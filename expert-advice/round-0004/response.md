审阅完成。M7.0 结论为“有条件 GO”，详细实施方案已写入 [recommendation.md](/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning/expert-advice/round-0004/recommendation.md)。

核心判断：

- **[推断]** 先冻结统计语义，再接持久化：区分 historical counters 与 active gauges。
- **[事实]** 当前 `lastProcessedSeq` 实际保存 `events.length`。建议只存 `eventCount`，不重复存可推导的 `lastEventSeq`。
- **[推断]** 取消 net clamp，统一使用 `tokenMeter.estimateMessage()`，将 expansion、marker、prune 成本纳入 signed ledger；负值显示为 `history overhead`。
- **[推断]** domain 只保存可重算的 per-session snapshot；聚合始终扫描 records 求和，不维护全局 `+=`。
- **[推断]** `storageDomain` 必须通过动态依赖子 fiber 接线，不能加入顶层 required inject。所有存储故障只降级 persistent stats。
- **[推断]** `/dcp stats` 始终显示 session 部分；domain 部分明确呈现 `current / stale / unavailable` 和 single-process scope。
- **[推断]** E7-CODE 不与 M7.0 在同一实现分支并行；独立、非阻塞 spike 可以接受。

重点补充了 `KvTable.put()` 不重新校验 zod、seed 不触发 `session/event`、`command/done` 晚于 stats handler、旧异步 snapshot 覆盖新 snapshot、fork 重复计数及 JSON whole-file rewrite 等风险。

本轮未运行安装、构建、测试或 git 写操作；未自行创建 `response.md`。
