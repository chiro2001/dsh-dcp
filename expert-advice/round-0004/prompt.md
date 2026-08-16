# Round 0004 prompt — M7.0 storage-domain + `/dcp stats` 纵向切片实施审阅

你是 dsh-dcp 项目的顶级审阅/顾问。M6.3（rc.3）已完成：Code Mode fail-closed、
探针 oracle 重写、提示词修复与发布面统一。当前进入 v0.2 最小核心
**M7.0：storage-domain 持久统计 + `/dcp stats` 纵向切片**的实施节点。

请阅读 `context.md` 及其中列出的输入，完成以下任务。

## 1. 审阅职责

1. **反驳与批评**：对 M7.0 的候选实现方案给出独立判断——
   - 统计口径（session snapshot vs active/historical、net saved 是否 clamp、
     marker/expansion 成本、estimated 标注）；
   - domain schema（per-session record 字段、version、eventCount/lastEventSeq）；
   - 生命周期与降级（storageDomain 缺失/open 失败/version mismatch/write 失败；
     是否允许核心压缩不依赖 stats）；
   - `/dcp stats` 输出（session/domain/status/stale/unavailable 如何呈现）；
   - 测试矩阵（真实 dsh-storage-json、restart、写失败、追平、多 session）。
2. **最可能遗漏的风险**：Cordis 生命周期、KvTable async 语义、单进程口径、
   per-session 串行/合并、schema 迁移、与 Code Mode 拒绝的交互等。
3. **按信息增益排序的 1–3 个“实施步骤/实验”**：输入、动作、可证伪断言、
   停止条件。
4. **方向性判断**：是否应把 E7-CODE 与 M7.0 并行；是否应先冻结统计语义文档；
   `/dcp stats` 的字段最小集应是什么。
5. **明确区分**：事实 / 推断 / 需实验。

## 2. 交付物

1. **`recommendation.md`**：M7.0 实施计划（schema、接线、降级、命令输出、
   测试矩阵、验收标准、停止条件）；
2. 最终回复由 CLI `-o` 落盘为 `response.md`，不要在会话内自行写。

## 3. 约束

- 只写 `expert-advice/round-0004/` 目录。
- 不执行安装、构建、测试、git 写操作。
- 不查看“既有 TUI 前端插件”项目；不查看无关仓库。
- 以仓库实际文件为准（见 context.md）。
