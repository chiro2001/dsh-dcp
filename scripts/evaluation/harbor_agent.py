"""Harbor controller for production dsh. No model key is supplied to the container."""
import asyncio
import json
import math
import os
import time
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

PROJECT = Path(__file__).resolve().parents[2]


def _write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".writing")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


class DSHAgent(BaseAgent):
    def __init__(self, *args, arm="baseline", task_id="unknown", replicate=1,
                 max_requests=80, max_seconds=300, max_cost_usd=1, **kwargs):
        super().__init__(*args, **kwargs)
        if arm not in {"baseline", "dcp"}:
            raise ValueError("arm must be baseline or dcp")
        self.arm = arm
        self.task_id = task_id
        self.replicate = int(replicate)
        self.max_requests = int(max_requests)
        self.max_seconds = float(max_seconds)
        self.max_cost_usd = float(max_cost_usd)
        self.cwd = None

    @staticmethod
    def name():
        return "dsh-dcp-evaluation"

    def version(self):
        return "0.2.0-rc.2/dcp-0.1.0-rc.9"

    async def setup(self, environment: BaseEnvironment):
        result = await environment.exec("pwd", timeout_sec=10)
        if result.return_code != 0 or not result.stdout.strip().startswith("/"):
            raise RuntimeError("Cannot establish the task container working directory")
        self.cwd = result.stdout.strip()

    def _account(self, ledger, context):
        totals = ledger.get("usageTotals", {})
        if ledger.get("usageComplete"):
            context.n_input_tokens = totals.get("uncachedInputTokens", 0) + totals.get("cacheReadTokens", 0)
            context.n_cache_tokens = totals.get("cacheReadTokens", 0)
            context.n_output_tokens = totals.get("outputTokens", 0)
        context.cost_usd = ledger.get("totalCost")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext):
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"{self.task_id}-{self.arm}-r{self.replicate}-{self.session_id or time.time_ns()}"
        context.metadata = {"execution_status": "running", "verification": "pending",
                            "ledger_path": str(self.logs_dir / "ledger.json")}
        process = None
        stderr_task = None
        done = None
        try:
            process = await asyncio.create_subprocess_exec(
                "node", f"--env-file-if-exists={Path.home() / 'litellm' / '.env'}",
                "--import", "tsx", str(PROJECT / "scripts/evaluation/run-agent.ts"),
                cwd=PROJECT, env=dict(os.environ), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=2**22,
            )
            stderr_task = asyncio.create_task(process.stderr.read())
            initial = {
                "kind": "init", "descriptor": {
                    "runId": run_id, "taskId": self.task_id, "arm": self.arm,
                    "replicate": self.replicate, "model": "deepseek-flash",
                    "provider": "deepseek", "startedAt": int(time.time() * 1000),
                },
                "instruction": instruction, "cwd": self.cwd,
                "dcpEnabled": self.arm == "dcp", "outputDir": str(self.logs_dir),
                "budget": {"maxRequests": self.max_requests,
                           "deadlineMs": self.max_seconds * 1000,
                           "maxCostUSD": self.max_cost_usd},
            }
            process.stdin.write((json.dumps(initial) + "\n").encode())
            await process.stdin.drain()
            while line := await process.stdout.readline():
                try:
                    frame = json.loads(line)
                except (ValueError, UnicodeError):
                    continue  # Non-protocol Cordis diagnostics are not tool results.
                if not isinstance(frame, dict):
                    continue
                if frame.get("kind") == "exec":
                    response = {"id": frame["id"]}
                    try:
                        result = await environment.exec(
                            frame["command"], cwd=self.cwd,
                            timeout_sec=math.ceil(frame["timeoutSec"]),
                        )
                        response.update(kind="result", stdout=result.stdout or "",
                                        stderr=result.stderr or "", returnCode=result.return_code)
                    except Exception as error:
                        response.update(kind="error", message=str(error)[:300])
                    process.stdin.write((json.dumps(response) + "\n").encode())
                    await process.stdin.drain()
                elif frame.get("kind") == "done":
                    done = frame["result"]
                    _write_json(self.logs_dir / "ledger.json", done["ledger"])
                    _write_json(self.logs_dir / "execution.json", done)
                    self._account(done["ledger"], context)
                    context.metadata.update(execution_status=done["execution"]["status"],
                                            verification="pending")
                elif frame.get("kind") == "controller_error":
                    raise RuntimeError(frame.get("message", "Node controller failed"))
            return_code = await process.wait()
            if done is None or return_code != 0:
                raise RuntimeError(f"Node controller exited without valid completion (exit={return_code})")
        except BaseException:
            context.metadata.update(execution_status="error", verification="pending",
                                    accounting_status="unknown")
            ledger_path = self.logs_dir / "ledger.json"
            if ledger_path.exists():
                try:
                    self._account(json.loads(ledger_path.read_text()), context)
                except (ValueError, OSError):
                    pass
            raise
        finally:
            if process is not None and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except TimeoutError:
                    process.kill()
                    await process.wait()
            if stderr_task is not None:
                # No raw subprocess environment or provider configs are logged.
                await stderr_task
