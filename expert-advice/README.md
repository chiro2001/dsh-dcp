# Expert advice archive

此目录保存外部顶级模型对 dsh-dcp 开发计划的独立审阅与修订轮次。每轮使用
不可覆盖的 `round-NNNN/`：

```text
prompt.md      请求与问题
context.md     仓库 commit、输入文件与实际执行方式
response.md    模型最终回复（含完整修订版 PLAN 文本或独立文档）
decision.md    执行 Agent 对每条建议的 accept/reject/defer 处置
```

流程规范：按“顶级模型咨询流程”（见参考项目 `docs/06-agent-iteration-protocol.md`
§5 的同一套约定，本文档不再重复）。核心约定：

- 咨询模型以 `gpt-5.6-sol` + `max` reasoning 运行，工作区可写，但只允许
  写入本目录 `round-NNNN/` 下的输出文档，不得改动源码、规划文档、实验产物
  或构建目录。
- 顶级模型建议不是证明，也不自动改变规划；执行 Agent 阅读 `response.md` 后
  写 `decision.md`，接受的建议必须落到 `docs/PLAN.md` 或后续实现中。
- 不可用/失败时只记录 `blocked.md` 与错误，不伪造回复，不阻塞主流程。
- 不在本目录提交认证信息、环境变量值或未脱敏数据。
