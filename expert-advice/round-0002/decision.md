# Round 0002 decision

咨询模型：`gpt-5.6-sol`（profile `sss`，reasoning effort `max`，`codex exec`）。
产出：`response.md`（审阅意见）、`recommendation.md`（下一步里程碑计划）。

处置结论：**整体接受方向 D**（RC protocol conformance 优先），采纳
M6.0 → M6.1 → M6.2 三阶段顺序；暂缓 v0.2 功能与增量 replay；npm/公开化决策
放到 M6.2 门。`docs/ROADMAP.md` 按本决策更新。

| #   | 建议/事实                                                          | 处置                                                                | 落点                    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------- |
| 1   | pre-step 多次全量 reduce；applyDcpEvents 无生产调用点              | accept：先测热路径，不先写增量 replay                               | M6.0/§3.2 → M6.1 实验门 |
| 2   | turnOfSeq/保护扫描存在 O(n²) 组合风险                              | accept：M6.1 长会话实验验证                                         | M6.1                    |
| 3   | `references.transport`/`maxAliasEntries`/`excerptChars` 无生产使用 | accept：M6.0 接线或 fail-closed                                     | M6.0                    |
| 4   | marker alias 未接线（pre-step 不生成、replay 不消费）              | accept：最高优先级协议缺口                                          | M6.0                    |
| 5   | `enabled`/`subagents.*` 无生产使用                                 | accept：enabled 控制注册与 pre-step；subagents 未支持项 fail-closed | M6.0                    |
| 6   | nudge 未实现 minRatio/iterationThreshold 语义                      | accept：补完整 hysteresis/re-arm                                    | M6.0                    |
| 7   | stats 混入 native shadow price                                     | accept：按 dcp metadata 相邻关系区分口径                            | M6.0                    |
| 8   | control/命令结果静默 no-op；recovery provider/model 写死 mock      | accept：结果回传 + 真实 header                                      | M6.0                    |
| 9   | multi-range 初始失败整批抛错；cleanup 下标映射无测试               | accept：partial 语义测试与映射修正                                  | M6.0                    |
| 10  | `m10000` 不被 replay 识别；普通消息 decode 诊断噪音                | accept：放宽 ref 解析 + 减少误报诊断                                | M6.0                    |
| 11  | 只注册 `dcp`，README 声称 `dcp-compress`；无快照测试               | accept：注册 `dcp-compress` + 快照测试                              | M6.0                    |
| 12  | 真实 adapter XML 参数与 schema 不匹配、call id 不唯一              | accept：nested content[] round-trip + 唯一 call id + 单测           | M6.0                    |
| 13  | KV cache 无真实测量                                                | defer：M6.1 在线 A/B，无稳定指标标 inconclusive                     | M6.1                    |
| 14  | peerDependencies 无上界与 PLAN 冲突                                | accept：收窄为实测范围（当前 rc.6）                                 | M6.0                    |
| 15  | public/private 文档矛盾                                            | 已修复（仓库已公开，README/AGENTS/PLAN 已统一）                     | 已完成                  |
| 16  | 覆盖率数字来自 context 报告                                        | accept：以行为矩阵为准，覆盖率为辅助                                | M6.0                    |
| —   | `check-all.sh --e2e` 空操作、CI e2e 仅安装                         | accept：接入 deterministic AgentLoop 矩阵                           | M6.0                    |
| —   | 方向 A/B/C                                                         | 部分接受：A 吸收进 D；B 延后；C 拆分进 M6.1/M6.2                    | ROADMAP                 |

## 决策门（按 recommendation §5）

- GO(rc.2)：M6.0 全绿、`--e2e` 真实执行、协议条款有实现或明确兼容处置。
- GO(v0.2 开发)：rc.2 通过 + M6.1 给出 transport/replay 决策。
- NO-GO：request/derive desync、token 漂移、工具配对破坏、silent control
  failure、不可重放 alias/state、未界定 dsh peer 范围。
- NO-GO(npm only)：可见性/许可/源码/secret/tarball 任一未闭合。

## 说明

- `recommendation.md` 为权威建议；`response.md` 由 CLI `-o` 落盘。
- 本轮咨询未修改仓库其他文件；未运行安装/构建/测试。
