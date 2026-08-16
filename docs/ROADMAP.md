# ROADMAP

## v0.2（规划）

- **message-mode 安全子集**：无 tool-call 单节点压缩（M3 决策门后开启）。
- **Code Mode 支持**：`run_code` 子调用内的 `compress` 识别与拒绝/授权策略。
- **子代理深读取**：child-session 结果合并（opt-in enrichment）。
- **storage-domain 实机接线**：dsh-storage-json 后端 + 重启追平 e2e。
- **真实模型质量门槛**：可选 `e2e-real-model`，报告摘要质量与 cache 使用。
- **精确 decompress 上游提案**：推动“单节点原位展开为多节点”宿主 API。

## v1.0（远期）

- 协议 v1 向后兼容扩展（只加字段、不破坏 decoder）。
- 长会话/多 profile 统计面板（读 storage-domain 聚合）。
- 原生 compaction 共存全矩阵在真实 dsh profile 下的 e2e 回归。
