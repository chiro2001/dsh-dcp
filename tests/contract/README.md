# M0 — 宿主契约证伪实验

依据修订版 PLAN §4。目标：在开始 M1 功能编码前，用真实 dsh 包验证三个
阻塞性假设，产出可重复的决策记录。

## 环境快照

- dsh 包版本：`0.1.0-rc.6`（npm 发布）
- 宿主源码证据：本地 `deepseek-harness` checkout（commit 待 M0 记录）
- 本仓库 commit：见 `git log`

## 实验清单

| 实验                                     | 阻塞         | 状态                            |
| ---------------------------------------- | ------------ | ------------------------------- |
| E-01 持久事务、计量与内联参数清理        | M1           | 完成（见 DECISIONS.md）         |
| E-02 边界可用性、日志成本与 KV cache A/B | 边界协议冻结 | 完成（默认 B，见 DECISIONS.md） |
| E-03 并发、崩溃与原生 compaction 状态机  | M2/M4        | 完成（契约层，见 DECISIONS.md） |

每个实验的结论与 decision record 追加到 `DECISIONS.md`。
