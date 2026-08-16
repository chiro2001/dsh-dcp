# Round 0002 recommendation — 先做 RC 完整性门，再进入 v0.2

> 审阅基线：`context.md` 所列 commit `08d024c8f845092fd8c0e1f9c55ad1e67f470511`。
> 本轮遵守只读审阅约束，未运行安装、构建或测试；测试通过数与覆盖率采用
> `context.md` 的报告值。

## 0. 结论

- **[事实]** “模型可见即日志”、标准 compaction transaction、half-open surface
  range、原始日志不删除这四个核心方向，均有 PLAN、PROTOCOL、M0 contract 与当前
  主链路代码相互支持，不应改变。
- **[事实]** “M0–M5 全部完成”不能等价为“PLAN 的全部验收矩阵已被证明”：
  `tests/contract/DECISIONS.md` 明确把双 writer 挂载顺序、overflow、`/compact`、
  deny/abort/timeout 与 Code Mode 拒绝留给 M3/M4；仓库中没有对应测试；
  `scripts/check-all.sh --e2e` 当前只打印 `not implemented yet`，CI 的 `e2e` job
  只验证安装与 dump-config。
- **[事实]** 当前实现与已发布 PROTOCOL v1 存在可观察差距，最关键的是 native
  compaction 后的 marker alias 只存在于构造/解析函数和 E-02 模拟中，实际 pre-step
  不生成 alias，replay 也不消费 alias。另有若干公开配置和行为声明尚未接线，见 §1。
- **[推断]** 不应直接选择纯 A、B 或 C。建议采用第四方向 **D：RC protocol
  conformance（协议一致性与真实入口加固）**，吸收 A 中有价值的确定性 AgentLoop
  回归，吸收 C 中的长会话/KV 测量与发布决策，但暂缓 B 的新增状态空间。
- **[推断]** 下一交付应是 `v0.1.0-rc.2` 的完整性门，而不是直接命名为 v0.2。
  在协议、入口和门禁诚实性修复前，新增 message-mode、Code Mode 执行或 child
  deep-read 会放大未被观测的组合状态。
- **[推断]** 不先实现“增量 replay”。先测实际 pre-step/prepare 热路径并定位成本；
  当前 `applyDcpEvents()` 仍然全量 refold，且生产入口没有使用它，单独优化该函数未必
  改善真实延迟。

## 1. 证据审阅与反驳

### 1.1 当前状态中被文件直接支持的事实

1. **[事实]** `src/index.ts` 每个普通 pre-step 至少调用两次 `reduceDcpState()`；
   `src/protocol/replay.ts#applyDcpEvents` 只是把旧、新日志拼接后再次全量 reduce，且
   除测试外没有生产调用点。
2. **[事实]** `turnOfSeq()` 从日志头扫描到目标 seq；prepare、dedup/purge 等路径会对
   多个 surface 节点重复调用它。`collectProtectedAppendix()` 也会对工具结果重复扫描
   全日志找 call。当前 perf smoke 只计一次 200/1000 节点 cold replay 的绝对时间，
   不覆盖完整 pre-step，也没有增长率断言。
3. **[事实]** `references.transport` 接受 `marker | context-tool`，但插件入口无
   `dcp_context` 注册，且无论配置值为何都追加 marker；`maxAliasEntries` 与
   `excerptChars` 没有生产使用点。
4. **[事实]** `buildAlias()`/`parseAlias()` 只有单元 round-trip；replay 只识别
   `<dcp-boundary>`，没有 alias fold。PROTOCOL §2 却承诺 native 遮蔽 marker 后由下一
   marker 追加 alias delta。
5. **[事实]** 全局 `config.enabled` 不控制注册或 pre-step；`subagents.*` 也没有生产
   使用点。`compress.enabled` 只控制工具注册，其他 DCP 行为仍运行。
6. **[事实]** `computeNudge()` 不读取 `minRatio` 或 `iterationThreshold`；它也没有按
   “最后一次 nudge 之后”限定 compression。现有 nudge 测试只覆盖高/低压力与频率，
   没有证明 PROTOCOL 所述 hysteresis/re-arm。
7. **[事实]** `computeSessionStats()` 累加所有 `compaction/summary` 和
   `compaction/prune`，没有区分 DCP 与 native；这与 PROTOCOL §8“native 节省不计入
   DCP”不一致。`renderStats()` 也未接入 domain aggregate。
8. **[事实]** command/control 路径忽略 `applyExpansion()`/`applyRecompress()` 的
   `RecoveryResult`；命令先报告“will be ...”，后续 control turn 即使 no-op 也没有结果
   回传。production recovery bracket 把 provider/model 固定写为 `mock`。
9. **[事实]** multi-range 在逐项 commit 前先用 `prepareBatch()` 验证全部 range；任一
   初始 range 失败会让整个工具抛错。inline cleanup 按“成功 block 数组下标”重写原
   `content[]` 的全部 summary；目前没有“中间 range 失败”的入口测试证明映射正确。
10. **[事实]** replay 对每条普通 `user/message` 都调用 `decodeDcpMeta()` 并把失败加入
    diagnostics；marker 计数只接受四位 `m\d{4}`，而生成器在 9999 后会产生
    `m10000`。现有长会话测试没有覆盖这两个边界。
11. **[事实]** 命令实现只注册 `dcp`；README 声称还注册 `dcp-compress`。PLAN 要求命令
    与提示词快照，但仓库测试没有 `toMatchSnapshot`/`toMatchInlineSnapshot` 使用点。
12. **[事实]** 真实模型 e2e 只有一个 `it`，覆盖 compress、context、manual on。
    纠正循环给出的 XML 是扁平 `startRef/endRef/topic/summary`，而工具 schema 要求
    `topic + content[]`；XML parser 也只构造扁平字符串参数。该 fallback 本身不能产生
    当前工具所需的合法参数。
13. **[事实]** adapter 已读取 `prompt_cache_hit_tokens`，但测试不记录、不比较、不设
    断言；E-02 的 KV/cache 结论来自模拟指标，而非真实 provider A/B。
14. **[事实]** devDependencies 锁定 dsh `0.1.0-rc.6`，但所有 dsh peerDependencies
    是无上界 `>=0.1.0-rc.6`；这与 PLAN §13“rc 阶段不使用无上界 `>=`”相冲突。
15. **[事实]** `context.md` 称仓库 private，而 README 同时出现 public 与 private 两种
    描述，AGENTS 又称 public；实际发布可见性不能由这些文件唯一确定。
16. **[事实（context.md 报告）]** 当前 52 passed + 1 skipped、核心纯逻辑覆盖达到既定
    门槛；commands/tool/index 覆盖明显偏低。由于本轮禁止运行测试，这些数字没有在本轮
    重新验证。

### 1.2 对三个候选方向的判断

| 方向                           | 判断                          | 成立部分                                                                 | 论证不足/应修改部分                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A：真实回归矩阵 + 入口覆盖     | **[推断] 部分接受，重构为 D** | restart、native coexist、tool/command/control 真实入口确是最高优先级缺口 | command 全族与自动策略是确定性行为，不应全部绑真实 LLM；先用 scripted adapter 跑真实 AgentLoop。`90%+` 行覆盖只能作旁证，不能替代 allow/deny/abort、失败回传、无 LLM control turn 与 invariant 断言。真实模型只保留少数模型行为探针。 |
| B：直接 v0.2                   | **[推断] 现在拒绝**           | storage-domain 实机接线边界小、价值明确，可成为完整性门后的首个 v0.2 项  | message-mode 增加 range 之外的协议分支；Code Mode 尚缺“明确拒绝”契约；child deep-read 引入 provider/隐私/递归问题。四项一起做没有共同的最小决策门。                                                                                   |
| C：性能/发布/上游              | **[推断] 拆分接受**           | 长会话 marker、真实 cache、dsh 漂移和 npm/public 决策应提前获取证据      | 先写增量 replay 是 solution-first；先测完整热路径。npm“是否公开”现在决策，实际 publish 在 RC 门后。多节点展开提案不解决当前正确性，可在确有产品需求和宿主契约草案后独立推进。                                                         |
| D：协议一致性 + 确定性真实入口 | **[推断] 推荐**               | 直接验证已发布承诺，修复虚假门禁，再决定性能实现和 v0.2 范围             | 必须控制范围：只修 PROTOCOL/README 已承诺行为和入口缺口，不借机加入新模式。                                                                                                                                                           |

## 2. 最可能遗漏的风险

| 优先级 | 风险与标注                                                 | 证据/影响                                                                                                                    | 处置或停止条件                                                                                                  |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P0     | **[事实] 协议—实现漂移**                                   | alias、transport、nudge、stats、命令别名等已出现文档承诺与生产路径不一致                                                     | 建立逐条 conformance ledger；不能实现的 v1 承诺必须明确按 RC 缺陷处理，不能继续宣称完成                         |
| P0     | **[需实验] control/工具真实入口可能绕过预期决策**          | control 分支在 `decision.kind` 检查前执行，并丢弃同批非 control messages；deny/abort/timeout/多 compress 尚无 AgentLoop 矩阵 | 任一 downstream exit 后仍 mutation、消息丢失、未配对工具或 request desync，立即停止功能扩张                     |
| P0     | **[需实验] partial bracket 误关联**                        | recovery classifier 不按 compactionId/source 关联 summary/replace/end；故障后的其他 replace 是否会被误认尚未测试             | fault injection + restart；出现误报 committed/recovered 即阻塞 release                                          |
| P1     | **[推断] 长会话热路径可能比“replay O(n)”更差**             | 多次全量 fold，加上逐节点 prefix scan 和保护工具全日志查找，存在 O(n²) 组合                                                  | 先跑 §3.2；达到阈值后才实现被生产入口实际消费的 cache/incremental reducer                                       |
| P1     | **[需实验] marker 累积与四位 ref 上限**                    | 每 step 一个 surface message；`m10000` 不被当前 replay regex 接受；真实 active marker/token 增长未测                         | 20k-step 无碰撞测试；artifact token 超预算则转向 coarse marker/context-tool 或压缩 marker 策略                  |
| P1     | **[需实验] KV cache 结论可能不成立**                       | 当前只有模拟 E-02；provider cache 的粒度、最小前缀与计费语义未知                                                             | 无稳定 cache metric 时结论标为 inconclusive，不以“header churn=0”代替 cache 命中证明                            |
| P1     | **[事实/推断] 真实模型 e2e 混入 adapter 缺陷与模型随机性** | XML fallback schema 不匹配，call id 每次 parse 从 `call_0` 开始；单次强制 prompt 不能衡量自然工具调用可靠性                  | 先修 harness、自测 schema round-trip，再做重复样本；命令矩阵不使用真实 LLM                                      |
| P1     | **[事实] dsh rc 漂移没有支持矩阵**                         | build/test 固定 rc.6，peer 却承诺所有未来版本                                                                                | 支持版本逐个跑 M0 + deterministic AgentLoop；失败就收窄 peer range，不用类型通过代替运行兼容                    |
| P1     | **[事实/推断] 发布元数据与可见性未闭合**                   | public/private 文档矛盾；`package.json` 无 SPDX `license`、`repository`、`publishConfig`；无 release workflow                | 未决定仓库/包可见性、对应源码获取方式和发布责任前，停止 npm publish；这不是法律结论，必要时由所有者取得法律意见 |
| P1     | **[事实/推断] e2e secret/privacy 面过宽**                  | shell 以 `set -a; source ~/litellm/.env` 导出文件内所有变量；文档只说明 key 不打印，未说明第三方请求与合成数据边界           | 只向测试进程传所需 key；禁止真实用户 session；日志/artifact 做 secret scan，失败即停止外部 e2e                  |
| P2     | **[推断] child deep-read 会改变“模型原本可见的数据集合”**  | 当前父 surface 保护语义较清楚；深读 child 可能带入父模型未见内容、远程 child 不存在、还可能含秘密                            | 仅 opt-in，先做 provider/权限/大小/脱敏契约；读取失败保持父结果，不允许空替换                                   |
| P2     | **[事实] 聚合统计尚不是产品闭环**                          | adapter 有单测，但插件未接 storage-domain，stats command 不展示 aggregate；当前 DCP/native 口径还混合                        | 先修 session 口径，再做真实后端 restart/catch-up；不能用 adapter 单测宣称实机聚合完成                           |

## 3. 按信息增益排序的三个下一个里程碑/实验

### 3.1 M6.0 — PROTOCOL v1 一致性与真实入口门（优先级 1）

**目标**

- **[推断]** 在不增加 v0.2 功能的前提下，使 PROTOCOL、README、公开配置、实际
  AgentLoop 行为和门禁互相一致；产出可发布的 rc.2 基线。

**输入**

- **[事实]** `docs/PROTOCOL.md` §§1–8、`tests/contract/DECISIONS.md` 的延期矩阵、
  `src/index.ts`、commands/tool/control/recovery/stats/refs/replay，以及现有 dsh rc.6
  contract fixture。

**动作（严格先写失败测试）**

1. **[需实验]** 建立“PROTOCOL 条款 → production symbol → test case”ledger；逐条覆盖
   marker/alias、range、事务相邻、策略、control、恢复、native membership 与统计口径。
2. **[需实验]** 用 scripted LLM adapter 挂载真实 AgentLoop、ToolRuntime、
   CommandRuntime、compaction/invariant companions，覆盖：
   - `compress` 从注册表到 execute 的 allow/deny/abort/timeout、同 assistant 多调用、
     partial failure 与 cleanup；
   - `/dcp` 全部参数、非法参数、busy/no-op、followup/control turn、重启后的命令状态；
   - control turn 不产生 LLM dispatch、不吞并普通输入、mutation 失败可被用户观察；
   - native compaction 前后 alias/ref、block membership、nudge、stats、restart；
   - 每一次实际 dispatch 的 `options.messages === session.deriveMessages()`。
3. **[需实验]** 为 §1.1 的静态差距写回归：global enabled、transport/no-op config、
   alias fold、真正的 min/max hysteresis、iteration fallback、native stats 排除、metadata
   diagnostics、`m9999` 边界、recovery provenance/sourceEventSeqs、multi-range 失败映射。
   对暂不支持的配置应 fail closed 或明确拒绝，不能静默接受。
4. **[需实验]** 给 system/tool/command/control/placeholder 文本加快照；命令与
   tool/index 的行覆盖达到 90% 只作为行为矩阵完成后的辅助信号，同时要求所有可达
   dispatch 分支有断言。
5. **[需实验]** 把 deterministic AgentLoop suite 真正接入
   `check-all.sh --e2e` 和 CI；删除“打印成功但不执行”的路径。真实模型测试保持可选，
   不作为此门的确定性替代品。
6. **[需实验]** 修复并单测真实 adapter 的 nested `content[]` schema round-trip、XML
   escaping、跨 response 唯一 call id、tool-call finish 语义；随后只保留一个最小在线
   smoke 验证网关仍可用。

**可证伪断言与验收标准**

- **[需实验]** 任意测试到达 LLM dispatch 时，请求 messages 与当时
  `deriveMessages()` 逐字节一致；deny/abort/downstream exit 后 DCP 日志和 surface
  均无 mutation。
- **[需实验]** native 遮蔽 marker 后，PROTOCOL v1 声称可保留的旧 ref 在下一 step
  通过有界 alias 可解析；超过 alias 预算时有确定、fail-closed 的诊断。
- **[需实验]** DCP stats 不计 native shadow price；manual/nudge 在 restart 后与冷重放
  相同；普通 user message 不产生 DCP metadata 错误诊断。
- **[需实验]** 所有 mutation command 的“已执行/未执行/失败”与日志事实一致，不允许
  先报 success 后静默 no-op。
- **[需实验]** `check-all.sh --e2e` 至少执行 deterministic AgentLoop、restart、native
  coexist 三类测试，任一失败使脚本非零退出。
- **[推断]** 满足以上条件后，才可把“M0–M5 完成”升级为“v0.1 RC contract-complete”。

**停止条件**

- **[需实验]** 发现 request reconstruction desync、shadow-price 漂移、工具配对破坏、
  无法分类的 partial commit 或跨重启静默状态变化时，停止该里程碑的其余便利性修复，
  先解决协议问题。
- **[推断]** 若 alias 或 control 结果回传受宿主公开 API 阻塞，记录最小宿主能力缺口，
  收缩/修订相应公开承诺并明确 rc.1 兼容处置；不得以进程内缓存伪装持久语义。

### 3.2 M6.1 — 长会话、marker 与 KV cache 决策实验（优先级 2）

**目标**

- **[推断]** 回答三个问题：真实热路径何时变慢、marker 何时抵消压缩收益、默认 marker
  是否实质伤害目标 provider 的 cache。实验结果决定是否以及在哪里做增量 replay。

**输入**

- **[需实验]** 两类固定 corpus：
  1. deterministic：1k/5k/20k/50k raw events，分别构造“大 raw log/小 surface”、
     高 dedup、嵌套 block、native absorption、restart；
  2. online synthetic：相同 system/tools 与固定多步转录，对照 DCP off、marker on、
     `context-tool`（仅在 M6.0 真正实现后）三组，不含用户或仓库秘密。

**动作**

1. **[需实验]** 计量完整 `agent/pre-step`、`reduceDcpState`、策略扫描、nudge、
   `prepareRange` 的 p50/p95、CPU、heap、raw-log bytes、surface nodes 与 DCP artifact
   tokens；区分冷启动与连续增量 step。
2. **[需实验]** 增加增长率断言而非只设 2 秒绝对值：固定参考环境预热后，比较
   `T(4n)/T(n)`；同时跑 20k marker，验证 ref 唯一、可重启和 alias 有界。
3. **[需实验]** online A/B 至少重复足以报告分布，记录 input tokens、cache-read
   tokens、首 token/总延迟、header changes；先验证 provider 是否稳定返回可比较的 cache
   指标，再讨论命中率。
4. **[推断]** 只有完整 pre-step 达到下述失败阈值，才实现 per-session 增量状态/cache；
   cache key 至少包含 session identity、已消费事件位置和 surface replacement generation，
   并继续用 property test 证明 cold/incremental 等价。

**可证伪断言与决策阈值**

- **[需实验]** 参考环境中 `T(4n)/T(n) <= 6`；若接近 16 或 50k-event pre-step p95
  超过 100 ms，则“当前热路径近线性且足够快”被证伪，触发增量/cache 实现。
- **[需实验]** 在发生常规压缩后的稳态，active DCP artifact tokens 不得超过 context
  window 的 5%，也不得超过累计净节省的 10%；任一超限则默认每-step marker 被证伪，
  进入 coarse marker/context-tool 对照。
- **[需实验]** 20k step 中 marker/ref 不碰撞、不回绕，restart 后 next ref 单调；否则
  四位 ref 协议的长会话可用性被证伪。
- **[需实验]** warmup 后 marker 组的 cache-read/input ratio 中位数相对 DCP-off 下降不
  超过 5 个百分点。若 provider 不返回稳定指标或置信区间跨越阈值，结果必须标记
  `inconclusive`，不能宣称“KV cache 无影响”。
- **[需实验]** 若触发优化，优化版本必须被 production pre-step 实际消费，并在同一
  corpus 上同时通过 cold/incremental 等价与上述延迟阈值；只让
  `applyDcpEvents()` 单测更快不算验收。

**停止条件**

- **[推断]** marker 预算或 cache 退化失败时，暂停 message-mode 等新增上下文写入，
  先重新选择 transport/frequency。
- **[推断]** 若增量缓存无法对 replacement/crash/restart 建立可靠失效条件，保留冷
  replay 作为真相并优化扫描/索引，不引入可能陈旧的隐式状态。

### 3.3 M6.2 — dsh 兼容、定向真实模型与发布决策门（优先级 3）

**目标**

- **[推断]** 把“在 rc.6 开发环境工作”收敛为明确支持范围，并决定继续 GitHub 源还是
  同时发布 npm；在线模型只验证模型相关假设，不承担 deterministic 回归职责。

**输入**

- **[事实]** 当前 rc.6 lockfile/devDependencies、无上界 peers、GitHub 安装路径、
  AGPL-3.0-or-later + NOTICE、矛盾的 public/private 文档、单网关真实 e2e。

**动作**

1. **[需实验]** 对 rc.6 与拟支持的新 dsh 版本逐个跑 M0 contract、M6.0 deterministic
   AgentLoop、安装/重启/package gate；记录包版本与支持结论。没有跑过的版本不进入 peer
   范围。
2. **[推断]** 把 peerDependencies 改为与实测矩阵一致的有界范围；新 rc 先 contract，
   后扩范围。若新版本失败，继续支持 rc.6 并清晰报错，而不是被 `>=` 隐式接纳。
3. **[需实验]** 真实模型只做三类重复探针：自然提示下选择合法 marker/schema、收到
   invalid/stale ref 后纠正、嵌套摘要保留关键事实。每类保留输入、结构化结果、usage/
   cache 指标与失败分类，不把一次通过写成质量结论。
4. **[推断]** 在 owner 明确仓库与 npm 可见性后再选择发布路径。若发 npm，先补齐 SPDX
   license、repository/source、publishConfig、tarball 清单、构建产物与源码一致性、tag
   gate/provenance；AGPL 对应源码义务由 owner/必要的法律意见确认，本计划不作法律结论。
5. **[需实验]** 收窄在线 e2e 环境：只传必需 key，使用合成 session，明确第三方
   endpoint，检查 stdout/stderr/artifact/tarball 不含 key 或会话内容。公开文档统一
   public/private、支持版本与数据边界。

**可证伪断言与验收标准**

- **[需实验]** 每个宣称支持的 dsh 版本均通过相同 contract/AgentLoop/restart 矩阵；
  任一版本失败就不能留在支持范围。
- **[需实验]** 被测 route 的自然 compress/纠正探针至少 8/10 产生 schema-valid、范围
  合法且成功提交的调用；低于阈值时标记 prompt/adapter/model reliability 缺陷，保持 RC，
  不扩模型驱动功能。摘要质量另按固定关键事实 rubric 报告，不与调用成功率混为一项。
- **[需实验]** npm dry-run tarball 可从声明入口加载，license/source 链接可达，构建产物
  与该 tag 源码一致，clean profile 安装无需未声明的本地状态。
- **[需实验]** secret scan 为零命中；在线测试仅含合成输入。命中任何 key/真实会话内容
  即停止上传 artifact 与发布。
- **[推断]** npm 决策未完成只阻塞 npm，不阻塞通过上述技术门的 GitHub rc.2；许可或
  对应源码获取方案未闭合时不得公开 registry 包。

## 4. 三个门之后的 v0.2 顺序

1. **[推断] storage-domain 实机接线优先。** 它不改变模型可见协议；先用
   dsh-storage-json 做 restart、写失败、catch-up、同长度/新增事件与多 session 测试，
   同时让 `/dcp stats` 明确展示 session/domain 口径。
2. **[推断] message-mode 安全子集其次。** 只允许无 tool-call 的单节点；复用事务、
   protection、收益和 restart 矩阵。任何 tool-bearing 节点仍拒绝或走完整 range。
3. **[推断] Code Mode 分两步。** M6.0 先证明 v0.1 能在 mutation 前明确拒绝；真正支持
   只有在宿主能提供外层 author/call provenance、approval 与 cleanup 契约后再开。
4. **[推断] child-session 深读取最后。** 仅 opt-in enrichment，并先解决权限、隐私、
   remote provider、递归/大小上限和父 surface fallback。
5. **[推断] 增量 replay、npm 发布分别服从 M6.1/M6.2 的实验结论。** 不把它们预先绑在
   v0.2 feature bundle 中。
6. **[推断] “单节点展开为多节点”的上游提案可独立进行，但不阻塞上述顺序。** 先给出
   sourceEventSeqs、角色/tool pairing、shadow price、权限和 crash atomicity 的最小 API
   契约；在没有真实 exact-decompress 需求证据前不投入主线实现。

## 5. 最终 go/no-go 规则

- **[推断] GO（rc.2）**：M6.0 全绿，`--e2e` 不再是空操作；PROTOCOL 条款均有实现或
  明确兼容处置；rc.6 deterministic/重启矩阵全绿；真实模型 smoke 至少不再受 adapter
  schema 缺陷污染。
- **[推断] GO（v0.2 开发）**：rc.2 完整性门通过，M6.1 已给出 transport/replay 决策，
  然后按 §4 一项一决策门推进。
- **[推断] NO-GO**：任何 request/derive desync、token projection 漂移、工具配对破坏、
  silent control failure、无法重放的 alias/state、未界定的 dsh peer 范围。
- **[推断] NO-GO（npm only）**：public/private、license/source、secret/privacy 或 tarball
  可复现性任一未闭合。

方向不应从“测试优先”转成“功能优先”，而应从“扩大真实模型场景数量”修正为
“先让已发布协议在确定性真实入口上可证伪，再用少量在线实验回答只有真实 provider
才能回答的问题”。
