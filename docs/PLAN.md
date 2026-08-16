# dsh-dcp 实现规划

> 状态：方案确认中，尚未开始编码。
> 仓库：`chiro2001/dsh-dcp`（private）。
> 参考实现：`opencode-dcp` v3.1.15（本机镜像位于当前仓库的兄弟目录
> `opencode-dynamic-context-pruning/`，remote 为
> `github.com/Opencode-DCP/opencode-dynamic-context-pruning`）。
> 目标读者：后续按本计划实施 dsh-dcp 的模型/工程师。

---

## 1. 背景、目标与边界

### 1.1 目标

在 DeepSeek Harness（dsh）上实现一个动态上下文管理插件 `@chiro2001/dsh-dcp`，
功能对标 opencode-dcp v3.1.15：

- **模型驱动压缩**：向模型暴露 `compress` 工具，让模型在任务完成后主动把
  已闭环、陈旧但仍有价值的对话内容替换为高保真技术摘要。
- **两种压缩模式**：`range`（连续消息区间 → 一个或多个摘要）与 `message`
  （单条原始消息独立压缩，可批量）。
- **嵌套压缩**：新压缩区间覆盖旧压缩块时，旧摘要以“块引用/占位符”形式嵌入新摘要，
  保证多层压缩不丢失关键信息。
- **自动策略**：重复工具调用去重（同工具+同参数保留最近一次）；错误工具调用
  在 N 轮后清理输入、保留错误消息。
- **受保护内容**：受保护工具输出、受保护文件路径模式、`<protect>` 标签内容、
  用户消息（可选）、子代理结果（可选）在压缩摘要中保留原文。
- **手动控制**：`/dcp` 命令族（context / stats / sweep / manual / compress /
  decompress / recompress / help）与手动模式。
- **上下文压力提示（nudge）**：在系统提示中按上下文上限/下限与迭代阈值注入
  压缩提醒。
- **消息边界体系**：`mNNNN`（消息引用）与 `bN`（压缩块引用），供模型选择压缩范围。
- **统计与状态**：会话内/跨会话 token 节省统计；会话状态可重放重建、可持久化。

### 1.2 与 dsh-oc 的关系及约束

`~/projects/dsh-oc` 是此前实现的 **TUI 前端插件**：它在 dsh 进程内提供
OpenCode 兼容 HTTP/SSE 桥并拉起官方 opencode TUI，属于“前端/界面”目标。

> **约束声明**：本项目的实现阶段**不要直接查看或复用 `~/projects/dsh-oc` 的
> 代码与文档**。它属于 TUI 插件，与 dsh-dcp 的上下文管理目标不同，直接参考会
> 引入错误的架构假设（HTTP 路由、opencode 协议、二进制管理等）。规划阶段为了
> 对齐项目背景做过浏览，但后续实现只依据：
>
> 1. opencode-dcp 的原理与公开实现（行为、提示词、状态语义）；
> 2. dsh 官方扩展点文档与源码（`deepseek-harness` 仓库）；
> 3. dsh-dcp 自身的需求。

dsh-dcp 与 dsh-oc 唯一允许的相似点：同为外置 profile bundle，使用
`package.json#dsh.bundle` + `cordis.patch.yml` 的挂载方式（这是 dsh 插件
标准格式，不是 dsh-oc 的私有设计）。

### 1.3 非目标（首版不做）

- **不包含任何 TUI / 前端 / HTTP 桥**：无 `@opentui`、无 webserver、无 opencode
  协议兼容层。
- **不做 opencode 式 toast / chat 通知注入**：dsh 的模型可见内容必须来自日志，
  不能向模型历史注入“忽略型”通知消息；通知改为日志 + 命令结果 + 工具结果文本。
- **不做 auto-update**：dsh 插件的更新机制是 `dsh plugin ... add/update`
  （pnpm 源安装），不复制 opencode-dcp 的 npm 自更新。
- **不替换/不 fork dsh 原生 compaction**：`/compact`、`ctx.compaction`、
  `dsh-compaction-basic` 继续保留；dsh-dcp 是模型驱动的补充层，两者可共存。
- **不修改 dsh 核心仓库**：所有能力通过公开扩展点实现。
- **不做 opencode 专属权限模型**：`ask/allow/deny` 语义映射到 dsh 的
  approval/工具管线；不引入新的全局权限表。

---

## 2. 参考实现原理摘要（opencode-dcp v3.1.15）

### 2.1 挂载点

opencode-dcp 是 opencode 插件，注册以下扩展点：

| opencode 扩展点 | 职责 |
|---|---|
| `experimental.chat.messages.transform` | 每次请求前改写消息：剪枝、注入摘要、消息 ID、nudge |
| `experimental.chat.system.transform` | 追加 DCP 系统提示（工具说明、块格式） |
| `experimental.text.complete` | 清理模型输出中的幻觉（重复工具调用/路径） |
| `tool: compress` | 注册压缩工具（range/message 两种实现） |
| `command.execute.before` | `/dcp` 与 `/dcp-compress` 命令 |
| `event` | 监听 `message.part.updated` 计算压缩耗时 |
| `config` | 权限默认值、primary_tools、命令定义 |

### 2.2 核心机制

- **永不修改会话历史**：所有剪枝/摘要只发生在“发送给模型的请求”上；
  服务端历史原样保留。压缩块以 `<dcp-message-id>bN</dcp-message-id>` 结尾的
  合成消息注入。
- **压缩状态**：每个 session 一个 JSON 文件（
  `~/.local/share/opencode/storage/plugin/dcp/{sessionId}.json`），保存压缩块、
  剪枝工具 ID、nudge 锚点、统计、手动模式。
- **压缩管线**：模型调用 `compress(topic, content:[{startId,endId,summary}])` →
  校验参数 → 拉取会话消息 → 重建状态 → 先跑自动策略（dedup/purge-errors）→
  解析边界（`mNNNN`/`bN`）→ 校验不重叠 → 解析块占位符 → 追加受保护内容
  （用户消息、`<protect>`、受保护工具、文件模式、子代理结果）→ 分配 blockId/runId →
  写入状态 → 返回结果。
- **摘要调用**：由模型在 `summary` 字段内联生成（opencode-dcp 不自己调 LLM，
  “高保真摘要”由模型即时产出）；DCP 只负责组装保护内容与状态。
- **自动策略**：dedup 按“工具名 + 规范化参数”签名分组，保留每组最后一次；
  purge-errors 按 turn 年龄剪掉错误工具输入。
- **消息 ID**：transform 阶段给每条用户/助手消息追加
  `<dcp-message-id>mNNNN</dcp-message-id>`（优先级标签可选），压缩块用
  `bN` 引用；`/dcp context` 展示 token 构成，`/dcp decompress/recompress`
  管理块生命周期。
- **nudge 锚点**：内存 + 持久化的锚点集合，按频率在上下文超限时向指定消息
  追加提示文本。

### 2.3 opencode 特有、不能直接照搬的部分

| opencode-dcp 机制 | 为何不能照搬 |
|---|---|
| 请求时改写 `messages` | dsh 有 `model-visible means logged` 不变式（见 §3.4） |
| opencode storage 目录 | dsh 有 session log / storage-domain |
| `@anthropic-ai/tokenizer` | dsh 有 `ctx.tokenMeter` 与 adapter 容量查询 |
| toast / chat 通知 | dsh 没有 toast；chat 通知会污染模型历史 |
| npm auto-update | dsh 插件用 pnpm/profile 源管理 |
| opencode permission 模型 | dsh 有 approval/tools 管线 |

---

## 3. dsh 架构基线（调研结论）

### 3.1 Profile / Bundle

- dsh 运行时是 Cordis 插件树：**profile** 列出 bundle 层；**bundle** 在
  `package.json#dsh.bundle.patch` 声明 `cordis.patch.yml`；层顺序为
  profile bundles → profile `cordis.patch.yml` → home 级 patch → `--patch`。
- 插件安装：`dsh plugin --profile <name> add <spec>` → 在 profile 目录执行
  pnpm → 按已安装依赖中声明 `dsh.bundle` 的包自动加入 bundle 层。
- 本次已创建 private 仓库 `chiro2001/dsh-dcp` 并设为本地仓库 origin。

### 3.2 关键扩展点

| dsh 扩展点/服务 | 能力 |
|---|---|
| `agent/pre-step`（waterfall） | 步骤前压力检查；可改写**进入步骤的输入消息**（不是历史） |
| `agent/request`（waterfall） | 只能替换调用配置，**不能改消息**（文档明确） |
| `llm/stream`（waterfall） | 拦截所有模型调用；请求必须冻结且与日志一致 |
| `ctx.systemPrompt.section/context/tools/variable` | 注入有序系统提示 section、动态上下文、工具 schema |
| `ctx.tools.register` / `defineTool` | 注册模型工具（schema + 输出 + 执行体 + 权限链） |
| `ctx.commands.register` | 人类命令（不进模型历史，返回 `CommandResult`） |
| `ctx.settings.register(ns, schema, ...)` | 用户配置命名空间（YAML/JSON，热更新） |
| `ctx.storageDomain` | 跨会话非模型可见状态（统计等） |
| `ctx.tokenMeter` | 会话 token 计量（`measure()`、`estimateMessage()`） |
| `ctx.llm.resolveModelInfo().context` | adapter 提供的模型上下文容量 |
| `ctx.llm.stream` + `purpose` | 辅助摘要调用（`purpose: 'compaction'` 已有先例） |
| `ctx.sessions` / `session.surface` / `session.events` | 追加事件、表面替换、重放 |
| `ctx.subagents` / `subagent/descriptor` | 子代理会话定位与结果读取 |
| `ctx.compaction`（可选） | 检测原生压缩事件，复位 DCP 锚点 |

### 3.3 会话日志与表面（Surface）

- 会话是**只追加事件日志**；`deriveMessages()` 从 surface 投影模型消息。
- surface 成员只有 `user/message`、`assistant/message`、`tool/result`；
  `surfaceOp: 'replace'` 可把一段旧节点替换为新节点，**原始事件仍在日志中**。
- `tool/result` 支持**仅内容替换**（`dsh-compaction-tool-result-pruner` 先例）。
- `SessionEventMap` 可声明合并，插件可新增 `dcp/*` 日志事件；未知类型带
  `ignorable: true` 时，未装插件的进程也能安全加载会话。

### 3.4 核心不变式（决定性约束）

`agent-loop` 的 request-reconstruction invariant 在 `llm/stream` 前检查：

```ts
const expected = session.deriveMessages()
if (JSON.stringify(options.messages) !== JSON.stringify(expected)) {
  fail('llm request ... diverges from the dispatch-time durable derivation')
}
```

因此 **dsh-dcp 不能像 opencode-dcp 那样在请求时临时改写/注入消息**。
任何模型可见的改动都必须以“日志中可重建”的形式落地。这直接决定了 §4 的架构。

---

## 4. 核心架构决策

### 4.1 决策总表

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 模型可见内容的落地方式 | **全部走会话日志**：压缩范围 → `user/message` + `surfaceOp replace`；工具剪枝 → `tool/result` content-only replace | 满足 `model-visible means logged` 不变式 |
| D2 | DCP 状态存储 | 会话内状态 = 日志中新增 `dcp/*` log-only 事件，重放重建；跨会话统计 = `ctx.storageDomain` | 单一事实来源、可重放、无需每会话 JSON 文件 |
| D3 | 系统提示注入 | `ctx.systemPrompt.section('dcp:guidance')`（动态 provider）+ 可选变量 | 随 `request/header` 落日志，可重建 |
| D4 | 压缩工具 | `ctx.tools.register(defineTool({ name: 'compress' }))`；`config.compress.permission === 'deny'` 时不注册 | dsh 原生工具管线/权限/展示 |
| D5 | 权限 | 默认走 dsh approval 链（`tools/pre-execute` + `ctx.approval`）；DCP 不做自己的 ask/allow/deny 表 | opencode 权限模型不可移植 |
| D6 | 命令 | `ctx.commands.register('/dcp')` + `/dcp-compress`；`/dcp compress` 通过 `agent.followup()` 发送**日志化**触发消息 | 命令结果不进模型历史；触发消息必须可重建 |
| D7 | 计量 | `ctx.tokenMeter`（权威）+ `ctx.llm.resolveModelInfo().context`（容量）+ 可选字符回退 | 不引入 tokenizer 依赖 |
| D8 | 配置 | `ctx.settings.register('dcp', schema)`；v1.1 可选项目级 `dcp.jsonc` 覆盖 | dsh 原生配置热更新 |
| D9 | 通知 | `ctx.logger` + 命令结果 + 工具结果文本；**不注入 chat 消息** | 避免污染模型历史 |
| D10 | 子代理结果 | 压缩时经 `ctx.subagents` / child session 读取最终输出，追加进保护内容 | 对标 opencode-dcp 的 `injectExtendedSubAgentResults` |
| D11 | 更新 | 不实现 auto-update；文档指引 `dsh plugin ... add github:chiro2001/dsh-dcp` | dsh 插件机制替代 |
| D12 | 原生 compaction 共存 | 监听 `compaction/*` 事件，检测到原生压缩后复位 nudge 锚点/统计基准 | 两个摘要体系不打架 |

### 4.2 总体数据流

```text
┌──────────── dsh（Cordis 插件树） ────────────┐
│ profile = dsh-base + dsh-dcp (bundle patch)  │
│                                              │
│ dsh-dcp 注册：                                │
│  · ctx.tools: compress（range/message）      │
│  · ctx.systemPrompt: dcp:guidance section    │
│  · ctx.commands: /dcp, /dcp-compress         │
│  · session/event: dcp/* 状态增量 + 原生compaction│
│  · agent/pre-step: 自动策略 + 压力 nudge 计算 │
│  · settings: dcp namespace                   │
│  · storageDomain: dcp 跨会话统计             │
└──────────────┬───────────────────────────────┘
               │
   模型调用 compress 工具（在 turn 内）
               │
               ▼
  1. 读取 session.events / deriveMessages，重放重建 DcpState
  2. 校验参数（topic, ranges/messages, summaries）
  3. 先执行自动策略（dedup / purge-errors）→ 必要时 tool/result replace
  4. 解析 mNNNN / bN 边界，校验不重叠与嵌套关系
  5. 解析旧块占位符，组装保护内容（用户消息/<protect>/工具/文件/子代理）
  6. 不自行调 LLM：摘要由模型在参数中给出（与 opencode-dcp 一致）
  7. append dcp/compress（log-only）+ user/message replace（摘要节点）
  8. 更新 dcp 统计（storageDomain）与工具结果文本

   系统提示（每次 assemble）：
  ctx.systemPrompt.section('dcp:guidance')
    · compress 工具使用说明与边界格式
    · mNNNN/bN 边界索引（最近 N 条，含主题摘录）
    · 上下文压力 nudge（over max/min、迭代阈值）
    · 手动模式状态说明
```

### 4.3 与 opencode-dcp 的行为差异（有意为之）

| 行为 | opencode-dcp | dsh-dcp |
|---|---|---|
| 摘要落地 | 每次请求时临时注入 | 持久 `user/message` surface replace（原始日志保留） |
| 剪枝落地 | 每次请求时临时替换输出 | 持久 `tool/result` content-only replace |
| 消息 ID | 每条消息临时追加 tag | 系统提示内维护边界索引（`mNNNN ↔ 主题摘录`），压缩块 footer 带 `bN` |
| 状态持久化 | 每会话 JSON 文件 | 日志重放 + storage-domain 统计 |
| 摘要生成 | 模型参数内联 | 同（保持“模型即时生成摘要”语义） |
| 权限 | opencode permission | dsh approval 链 |

`decompress` 语义相应变化：在 dsh 中恢复 = 追加新的 `user/message` surface
replace（把被压缩区间放回表面）或撤销 `tool/result` replace（追加恢复内容的
content-only replace）。原始事件始终在日志中，因此恢复是安全、可重建的。

---

## 5. 会话状态模型（dcp/* 事件）

### 5.1 事件表（`SessionEventMap` 声明合并）

所有 `dcp/*` 事件均为 **log-only**（无 `surfaceOp`）、带 `ignorable: true`。

| 事件 | 载荷（草案） | 语义 |
|---|---|---|
| `dcp/compress` | `{ runId, blockId, mode, topic, batchTopic, startRef, endRef, anchorSeq, summary, protectedContent?, consumedBlockIds, messageSeqs, toolCallIds, summaryTokens, compressedTokens, durationMs, compressCallId? }` | 一次压缩块落地；`blockId`/`runId` 单调 |
| `dcp/prune-tool` | `{ toolCallId, tool, reason: 'dedup'\|'purge-error'\|'sweep'\|'user', turn, tokenCount }` | 标记某工具调用被剪枝（配合 `tool/result` replace） |
| `dcp/manual` | `{ enabled, source }` | 手动模式开关（命令/配置触发） |

统计（`pruneTokenCounter`、`totalPruneTokens`、时长）可从上述事件累加得到；
跨会话聚合写入 `ctx.storageDomain` 域 `dcp`（记录 `{ sessions: { [id]: {...} } }`
或 key-value 记录），仅作展示，不作为权威状态。

### 5.2 状态重建

```ts
class DcpState {
  // 由 session.events 重放得到（首次构建后按 seq 增量更新）
  blocks: Map<blockId, DcpCompressionBlock>
  prunedToolCalls: Map<callId, DcpPruneEntry>
  manualMode: boolean
  stats: DcpStats
  // 派生视图
  activeByAnchorSeq: Map<seq, blockId>
  messageRefs: Map<ref, seq>   // mNNNN -> surface 序号
  messageSeqsByRef: Map<ref, number[]>
}
```

- 会话加载/切换时一次性重放；之后订阅 `session/event` 增量应用。
- 与原生 `compaction/*` 的交互：检测 `compaction/summary` 后清除 nudge 锚点、
  重置压力基准（对标 opencode 的 `resetOnCompaction`）。

### 5.3 压缩块模型（对标 opencode `CompressionBlock`）

保留关键字段：`blockId, runId, active, mode, topic, batchTopic, startRef, endRef,
anchorSeq, compressMessageSeq, compressCallId, includedBlockIds, consumedBlockIds,
parentBlockIds, directMessageSeqs, directToolCallIds, effectiveMessageSeqs,
effectiveToolCallIds, createdAt, deactivatedAt?, deactivatedByUser,
summaryTokens, compressedTokens, durationMs, summary`。

嵌套语义：新块 `consumedBlockIds` 引用旧块 → 旧块置为非激活、`parentBlockIds`
记录新块；摘要占位符解析时把旧块摘要展开/合并（对标
`injectBlockPlaceholders` / `appendMissingBlockSummaries`）。

---

## 6. 功能映射表（opencode-dcp → dsh-dcp）

| opencode-dcp 模块 | dsh-dcp 对应设计 |
|---|---|
| `lib/hooks.ts`（系统提示/消息变换/命令/事件） | `src/index.ts` 注册 systemPrompt section、commands、session/event、agent/pre-step、tools |
| `lib/compress/range.ts` / `message.ts` | `src/compress/range.ts` / `src/compress/message.ts`（工具执行体） |
| `lib/compress/pipeline.ts`（prepare/finalize） | `src/compress/pipeline.ts`：拉会话、重建状态、跑策略、落盘（append + storageDomain） |
| `lib/compress/range-utils.ts` / `search.ts` | `src/compress/boundary.ts`：mNNNN/bN 解析、范围解析、占位符 |
| `lib/compress/state.ts` | `src/state/apply.ts`：allocateBlockId/allocateRunId/applyCompressionState |
| `lib/compress/protected-content.ts` | `src/compress/protected.ts`：用户消息、`<protect>`、受保护工具、文件模式、子代理 |
| `lib/strategies/deduplication.ts` / `purge-errors.ts` | `src/strategies/`：签名规范化、turn 年龄；落地为 `dcp/prune-tool` + `tool/result` replace |
| `lib/messages/prune.ts` / `priority.ts` / `inject/*` | `src/messages/`：请求前派生视图（索引、优先级、nudge 文本） |
| `lib/commands/*` | `src/commands/`：ctx.commands 处理器（输出 CommandResult） |
| `lib/state/*`（持久化） | `src/state/replay.ts` + `src/state/domain.ts` |
| `lib/prompts/*`（system/compress-message/compress-range/nudge） | `src/prompts/`：移植提示词结构（自有措辞） |
| `lib/protected-patterns.ts` | `src/protected/patterns.ts`：glob、工具名、`apply_patch`/`multiedit` 路径提取 |
| `lib/message-ids.ts` | `src/refs.ts`：mNNNN/bN 格式与解析 |
| `lib/token-utils.ts` | `src/tokens.ts`：包 `ctx.tokenMeter` + 字符回退 |
| `lib/subagents/subagent-results.ts` | `src/subagents.ts`：子代理会话读取与结果合并 |
| `lib/compress/timing.ts` | `src/compress/timing.ts`：`tool/call`→`tool/result` 时长（session/event 驱动） |
| `lib/host-permissions.ts` / `compress-permission.ts` | 简化为 config 校验 + approval 链（D5） |
| `lib/update.ts` / `tui/*` / `ui/notification.ts` | 不做（D9/D11） |

---

## 7. 模块设计与仓库结构

### 7.1 目录树

```text
dsh-dynamic-context-pruning/          ← 本地工作区（本仓库）
├─ package.json                       # @chiro2001/dsh-dcp + dsh.bundle.patch
├─ pnpm-workspace.yaml                # 单包即可（peer 由 profile 提供）
├─ tsconfig.json
├─ tsdown.config.ts
├─ cordis.patch.yml                   # 仅插入 dcp 行
├─ LICENSE / NOTICE                   # 见 §13
├─ README.md
├─ AGENTS.md                          # 开发/自测门槛（对齐 dsh-oc 风格，但独立编写）
├─ docs/
│  ├─ PLAN.md                         # 本文
│  ├─ PROTOCOL.md                     # dcp/* 事件与表面替换协议（M4 后定稿）
│  └─ ROADMAP.md / CHANGELOG.md
├─ src/
│  ├─ index.ts                        # 插件入口（name/inject/apply/static Config）
│  ├─ config.ts                       # schemastery schema + 默认值 + 校验
│  ├─ events.ts                       # dcp/* 事件类型 + 声明合并 + 追加助手
│  ├─ state/
│  │  ├─ replay.ts                    # 日志重放 → DcpState
│  │  ├─ apply.ts                     # 压缩状态落地（block/run id、嵌套、统计）
│  │  └─ domain.ts                    # storageDomain 跨会话统计
│  ├─ compress/
│  │  ├─ pipeline.ts                  # 工具执行流程编排
│  │  ├─ range.ts / message.ts        # 两种模式 schema + 校验 + 落地
│  │  ├─ boundary.ts                  # mNNNN/bN 解析、范围解析、索引构建
│  │  ├─ protected.ts                 # 受保护内容组装
│  │  ├─ timing.ts                    # 压缩时长统计
│  │  └─ summarize.ts                 # （保留）未来可选 DCP 自调用摘要
│  ├─ strategies/
│  │  ├─ deduplication.ts
│  │  └─ purge-errors.ts
│  ├─ messages/
│  │  ├─ index.ts                     # 边界索引文本、优先级、nudge 文本
│  │  └─ query.ts                     # 用户消息/压缩调用查询
│  ├─ prompts/
│  │  ├─ system.ts                    # dcp:guidance section 渲染
│  │  ├─ compress-range.ts / compress-message.ts
│  │  └─ nudge.ts
│  ├─ commands/
│  │  ├─ context.ts / stats.ts / sweep.ts / manual.ts
│  │  ├─ decompress.ts / recompress.ts / help.ts
│  │  └─ index.ts
│  ├─ protected/patterns.ts           # glob/工具名/路径提取
│  ├─ refs.ts                         # mNNNN/bN 格式
│  ├─ tokens.ts                       # tokenMeter 封装
│  ├─ subagents.ts
│  └─ logger.ts                       # debug 开关 + ctx.logger 包装
├─ tests/                             # vitest 单测/集成
├─ scripts/                           # 诊断脚本（如 dsh-dcp-stats、会话时间线）
└─ .github/workflows/ci.yml           # typecheck + test + build（+ e2e 可选）
```

### 7.2 package.json 关键字段

```jsonc
{
  "name": "@chiro2001/dsh-dcp",
  "version": "0.1.0-rc.1",
  "type": "module",
  "packageManager": "pnpm@11.x",
  "engines": { "node": ">=22" },
  "exports": {
    ".": "./lib/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.0",
    "@deepseek-ai/dsh-agent": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-commands": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-llm": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-session": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-settings": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-storage-domain": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-subagent": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-system-prompt": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-token-meter": ">=0.1.0-rc.5",
    "@deepseek-ai/dsh-tools": ">=0.1.0-rc.5"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-*": "0.1.0-rc.6",
    "tsdown": "…", "typescript": "…", "vitest": "…"
  }
}
```

> peer 版本在开始编码时按本机 `deepseek-harness` checkout 的实际版本核对
> （当前 root 为 `0.1.0-rc.5`，dsh-oc 已按 `rc.6` 开发，采用 `>=0.1.0-rc.5`）。

### 7.3 cordis.patch.yml

```yaml
# 叠加在 dsh-base 之上；只插入 dcp 服务，不引入任何 TUI/HTTP 组件。
- insert:
    - id: dcp
      name: '@chiro2001/dsh-dcp'
      inject: [sessions, tools, systemPrompt, commands, settings, tokenMeter, llm, storageDomain]
```

`inject` 在编码时按实际 `static inject` 核对；可选服务（`subagents`、
`compaction`、`approval`）用 `ctx.get()` 惰性读取，不强制依赖。

### 7.4 安装方式

```bash
dsh plugin --profile web add github:chiro2001/dsh-dcp
# 或固定版本：github:chiro2001/dsh-dcp#v0.1.0-rc.1
dsh --profile web
```

pnpm 对 git 源插件的 `prepare` 构建需要 allowBuilds 放行，文档中给出指引
（与 dsh-oc 相同）。

---

## 8. 详细实现计划（里程碑）

### M1 — 脚手架与最小可用链路

目标：插件能挂载，`compress` 工具（range 模式）能完成一次真实压缩并改变表面。

- [ ] 仓库脚手架：package.json、tsconfig、tsdown、vitest、lint、CI、LICENSE/NOTICE
- [ ] **测试先行**：搭好 vitest + 测试夹具（会话构造器、mock LLM 上下文）、
      `check-all.sh` 骨架与 CI 首版（typecheck/test/build 即可先绿）
- [ ] `dcp/*` 事件类型声明合并（`ignorable: true`）与追加助手
- [ ] `DcpState` 重放器（blocks/pruned/manual/stats + 增量订阅）
- [ ] `ctx.settings` 注册 `dcp` namespace（schema + 默认值）
- [ ] `ctx.tools` 注册 `compress`（range 模式最小实现：参数校验、边界解析、
      状态落地、`user/message` replace）
- [ ] 摘要节点格式：`[Compressed conversation section]` + 摘要 + `<dcp-message-id>bN`
- [ ] `/dcp` 最小命令（help）

验收（全部由测试门禁证明，无人工验证项）：
- 单测：事件追加助手、重放器、配置 schema、摘要节点格式
- 集成：构造会话 → 调用压缩执行体 → `deriveMessages()` 返回摘要节点、
  `surface.replaceGeneration` 前进、日志含 `dcp/compress`
- e2e：`dsh --profile e2e` + mock LLM 完成一次“模型发起压缩”的完整回合；
  重启进程后状态可由日志重建

### M2 — 边界体系、嵌套与系统提示

- [ ] `mNNNN` 引用分配与边界索引渲染（system prompt section）
- [ ] `bN` 解析、范围解析、重叠校验、锚点选择
- [ ] 嵌套压缩：占位符解析、旧块摘要展开/合并、`consumedBlockIds`/`parentBlockIds`
- [ ] `dcp:guidance` section：工具说明、块格式、边界索引、手动模式状态
- [ ] `message` 模式（批量单条压缩 + priority 标签）
- [ ] `agent/pre-step` 压力检测（min/max 阈值，容量来自 adapter）

验收（全部由测试门禁证明）：
- 单测：边界解析/越界/顺序/重叠、嵌套展开、索引渲染快照、优先级分类
- 集成：两层嵌套后旧块摘要保留；system prompt section 渲染与 `request/header`
  一致；`/dcp context` token 构成正确（tokenMeter 断言）
- e2e：模型依据索引引用 `mNNNN..mNNNN` 完成压缩

### M3 — 自动策略与保护内容

- [ ] dedup（签名规范化、受保护跳过）→ `dcp/prune-tool` + `tool/result` replace
- [ ] purge-errors（turn 年龄、保留错误消息）→ 同上
- [ ] `/dcp sweep [N]`（since-user / last-N 两种模式）
- [ ] 受保护工具、文件路径模式、`apply_patch`/`multiedit` 路径提取
- [ ] `<protect>` 标签与 `protectUserMessages`
- [ ] 子代理结果保留（读 child session 最终输出，合并进保护内容）
- [ ] nudge（context-limit / turn / iteration 锚点，全部由日志可重建）

验收（全部由测试门禁证明）：
- 单测：签名规范化（键排序、null/undefined 归一）、turn 年龄、glob/工具名/
  路径提取、nudge 锚点推导
- 集成：重复调用只保留最后一次；4 轮后错误输入被清理且错误消息仍在；
  摘要含受保护内容；子代理结果被保留；`tool/result` replace 通过内容校验
- e2e：自动策略在无模型参与下生效；`/dcp sweep` 两种模式

### M4 — 命令族与手动模式

- [ ] `/dcp context`（token 分解 + bar）
- [ ] `/dcp stats`（会话 + 全时段）
- [ ] `/dcp manual [on|off]` + `dcp/manual` 事件
- [ ] `/dcp compress [focus]` / `/dcp-compress`：`agent.followup` 触发（日志化）
- [ ] `/dcp decompress <n|bN>`（表面恢复：追加替换事件放回区间/内容）
- [ ] `/dcp recompress <n|bN>`
- [ ] 压缩时长统计（`tool/call` → `tool/result`）
- [ ] 与原生 compaction 共存检测（复位锚点）

验收（全部由测试门禁证明）：
- 单测：每个命令的输出文本快照、参数解析、错误分支
- 集成：decompress 后 `deriveMessages()` 恢复被压缩区间；recompress 反向；
  命令结果不进模型历史（请求不变式仍成立）
- e2e：命令族全链路 + 重启后手动模式/统计一致

### M5 — 测试加固、文档与发布

- [ ] 单测全覆盖（状态重放、边界、策略、保护、配置、命令格式化）
- [ ] 集成测试：mock LLM（`llm-replay`/stub adapter）+ 构造会话 → 断言表面变化
- [ ] e2e：隔离 `DSH_HOME` + mock LLM，验证安装、命令、压缩、去重、恢复
- [ ] 全量门禁：`bash scripts/check-all.sh --e2e`（含分片）在本地与 CI 双绿
- [ ] 覆盖阈值达标（核心模块行覆盖 ≥ 85%，见 §10.5）
- [ ] docs：README、PROTOCOL（事件/替换协议）、AGENTS、ROADMAP、CHANGELOG
- [ ] CI：typecheck + test + build；发布 `v0.1.0-rc.1`

---

## 9. 测试驱动开发与测试策略

### 9.1 开发原则（本仓库对 Agent 的硬性要求）

1. **测试先行（TDD）**：每个功能/修复先写失败测试，再实现到测试通过；
   不允许“先写代码后补测试”作为默认路径。
2. **测试全权由实现者负责**：用户不介入测试；写测试、跑测试、修测试、
   维护测试环境（mock LLM、夹具、CI）都是本仓库开发工作的一部分。
3. **合并门槛 = 测试全绿**：任何提交必须通过 §10 的门禁；CI 与本地
   `check-all.sh` 双绿才能进入下一里程碑。
4. **每个里程碑以测试验收为完成标准**：M1–M5 的“验收”全部是可执行的
   测试断言，不设人工验证清单。
5. **回归优先**：修复 bug 先加最小复现测试；重构不改变语义时由既有
   测试网络兜底。

### 9.2 测试金字塔

| 层级 | 工具/环境 | 覆盖对象 | 速度 |
|---|---|---|---|
| 单元 | vitest（纯函数，无 dsh 运行时） | 重放器、边界解析、策略、保护模式、配置、refs、格式化 | 毫秒级 |
| 集成 | vitest + `Session.create()` + stub/mock LLM + Cordis 迷你上下文 | 工具执行体、表面替换、系统提示渲染、命令处理、与 compaction 共存 | 秒级 |
| e2e | 真实 `dsh` CLI + 隔离 `DSH_HOME` + `@deepseek-ai/dsh-llm-mock-server` | 安装、profile 挂载、完整回合、重启重建 | 分钟级 |
| 可选真实模型 | 真 API key（CI 中自动跳过） | 摘要质量、nudge 生效、提示词可读性 | 手动/定时 |

### 9.3 单元测试清单（tests/ 目录草案）

```text
tests/
  state-replay.spec.ts          # 事件序列 → DcpState；增量更新；损坏/缺失容错
  events.spec.ts                # dcp/* 事件载荷校验、ignorable、seq 单调
  refs.spec.ts                  # mNNNN/bN 格式、越界、分配、冲突
  boundary.spec.ts              # 范围解析、顺序校验、重叠校验、锚点
  nested.spec.ts                # 占位符解析、旧块摘要展开/合并、parent/consumed
  dedup.spec.ts                 # 签名规范化、保护跳过、保留最后一次
  purge-errors.spec.ts          # turn 年龄、错误输入清理、错误消息保留
  protected-patterns.spec.ts    # glob、工具名、apply_patch/multiedit 路径
  protected-content.spec.ts     # <protect>、用户消息、受保护工具组装
  config.spec.ts                # schemastery 校验、默认值、非法键/类型
  prompts.spec.ts               # guidance/索引/nudge 文本快照
  commands/*.spec.ts            # 每个命令的参数解析与输出快照
  tokens.spec.ts                # tokenMeter 封装与字符回退
  subagents.spec.ts             # child session 读取、结果合并、降级
  timing.spec.ts                # tool/call→tool/result 时长计算
  compression-targets.spec.ts   # 活跃/可恢复块分组（对标 opencode 同名测试）
```

### 9.4 集成测试

- 用 `Session.create()` + 构造的 `user/message`、`assistant/message`、
  `tool/call`、`tool/result`、`turn/*` 事件建立会话，**不启动完整 dsh**。
- mock LLM 层：注册 stub adapter（返回固定流）或直接调用工具执行体
  （压缩摘要由模型参数给出，执行体不需要真实 LLM）。
- 断言重点：
  - `deriveMessages()` 与 `llm/stream` 请求的 `options.messages` **逐字节一致**
    （agent-loop invariant 不被破坏）；
  - `user/message` / `tool/result` replace 通过 `session.append` 的全部
    校验（覆盖、content-only、sourceEventSeqs）；
  - 压缩后 `ctx.tokenMeter.measure()` 反映表面变化；
  - `dcp:guidance` section 与 `request/header` 记录一致；
  - 同时挂载 `dsh-compaction-basic` 时互不破坏。
- 命令处理器用 Cordis 迷你上下文 + `ctx.commands` stub 或真实 registry 测试。

### 9.5 e2e（无 TUI，因此比 dsh-oc 更轻）

- 全部基于 `headless`-风格 profile（`dsh plugin --profile e2e add <repo>`）
  或 API 驱动，**不需要 tmux/PTY**；mock LLM 提供脚本化响应（包括发起
  `compress` 调用、返回摘要参数）。
- 隔离环境：每次运行独立的 `DSH_HOME`（`mktemp -d`），失败时保留
  `.e2e/<run-id>/` 并上传 CI artifact。
- 场景清单：
  - `e2e-install.sh`：`dsh plugin ... add .` → `dsh --profile e2e --dump-config`
    含 dcp 行；
  - `e2e-compress.sh`：完整回合（用户消息 → 模型发起 compress → 摘要落地 →
    下一请求不含被压缩区间）；
  - `e2e-strategies.sh`：dedup/purge-errors 自动生效；
  - `e2e-commands.sh`：/dcp 命令族输出与状态变化；
  - `e2e-manual.sh`：手动模式开关、/dcp-compress 触发、decompress/recompress；
  - `e2e-restart.sh`：kill 后重启，状态由日志重建一致；
  - `e2e-compaction-coexist.sh`：与 dsh 原生 `/compact` 共存。
- 可选真实模型：`pnpm run e2e:real`（有 `DEEPSEEK_API_KEY` 才跑，
  CI push 自动跳过）。

### 9.6 稳定性与性能回归

- **请求不变式回归**：任何改动跑集成测试中“messages === deriveMessages()”
  断言，防“请求时改写”回潮。
- **确定性**：边界索引、nudge、命令输出都是纯函数，测试用快照锁死格式，
  防止无意义漂移（对齐 opencode-dcp 的 snapshot 式测试）。
- **perf smoke**：构造 200/1000 会话状态，断言重放与索引构建在预算内
  （如 <100ms/会话），防止 O(n²) 回潮。
- **会话审计脚本**：`scripts/audit-sessions.sh` 扫描真实会话日志，断言
  dcp/* 事件与 replace 不变量，供本地与 CI 手动跑。

---

## 10. 自测门槛与 CI（提交/合并前必须全绿）

### 10.1 本地一键门禁：`scripts/check-all.sh`

按 dsh-oc 的组织方式，但按 dsh-dcp 的实际内容裁剪：

```bash
bash scripts/check-all.sh            # 快速门禁
bash scripts/check-all.sh --e2e      # 全量（含 e2e）
bash scripts/check-all.sh --coverage # 附加覆盖率门槛
```

门禁顺序（任一步失败即退出）：

1. `pnpm typecheck`（`tsc --noEmit`）
2. `pnpm lint`（oxlint + prettier check）
3. `pnpm test`（vitest 单测 + 集成）
4. `pnpm build`（tsdown → `lib/`）
5. `pnpm run check:package`（构建产物/入口/声明验证）
6. `node scripts/perf-smoke.mjs`（200 会话状态重放预算）
7. `--coverage`：核心模块行覆盖 ≥ 85%（`state/replay`、`compress/boundary`、
   `strategies`、`protected/patterns`、`config`）
8. `--e2e`：按 `CI_E2E_SUBSET` / `CI_E2E_SHARD` 分片跑 §9.5 场景

### 10.2 CI 工作流

```text
.github/workflows/ci.yml    # push（main/develop/feat-*/fix-*/docs-*/perf-*/test-*/chore-*）+ PR
                            #  job: setup(pnpm@11, node 22) → build → typecheck
                            #       → lint → unit+integration → coverage
                            #       → perf smoke → check:package

.github/workflows/e2e.yml   # 同一分支白名单；矩阵 2 shard（fail-fast: false）
                            #  隔离 DSH_HOME + mock LLM；timeout 30min
                            #  push：稳定子集（分片）；workflow_dispatch：全量
                            #  failure：上传 .e2e artifact（retention 3d）

.github/workflows/release.yml  # tag v* → build + verify → 创建 GitHub Release
                               #（private repo；安装走 github:chiro2001/dsh-dcp#<tag>）
```

Node 版本：主跑 22；e2e 额外跑 24（覆盖 dsh 支持矩阵的上下界）。

### 10.3 分支与提交规范（对齐 dsh-oc 的组织习惯）

- `main`：稳定发布线；`develop`：集成交付线。
- 功能分支：`feat-*` / `fix-*` / `docs-*` / `perf-*` / `test-*` / `chore-*`。
- Conventional Commits：`feat/fix/docs/perf/test/chore/refactor`。
- e2e 只允许在以上白名单分支与 PR 运行。
- 每个里程碑合入 `develop` 时，CI 全绿是唯一准入条件。

### 10.4 测试环境依赖

- `@deepseek-ai/dsh-llm-mock-server`（dsh 官方 mock LLM，e2e 使用）
- `@deepseek-ai/dsh-replay` 或自写 stub adapter（集成测试）
- 本地 `deepseek-harness` checkout 仅用于 devDependencies 与类型对照，
  不进入发布产物
- CI 中 `npm i -g @deepseek-ai/dsh@<目标版本>` + `pnpm@11`

### 10.5 覆盖率与快照策略

- 核心纯逻辑（重放、边界、策略、保护、配置）要求行覆盖 ≥ 85%，由
  `--coverage` 门禁强制。
- 命令输出与提示词文本用快照测试（vitest `toMatchInlineSnapshot`），
  修改需显式更新快照并说明理由。
- 不追求 100%：错误路径中不可达分支与纯展示代码可豁免（清单写入
  `AGENTS.md`，避免门禁沦为形式）。

---

## 11. 配置方案（草案）

```jsonc
{
  "$schema": "./dcp.schema.json",
  "enabled": true,
  "debug": false,
  "pruneNotification": "off",            // 仅日志级别，无 chat/toast
  "commands": { "enabled": true, "protectedTools": [] },
  "manualMode": { "enabled": false, "automaticStrategies": true },
  "turnProtection": { "enabled": true, "turns": 2 },
  "experimental": { "allowSubAgents": false },
  "protectedFilePatterns": [],
  "compress": {
    "mode": "range",                     // "range" | "message"
    "permission": "allow",               // "allow" | "deny"（"ask" 映射到 dsh approval）
    "showCompression": true,
    "summaryBuffer": true,
    "maxContextLimit": "80%",
    "minContextLimit": "60%",
    "nudgeFrequency": 8,
    "iterationNudgeThreshold": 12,
    "nudgeForce": "soft",
    "protectedTools": ["task", "skill", "todowrite", "todoread"],
    "protectTags": true,
    "protectUserMessages": false
  },
  "strategies": {
    "deduplication": { "enabled": true, "protectedTools": [] },
    "purgeErrors": { "enabled": true, "turns": 4, "protectedTools": [] }
  }
}
```

- 默认值与 opencode-dcp 对齐（`maxContextLimit: 80%`、`minContextLimit: 60%`、
  purgeErrors turns 4、nudgeFrequency 8、iterationNudgeThreshold 12）。
- 存储：`ctx.settings` namespace `dcp`（`settings.yaml` / `settings.json`，
  `$DSH_HOME` 下），schema 用 `@deepseek-ai/schemastery`，非法键/类型在注册时
  失败。
- v1.1 可选：项目级 `dcp.jsonc` 覆盖（由插件自行读取合并，文档声明优先级）。

---

## 12. 风险与开放问题

| 风险/问题 | 影响 | 应对 |
|---|---|---|
| 不变式约束下无逐条消息 tag | 模型选择边界的准确度依赖索引 | 系统提示索引 + 摘要 footer `bN`；e2e 验证；备选方案见下 |
| 持久 replace 与 opencode“不改历史”观感差异 | 用户认知 | 文档明确“原始日志永不删除，可恢复”；`decompress` 提供恢复 |
| 与 compaction-basic 同开 | 双摘要体系、锚点错乱 | 检测 `compaction/*` 复位；文档说明建议二选一或共存策略 |
| `tool/result` content-only replace 约束 | 某些剪枝场景被拒 | 仅替换 text 内容块、保持 callId/turn/step/meta；测试覆盖 |
| 子代理冷会话读取 | 需 persistence | 失败时降级为工具结果原文（记录 warning） |
| 模型是否真的会主动调用 compress | 核心收益 | 提示词质量 + nudge；可先用 `/dcp compress` 验证 |
| opencode-dcp 为 AGPL-3.0 | 许可证合规 | 独立重写、NOTICE 声明参考；LICENSE 建议见 §13 |
| `purpose` 联合类型目前只有 `'compaction'\|'session-title'` | DCP 摘要调用归属 | 复用 `'compaction'`；如需独立归属，先向 dsh 提扩展 |
| 系统提示动态变化使 KV cache 失效 | 性能 | 与 opencode 相同；nudge 文本保持稳定锚点格式 |
| dsh 版本漂移（rc.5/rc.6） | 编译期 API 变化 | devDeps 锁定本机 checkout 版本；peer 用宽松区间 |

备选方案（若索引不够用）：在 v1.1 中给“最近 N 条用户消息”追加 content-only
`user/message` replace 以带上 `mNNNN` tag（代价是更多替换事件与 cache 失效），
由配置开关控制。

---

## 13. 版本、许可证与发布

- 版本：`0.1.0-rc.1` 起步，里程碑打 tag。
- 许可证建议：**AGPL-3.0-or-later**（与参考实现一致，避免衍生作品合规争议），
  `NOTICE` 声明“参考了 Opencode-DCP/opencode-dynamic-context-pruning 的设计
  与提示词结构；本实现为独立代码”。若用户希望 MIT，需确认 clean-room 边界
  （仅参考公开行为，不引用其代码/提示词原文），M1 前与用户确认。
- 发布：private repo 内 tag + CI 产物；安装走 `github:chiro2001/dsh-dcp#<tag>`。

---

## 14. 参考文档清单

- opencode-dcp v3.1.15：`opencode-dynamic-context-pruning/`（本机镜像）
  - `README.md`（How It Works / 默认配置）
  - `lib/hooks.ts`、`lib/compress/*`、`lib/messages/*`、`lib/commands/*`、
    `lib/strategies/*`、`lib/state/*`、`lib/prompts/*`、`lib/protected-patterns.ts`
- dsh（deepseek-harness）：
  - `docs/architecture.md`、`docs/agent-lifecycle.md`、`docs/tool-execution-pipeline.md`
  - `packages/core/system-prompt/README.md`、`packages/core/tools/README.md`
  - `packages/llm/llm/README.md`、`packages/llm/token-meter/README.md`
  - `packages/core/session/README.md`、`packages/compaction/*/README.md`
  - `packages/interaction/commands/README.md`、`packages/settings/*/README.md`
  - `packages/storage/storage-domain/README.md`、`packages/subagent/*/README.md`
  - `packages/core/agent-loop/src/invariant.ts`（核心约束）
  - `apps/cli/src/plugin.ts`（插件安装机制）
