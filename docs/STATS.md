# DCP 统计语义（M7.0 冻结）

## 原则

- 原始 session 日志是唯一真相；统计永远是**从日志可重算的缓存**。
- 所有 token 数字都是 **heuristic estimate**（默认四字符/token；生产路径传入
  `ctx.tokenMeter.estimateMessage`）。
- 持久化只保存 per-session snapshot（`eventCount` 边界下的冷重算结果），
  domain 聚合 = 各 session 最新 record 的逐字段求和，**不做全局 `+=`**。

## SessionStats（signed ledger）

| 字段                | 语义                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `blockCount`        | 历史 DCP summary + expansion 事务数                                                 |
| `activeBlockCount`  | 当前 surface 上的 active DCP block 数（gauge）                                      |
| `pruneReplacements` | DCP 去重/错误单元清理的替换数                                                       |
| `shadowedTokens`    | DCP summary 遮蔽的 heuristic token 总量                                             |
| `checkpointTokens`  | DCP checkpoint 与 prune 替换文本的 estimate                                         |
| `pruneTokens`       | 被清理原始工具结果的 estimate                                                       |
| `expansionTokens`   | semantic expansion 的有符号 delta（通常为负）                                       |
| `markerTokens`      | boundary marker 的 estimate（单独列出）                                             |
| `historyReduction`  | `shadowed + prune - checkpoint + expansion - marker`（有符号；负值显示为 overhead） |

不再使用 clamp 后的 `netSavedTokens`；负数如实呈现为 `history overhead`。

## Domain record v1

```ts
{ v: 1, eventCount: number, ledger: SessionStats, updatedAt: string }
```

- `eventCount = events.length`（当前实现的日志长度语义）；不同时保存可推导的
  `lastEventSeq`，避免 off-by-one。
- 只前向追平：`eventCount` 倒退时拒绝覆盖（防旧异步快照覆盖新快照）。
- 单进程口径：JSON backend 无跨进程写锁，domain 不描述跨进程一致。

## `/dcp stats` 输出

- 始终先显示 session 部分；domain 部分只在可用时出现。
- 状态：`current`（已追平）/ `stale`（同步失败）/ `unavailable`（未接线）。
- storage 任何失败只降低 persistent stats 可见性，不影响 compress/control/
  marker/request invariant。
