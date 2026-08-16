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

## E-03 — 通过（2026-08-16，契约层）

契约测试 `tests/contract/e03.spec.ts`（4/4）+ `src/protocol/recovery.ts`。

### 结论

1. **[事实]** 压缩 bracket 每个崩溃点的分类可确定性重放：none /
   live-orphan-start / stale-orphan-start / summary-without-replace /
   recovered-unclosed / committed / failed-attempt。
2. **[事实]** `session/end-seed` 之后的未闭合 `compaction/start` 是上一生命
   周期的陈旧孤儿（不阻塞）；end-seed 之前的是活孤儿。
3. **[事实]** 在稳定边界 fork 的子会话不含父会话的孤儿 bracket；
   fork 边界必须位于 turn 外（宿主强制）。
4. **[事实]** 冷重放（`foldSurface`）与增量 surface 一致；原生 compaction
   吸收 DCP checkpoint 后，reconcile 标记为 `absorbed-native`，token meter
   的 surfaceTokens 与 nodes 和一致且下降。

### 决策门

- 崩溃/部分提交分类：**通过**，M1 落入 `src/protocol/`。
- 与原生 compaction 共存（surface membership reconciliation）：**通过契约层**；
  实际双插件挂载顺序、overflow recovery、`/compact` 手动路径在 M3/M4 e2e
  覆盖（修订版 PLAN §4 E-03 的剩余矩阵）。
- 工具管线并发（多 compress/deny/abort/timeout、Code Mode 子调用拒绝）：
  M3/M4 门禁，v0.1 的 `compress` 保持 exclusive + 宿主 approval。

## M3 补充决策（2026-08-16）

- **[事实]** `tool/result` content-only replace 在**开放 turn 但无开放 step**
  （`agent/pre-step` 位置）同样合法 —— 自动策略可挂在 pre-step。
- **[事实]** 已剪枝的 `tool/result` 是 replacement 节点（`surfaceOp !== 'append'`），
  策略据此幂等，多次 pre-step/重启不会重复替换。
- **message-mode 实验项**：延后。v0.1 `compress.mode` 仅 `range`（config schema
  拒绝 `message`）；安全子集（无 tool-call 单节点）留待 v0.2 决策门。

## M6.1 初始实验（2026-08-16，长会话热路径）

- **[事实]** 完整 pre-step 等价热路径（replay + nudge + alias scan）在
  1k/4k/16k/50k 事件上：9.8 / 20.9 / 60.2 / 188.9 ms；T(4n)/T(n) ≈ 2.1–3.1
  （门禁 ≤6），未触发“当前热路径非近线性”证伪。
- **[推断]** 50k 事件单次 ~190ms、近线性增长 → **暂不实现增量 replay**；
  `applyDcpEvents()` 保持“拼接后全量 refold”仅作为等价性参考，生产入口继续
  使用冷 replay。若后续 50k+ p95 超 100ms 或增长率 >6，再实现被生产消费的
  增量状态/cache。
- **[事实]** alias 扫描已优化为一次性 replacement map（O(n)），不再是
  逐 marker × 全日志扫描。
