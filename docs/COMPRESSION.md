# dsh-dcp 压缩处理流（Compression Flow）

> 本文说明 dsh-dcp 插件对“压缩上下文”的完整处理逻辑，包括模型调用、
> 校验、checkpoint 注入、延迟 cleanup、模型可见语义、审计与恢复。
> 协议细则见 [docs/PROTOCOL.md](./PROTOCOL.md)，统计口径见
> [docs/STATS.md](./STATS.md)。

压缩行为的关键规则、结果状态机、首次调用模板和配置注入边界集中维护在
[COMPRESSION-RULES.md](./COMPRESSION-RULES.md)；修改模型提示词前请先查看该维护专区。

## 1. 目标

dsh-dcp 的目标是：在 dsh 的模型可见上下文演化过程中，把**已经闭合、
不再需要逐字保留的旧对话区间**替换为一个**包含完整技术摘要的标准 checkpoint**，
从而降低后续请求的 token 用量，同时不破坏 dsh 的请求不变式：

```text
llm/stream 的 options.messages === session.deriveMessages()
```

插件不在请求时临时改写模型消息；一切压缩结果都先成为已落库的 surface 事件。

## 2. 核心概念

| 概念           | 说明                                               |
| -------------- | -------------------------------------------------- |
| `mNNNN`        | 日志化 boundary marker，模型可见的边界引用         |
| `bN`           | 一个 DCP checkpoint，也是可引用的活跃边界          |
| `range`        | half-open 区间 `[startRef, endRef)`                |
| `topic`        | 压缩区间短标题，用于人类阅读和统计                 |
| `summary`      | 模型提供的完整技术正文                             |
| `checkpoint`   | 替换原区间后的标准 `user/message`                  |
| `延迟 cleanup` | 闭合后把纯 compress 调用与结果整体替换为短归档记录 |
| `shadowed`     | 被压缩区间遮蔽的原始 surface 节点                  |

### 2.1 边界标记

默认每个 turn 的首个 step 入口，插件追加（`references.granularity: step` 可逐步标记）：

```xml
<dcp-boundary ref="m0001" turn="1" step="1" />
```

- 引用按 surface position 解析，不按 seq 数值大小。
- range 是 half-open，`endRef` 本身不被压缩。
- 陈旧/无效引用 fail closed，不扩大范围。
- 被原生 compaction 吸收后，会追加 alias 以保持旧引用可解析。

## 3. compress 工具调用

模型调用：

```json
{
  "topic": "初始仓库检查",
  "content": [
    {
      "startRef": "m0001",
      "endRef": "m0004",
      "summary": "这里是完整技术正文，而不是指针式占位。"
    }
  ]
}
```

一次调用可以包含多个不重叠 range，每个 range 独立事务。

### 3.1 输入校验

- `topic` 非空且 ≤ 200 字符。
- `content` 非空数组，数量 ≤ `maxRangesPerCall`。
- 每个 range 的 `startRef` / `endRef` 必须存在且合法。
- ranges 必须互不重叠；无需按 surface 顺序提交，插件会在内部规范化处理顺序。
- range 两侧 cuts 必须工具配对平衡。
- range 不得进入当前 turn 及前 `retainRecentTurns - 1` 个 turn。
- range 不得包含当前 compress 调用。
- range 不得包含硬保护内容（instructions / snapshot）。
- 净节省必须 ≥ `minNetSavingsTokens`。
- `summary` 必须：
  - 非空；
  - ≤ 8000 字符；
  - 不以内嵌 `[bN]` 块引用前缀开头；
  - 是实际技术正文，不是 `<dcp-inline-cleanup ... />`、`[stored in bN]` 这类指针占位。

## 4. 压缩事务与 checkpoint 注入

每个 range 独立记录以下日志序列：

```text
compaction/start
  → compaction/summary
  → user/message  (checkpoint，surface replace)
  → compaction/end
```

其中：

- `compaction/summary` 保存 `shadowedSeqs`、`shadowedTokenCount` 和摘要；
- `user/message` 使用标准 surface replace 替换原区间；
- `sourceEventSeqs` 记录被遮蔽的全部 surface 节点；
- `compaction/end` 关闭该笔事务。

### 4.1 checkpoint 文本格式

```text
[Compressed conversation section]
<完整技术正文>
（可选：受保护内容附录，原样保留）

<dcp-message-id>b1</dcp-message-id>
```

要点：

- blockRef 只通过 `<dcp-message-id>` 表达；
- summary 正文中不携带 `[bN]` 前缀；
- 受保护内容（用户消息、`<protect>`、受保护工具、来源附录等）以附录形式保留；
- checkpoint 是模型后续读到的**权威摘要**。

## 5. 延迟 cleanup

模型提交的长 summary 已保存在 checkpoint，但原 assistant 调用也携带一份。
当前上游禁止历史 assistant replacement，因此先保留一次原生结果消费，再在 turn-stopping 或更后的 pre-step 将纯 compress
调用和配对结果整体替换为一条短归档：

```text
<dcp-cleanup provenance="dsh-dcp" expected="true" status="success">
callId: <id>; name: compress
m0001..m0002: <dcp-archived in b1; submitted_chars=...; stored_chars=...; verbatim=true>
archived_result: status=success; committed=b1; rejected=none; correction=STOP
Summaries are in checkpoints; raw calls remain logged. Continue the task; do not retry committed ranges.
</dcp-cleanup>
```

只处理配对完整、step 已闭合、区间不夹杂其它节点的纯调用；assistant 含普通文本、
reasoning 或其它工具时保留原样。短调用若清理会增加 token，也保留原样。
记录不携带长摘要、任意 topic/planRef 或任意工具结果，只保留安全 refs、callId、
真实提交凭据或错误码与本地生成的 correction。
原失败范围若由另一调用在该结果之后成功提交，归档追加 `resolved_by=bN`，
不再要求重试；旧调用的原始状态和自身提交列表仍保持原意。

checkpoint 是完整摘要的权威位置，raw log 保留调用、参数、结果供审计。
清理失败不会推翻已经提交的 checkpoint。旧 inline 标记仅属于历史格式。

## 6. 多 range 与部分失败

- 一次 `compress` 可以携带多个 range；
- 每个 range 独立提交；
- 批内后续 range 在提交时按当前 surface 重新解析；
- 某个 range 失败只进入 `failed`，不伪造跨 range 原子性；
- tool result 会列出成功 blocks 和失败 ranges。

## 7. 持久化与恢复

- 原始 session 日志永不删除；
- checkpoint 是标准 `user/message`，可被 dsh 持久化、重启、投影；
- DCP 状态可以从日志冷重放：`reduceDcpState()`；
- 被原生 compaction 吸收或再次压缩的 `bN` 通过 membership 重分类；
- 支持 `show`、semantic expansion、recompress 等只读/恢复路径。

## 8. 验证边界

测试对真实 AgentLoop 请求逐字节断言 `messages === deriveMessages()`，并验证
重启重放、配对边界、系统/工具声明保护与 token 计量。真实模型是否仍误判清理，
必须用 `e2e:real` 和召回 probe 单独验证，不能由 mock 测试推断。
