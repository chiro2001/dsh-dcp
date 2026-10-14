# 单场景：事件账本修复费用对照

官方 DeepSeek / deepseek-flash，固定公开 fixture；公共准备输入 478,056 tokens。

| 分支     | 独立验收 | 请求数 | 平均输入 tokens | 压缩次数 |  续作费用 |
| -------- | -------- | -----: | --------------: | -------: | --------: |
| inactive | 通过     |      6 |          480693 |        0 | $0.011411 |
| active   | 通过     |     23 |           33234 |        1 | $0.012177 |

续作节省率：-6.71%。共同准备费用 $0.071710，实际实验支出 $0.095298。

平均上下文下降 93.09%，压缩后首请求为 3,558 tokens、其后请求平均约 13,008。
请求数从 6 增至 23，累计输出从 4,207 增至 13,223：节省的缓存输入费用
$0.006394 被新增未缓存输入和输出费用 $0.007160 抵消。
完整构成见 [上下文与费用分析](cost-context-analysis.md)，执行路径见
[轨迹诊断](trajectory-analysis.md)。
active 的额外调用伴随多轮代码修改和 3 次检查失败后的恢复，压缩本身只提交
一次且没有收据重试。单次轨迹差异不能直接证明摘要损害了模型能力。

同一静态定义与日志 seed 核对：通过。

两边各通过 12 项独立验收。唯一压缩参数/块元数据均为 m0001→m0003；无
非 DCP 摘要、无 compaction-purpose 请求。全部 30 个实际请求用量完整，
共同准备只计一次。57 项运行源码及冻结归档全部匹配，凭据扫描未检出加载 key，
见 [独立对账](raw/independent-audit.json)。运行前离线门禁 280 passed / 5 skipped，
typecheck/lint/build/package/peers/perf 全绿。可用 `pnpm eval:scenario` 生成公开
夹具；`pnpm eval:scenario --execute` 在协议预算内新建不可覆盖的真实实验。

历史是明确标注的构造调查回放；公共准备及两条续作使用真实模型。指定一次压缩，保留最近两 turn，不评价自然触发算法或总体非劣。共享前缀以官方 usage 确认缓存；单组顺序固定 inactive→active，缓存状态及模型随机性限制结论范围。

构造回放之前的自然模型工作费用未测。共同准备仅实际计费一次；完整条件归因成本见 raw/summary.json。失败、缺 usage 和未成功压缩均保留。

[请求费用表](request-costs.csv) · [完整汇总](raw/summary.json) · [预注册协议](raw/protocol.json) · [冻结源码清单](raw/source-manifest.json)
