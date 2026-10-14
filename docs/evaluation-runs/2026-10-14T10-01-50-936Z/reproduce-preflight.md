# 复现本轮真实模型接入预检

以下命令由 Agent 执行，用户不承担测试工作。用于复现同一任务、运行配置与环境版本，
不保证随机模型轨迹、服务商缓存或回答逐字相同。正式 pilot 的源码指纹与配置见
[协议](raw/protocol.json)，环境快照见 [environment-reproduction.json](raw/environment-reproduction.json)。
本轮尚未提交的运行源码已按 [指纹清单](raw/runtime-source.json) 保存实际文件到
`raw/frozen-runtime-source.tar.gz`。后续代码改变时，应在独立 checkout 中恢复并逐文件核对，
不直接覆盖正在运行的工作区。该快照覆盖模型执行、评分、配置和依赖锁，不是整仓库
或全部测试文件备份；离线门禁的实测证据另见 `raw/offline-gate.log`。

在插件仓库根目录先执行 `pnpm install --frozen-lockfile`。Docker daemon 须可用。
本轮宿主为 Python 3.14.6、Node 26.5.1、pnpm 11.9.0、Docker 29.7.1，Harbor 0.24.0。
以下步骤不安装或锁定宿主 Node/pnpm/Docker 工具链，执行环境须先提供这些记录的版本。
新环境按固定 revision 建立本地输入（已存在的目录不重复 clone）：

```bash
mkdir -p .tmp-vitest/evaluation-setup/tmp
git clone https://github.com/harbor-framework/terminal-bench-2.git .tmp-vitest/evaluation-setup/terminal-bench-2
git -C .tmp-vitest/evaluation-setup/terminal-bench-2 checkout --detach 2fd12b88aafdd04a52c298e3940bcb189f9766d6
git clone https://github.com/harbor-framework/harbor.git .tmp-vitest/evaluation-setup/harbor-source
git -C .tmp-vitest/evaluation-setup/harbor-source checkout --detach b53b8134e1241686dca7759af188f987ecc48e8b
python3.14 -m venv .tmp-vitest/evaluation-setup/.venv
.tmp-vitest/evaluation-setup/.venv/bin/python -m pip install --index-url https://pypi.org/simple -r docs/evaluation-runs/2026-10-14T10-01-50-936Z/raw/python-requirements.txt
```

实际安装使用公共 PyPI wheel，Harbor source checkout 用于版本核对，不是可编辑安装。
环境 JSON 的 `commands` 是最短审计示例，仅 pin Harbor；重建全部 93 项包须采用上方
`-r python-requirements.txt` 命令，不能把该缩略示例当完整依赖锁定步骤。
93 项包版本已冻结，但未冻结每个 wheel 的下载内容 hash；上游删除版本或改变构建平台
时仍可能无法重建。原源码的 `uv.lock` 不作为这份 pip venv 的锁文件。

复制官方 fix-git 输入，仅将环境镜像引用锁为本轮资格检查的 digest；不改变指令和 verifier：

```bash
python3.14 - <<'PY'
import json
import shutil
from pathlib import Path

root = Path.cwd()
setup = root / '.tmp-vitest/evaluation-setup'
protocol = json.loads((root / 'docs/evaluation-runs/2026-10-14T10-01-50-936Z/raw/protocol.json').read_text())
target = setup / 'preflight-input/fix-git'
if target.exists():
    raise RuntimeError('Preflight input already exists; preserve prior evidence')
shutil.copytree(setup / 'terminal-bench-2/fix-git', target)
path = target / 'task.toml'
text = path.read_text()
old = 'docker_image = "alexgshaw/fix-git:20251031"'
if text.count(old) != 1:
    raise RuntimeError('Unexpected official task image declaration')
digest = protocol['frozenInputs']['fix-git']['imageDigest']
path.write_text(text.replace(old, f'docker_image = "{digest}"'))
PY
```

先用该输入运行 oracle 资格检查，失败时保留结果，不开始模型推理：

```bash
HARBOR_TELEMETRY=0 TMPDIR="$PWD/.tmp-vitest/evaluation-setup/tmp" \
  .tmp-vitest/evaluation-setup/.venv/bin/harbor run \
  --path .tmp-vitest/evaluation-setup/preflight-input/fix-git \
  --agent oracle --env docker --n-concurrent 1 --n-attempts 1
```

真实 Agent 预检命令如下。每次使用新的 job name，禁止 resume 旧结果。第二臂将
`arm=baseline` 改为 `arm=dcp`，并使用新的 job name；两臂预算保持一致：

```bash
PYTHONPATH="$PWD" HARBOR_TELEMETRY=0 TMPDIR="$PWD/.tmp-vitest/evaluation-setup/tmp" \
  .tmp-vitest/evaluation-setup/.venv/bin/harbor run \
  --path .tmp-vitest/evaluation-setup/preflight-input/fix-git \
  --agent scripts.evaluation.harbor_agent:DSHAgent \
  --model deepseek/deepseek-flash \
  --ak arm=baseline --ak task_id=fix-git --ak replicate=0 \
  --ak max_requests=20 --ak max_seconds=120 --ak max_cost_usd=0.1 \
  --env docker --n-concurrent 1 --n-attempts 1 \
  --jobs-dir .tmp-vitest/evaluation-setup/jobs \
  --job-name "preflight-baseline-$(date -u +%Y%m%dT%H%M%SZ)"
```

控制器仅在宿主 Node 内存读取外部 `DEEPSEEK_API_KEY`，或 `~/litellm/.env` 中的默认 key；
外部 env 优先，不打印、不写配置、不传容器。路由强制官方
`https://api.deepseek.com/v1`、`deepseek-flash`、thinking disabled。新日期重跑前应重新
冻结官方价格；本轮保存的价表是 2026-10-14 的引用，不当作永久报价。

成功依据官方 trial `verifier_result.rewards.reward=1`、无 trial exception、执行正常完成，
不以模型最后一句话判定。检查 `agent/ledger.json` 中全部请求、usage 和费用；缺 usage
保留 unknown。原预检两臂结果位于 [preflight](raw/preflight/)，不混入正式 pilot。

正式 batch 使用 `pnpm eval:benchmark --qualification <本机新资格快照>`。当前资格快照
含本机 oracle trial/lock 的绝对路径，作为本轮证据保存；迁移到新机器须重新做资格检查
并生成本机快照，不能直接复用原路径。阶段 fork 与新候选算法不在本轮实现范围。
