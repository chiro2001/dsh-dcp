# Round 0003 prompt — v0.2 范围与实施顺序审阅

你是 dsh-dcp 项目的顶级审阅/顾问。方向 D（RC protocol conformance）已完成：
`v0.1.0-rc.2` 已发布，M6.0/M6.1/M6.2 门禁与真实模型探针全部落地。当前处于
“决定 v0.2 范围与实施顺序”的节点。

请阅读 `context.md` 及其中列出的输入，完成以下任务。

## 1. 审阅职责

1. **反驳与批评**：对 round-0002 建议的 v0.2 顺序（storage-domain 实机接线 →
   message-mode 安全子集 → Code Mode 支持 → child-session 深读取）给出独立
   判断：哪些仍然成立、哪些需要调整、是否应插入其他更高优先项（例如提示词
   优化：微小 range 净节省、nested prior-block 4/5、真实模型自然调用可靠性）。
2. **最可能遗漏的风险**：storage-domain 实机接线、message-mode 协议分支、
   Code Mode 拒绝/支持、child 深读取、与 rc.3+ dsh 版本漂移、发布面等。
3. **按信息增益排序的 1–3 个“下一个里程碑/实验”**：给出输入、动作、可证伪
   断言与停止条件。
4. **方向性判断**：是否应先做“提示词与真实模型可靠性”而非直接堆功能；
   message-mode 是否应继续延后；storage-domain 是否必须由 `/dcp stats`
   展示才值得做。
5. **明确区分**：“由现有文件/测试支持的事实”“推断”“需要实验验证的建议”。

## 2. 交付物

1. **`recommendation.md`**：v0.2 里程碑计划（目标、范围、验收标准、先后顺序、
   风险与停止条件）；
2. 最终自然语言回复由 CLI `-o` 落盘为 `response.md`，不要在会话内自行写。

## 3. 约束

- 只写 `expert-advice/round-0003/` 目录（`recommendation.md`）。
- 不执行安装、构建、测试、git 写操作。
- 不查看“既有 TUI 前端插件”项目；不查看无关仓库。
- 以仓库实际文件为准（见 context.md），不要泛泛建议。
