# dsh-dcp 压缩处理流（Compression Flow）

> 本文说明 dsh-dcp 插件对“压缩上下文”的完整处理逻辑，包括模型调用、
> 校验、checkpoint 注入、inline cleanup、模型可见语义、审计与恢复。
> 协议细则见 [docs/PROTOCOL.md](./PROTOCOL.md)，统计口径见
> [docs/STATS.md](./STATS.md)。

## 1. 目标

dsh-dcp 的目标是：在 dsh 的模型可见上下文演化过程中，把**已经闭合、
不再需要逐字保留的旧对话区间**替换为一个**包含完整技术摘要的标准 checkpoint**，
从而降低后续请求的 token 用量，同时不破坏 dsh 的请求不变式：

```text
llm/stream 的 options.messages === session.deriveMessages()
```

插件不在请求时临时改写模型消息；一切压缩结果都先成为已落库的 surface 事件。

## 2. 核心概念

| 概念             | 说明                                                            |
| ---------------- | --------------------------------------------------------------- |
| `mNNNN`          | 日志化 boundary marker，模型可见的边界引用                      |
| `bN`             | 一个 DCP checkpoint，也是可引用的活跃边界                       |
| `range`          | half-open 区间 `[startRef, endRef)`                             |
| `topic`          | 压缩区间短标题，用于人类阅读和统计                              |
| `summary`        | 模型提供的完整技术正文                                          |
| `checkpoint`     | 替换原区间后的标准 `user/message`                               |
| `inline cleanup` | 同一步把 assistant 消息中的 summary 参数清理为 `[stored in bN]` |
| `shadowed`       | 被压缩区间遮蔽的原始 surface 节点                               |

### 2.1 边界标记

每个 step 入口，插件追加：

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
- ranges 必须按 surface 顺序且互不重叠。
- range 两侧 cuts 必须工具配对平衡。
- range 不得进入最近 `retainRecentTurns` 个 turn。
- range 不得包含当前 compress 调用。
- range 不得包含硬保护内容（instructions / snapshot）。
- 净节省必须 ≥ `minNetSavingsTokens`。
- `summary` 必须：
  - 非空；
  - ≤ 8000 字符；
  - 不以内嵌 `[bN]` 块引用前缀开头；
  - 是实际技术正文，不是 `[stored in bN]` 这类指针占位。

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

## 5. inline cleanup

模型调用 `compress` 时，assistant 消息中通常包含一大段内联 summary。
压缩提交后，插件在同一步把该 assistant 消息里的 tool-call `summary` 字段改为：

```text
[stored in bN]
```

### 5.1 为什么需要

- 避免同一份完整摘要同时出现在“checkpoint”和“旧 assistant 参数”中；
- 保留 assistant 消息、tool-call id、message id 不变；
- 原始完整参数仍保留在 `tool/call` 的 raw log 中，形成审计链。

### 5.2 模型可见语义（重要）

压缩成功后，模型后续看到的上下文包含：

1. **checkpoint `user/message`**：完整技术正文，权威内容；
2. **assistant 消息中的工具调用参数**：`[stored in bN]`，这只是清理标记；
3. **tool result**：报告压缩消息数和生成 blockRef，并明确说明完整摘要保存在 checkpoint 中。

因此：

```text
[stored in bN]  ≠ 原始 summary
[stored in bN]  ≠ 数据丢失
checkpoint       = 完整摘要唯一权威位置
```

模型不应因为看到自己被改写后的 tool-call 参数，就误以为提交了占位符。

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

## 8. 常见误读与防护

| 误读                                                 | 实际情况                                | 防护                                 |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------ |
| 认为 `[stored in bN]` 是提交的 summary               | 只是 inline cleanup 标记                | 工具结果 + 系统提示 + 本文档明确说明 |
| 认为 checkpoint 没有注入上下文                       | checkpoint 是 surface `user/message`    | 日志顺序 + deriveMessages 不变式     |
| 认为摘要开头必须写 `[bN]`                            | blockRef 只能由 `<dcp-message-id>` 表达 | schema 拒绝 + checkpoint 构造剥离    |
| 认为多个 range 必须分多次调用                        | 一次调用可携带多个 range                | 工具描述 + 系统提示 + 示例           |
| 把 `compaction/summary` 的 token 与 prune token 混算 | 两者口径不同                            | `docs/STATS.md` 明确区分             |

## 9. 一句话总结

> dsh-dcp 的压缩 = 把一段闭合历史替换成包含完整技术摘要的标准 checkpoint，
> 同时把模型原始 inline summary 参数清理为 `[stored in bN]` 审计标记。
> 完整摘要的权威位置是 checkpoint `user/message`。
