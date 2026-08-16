# Round 0001 decision

咨询模型：`gpt-5.6-sol`（profile `sss`，reasoning effort `max`，`codex exec`）。
产出：`response.md`（审阅意见）、`revised-plan.md`（完整修订版 PLAN）。

处置结论：**整体接受修订方向**，`docs/PLAN.md` 替换为 `revised-plan.md`；
所有“需实验”项进入 M0 决策门，未通过前不转化为实现承诺。

| # | 建议 | 处置 | 证据/理由 | 落点 |
|---|---|---|---|---|
| 1 | 坚持“模型可见即日志”、不改 dsh 核心、不做请求时 rewrite | accept | agent-loop invariant 为硬约束；修订稿保持原方向 | PLAN §1/§5 D1–D2 |
| 2 | 撤销 `dcp/* + ignorable` 自定义事件方案 | accept | `Session.append()` 无 `ignorable` 参数；外置事件不在静态事件目录，重载失败 | PLAN §3.3/§20 |
| 3 | exact decompress 不可实现，改为 raw show + semantic expansion | accept | 当前 replace 只能“多节点→一节点”；不伪造精确恢复 | PLAN §1.3/§10.3 |
| 4 | 任意 replace 必须紧邻合法 shadow-price 事件 | accept | token projection 由 `compaction/summary`/`compaction/prune` 驱动 | PLAN §3.4/§6.2/§9 |
| 5 | 复用原生 compaction transaction 需先验证 | defer→M0 E-01 | 外置 writer 是否被接受是实证问题；失败即阻塞 range 主路径 | PLAN §4 E-01 |
| 6 | 动态 system index 不作为默认，改用静态 guidance + marker/按需工具 | accept | 动态 index 造成 header churn/prefix 失效；保留 E-02 A/B/C 决策门 | PLAN §7 |
| 7 | 内联摘要重复 token 风险；优先 inline + 同一步 cleanup | accept（附条件） | E-01 第 5 项验证；辅助 LLM 不是自动 fallback | PLAN §8.1.1/§20.5 |
| 8 | purge-errors 原映射错误，改为完整平衡单元实验、默认关闭 | accept | 工具输入在 assistant tool-call block，`tool/result` 无法清理 | PLAN §9.3/§12 |
| 9 | 并发与命令需宿主级约束（exclusive、approval、control turn） | accept | 工具/命令/维护 API 事实 | PLAN §3.5/§9.4/§10.1 |
| 10 | 原生 compaction 需 surface membership reconciliation | accept | 不只“清内存 nudge 锚点” | PLAN §11/§20.7 |
| 11 | 子代理默认只读父 surface，child 深读取延期 | accept | remote provider 无本地 child session 事实 | PLAN §8.5 |
| 12 | 里程碑调整：新增 M0 契约证伪，TDD/CI 提前 | accept | 三个实验阻塞 M1/M2/M4 | PLAN §4/§15 |

## 实验决策门（M0）

| 实验 | 处置 | 通过条件（修订稿 §4） |
|---|---|---|
| E-01 | 必做，阻塞 M1 | 持久事务/计量/内联清理全部通过；失败项按决策门缩减或提上游需求 |
| E-02 | 必做，阻塞边界协议冻结 | 在 A/B/C 间冻结一种 transport；歧义或依赖 seq 排序者淘汰 |
| E-03 | 必做，阻塞 M2/M4 | 并发/崩溃/共存矩阵无未配对、无漂移、冷热重放一致 |

## 说明

- `revised-plan.md` 已直接替换 `docs/PLAN.md`；后续实现以该文档为准。
- 本轮咨询未修改任何代码/测试/规划之外的仓库内容；`response.md` 由 CLI
  `-o` 落盘，`revised-plan.md` 由模型在约束内写入。

