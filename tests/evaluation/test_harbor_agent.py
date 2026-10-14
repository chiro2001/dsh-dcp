import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from harbor.environments.base import ExecResult
from harbor.models.agent.context import AgentContext

from scripts.evaluation.harbor_agent import DSHAgent


def ledger_fixture():
    return {
        "runId": "harbor-run-1",
        "taskId": "task-1",
        "arm": "baseline",
        "replicate": 1,
        "model": "deepseek-flash",
        "provider": "deepseek",
        "version": 1,
        "attempts": [],
        "outcome": "failure",
        "success": False,
        "finishedAt": 1_800_000_000_000,
        "externalCost": 0,
        "usageComplete": True,
        "usageTotals": {
            "uncachedInputTokens": 100,
            "cacheReadTokens": 30,
            "outputTokens": 40,
            "reasoningTokens": 12,
        },
        "knownCost": 0.123,
        "totalCost": 0.123,
    }


def done_frame(ledger=None):
    return {
        "kind": "done",
        "result": {
            "ledger": ledger or ledger_fixture(),
            "execution": {"status": "completed", "requestCount": 1},
            "verification": "pending",
        },
    }


def exec_frame(command="false"):
    return {"kind": "exec", "id": 1, "command": command, "timeoutSec": 4}


class FakeStdin:
    def __init__(self):
        self.writes = []
        self.closed = False

    def write(self, data):
        self.writes.append(data.encode() if isinstance(data, str) else bytes(data))

    async def drain(self):
        return None

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None

    def decoded_lines(self):
        payload = b"".join(self.writes).decode()
        return [json.loads(line) for line in payload.splitlines() if line.strip()]


class FakeProcess:
    def __init__(self, frames=(), returncode=0, stderr=""):
        self.stdin = FakeStdin()
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.returncode = returncode
        self.terminated = False
        for frame in frames:
            self.stdout.feed_data((json.dumps(frame) + "\n").encode())
        self.stdout.feed_eof()
        if stderr:
            self.stderr.feed_data(stderr.encode())
        self.stderr.feed_eof()

    async def wait(self):
        return self.returncode

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.terminated = True


class FakeEnvironment:
    def __init__(self, terminal_error=None):
        self.calls = []
        self.terminal_error = terminal_error

    async def exec(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command == "pwd":
            return ExecResult(stdout="/workspace/terminal-task\n", return_code=0)
        if self.terminal_error is not None:
            raise self.terminal_error
        return ExecResult(stdout="ok\n", stderr="", return_code=0)


class HarborAgentTests(unittest.IsolatedAsyncioTestCase):
    def make_agent(self, logs_dir):
        return DSHAgent(
            logs_dir=logs_dir,
            model_name="deepseek-flash",
            arm="baseline",
            task_id="task-1",
            replicate=1,
            max_requests=80,
            max_seconds=300,
            max_cost_usd=1,
        )

    async def setup_agent(self, logs_dir, environment):
        agent = self.make_agent(logs_dir)
        await agent.setup(environment)
        return agent

    async def test_passes_instruction_as_json_to_host_node_and_keeps_key_out_of_container(self):
        with tempfile.TemporaryDirectory() as temporary:
            logs_dir = Path(temporary) / "logs"
            environment = FakeEnvironment()
            agent = await self.setup_agent(logs_dir, environment)
            process = FakeProcess([done_frame()])
            context = AgentContext()
            spawn = AsyncMock(return_value=process)

            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "host-only-secret"}):
                with patch("scripts.evaluation.harbor_agent.asyncio.create_subprocess_exec", spawn):
                    await agent.run("write READY then report it", environment, context)

            call = spawn.await_args
            self.assertIsNotNone(call)
            argv = [str(part) for part in call.args]
            self.assertEqual(argv[0], "node")
            self.assertTrue(any(part.endswith("scripts/evaluation/run-agent.ts") for part in argv))
            child_env = call.kwargs.get("env")
            if child_env is None:
                child_env = os.environ
            self.assertEqual(child_env.get("DEEPSEEK_API_KEY"), "host-only-secret")

            init_frames = process.stdin.decoded_lines()
            init = next(frame for frame in init_frames if frame.get("kind") == "init")
            self.assertEqual(init["instruction"], "write READY then report it")
            self.assertEqual(init["cwd"], "/workspace/terminal-task")
            self.assertEqual(init["descriptor"]["arm"], "baseline")
            self.assertEqual(init["budget"]["maxRequests"], 80)
            self.assertEqual(init["budget"]["deadlineMs"], 300_000)
            self.assertEqual(init["budget"]["maxCostUSD"], 1)
            self.assertFalse(init["dcpEnabled"])
            self.assertNotIn("host-only-secret", json.dumps(init_frames))
            for _, kwargs in environment.calls:
                self.assertNotIn("DEEPSEEK_API_KEY", kwargs.get("env") or {})

            self.assertEqual(context.n_input_tokens, 130)
            self.assertEqual(context.n_cache_tokens, 30)
            self.assertEqual(context.n_output_tokens, 40)
            self.assertEqual(context.cost_usd, 0.123)
            self.assertIn("pending", json.dumps(context.metadata))

    async def test_container_exec_error_is_returned_to_node_and_final_ledger_is_saved(self):
        with tempfile.TemporaryDirectory() as temporary:
            logs_dir = Path(temporary) / "logs"
            environment = FakeEnvironment(RuntimeError("container exec unavailable"))
            agent = await self.setup_agent(logs_dir, environment)
            expected_ledger = ledger_fixture()
            process = FakeProcess([exec_frame(), done_frame(expected_ledger)])
            context = AgentContext()
            spawn = AsyncMock(return_value=process)

            with patch("scripts.evaluation.harbor_agent.asyncio.create_subprocess_exec", spawn):
                await agent.run("run a command", environment, context)

            frames = process.stdin.decoded_lines()
            error_frame = next(frame for frame in frames if frame.get("kind") == "error")
            self.assertEqual(error_frame["id"], 1)
            self.assertIn("container exec unavailable", error_frame["message"])

            saved_ledger = json.loads((logs_dir / "ledger.json").read_text())
            self.assertEqual(saved_ledger, expected_ledger)
            self.assertTrue((logs_dir / "execution.json").is_file())
            self.assertEqual(context.n_input_tokens, 130)
            self.assertEqual(context.cost_usd, 0.123)

    async def test_child_exit_without_done_raises_and_retains_error_accounting_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            logs_dir = Path(temporary) / "logs"
            environment = FakeEnvironment()
            agent = await self.setup_agent(logs_dir, environment)
            process = FakeProcess(returncode=17, stderr="node controller crashed")
            context = AgentContext()
            spawn = AsyncMock(return_value=process)

            with patch("scripts.evaluation.harbor_agent.asyncio.create_subprocess_exec", spawn):
                with self.assertRaises(Exception):
                    await agent.run("run a task", environment, context)

            self.assertIsNotNone(context.metadata)
            self.assertIn("error", json.dumps(context.metadata).lower())


if __name__ == "__main__":
    unittest.main()
