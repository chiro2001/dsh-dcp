# M0 decision records

> 依据修订版 PLAN §4：每个实验记录 pass/fail、选中候选、被拒候选与证据。
> 未通过不得把对应协议搬进 M1。

## E-01 — 通过（2026-08-16）

宿主版本：`@deepseek-ai/*@0.1.0-rc.6`（npm）；契约测试
`tests/contract/e01.spec.ts`（6/6 绿）。

### 结论

1. **[事实]** 未知事件不能经公开 `Session.append` 写入：`plugin/test` 直接抛
   TypeError。原规划的 `dcp/*` 自定义事件不可实施，**维持修订稿撤销决策**。
2. **[事实]** 外置 writer 可以在开放 turn 内完整写入
   `compaction/start → summary → user/message replace → end`，随后
   `Session.create` 重载成功、`deriveMessages()` 与 surface 一致（“未加载
   DCP 逻辑”的等价重建）。
3. **[事实]** `user/message.source` 可携带 `compactionId + dcp` 扩展字段，
   JSON round-trip 后原样保留；`compaction/start` 必须在开放 turn 内
   （compaction invariant），否则被拒。
4. **[事实]** `tool/result` replace 必须保持 message id 与除 content 外所有
   字段（否则 “may change only content”），且只能在开放 turn/step 内追加
   （session invariant）。`measure().surfaceTokens === sum(nodes.tokens) ===
full heuristic recompute === contextBreakdown.messageTokens`；
   带 usage anchor 时 `projectedTokens` 的增量等于 heuristic surface delta。
5. **[事实]** 同一步 assistant 替换（保留 block/callId、仅改 summary 参数）
   在开放 step 内合法，重建后一致 —— inline cleanup 路径可行。
6. **[事实]** 每个 replace 只插入一个节点；多次 replace 仍保持单节点，无法
   原位展开为多个原角色/tool 节点 —— exact decompress 不可实现，维持
   show/semantic expansion 方案。

### 决策门

- D4（复用 compaction transaction + source metadata）：**通过**。
- D6（inline summary + 同一步参数清理）：**通过（契约层）**；净收益与
  `minNetSavingsTokens` 校验属 M1 策略实现。
- 不写 `dcp/*` 自定义事件：**维持**。
- exact decompress：**维持延期**，v0.1 只做 raw show / semantic expansion。

## E-02 — 通过（2026-08-16，默认候选 B）

契约测试 `tests/contract/e02.spec.ts`（30 组合成转录，确定性 PRNG）。

### 指标与结论

- A（每步完整 system index）：每步产生一次 `request/header change`；
  **按决策规则淘汰**，不作为默认。
- B（日志化原位 boundary marker + alias delta）：header churn 0，陈旧 ref
  率 < 5%，每步 marker 开销 < 50 token，可解析率 ≥ C 的 90%。
- C（静态 guidance + 按需 `dcp_context`）：header churn 0、解析率 100%，
  但每次压缩多一个模型 step。

### 决策

- **协议 v1 默认采用 B**：每个 step 入口追加小型日志化
  `<dcp-boundary ref="mNNNN" ... />`；被原生 compaction 遮蔽的 marker 用
  alias delta 保持引用可解析。
- C 保留为可配置 fallback / 低压会话模式。
- A 不提供；refs 一律按 surface position 解析，不依赖 seq 数值排序。

## E-03 — 待完成
