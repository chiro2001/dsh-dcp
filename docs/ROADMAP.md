# ROADMAP

## v0.2（规划）

- **M6.3（已完成，rc.3）**：Code Mode fail-closed、探针 oracle 重写、提示词
  方向修复、发布面统一。
- **M7.0（最小核心）**：storage-domain + `/dcp stats` 纵向切片（真实
  DomainFacility/KvTable、per-session snapshot、restart/failure/catch-up e2e、
  session/domain/estimated/status 口径）。
- **E7-CODE（stretch）**：Code Mode 完整支持可行性实验；未通过则维持明确拒绝。
- **延后/移出 v0.2**：message-mode（需价值 corpus + 协议决策）；child-session
  深读取（移出承诺）；autonomous 模型驱动模式（探针 0/10，不再新增）。
- **精确 decompress 上游提案**：推动“单节点原位展开为多节点”宿主 API
  （不阻塞上述顺序）。

## v1.0（远期）

- 协议 v1 向后兼容扩展（只加字段、不破坏 decoder）。
- 长会话/多 profile 统计面板（读 storage-domain 聚合）。
- 原生 compaction 共存全矩阵在真实 dsh profile 下的 e2e 回归。
