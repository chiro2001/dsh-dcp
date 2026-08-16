已完成审阅与修订。完整替换版计划已写入 [revised-plan.md](/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning/expert-advice/round-0001/revised-plan.md)。

## 审阅意见

1. **[事实] 核心方向成立。** 请求时 rewrite 与 agent-loop reconstruction invariant 冲突；“模型可见即日志”、不修改 dsh 核心应继续坚持。

2. **[事实] 原 `dcp/* + ignorable` 事件方案当前不可实施。** `Session.append()` 无法写 `ignorable: true`，外置事件又不在静态已知事件目录中，重启加载会失败。

3. **[事实] 原计划的 exact decompress 验收不可实现。** 当前 replace 只能把连续范围折叠为单节点，不能原位展开成多条原角色/tool 消息。

4. **[事实] 任意 replace 会令持久 token projection 漂移。** 每次 replace 必须紧邻合法的 `compaction/summary` 或 `compaction/prune` shadow price；仅调用 `tokenMeter.measure()`不足以修复持久投影。

5. **[需实验] 复用原生 compaction transaction 是最佳候选，但不能先验认定可行。** 修订稿要求先验证外置 writer、checkpoint source 扩展、invariant、持久化和插件缺席重载。

6. **[推断] 动态 system index/nudge 不适合作为默认方案。** 它会持续改变早期请求前缀或追加完整 runtime snapshot。默认候选改为静态 guidance 加尾部日志化 boundary marker，并与按需 `dcp_context` 工具做 A/B。

7. **[事实] 内联摘要存在重复 token 风险。** 摘要同时留在 `compress` 参数和 checkpoint 中。修订稿增加同一步 assistant replacement 实验；v0.1 仍优先 inline，但插件辅助 LLM 不再是未经验证的自动 fallback。

8. **[事实] 原 purge-errors 映射错误。** 工具输入位于 assistant tool-call block，替换 `tool/result` 无法清理输入。新版改为完整、工具配对平衡单元的实验性 deterministic prune，默认关闭。

9. **[事实/推断] 并发与命令需要宿主级约束。** `compress` 保持 exclusive 并复用 approval；直接 mutation 使用开放 turn 或 idle maintenance；需要 tool-result replace 的 sweep 通过 control turn 执行。

10. **[事实/推断] 原生 compaction 不能只触发 nudge 复位。** 它可能遮蔽 block、refs、marker 和 expansion；必须根据当前 surface membership 重建 `active/consumed/absorbed-native/expanded` 状态。

11. **[事实] 子代理结果不能默认依赖 child session。** 父 surface 的 tool result、report、settlement 和 job notice 才是默认保护来源；child 深读取延期为可选增强。

12. **[推断] 里程碑顺序需要调整。** 新增 M0 宿主契约证伪阶段；TDD、CI、重启和不变式测试从 M0/M1 开始，M5 只负责加固与发布。

## 信息增益最高的下一步实验

1. **E-01：持久事务、计量与内联参数清理。** 一次验证未知事件失败、compaction transaction、source metadata、token projection、same-step assistant cleanup 和 exact-decompress 边界。

2. **E-02：边界协议 A/B。** 比较动态 system index、原位 marker/alias delta、按需 context 工具的正确率、token、header churn 与 KV-cache 影响。

3. **E-03：并发、崩溃和原生 compaction 状态机。** 对每个事务阶段注入中止，并覆盖挂载顺序、surface 变化、重启、fork、多工具及 native absorption。

## 方向性结论

- 不 fork dsh 核心，不改用请求时 rewrite。
- v0.1 不写自定义 `dcp/*` SessionEvent。
- range 改用按 surface position 解析的 half-open、工具配对平衡区间。
- 摘要继续优先由当前模型内联生成，但以 E-01 的净收益与清理结果为准。
- exact multi-message decompress 延期；提供只读 raw show 和明确标注的单节点语义展开。
- purge-errors、Code Mode 子调用和 child-session 深读取保持实验或延期状态。

修订稿同时重写了事件/状态协议、模块结构、配置、M0–M5、测试矩阵、CI、恢复规则、原生 compaction 共存、许可决策和风险停止条件，并逐项使用 **[事实] / [推断] / [需实验]** 标注。

本轮仅新增 `revised-plan.md`；未创建 `response.md`，未运行安装、构建或测试。
