# Round 0004 decision

咨询模型：`gpt-5.6-sol`（profile `sss`，max，`codex exec`）。
产出：`response.md`、`recommendation.md`（M7.0 实施计划）。

处置结论：**整体接受（有条件 GO）**。先冻结可审计 signed ledger，再接真实
storage-domain；storage 只作为可降级 sidecar，不成为第二个真相来源。

| 建议                                                                                                                                           | 处置                  | 落点          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------- |
| 先冻结统计语义（historical counters vs active gauges）                                                                                         | accept                | M7.0 第一步   |
| 取消 net clamp；signed `estimated history reduction`（含 marker/expansion/prune），负值显示 overhead                                           | accept                | M7.0          |
| checkpoint 估算统一 `tokenMeter.estimateMessage()`（缺省字符回退）                                                                             | accept                | M7.0          |
| record 只持久化 `eventCount`（不重复存可推导 seq；若并存强制一致）                                                                             | accept                | M7.0          |
| domain 只存每 session 最新可重算 snapshot；聚合扫描求和，不做全局 `+=`                                                                         | accept                | M7.0          |
| storageDomain 走动态子 fiber 接线，不加入顶层 required inject；所有故障只降级 persistent stats                                                 | accept                | M7.0          |
| `/dcp stats` 始终显示 session 部分；domain 部分标注 current/stale/unavailable 与单进程口径                                                     | accept                | M7.0          |
| 风险处理：KvTable.put 不重校验 zod、seed 不发 session/event、command/done 晚于 handler、旧异步快照覆盖、fork 重复计数、JSON whole-file rewrite | accept：进入测试矩阵  | M7.0          |
| E7-CODE 不与 M7.0 同一分支并行                                                                                                                 | accept                | 独立 spike    |
| 规模 smoke 不达标时缩减为 session stats + command-time persistence                                                                             | accept（fallback 门） | M7.0 停止条件 |

## 执行说明

- 实施顺序：① ledger 语义与 `/dcp stats` 输出 → ② domain record v1 + 聚合 →
  ③ 真实 DomainFacility/KvTable 动态接线 → ④ 真实 JSON restart/failure e2e。
- 停止条件：跨重启丢失、未处理 rejection、request/derive desync、规模影响
  正常 step 等出现即停并按 fallback 收缩。
