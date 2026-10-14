# ROADMAP

## v0.2（规划）

- **M10（rc.9，未发布）**：精确适配 dsh `0.2.0-rc.2`；默认 turn 边界、短提示、
  纯调用配对安全 cleanup；每周检查 npm 稳定渠道变化。见 PLAN §24。
- **后续实验**：真实模型 cleanup 召回与首次压缩成功率；按需只读 token/range 预算
  工具；long turn 的闭合前缀与按需 anchors。先做 A/B 和保护契约，再增加模型流程。
- **评估基础已落地**：标准任务配对、请求费用账本、历史负载审计及同状态长上下文
  单场景已完成首组验证；尚未证明稳定费用收益。后续优先闭合 step 候选、摘要
  可续作性和缓存回本，沿用独立验收与完整费用指标，见 `docs/EVALUATION.md`。
- **M9（rc.8，历史工作版本）**：集中维护压缩关键规则与调用模板；失败或部分失败后清理
  模型可见的长 inline summary，以稳定状态码和当前边界提示引导一次修正；插件内部
  规范化 multi-range 顺序，并用 AgentLoop/重放/token accounting 回归锁定行为。
- **M8（rc.7，已完成，尚未发布）**：适配 dsh `0.1.2-rc.1` 的私有 session log、品牌化
  seq、`ToolCallId`、AgentLoop projection 依赖和更严格的 compaction invariant；
  增加真实激活安装冒烟。
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
