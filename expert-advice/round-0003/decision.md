# Round 0003 decision

咨询模型：`gpt-5.6-sol`（profile `sss`，max，`codex exec`）。
产出：`response.md`、`recommendation.md`（v0.2 范围与实施顺序）。

处置结论：**整体接受**。先执行 M6.3（Code fail-closed + probe oracle 重写 +
定向提示词修复 + 发布面统一，产出 rc.3）；storage-domain + `/dcp stats` 纵向切片
作为 v0.2 最小核心进入后续执行；message-mode/child deep-read 延后；Code Mode
完整支持走 E7-CODE 实验门。

| 建议                                                                   | 处置                 | 落点                   |
| ---------------------------------------------------------------------- | -------------------- | ---------------------- |
| 先修证据可信度，不先堆 prompt                                          | accept               | M6.3 probe oracle 重写 |
| natural 改名 forced/schema；另建 autonomous                            | accept               | M6.3                   |
| correction 不给正确 refs；nested 按新 block/consumedRefs/appendix 判定 | accept               | M6.3                   |
| 净节省不足提示方向拆分（更大区间/更紧凑摘要）                          | accept               | M6.3 prompt + 快照     |
| Code Mode mutation 前明确拒绝（exec.parent）                           | accept               | M6.3 tool + 测试       |
| storage-domain 必须与 `/dcp stats` 组成纵向切片                        | accept（下一执行轮） | M7.0                   |
| 真实 DomainFacility/KvTable、per-session snapshot、stale/unavailable   | accept（下一执行轮） | M7.0                   |
| message-mode 延后；child deep-read 移出 v0.2                           | accept               | 记录 + ROADMAP         |
| E7-CODE 独立实验后决定完整支持                                         | accept（staged）     | ROADMAP                |
| 发布面统一 public/tag/rc.6/npm NO-GO                                   | accept               | M6.3 + rc.3            |

## 执行说明

- 本轮（round-0003 执行）只做 M6.3；M7.0 与 E7-CODE 作为下一执行轮/实验门。
- 停止条件：Code 子调用 mutation、request desync、工具配对破坏等出现即停。
