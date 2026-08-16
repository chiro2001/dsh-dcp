# Round 0002 prompt — dsh-dcp 下一步方向审阅

你是 dsh-dcp 项目的顶级审阅/顾问。dsh-dcp 是 DeepSeek Harness（dsh）的动态
上下文管理插件，v0.1.0-rc.1 已实现并发布到 private GitHub 仓库，最近刚加入
真实 Agent e2e（真实 dsh agent-loop + opencode go `deepseek-v4-flash`，隔离
环境）。当前处于“下一步方向决策”节点。

请阅读 `context.md` 及其中列出的输入，完成以下任务。

## 1. 审阅职责

1. **反驳与批评**：对当前状态与三个候选方向给出独立判断——
   - A：先把真实 Agent e2e 从单场景扩成回归矩阵（命令全族、自动策略、
     嵌套/恢复闭环、重启、与原生 compaction 共存），并补 commands/tool
     入口覆盖率；
   - B：直接做 v0.2 功能（message-mode 安全子集、storage-domain 实机接线、
     Code Mode 策略、子代理深读取）；
   - C：性能/发布面（增量 replay、npm 发布、dsh 上游“单节点展开为多节点”
     提案、profile 集成文档）。
   哪些取舍成立、哪些论证不足、是否有更优的第四方向或组合。
2. **最可能遗漏的风险**：架构、测试、真实模型行为、KV cache、长会话、
   发布/许可/隐私、与 dsh 版本漂移（rc.6）等。
3. **按信息增益排序的 1–3 个“下一个里程碑/实验”**：给出每个的输入、动作、
   可证伪断言与停止条件。
4. **方向性判断**：是否应改变方向（例如先做增量 replay、先解决命令/工具
   入口覆盖、先验证长会话 marker 开销、先做 npm/公开化决策等）。
5. **明确区分**：“由现有文件/测试支持的事实”“推断”“需要实验验证的建议”，
   逐条标注。

## 2. 交付物

1. **`recommendation.md`**：下一步里程碑计划（目标、范围、验收标准、风险与
   停止条件、建议的先后顺序），可以直接指导后续开发；
2. 你的最终自然语言回复（审阅意见 + 修订摘要）由 CLI `-o` 自动落盘为
   `response.md`，**不要在会话内自行写 `response.md`**。

## 3. 约束

- **只写 `expert-advice/round-0002/` 目录**：只创建/更新 `recommendation.md`。
- 不执行安装、构建、测试、git 写操作或任何改变环境状态的操作。
- 不查看“既有 TUI 前端插件”项目；不查看本项目之外无关仓库。
- 以 `docs/PLAN.md`、`docs/PROTOCOL.md`、`tests/contract/DECISIONS.md`、
  `tests/` 的实际内容为准，不要给泛泛建议。

