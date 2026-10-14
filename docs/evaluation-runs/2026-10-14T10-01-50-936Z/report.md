# Terminal-Bench dsh A/B 开发 pilot

运行 ID：2026-10-14T10-01-50-936Z。官方 DeepSeek / deepseek-flash / thinking disabled，真实 dsh 0.2.0-rc.2 核心与容器 terminal preset。

计划 36 次任务运行，完成 36；源文件一致：true；停止原因：正常完成。

| 方案     | 运行/成功 | Q      | 总费用 USD | 每成功任务 K |
| -------- | --------- | ------ | ---------- | ------------ |
| baseline | 18/12     | 66.67% | $0.168567  | $0.014047    |
| dcp      | 18/13     | 72.22% | unknown    | unknown      |

实测价窗有效节省率：不可用；统一峰值费率节省率：不可用。

**本轮没有执行任何压缩动作，不能据此验证压缩算法。** 在相同预算标准下，DCP 成功率点估计高 5.56pp，但保守单侧质量差下界为 −76.04pp，无法证明 1pp 非劣，更不能声称总体能力提高。

DCP 的已知费用为 `$0.210384834`，还有一条 invalid_response 请求的费用未知。按非负费用口径，
`K_DCP ≥ 0.210384834 / 13 ≈ $0.016183449`，baseline 的 `K=$0.014047250`；因此本 cohort 中
真实节省率满足 `S ≤ −15.20%`，即每成功任务费用至少增加 15.20%。计算出的上界约为 −15.2072423%，
−15.20% 是向上取整后的保守界，避免四舍五入给出过强的不等式。这是已观察 cohort
的数学界，不是精确费用点估计或统计置信结论；没有把未知请求按零计入主账本。

`Q` 与逐行“预算内结果”要求官方 reward=1、无 trial exception、执行正常完成。
单看官方 reward=1，baseline 为 12/18、DCP 为 15/18；DCP 中两次虽验收通过，却触及
请求/时间预算，因此严格成功只有 13/18。预算阈值与评分逻辑在首个请求前已冻结，
不是看结果后改变成功标准。

本轮费用按官方 API usage 与冻结价表估算，不是账户扣款账单。36 次共 1026 个请求尝试
（449 baseline、577 DCP）；已知 API 支出 `$0.378951828`，精确总额因一笔缺 usage 不可用。
账本保守预算占用为 `$1.333673998`，低于预注册 `$10` 上限。两个预检共 22 请求、
`$0.009329868`，另列而不混入主样本；预检加 pilot 的已知 API 费用为 `$0.388281696`，
仍有上述未知部分。开发/测试 Agent 的工作费用不在任务运行 API 账本中。

此为非随机开发便利子集上的 pilot；样本量与保守质量下界不能证明 1pp 非劣。已知费用按官方当日价表和已返回的完整 usage 计量，未查账户扣款账单；unknown 不按零处理。

原始任务、资格失败与未运行候选均保留在冻结数据集/资格快照。此轮不使用 holdout 调参，不宣称完整 benchmark 或榜单结果。

每任务按原始指令运行一个用户 turn；DCP 默认保护最近两个 turn，可能没有合法压缩范围。未触发压缩时，此轮只能评估当前配置的整体开销与行为，不能证明阶段压缩的收益或损害。

[完整配置与计划](raw/protocol.json) · [统计与逐运行结果](raw/summary.json) · [运行输入源码指纹](raw/runtime-source.json) · [源码内容快照](raw/frozen-runtime-source.tar.gz) · [预检复现](reproduce-preflight.md) · [目标验收](completion-audit.md)

| 任务                      | 方案     | 重复 | 预算内结果 | 请求 | 费用 USD  | compress 调用 | 耗时 s |
| ------------------------- | -------- | ---- | ---------- | ---- | --------- | ------------- | ------ |
| extract-elf               | baseline | 1    | 失败       | 27   | $0.013981 | 0             | 139.1  |
| extract-elf               | dcp      | 1    | 通过       | 21   | $0.010988 | 0             | 97.6   |
| extract-elf               | dcp      | 2    | 通过       | 28   | $0.012340 | 0             | 137.0  |
| extract-elf               | baseline | 2    | 失败       | 19   | $0.012759 | 0             | 225.1  |
| multi-source-data-merger  | dcp      | 1    | 通过       | 8    | $0.004067 | 0             | 61.0   |
| multi-source-data-merger  | baseline | 1    | 通过       | 5    | $0.001775 | 0             | 46.0   |
| multi-source-data-merger  | baseline | 2    | 通过       | 7    | $0.002175 | 0             | 48.5   |
| multi-source-data-merger  | dcp      | 2    | 通过       | 6    | $0.001638 | 0             | 43.9   |
| regex-log                 | baseline | 1    | 失败       | 6    | $0.003034 | 0             | 63.4   |
| regex-log                 | dcp      | 1    | 通过       | 17   | $0.005852 | 0             | 83.1   |
| regex-log                 | dcp      | 2    | 通过       | 30   | $0.012739 | 0             | 127.1  |
| regex-log                 | baseline | 2    | 通过       | 46   | $0.014425 | 0             | 150.3  |
| break-filter-js-from-html | dcp      | 1    | 通过       | 32   | $0.006547 | 0             | 215.0  |
| break-filter-js-from-html | baseline | 1    | 通过       | 12   | $0.002290 | 0             | 47.4   |
| break-filter-js-from-html | baseline | 2    | 通过       | 14   | $0.003346 | 0             | 76.6   |
| break-filter-js-from-html | dcp      | 2    | 通过       | 17   | $0.003100 | 0             | 146.8  |
| sqlite-db-truncate        | baseline | 1    | 通过       | 58   | $0.020687 | 0             | 200.3  |
| sqlite-db-truncate        | dcp      | 1    | 失败       | 80   | $0.026707 | 0             | 198.4  |
| sqlite-db-truncate        | dcp      | 2    | 失败       | 39   | $0.014719 | 0             | 124.4  |
| sqlite-db-truncate        | baseline | 2    | 通过       | 30   | $0.009833 | 0             | 101.1  |
| cobol-modernization       | dcp      | 1    | 失败       | 79   | unknown   | 0             | 324.1  |
| cobol-modernization       | baseline | 1    | 失败       | 79   | $0.037846 | 0             | 314.0  |
| cobol-modernization       | baseline | 2    | 通过       | 53   | $0.020822 | 0             | 229.8  |
| cobol-modernization       | dcp      | 2    | 失败       | 80   | $0.022857 | 0             | 165.5  |
| nginx-request-logging     | baseline | 1    | 通过       | 10   | $0.001742 | 0             | 47.5   |
| nginx-request-logging     | dcp      | 1    | 通过       | 14   | $0.002394 | 0             | 51.0   |
| nginx-request-logging     | dcp      | 2    | 通过       | 10   | $0.001940 | 0             | 47.0   |
| nginx-request-logging     | baseline | 2    | 通过       | 11   | $0.001789 | 0             | 46.8   |
| cancel-async-tasks        | dcp      | 1    | 通过       | 57   | $0.021459 | 0             | 228.6  |
| cancel-async-tasks        | baseline | 1    | 失败       | 40   | $0.015662 | 0             | 267.1  |
| cancel-async-tasks        | baseline | 2    | 失败       | 8    | $0.001638 | 0             | 59.2   |
| cancel-async-tasks        | dcp      | 2    | 失败       | 36   | $0.013668 | 0             | 320.9  |
| fix-git                   | baseline | 1    | 通过       | 11   | $0.002342 | 0             | 41.9   |
| fix-git                   | dcp      | 1    | 通过       | 10   | $0.002074 | 0             | 38.7   |
| fix-git                   | dcp      | 2    | 通过       | 13   | $0.002018 | 0             | 41.2   |
| fix-git                   | baseline | 2    | 通过       | 13   | $0.002420 | 0             | 43.6   |

## 失败诊断与后续方向

| 执行结果/诊断                      | baseline | DCP      |
| ---------------------------------- | -------- | -------- |
| 正常结束但官方 reward=0            | 3        | 0        |
| 输出 token 上限（max-tokens）      | 2        | 1        |
| 请求数上限（request_count）        | 0        | 2        |
| 模型执行时间上限（deadline）       | 1        | 2        |
| 官方 verifier ConnectionResetError | 1        | 1        |
| 缺 usage 的请求                    | 0        | 1        |
| 含失败的 nearest-rank p95 总耗时   | 314.033s | 324.098s |

verifier 异常与 deadline 发生在同一运行，是额外诊断，不能再加进失败数。
max-tokens 是输出限制，不能把所有 `execution.status=error` 或通用 ledger outcome
标签解读成基础设施故障。含失败的 p95 点估计增加 3.21%，不是总体延迟保证。

本轮用原始指令、terminal-only preset、thinking disabled、固定 4096-token 输出上限，
没有真实 child 执行树。对照保留相同宿主原生 compaction，但本轮未达到其触发条件。
9 个非随机开发任务、每臂两次重复只能提供诊断，20 个留出任务未用于模型调参。

先实现当前 turn 的闭合 step/阶段候选和独立近期 token 保留，再实现真正的休眠模式
与同状态 fork。保留整任务部署 A/B，阶段 fork 用于隔离从同一状态启用策略的增量效果。
阶段许可不能仅取模型“已完成”自述；压缩后仍需独立续作验收。

下一轮计量应预注册处理硬截止时未返回 usage 的策略，例如受预算约束的在途请求
收尾窗口；不能事后给本轮补猜 usage、删掉超时样本或把阶段收益写成已经验证。

## 完整对账与缓存诊断

[独立逐请求对账](raw/reconciliation-final.txt)通过：36/36 运行、18 个配对、1026 个请求尝试
均与原始 ledger 一致，没有 pending 或丢失请求。唯一缺 usage 的条目位于
`cobol-modernization-dcp-r1`，状态为 `invalid_response`；该运行的执行原因是 deadline。
它在启动后约 299.256 秒发出、300.203 秒结束。日志未保留 response body 读取失败的
具体原因，因此不能把它确定归因为服务商坏 JSON，或确定称为取消导致；费用维持未知。

| 已知计费用量/诊断                   | baseline | DCP      |
| ----------------------------------- | -------- | -------- |
| uncached input U                    | 192679   | 231127   |
| cache read H                        | 7093248  | 10489728 |
| output O（含可能 reasoning）        | 197309   | 240411   |
| 已知输入加权 H/(U+H)                | 97.36%   | 97.84%   |
| DCP 来源 user message 追加          | 0        | 18       |
| compaction/prune/summary/checkpoint | 0        | 0        |
| compress tool call / 原生摘要请求   | 0 / 0    | 0 / 0    |

DCP 的用量与缓存比例仅覆盖有完整 usage 的请求，不能冒充包含未知请求的精确总量。
表中 output 已包含输出分项，不另加 reasoning；本轮 thinking disabled。高缓存读取率
不是省钱证据，DCP 的已知输入和输出支出仍更高。

[终点诊断](raw/diagnostics-final.json)确认 54 项运行源码及九个冻结任务的终点 hash
一致，所有 session surface operation 仅为 append。DCP 确实追加了控制/引用消息，
因此不能说插件未改变上下文；但本轮没有历史压缩或剪枝。这与一个用户 turn 加默认
最近两 turn 保护的候选限制一致，新阶段算法需单独实施和检验。

[离线门禁](raw/offline-gate.log)：248 passed / 5 real skipped、行覆盖 90.54%，
确定性 E2E 47 passed、隔离安装/build/package/peers/perf 全绿，Python unittest 3/3。
保留冻结评分结果，不在本轮事后改阈值、重跑替换失败或调整候选配置。

[最终文案复核](raw/report-claims-final.json)与 [凭据扫描](raw/credentials-final.json)通过：887 个普通文件、36 个 session gzip 与一个源码 tar 的解压内容均未检出已加载 key。源码 tar 的 54 文件也经 [独立校验](raw/source-archive-final.json)逐项匹配。
