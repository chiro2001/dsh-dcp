# Round 0005 decision

咨询模型：`gpt-5.6-sol`（profile `sss`，max，`codex exec`）。
产出：`response.md`、`recommendation.md`（rc.4 收尾清单）。

处置结论：**接受 NO-GO 判定并关闭全部 P0 后发 rc.4；E7-CODE 延后；npm 维持
NO-GO。**

| 建议                                                                                        | 处置                                                        | 落点                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| 生产接线 identity mismatch（child 注册、outer 查询）                                        | accept：注册到外层 ctx；无条件 inject；disposer await close | M7.0 修复 + topology 测试      |
| 三态状态机（current/stale/unavailable + reason/cursor/旧视图；log regression 不报 current） | accept                                                      | syncStatsWithStatus + 快照输出 |
| marker 计入 net（`shadowed + prune - checkpoint + expansion - marker`）                     | accept                                                      | session ledger + STATS.md      |
| record schema 收紧并校验 ledger 方程                                                        | accept                                                      | domain-store zod refine        |
| 10/100/1000 规模 smoke                                                                      | accept：默认门禁 10-session；100/1000 留 manual             | domain-store 测试              |
| rc.4 发布面（版本/README/AGENTS/RELEASE/CHANGELOG/lib/notes）                               | accept                                                      | rc.4                           |
| E7-CODE 延后至 rc.4 后独立 spike                                                            | accept                                                      | ROADMAP                        |
| npm 维持 NO-GO                                                                              | accept                                                      | RELEASE.md                     |
| 探针只支撑负向边界，不做正向可靠性声明                                                      | accept                                                      | CHANGELOG/RELEASE 措辞         |

## 发布声明（rc.4）

M7.0 single-process preview：统计从 raw session log 冷重算，per-session
durable snapshot 为可重建缓存；token 数为 heuristic estimate；persistent
stats 故障只降低可见性；仅支持 dsh rc.6 GitHub 源、JSON 单进程、无跨进程
一致保证；Code Mode 仍 fail closed；无 autonomous/correction/nested 成功率
承诺；npm 未发布。
