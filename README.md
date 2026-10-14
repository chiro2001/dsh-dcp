# dsh-dcp

DeepSeek Harness（dsh）的动态上下文管理插件：对标
[opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
（opencode-dcp）的原理与实现，在 dsh 上提供模型驱动的上下文压缩、工具结果剪枝、
错误输入清理、压缩块嵌套、受保护内容保留、手动命令与统计。

> **状态**：已发布基线为 v0.1.0-rc.6-1；当前工作版本 v0.1.0-rc.9
> 精确适配 dsh `0.2.0-rc.2`，包含低开销提示与延迟清理修复，尚未创建 tag 或发布。
> 详细方案见 [docs/PLAN.md](docs/PLAN.md)，协议见
> [docs/PROTOCOL.md](docs/PROTOCOL.md)，变更见
> [docs/CHANGELOG.md](docs/CHANGELOG.md)，下一阶段见
> [docs/ROADMAP.md](docs/ROADMAP.md)。

## 范围说明

dsh-dcp 是纯**上下文管理**插件：不含任何 TUI、前端或 HTTP 桥组件，也不启动
外部终端程序。项目存在一个目标不同的既有 TUI 前端插件（在 dsh 进程内提供
HTTP/SSE 桥并拉起官方 TUI），它属于界面层；实现本插件时**不要直接查看或复用
该 TUI 插件的代码与文档**。dsh-dcp 的设计依据是 opencode-dcp 的原理与 dsh
官方扩展点文档，bundle 结构使用 dsh 插件标准格式
（`package.json#dsh.bundle` + `cordis.patch.yml`）。

## 安装预览

以下默认分支安装适用于 dsh **`0.2.0-rc.2`**；从旧版更新时先升级宿主。
仍使用 dsh `0.1.1-rc.2` 的用户请固定下方 `v0.1.0-rc.6-1` tag。
主分支合入与正式版本发布分别进行，rc.9 的 tag 和 GitHub Release 尚未创建。

```bash
dsh plugin --profile web add chiro2001/dsh-dcp
```

安装源为 GitHub 仓库 `chiro2001/dsh-dcp`（npm 包名
`@chiro2001/dsh-dcp`，未发布 registry）。固定版本/分支：

```bash
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#v0.1.0-rc.6-1'
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#develop'
```

pnpm 对 git 源插件执行 `prepare` 构建（本包已声明 `prepare: pnpm build`），
`lib/` 构建产物也随仓库提交，保证直装可用。pnpm 11 默认禁止 git 源包执行
构建脚本，若安装报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，按报错提示把
**错误信息中打印的精确键**加入 profile 的 `pnpm-workspace.yaml`
（默认 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  '@chiro2001/dsh-dcp@https://codeload.github.com/chiro2001/dsh-dcp/tar.gz/<commit>': true
```

其中 `<commit>` 以报错里的 URL 为准、原样复制，保存后重新执行同一条
`dsh plugin ... add` 命令即可。若 pnpm 还拦截 `esbuild`/`koffi` 等依赖的
构建脚本，同样按提示追加对应条目。

安装后插件以 `dsh.bundle.patch` 声明的 `cordis.patch.yml` 挂载到 profile，
并注册：

- 模型工具 `compress`（range；message 模式延后）
- 稳定系统提示 section（压缩规则）；动态边界与 nudge 单独日志化
- 人类命令 `/dcp` 与 `/dcp-compress`
- 日志化边界 marker 与压缩检查点（标准 `user/message`/`tool/result`
  surface replace）

> 说明：v0.1 不写自定义 `dcp/*` 会话事件（宿主契约限制，见
> `tests/contract/DECISIONS.md`）；压缩/剪枝通过标准 surface replace 落地，
> 原始日志永不删除。

## 能力

- `compress` 工具：half-open range、工具配对校验、一次可传多个 non-overlapping
  range（各自独立事务）、`bN` 嵌套、闭合 step 后的摘要调用清理；摘要正文不得以
  `[bN]` 块引用前缀开头（构造 checkpoint 时也会自动剥离）。
- 压缩恢复：工具结果区分 `success`/`partial`/`rejected`，失败长摘要会以带
  provenance 的 cleanup marker 从模型可见 surface 清理，并返回定向 correction。
- 保护：用户消息/`<protect>`/受保护工具/文件路径/来源 verbatim 附录；
  system/developer 与 instructions/snapshot 硬保护。
- 自动策略：重复调用去重（pre-step，幂等）；错误单元清理（实验，默认关）。
- 命令：`/dcp help|context|stats|manual|compress|sweep|show|decompress|recompress`。
- 恢复：raw show 与 `--into-context` semantic expansion / recompress。
- 与 dsh 原生 compaction 共存（surface membership reconciliation）。

默认仅在每个 turn 的第一个 step 写一个 `mNNNN` 边界，后续 step 仅在实际需要
nudge 或 alias 时写短消息。可用 `references.granularity: step` 保留每步边界。
关闭 `compress.enabled` 后停止边界和压缩提示注入，自动工具去重仍可单独使用。
cleanup 只处理纯 compress 调用、结果配对完整且已有后续闭合模型响应消费结果的记录，并仅在估算
净节省为正时执行；含回答或 reasoning 的 assistant 消息保留原样。

## 已知限制（v0.1）

- 无精确多节点 decompress；message-mode 与 Code Mode 延后。
- purge-errors 默认关闭；子代理 child-session 深读取默认关闭。

## 验证与费用评估

功能验证通过不等于实际费用下降。目前已有官方 DeepSeek API 的真实工具调用、
压缩提交、恢复与事实召回验证；费用收益仍处于实验阶段，尚未证明稳定节省。

2026-10-14 的单场景实验从相同的 **47.8 万 token 对话状态**和独立环境副本续作，
使用官方 `deepseek-flash` 完成同一个事件账本修复任务，两边各通过 12 项独立验收：

| 指标          |  完整历史 | 指定一次 DCP 压缩 |
| ------------- | --------: | ----------------: |
| 平均输入      |  48.07 万 |           3.32 万 |
| 续作请求数    |         6 |                23 |
| 续作 API 费用 | $0.011411 |         $0.012177 |

平均输入下降 **93.1%**，续作费用却增加 **6.7%**：更多代码修改和验证循环带来的
输出与未缓存输入费用抵消了缓存输入节省。这是构造调查回放后的单组真实续作，
不能据此判断自动触发策略或全部任务的收益，也不能直接将路径差异归因为能力下降。
共同准备费用另列，详见[单场景报告](docs/evaluation-runs/2026-10-14T13-30-33-997Z-single-ledger/report.md)。

另有 36 次标准任务开发 pilot；该轮平均上下文仅约 1.6–1.9 万 tokens，且未触发
压缩，定位为短上下文计量与部署开销检查。完整指标、实验边界与复现方式见
[评估方案](docs/EVALUATION.md)和[首轮报告](docs/evaluation-runs/2026-10-14T10-01-50-936Z/report.md)。

## 兼容矩阵

- `v0.1.0-rc.9`（当前工作版本，未发布）：精确支持 dsh `0.2.0-rc.2`、Cordis `4.0.4`、Schemastery `3.18.4`。
- `v0.1.0-rc.8`（历史工作版本）：目标同为 dsh `0.1.2-rc.1`，包含 rc.7 兼容基线及压缩提示/失败恢复优化；尚未创建 tag 或发布。
- `v0.1.0-rc.7`：实测并精确锁定 dsh `0.1.2-rc.1`；尚未创建 tag 或发布。
- `v0.1.0-rc.6-1`：实测支持 dsh `0.1.1-rc.2`。旧宿主继续使用该固定 tag。
- 不维护跨 breaking rc 的运行时兼容层；其他 dsh 版本必须先跑相同矩阵，再进入
  对应的新插件版本。

## 自测

```bash
pnpm check:upstream       # 与 npm 稳定渠道比较，发现新版本即提示迁移
pnpm test                 # 单测/契约/集成（含真实 e2e 的跳过逻辑）
bash scripts/check-all.sh --coverage
pnpm run e2e:real         # 真实 Agent + 官方 DeepSeek API / deepseek-flash
```

`e2e:real` 在隔离临时 DSH_HOME 中运行，Node 从 `~/litellm/.env` 只在内存加载
凭据，外部环境变量优先；普通 `pnpm test` 不触发真实调用。默认使用官方
`https://api.deepseek.com/v1`，读取 `DEEPSEEK_API_KEY`，模型 `deepseek-flash`、
provider `deepseek`、thinking disabled。无默认 key 自动跳过，显式选择的 key 缺失
则报错；非官方 origin（含非默认端口）必须显式绑定 key 的环境变量名。
`probes:real` 与 `kv-ab` 共用这些默认值。直接运行上面的命令即可；需明确覆盖时：

```bash
DSH_DCP_LLM_API_KEY_ENV=DEEPSEEK_API_KEY \
DSH_DCP_LLM_BASE_URL=https://api.deepseek.com/v1 \
DSH_DCP_LLM_MODEL=deepseek-flash \
DSH_DCP_LLM_PROVIDER=deepseek \
DSH_DCP_LLM_THINKING=disabled \
pnpm run e2e:real
```

同样的配置下可运行 `DSH_DCP_PROBES=3 pnpm probes:real`，重复真实矩阵并生成
不可覆盖的 `docs/real-model-validation/<timestamp>.md` 报告；失败或全部跳过不算成功。
测试覆盖原生工具调用、模型自行摘要、先消费结果再清理、partial 故障恢复、嵌套
保真和移除原消息后的事实召回。partial 是显式瞬时提交故障注入，不代表观察到服务商故障。
2026-10-14 官方 `deepseek-flash`（thinking disabled）五场景连续三轮，15/15 通过，
共 99 个请求；[最终实测报告](docs/real-model-validation/2026-10-14T05-15-23-101Z.md)
保存逐轮结果、token/cache 指标、脱敏原始输出与源码指纹。额外两个专项使用
398-token 历史和显式 32/512 净节省阈值，验证短摘要保真与拒绝后停止；
不代表默认 256 阈值一定提交。该结果只覆盖本模型与合成夹具；此前失败证据仍保留，
修复依据见 [PLAN §25](docs/PLAN.md#25-真实模型验证与结果观测后的-cleanup)。
最终适配器只执行服务商原生 `tool_calls`；模型正文中的 XML 原样记录，不转成工具调用。
切换默认值后，不带接口/模型覆盖参数的五场景单轮也已 5/5 通过，
见[官方默认配置报告](docs/real-model-validation/2026-10-14T05-22-36-408Z.md)。
本地 `/tmp` 受限时测试临时目录使用仓库内
`.tmp-vitest/`（已 gitignore）。

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 详细实现规划（目标、架构决策、功能映射、
  模块设计、里程碑、测试、风险）
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — 协议 v1（边界、持久化、命令、恢复、
  与原生 compaction 共存）
- [docs/COMPRESSION.md](docs/COMPRESSION.md) — 压缩处理流（模型调用、校验、
  checkpoint 注入、延迟 cleanup、模型可见语义、审计与恢复）
- [docs/COMPRESSION-RULES.md](docs/COMPRESSION-RULES.md) — 压缩关键规则维护专区（安全
  不变式、结果状态机、首次调用模板、摘要保真与配置注入边界）
- [docs/STATS.md](docs/STATS.md) — 统计语义（signed ledger、domain record、
  `/dcp stats` 口径）
- [docs/EVALUATION.md](docs/EVALUATION.md) — 压缩算法评估设计（质量门槛、完整费用、
  阶段判断、缓存回本、对照实验）、已实现的 runner 与实测结果
