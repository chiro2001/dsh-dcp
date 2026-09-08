# 上下文压缩关键规则（维护专区）

本文是 dsh-dcp 压缩行为的重点维护区。模型看到的稳定规则单一来源是
[`src/prompts/compression-rules.ts`](../src/prompts/compression-rules.ts)；修改压缩
提示词时，先更新该模块及其快照，再同步本文的说明。配置限制在插件启动时解析，
只注入一次 `compress` 工具描述，不把每一步的 refs、nudge 或状态拼进 system
prompt，避免请求头反复变化。

## 调用触发

只有以下情况才调用 `compress`：用户明确要求、DCP nudge，或上下文压力明确显示压缩
具有节省价值。工具已经注册或当前可见本身不是触发条件；手动模式还必须由用户显式
触发 `/dcp compress`。

## 不可变安全规则

- 只压缩已闭合、已完成的历史；不得包含当前 turn、活动中的工具工作、未闭合的
  工具调用/结果对、受保护指令或受保护工具输出。
- 如果插件把受保护内容原样追加到 checkpoint，必须保留该附录，不得省略或改写。
- range 是 half-open 区间 `[startRef, endRef)`：包含 `startRef`，不包含 `endRef`。
  引用过期、含糊或无法验证时 fail closed，不能为了成功而扩大范围。
- 压缩是写入日志的 surface mutation。模型请求必须由 session 日志重建，不能依赖
  请求发送前的隐式改写。
- 每个 checkpoint 的摘要正文是实际技术内容；不能用 `[bN]`、`[stored in bN]`
  或其他指针占位符代替。
- 保真与节省冲突时保真优先：不能为了跨过最小节省阈值删除高价值事实，应改选
  边界或暂不压缩。

## 结果状态机

| 状态       | 上下文含义                           | 模型下一步                                                        |
| ---------- | ------------------------------------ | ----------------------------------------------------------------- |
| `rejected` | 没有任何 range 提交                  | 只执行错误返回的 correction；不要重复调用或再次粘贴被拒绝的长摘要 |
| `partial`  | 只有结果列出的成功 range 已提交      | 保留成功 checkpoint，只重试失败 range，并重新使用当前 refs        |
| `success`  | 结果列出的 checkpoint 已成为权威摘要 | 停止；不要再次压缩成功 range                                      |

工具执行后，插件可能把历史 assistant 工具调用中的长 `summary` 改写为带 provenance
的 committed 或 rejected cleanup marker，例如：
`<dcp-inline-cleanup provenance="dsh-dcp" status="committed" block-ref="bN" />`。
这是插件在工具执行之后对历史调用做的 inline cleanup 标记，不是模型提交的摘要，也不
代表数据丢失；只有 committed checkpoint 中保存的完整正文才是权威内容，rejected marker
表示没有对应提交。旧会话中若仍出现
`[stored in bN]`，也只能按历史 cleanup 标记理解，不能把它当作摘要正文。原始日志仍
用于审计和重放。

## 首次调用模板

工具描述中包含下面的简洁模板。模型应替换所有尖括号占位符，不应照抄占位值：

```json
{
  "topic": "<COHERENT_PHASE>",
  "content": [
    {
      "startRef": "<CURRENT_CLOSED_START_REF>",
      "endRef": "<CURRENT_CLOSED_END_REF>",
      "summary": "Goal: <...>\nConstraints: <...>\nDecisions: <...>\nArtifacts: <...>\nFailures: <...>\nVerification: <...>\nOpen work: <...>"
    }
  ]
}
```

每个 range 尽量只覆盖一个连贯阶段或主题。可以在一次调用中提供多个不重叠
range；不要求采用旧到新的特定顺序，插件内部会负责安全的范围顺序处理。

## 摘要保真模板

较长或实质性 range 按需保留下列字段；小而单一的 range 可以使用紧凑的高保真短段落。
省略空字段和标题，不要机械填写“none”或其他空占位，也不要凭空补事实：

```text
Goal: 用户目标和当前阶段要解决的问题
Constraints: 硬性约束、环境、兼容性或不能采取的方案
Decisions: 已做决定及其理由
Artifacts: 文件、符号、命令、ID、配置或其他可定位产物
Failures: 出错现象、根因、修复和仍存在的限制
Verification: 执行过的测试、检查及结果
Open work: 尚未完成、待确认或下一步工作
```

摘要应能让后续模型继续工作，而不仅是概括主题。尤其不能删掉关键决策、文件/符号、
失败与修复、验证结果或未完成事项来满足 `minNetSavingsTokens`。

## 当前配置值与提示边界

默认值来自 [`src/config.ts`](../src/config.ts)，当前压缩默认值为：

| 配置                  | 默认值 | 作用                                  |
| --------------------- | -----: | ------------------------------------- |
| `retainRecentTurns`   |    `2` | 保留最近完整 turn，不纳入压缩         |
| `minNetSavingsTokens` |  `256` | 每次提交所需的最小估算净节省          |
| `maxRangesPerCall`    |    `3` | 一次工具调用允许的最大不重叠 range 数 |

用户覆盖配置后，解析后的值会出现在本次注册的 `compress` 工具描述中。system
prompt 只保留本文件上方的稳定规则；不要把每一步动态的 boundary refs、token
估算或 nudge 文本加入 system guidance。
