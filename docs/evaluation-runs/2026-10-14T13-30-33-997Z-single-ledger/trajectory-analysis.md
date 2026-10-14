# 轨迹诊断

范围仅限本次公开合成 fixture 的 prepare/continuation session、ledger 与最终 artifacts；没有读取私有历史，也没有调用 API。

## 直接观察

- 两条续作从同一份 359-event checkpoint 分支；共同 prepare 花费 1 个模型请求，记录输入 478,056 tokens。
- inactive 有 6 个模型请求、5 个续作工具调用；active 有 23 个请求、24 个续作工具调用，其中有 1 次压缩调用。active 比 inactive 多 17 个请求。
- active 压缩调用前的 prompt 为 478,197 tokens；压缩后有 22 个请求，第一条为 3,558 tokens，压缩后请求均值为 13,007.95。inactive 的首条 prompt 为 478,158 tokens，之后 5 条均值为 481,199.6。
- active 的续作工具调用包括 7 次检查、10 次与 smoke 测试相关的调用、2 次完整账本运行和 3 次 Python 检查；另有 1 次压缩调用。检查里出现各 1 次 `KeyError`、`AssertionError`、`NameError`，之后继续修改和验证。inactive 的 5 个工具调用都成功。
- 轨迹记录了 5 次写入 `ledger.py` 的工具调用；其中 4 次返回成功，1 次合并写入与检查的调用以 `NameError` 结束。inactive 记录 1 次成功写入。没有显式格式化器或 `py_compile` 调用，也没有观察到语法或缩进错误。
- active 只调用一次压缩。收据报告提交成功，日志各有一条 summary 和 prune 记录，影子范围计量为 279,168 tokens；之后没有第二次压缩调用。23 个 ledger attempt 都是 conversation，没有额外的 compaction API 请求。没有观察到重复提交或收据重试。
- 两边最终独立验收均为 12/12。最终 ledger 都是 181 行，输出计数相同：3,747 accepted、133 rejected、216 duplicates；两份 ledger 源文件内容不同。
- continuation 实际费用为 inactive `$0.011411280`、active `$0.012177312`，active 多 `$0.000766032`。轨迹汇总的平均 prompt 分别约 480,693 和 33,234 tokens。

## 解释与限制

日志显示，active 分支在压缩后继续进行了 22 个模型请求，工具记录同时显示多次代码、检查与验证交互；inactive 分支一次写入后完成了较少的验证步骤。这与 23 对 6 的请求差异一致。日志不能证明压缩导致了更多请求，也不能把费用或成功归因于压缩本身：这是一个顺序固定的单次模型轨迹，分支间还存在生成随机性。
