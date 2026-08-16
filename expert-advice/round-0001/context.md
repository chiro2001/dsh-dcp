# Round 0001 context — dsh-dcp 开发规划修订咨询

## 项目与仓库

- 仓库根目录：`/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning`
- 当前 commit：`27743f2bc25c0cf90c11c3c6c19248f1269e8934`（`main`）
- 当前内容：仅有规划文档，无代码
  - `docs/PLAN.md` —— **本次修订对象**（必读全文）
  - `README.md` —— 项目简介与范围说明（快速背景）
  - `expert-advice/round-0001/prompt.md` —— 本轮的请求（必读）
  - `expert-advice/round-0001/context.md` —— 本文

## 输入材料（按需读取）

- 参考实现 opencode-dcp v3.1.15 源码镜像：
  `/home/chiro/projects/dsh-dynamic-context-pruning/opencode-dynamic-context-pruning`
  （重点：`README.md`、`lib/hooks.ts`、`lib/compress/*`、`lib/messages/*`、
  `lib/commands/*`、`lib/strategies/*`、`lib/state/*`、`lib/prompts/*`、
  `lib/protected-patterns.ts`、`tests/`）
- dsh 源码 checkout：本地 `~/projects` 下名为 `deepseek-harness` 的目录
  （可用 `find ~/projects -maxdepth 2 -type d -name deepseek-harness` 定位；
  目录所在父路径与本项目无关，不必在文档中复述）
  - 必读：`docs/architecture.md`、`docs/agent-lifecycle.md`、
    `docs/tool-execution-pipeline.md`、`packages/core/agent-loop/src/invariant.ts`
  - 按需：`packages/core/system-prompt/README.md`、`packages/core/tools/README.md`、
    `packages/core/session/README.md`、`packages/llm/llm/README.md`、
    `packages/llm/token-meter/README.md`、`packages/compaction/*/README.md`、
    `packages/interaction/commands/README.md`、`packages/settings/*/README.md`、
    `packages/storage/storage-domain/README.md`、`packages/subagent/*/README.md`

## 已确认的关键事实（规划依据，供审阅时核对）

1. dsh 的 agent-loop request-reconstruction invariant 在 `llm/stream` 前检查：
   `options.messages` 必须与 `session.deriveMessages()` 逐字节一致，且请求必须
   冻结；`agent/request` waterfall 明确“不能改写消息”。
2. dsh 会话日志是只追加事件流；surface 成员为 `user/message`、
   `assistant/message`、`tool/result`，支持 `surfaceOp: replace`；`tool/result`
   支持 content-only 单结果替换（`dsh-compaction-tool-result-pruner` 先例）。
3. `SessionEventMap` 可声明合并新增事件；未知类型带 `ignorable: true` 时未装
   插件的进程可安全加载会话。
4. 原生 compaction（`ctx.compaction` / `compaction-basic` / `/compact`）已存在：
   token 压力 + 摘要 + 表面替换；dsh-dcp 定位为模型驱动的补充层，不替换它。
5. opencode-dcp 的核心机制：请求时改写消息、每会话 JSON 状态、模型在工具参数
   内联摘要、dedup/purge-errors 自动策略、`/dcp` 命令族、`mNNNN/bN` 边界体系、
   保护内容（工具/文件模式/`<protect>`/用户消息/子代理）。
6. 环境：Node >=22，pnpm，目标 dsh 版本 `0.1.0-rc.x`；插件以
   `package.json#dsh.bundle` + `cordis.patch.yml` 挂载。

## 审阅重点（规划中仍有争议/待验证的假设）

- 用系统提示“边界索引”替代 opencode 的逐条消息 tag，模型能否可靠选择范围；
- 压缩/剪枝全部落地为持久 surface replace 的取舍（cache 失效、事件量、
  decompress/recompress 语义）；
- 摘要由模型内联（与 opencode 一致）vs 插件自调用 `ctx.llm.stream` 的取舍；
- 自动策略在 `agent/pre-step` 落地的并发/重入安全性；
- 与原生 compaction 共存的锚点复位与统计口径；
- `dcp/*` 事件承载全部状态 vs 部分状态外置（storage-domain）的边界。

## 执行方式（本次咨询的等价命令）

流程参照参考项目的“顶级模型咨询流程”（`docs/06-agent-iteration-protocol.md`
§5）执行。由于本咨询发生在 Codex 会话内，等价于：

```text
model: gpt-5.6-sol
reasoning effort: max
沙箱: workspace-write，但只允许写 expert-advice/round-0001/ 下的输出文档
输出: response.md（最终回复 + 修订摘要）；revised-plan.md（完整修订版 PLAN）
```

执行 Agent 在收到 `response.md` 后写 `decision.md`，并把接受的修订落到
`docs/PLAN.md`。

## 禁止事项

- 不查看“既有 TUI 前端插件”项目（在 dsh 进程内提供 HTTP/SSE 桥并拉起官方
  TUI 的那个仓库）；其父目录与 dsh 源码 checkout 相邻，注意不要误入。
- 不修改 `docs/PLAN.md`、README、源码、测试或任何 round 目录之外的文件。
- 不执行 pnpm/npm/git 写操作、构建、测试或安装。

