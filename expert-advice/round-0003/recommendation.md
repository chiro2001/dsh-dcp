# Round 0003 recommendation — 先修“证据可信度”，v0.2 只承诺可见的持久统计

> 审阅基线：`context.md` 所列 commit
> `3989c8144d6440825b71f856b9315df4f5d0ead9`（`main`）。本轮未运行安装、
> 构建或测试；门禁、在线样本和发布状态采用仓库已落盘记录。除本文件外未修改
> 其他文件。

## 0. 结论

1. **[推断] round-0002 的四项顺序不应原样执行。** storage-domain 仍是风险最低、
   不改变模型可见协议的首个 v0.2 功能；但在它之前应插入一个很小的
   **M6.3“可信度与 Code Mode fail-closed 门”**。message-mode 不应排第二；完整
   Code Mode 支持若通过独立实验，应排在 message-mode 之前；child-session 深读取
   应移出 v0.2 的承诺范围。
2. **[事实] 当前三组在线探针不支持“自然调用 9/10、模型自行纠正 5/5、nested
   标准段 4/5”这样的强解释。** natural 用用户提示明确指定了 `compress` 与精确
   refs；correction 由下一条用户消息直接提供正确 refs；nested 的 `committed` 只检查
   “存在任意 active block”，而 `Included prior blocks` 是
   `prepareRange()` 的确定性附加行为。**[推断]** 先修 probe oracle，比继续调 prompt
   信息增益更高。
3. **[事实]** 静态 guidance 把“无效 range”和“净节省不足”合并成“retry with a
   smaller or safer range”；对净节省不足而言，`smaller` 通常方向相反。在线 natural
   唯一失败又恰是微小 range 的负节省。**[推断]** 应做一次定向措辞修复，但不应降低
   `minNetSavingsTokens` 或强迫模型把不经济的调用变成 commit。
4. **[事实]** PROTOCOL/PLAN/CHANGELOG 声明 Code Mode 子调用不执行 `compress`；当前
   `createCompressTool().execute()` 没有检查宿主已经公开的 `exec.parent`，仓库也没有
   Code Mode 拒绝测试。**[需实验]** 必须先用真实 `run_code` 子调度证伪；若确实可达
   mutation，则这是已发布行为的 conformance 缺陷，不是等到 v0.2 才做的新功能。
5. **[推断] storage-domain 只有被 `/dcp stats` 展示才值得交付。** 仅把记录写进
   dsh-storage-json 会增加 schema、生命周期、失败恢复和发布依赖，却不给用户任何
   可观察价值。应把“真实 DomainFacility 接线 + 多会话聚合 + stale/unavailable 口径
   - `/dcp stats` 输出 + restart/failure e2e”作为不可拆分的一个纵向切片。
6. **[推断] v0.2 的最小可发布范围应是：** M6.3 完成后，交付 storage-domain/
   `/dcp stats` 纵向切片；Code Mode 完整支持是通过实验才纳入的 stretch goal。
   message-mode、child deep-read、exact decompress 与增量 replay 均不应成为 v0.2
   发布阻塞项。
7. **[事实]** 当前 peer 精确锁定 dsh `0.1.0-rc.6`，npm 仍为 NO-GO。
   **[推断]** 不需要为了“看起来支持新版本”主动扩大范围；每个实际目标 RC 先跑相同
   contract/AgentLoop/storage/code-mode 矩阵，再逐版本扩 peer。npm 决策与 v0.2 技术
   范围继续解耦。

---

## 1. 对现有证据与原顺序的独立审阅

### 1.1 真实模型证据：先修测量，不先追求更漂亮的比例

#### 现有文件直接支持的事实

1. **[事实]** `probeNatural()` 的第二条用户消息明确要求：使用 `compress`、选择
   `m0001..m0002`、给短摘要。它只是不再给 XML 模板，不能证明模型会在真实长会话中
   自主判断“何时值得压缩、选择哪一段”。
2. **[事实]** 三组探针把生产默认 `minNetSavingsTokens=256` 改成 `1`，corpus 只有
   极短的一两个 turn。它们适合测 adapter/schema/工具入口，不代表默认配置下的经济性
   或自然调用率。
3. **[事实]** natural 的 1/10 未 commit 是工具正确拒绝了约 `-9` token 的 range。
   **[推断]** 在用户要求本身不经济时，“拒绝 commit”是正确性信号，不能直接算成模型
   可靠性失败。
4. **[事实]** `probeCorrection()` 在失败后新增用户消息，直接告诉模型改用
   `m0001..m0002`。`summarizeProbe()` 又只验证第一笔 call 的 schema，并以“最终存在任意
   active block”判断 committed。它不能证明模型只根据 tool error 就会自主修正。
5. **[事实]** `probeNested()` 的第一次成功会留下 active `b1`；随后即使第二次 nested
   调用没有发生，`reduceDcpState(events).activeBlockRefs.length > 0` 仍使
   `committed=true`。所以报告中的 nested 5/5 不是“第二层压缩 5/5”。
6. **[事实]** 当第二层 range 真正包含 active prior block 时，`prepareRange()` 总会把
   prior block 交给 `collectProtectedAppendix()`，现有确定性 integration test 要求最终
   文本包含 `Included prior blocks` 和旧摘要。**[推断]** 在线 4/5 更可能说明第二阶段
   未完成或 oracle 分类不够细，而不是模型漏写了一个本应由插件生成的标准段。
7. **[事实]** system guidance 当前写道：invalid 或 savings 不足时“retry with a
   smaller or safer range”。**[推断]** 应把错误建议拆开：stale/protected/pairing 错误
   选择当前、闭合、安全的 refs；净节省不足则选择更大、更旧、更有内容的区间，或写更
   短但仍高保真的摘要；不要原样重试微小 range。

#### 判断

- **[推断] 应先做“可靠性测量修复 + 一次定向 prompt 修复”，而不是开放式 prompt
  调优。** 现有 10/10 schema-valid 已说明 adapter/tool schema 基本可用；目前最大未知
  是 oracle 是否在测声称的东西。
- **[推断] 不以 10/10 commit 为目标。** 对不经济、安全性不足或无合适历史的请求，
  正确行为是“不调用”或接受 fail-closed 结果。质量指标应是“在有合格候选时成功；在
  没有合格候选时不产生 mutation”，而不是无条件提高 commit 率。
- **[推断] nested prompt 暂无证据需要加入 `Included prior blocks` 逐字要求。** 该段
  是插件的持久正确性责任；把它转嫁给模型既重复又会掩盖实现/oracle 缺陷。

### 1.2 storage-domain：方向仍成立，但现有 adapter 不是“差最后一根线”

#### 现有文件直接支持的事实

1. **[事实]** `src/stats/domain.ts` 使用自定义同步接口
   `read()/write(): void`；真实 `@deepseek-ai/dsh-storage-domain` 通过
   `DomainFacility.open(spec)` 异步打开，table 读取同步、`put/update/delete` 异步且先
   durable 后更新内存。当前 adapter 不能直接当真实 table 使用。
2. **[事实]** 真实 domain 需要 `defineDomain`、zod record schema、domain/table format
   version，并由 consumer 关闭 handle；当前仓库没有这些声明或生命周期接线。
3. **[事实]** `src/index.ts` 与 `cordis.patch.yml` 均未取得/注入
   `storageDomain`，也没有任何生产调用 `syncDomainStats()`。
4. **[事实]** `/dcp stats` 只调用 `computeSessionStats()`，输出 session 指标；不展示
   domain 总计、session 数、更新时间、stale、unavailable 或 write failure。
5. **[事实]** 当前 integration test 只用内存 Map 证明“同一 `events.length` 不重复同步”；
   没有 dsh-storage-json、进程重启、两 session、写失败或追平测试。源文件头注释所称
   “e2e-verified in M5”与当前 context/ROADMAP 记载不一致。
6. **[事实]** JSON backend 没有跨进程写锁；domain change 通知也仅进程内。
   **[推断]** v0.2 必须声明单 host process 口径，不能把它描述成多进程一致的全局
   计数器。
7. **[事实]** 当前 `netSavedTokens` 是
   `max(0, shadowedTokens - checkpointTokens)`；marker 单列，semantic expansion 的
   负增量被 clamp，blockCount 也没有在名称上区分历史/active。
   **[推断]** 在把数字持久化并称为 all-time 之前，需要先冻结统计语义，否则只是把
   会话级歧义永久放大。

#### 判断

- **[推断] 接受 storage-domain 为首个真正 v0.2 feature，但改成完整纵向切片。**
  真实价值来自用户能在 `/dcp stats` 看见“本会话”和“持久 domain”两个清晰口径，而
  不是后端文件存在。
- **[推断] domain record 应保存每 session 的可重算 snapshot，不做全局 `+=`。**
  `/dcp stats` 从 table entries 求和，先换取幂等、失败追平和易审计；只有 session 数量
  的实测使扫描成为瓶颈后，才增加可重建全局索引。
- **[推断] storage 必须是可选增强。** domain 服务缺失、open 失败、version mismatch
  或 write 失败时，核心压缩仍工作，session stats 仍可读，并明确显示 persistent stats
  unavailable/stale。

### 1.3 message-mode：协议里有枚举值，不等于已经有安全设计

1. **[事实]** metadata decoder 已接受 `mode: 'message'`；但 config 只接受 `range`，
   模型 tool schema 只有 `startRef/endRef/summary`，resolver 只有 marker/block cut，commit
   固定写 `mode: 'range'`。
2. **[事实]** 当前 marker 是 step-entry cut，不是任意 message id。现有文档没有冻结
   message-mode 的输入形状、目标 ref、单节点角色、mixed range/message batch、inline
   cleanup 映射、保护与收益口径。
3. **[事实]** 安全子集排除 tool-call 节点、当前/recent turn、instructions/snapshot、
   受保护内容；生产默认还要求至少 256 token 净节省。
   **[推断]** 对普通短消息，这个交集可能几乎没有经济价值；不能因为实现看似只是一笔
   单节点 replace 就假设产品价值。
4. **[推断] message-mode 会把一个已经较稳定的 range protocol 变成双分支矩阵：**
   schema/prompt、refs、prepare/commit、batch partial result、nested、recovery、stats、
   native absorption、Code Mode 与旧 decoder 都要重新覆盖。

**判断：继续延后。** 先收集 range 模式确实无法表达、且单节点净节省达到生产门槛的
真实 corpus；没有该证据时，不进入 v0.2 committed scope。若将来开启，先写协议决策
记录而不是直接扩 schema。

### 1.4 Code Mode：拒绝和支持必须拆成两个里程碑

1. **[事实]** dsh tool runtime 用 `exec.parent` 标识 `run_code` SDK 子调度，并提供
   `rootCallId`、`tool/code-dispatch-start`/`tool/code-dispatch` 的 parent/sub-call/args
   审计链；子调用仍经过完整 policy/guard/body/result 管线。
2. **[事实]** 当前 `compress` body 不检查 `exec.parent`，并用 sub-call id 去 surface
   查普通 assistant `tool-call`；Code Mode surface 只有外层 `run_code` call/result，
   因而 author 查找与 inline cleanup 均不成立。
3. **[推断]** 在 Code presentation 暴露 `compress` 时，当前实现可能进入实际 mutation
   后才给 cleanup warning。这与公开“Code Mode 子调用不执行”不一致，必须由
   deterministic real-code-runtime test 立即证伪或确认。
4. **[推断]** 明确拒绝很小且可靠：在任何 DCP mutation/prepare 前检查 parent
   provenance，返回说明应改用 native call 或 `/dcp compress`；同时断言无 bracket、
   replace、block 或 stats 变化。
5. **[推断]** 完整支持不是“删掉拒绝”即可。需要决定：
   - `authorMessageId` 是否映射到 `rootCallId` 对应的外层 assistant；
   - `compressCallId` 是否使用 subCallId，审计参数是否以 code-dispatch-start 为准；
   - arbitrary source code 中的内联 summary 不清理时，如何记录行为与 token 口径；
   - inner commit 后 outer program 又失败/abort 时，是允许已提交 side effect，还是延迟
     到 outer success；
   - 重试、approval、exclusive barrier 与当前 outer turn 排除如何保持确定性。

**判断：M6.3 先保证拒绝；完整支持在独立实验通过后可排在 message-mode 之前。**
若实验失败，v0.2 保持明确拒绝仍可发布。

### 1.5 child-session 深读取：从“最后做”调整为“移出 v0.2 承诺”

1. **[事实]** 当前保护逻辑以父 surface 实际可见的 tool result/report/settlement 为准，
   config 对 `readChildSession=true` fail closed。
2. **[事实]** dsh subagent contract 允许 remote one-shot provider 没有 local child
   session；session-backed child 也可能 running、inactive、需要 persistence 才可读取。
3. **[推断]** 深读取会把父模型从未见过的 child raw history带入父摘要，改变数据可见
   集合，并引入 authority、隐私、prompt injection、递归、fork 重复前缀、大小上限与
   活跃 child 一致性问题。仅写“opt-in”不能解决这些问题。
4. **[推断]** 只有出现具体失败 corpus——父 surface 的已结算结果被截断且不足以保留
   关键事实，而本地 child history 可授权、稳定地补足——才值得开启设计。否则继续
   保护父 surface，深读取放 v0.3+ 或上游 producer-side enrichment 讨论。

### 1.6 版本与发布面

1. **[事实]** package/peer 当前精确为 dsh rc.6；未实测版本不在支持范围，这一点是
   正确的，不需要主动放宽。
2. **[事实]** storage-domain 会依赖 DomainFacility/schema/lifecycle，Code Mode 会依赖
   parent/rootCallId/code-dispatch 事件；二者都比纯逻辑更容易随新 RC 漂移。
3. **[事实]** README 仍把状态/安装示例写为 rc.1，并同时存在 public repo 与“GitHub
   私有仓库”表述；AGENTS 的安装段也仍举 rc.1 并写“私有仓库”。RELEASE/CHANGELOG/
   context 则记录 public + rc.2。
4. **[推断]** M6.3 应顺手统一当前 tag、可见性、支持矩阵与 npm NO-GO；这是发布面
   正确性，不是无关文档整理。
5. **[推断]** storage schema version 一旦随 v0.2 发布，就需要把 version mismatch
   当显式兼容事件；不要静默清空 JSON，也不要把不可读 domain 变成插件整体不激活。

---

## 2. 修订后的范围与实施顺序

| 顺序 | 交付/实验                                                        | 判断                                              | 是否阻塞 v0.2           |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------- | ----------------------- |
| 0    | **M6.3：Code fail-closed + probe oracle + 定向 prompt/发布修正** | **[推断] 必做；建议形成 v0.1.0-rc.3**             | 是                      |
| 1    | **E7-CODE：完整 Code Mode 支持可行性实验**                       | **[推断] 先取证，不预先承诺支持**                 | 否；失败则维持拒绝      |
| 2    | **M7.0：storage-domain + `/dcp stats` 纵向切片**                 | **[推断] v0.2 最小核心功能**                      | 是                      |
| 3    | **M7.1：完整 Code Mode 支持**                                    | **[推断] 仅 E7-CODE 通过后；优先于 message-mode** | 否，可作为 v0.2 stretch |
| 延后 | message-mode 安全子集                                            | **[推断] 缺少价值 corpus 与协议决策**             | 否                      |
| 移出 | child-session 深读取                                             | **[推断] 风险/价值比不支持纳入 v0.2**             | 否                      |

这里把 E7-CODE 提前，是为了尽早决定 v0.2 是否包含该功能；实际 feature 实现仍排在
storage-domain 之后。若团队只希望最短交付路径，也可以在 M6.3 后直接做 M7.0，并让
E7-CODE 完全不阻塞 v0.2。

---

## 3. 按信息增益排序的三个下一个里程碑/实验

### 3.1 优先级 1 — M6.3：可信度与已发布边界闭合

#### 目标

- **[推断]** 在扩大功能前，证明探针在测其声称的行为，并使 Code Mode 实际行为与
  v0.1 公开限制一致；只做最小、可解释的 prompt 修复。

#### 输入

- **[事实]** `scripts/real-model-probes.ts`、三份 probe 报告、
  `src/prompts/system.ts`、`src/compress/tool.ts`、`src/compress/prepare.ts`、
  dsh rc.6 的 `ToolRunContext.parent/rootCallId` 与 code-dispatch 事件、现有
  deterministic AgentLoop/invariant fixture。

#### 动作

1. **[需实验] Code fail-closed 测试先行：** 通过真实 `run_code` SDK 子调度调用
   `compress`，先锁定当前是否可达 body/mutation；随后要求 `exec.parent !== undefined`
   在 prepare/commit 前得到明确错误。保留 native direct call 的成功对照。
2. **[需实验] 重写 probe oracle，而不是先改阈值：**
   - 每个 call/attempt 分别记录 schema、refs、tool result、blockRef、membership、
     `consumedBlockRefs` 与净 token delta；
   - nested 成功必须是新 active `b2`（或本次分配 ref）消费旧 `b1`，不能用“任意
     active block”；标准 appendix 作为 deterministic implementation assertion；
   - correction 在第一次 tool error 后不给正确答案，让同一 agent 只根据错误自行重试；
   - 将现有 natural 重命名为 forced/schema probe，另建不指定 tool/refs 的 autonomous
     corpus。
3. **[需实验] 建立成对经济性 corpus：**
   - 可压缩组：足够长、已闭合、无保护冲突，使用生产默认
     `minNetSavingsTokens=256`，由压力/nudge 或一般性继续任务触发；
   - 不可压缩组：只有微小/recent/protected range；“不调用”或 fail-closed 且无 mutation
     都算正确，不能要求 commit。
4. **[推断] 定向修 prompt/tool feedback：** 把 invalid/stale/protected 与 insufficient
   savings 的恢复建议拆开；明确不要压缩微小 range，净节省不足时选择更大的旧闭合
   区间或更紧凑的高保真摘要。不得通过降低收益门槛美化通过率。
5. **[推断] 同步发布表面：** README/AGENTS/CHANGELOG/RELEASE/package/tag 示例统一
   到实际 public、rc.2/后续 rc.3、精确 rc.6 支持与 npm NO-GO；更新 prompt/帮助快照并
   说明语义理由。

#### 可证伪断言与验收标准

- **[需实验]** Code 子调用返回确定性拒绝；从 call 开始到 settle，DCP
  `compaction/start|summary|end`、surface replacement、block 数与 session stats 均无
  变化。native direct call 仍提交成功，deny/abort 与
  `messages === deriveMessages()` 回归继续全绿。
- **[需实验]** forced/schema probe 保持 schema-valid 10/10；这只证明 transport，不再
  命名为 natural reliability。
- **[需实验]** 在至少 10 个可压缩独立样本中，autonomous 场景至少 8/10 选择合法候选
  并提交；低于门槛即证伪“当前 prompt 足以自然工作”，v0.2 不增加新的模型驱动模式。
- **[需实验]** 在至少 10 个不可压缩样本中，10/10 无 DCP mutation；模型选择不调用
  与工具正确拒绝均可，但不得循环重试同一微小 range 直至碰巧通过。
- **[需实验]** correction 在不给正确 refs 的情况下至少 8/10 能依据结构化错误选择
  当前合法/更经济候选；把“未重试但安全停止”与“错误重复”分开报告。
- **[需实验]** nested 每次报告本轮新 block；若本轮已提交，则
  `consumedBlockRefs` 与 `Included prior blocks` 5/5 一致。这里任何缺失先按实现/harness
  缺陷处理，不能先归因于 prompt。
- **[推断]** 在线比例只阻塞新增模型驱动功能，不阻塞完全确定性的 storage stats；
  provider 不稳定时允许记为 inconclusive，但不得继续沿用误命名指标。

#### 停止条件

- **[需实验]** Code 子调用已经产生无法在 mutation 前拒绝的副作用、任何 request/
  derive desync、未配对工具或 partial bracket 时，立即停止 v0.2 功能工作，先修协议。
- **[推断]** 若修正 oracle 后 4/5 nested 消失，不继续为该假问题堆 prompt；若仍存在，
  先以逐 attempt 日志定位“未调用/拒绝/commit/appendix”阶段。
- **[推断]** 不进行无上限 prompt 搜索。一次语义修复后仍低于自然调用门槛，则保持
  range 工具可手动/明确触发，并把模型/route 适配列为已知限制。

### 3.2 优先级 2 — E7-CODE：完整支持的最小可行性证伪

#### 目标

- **[推断]** 用一个不进入发布的最小 spike 回答：Code Mode 能否在不重写任意源代码、
  不破坏事务/审计/outer failure 语义的前提下安全提交 DCP block。

#### 输入

- **[事实]** rc.6 的 `exec.parent`、`rootCallId`、subCallId、
  `tool/code-dispatch-start|tool/code-dispatch`；当前 metadata 的
  `authorMessageId/compressCallId`；native inline cleanup 和 recovery/restart 矩阵。

#### 动作

1. **[需实验]** 写出并测试 provenance 映射：outer `run_code` assistant message id →
   `authorMessageId`；code-dispatch subCallId → `compressCallId`；normalized arguments →
   审计来源。任何字段不能从持久日志重建即失败。
2. **[需实验]** 明确选择“不清理 arbitrary code 中 summary”，并对比调用前后下一次
   `deriveMessages()` 的真实 token delta；tool output/metadata 必须清楚说明该分支，而
   不是复用 native cleanup warning 当成功语义。
3. **[需实验]** fault matrix：inner allow/deny、outer 正常完成、inner commit 后 outer
   抛错、outer abort、重复执行、restart、native compaction coexist。特别记录模型是否
   能从 outer result 得知已经 commit，避免无意识重试。
4. **[需实验]** 证明 range 永不包含 outer current assistant/call，approval 与 exclusive
   barrier 没被 parent path 绕过，且所有 mutation 前检查 signal/lock/current surface。

#### 可证伪断言与验收标准

- **[需实验]** 每个 committed Code block 都能仅从日志关联到 outer author、subCall、
  exact args 与最终 outer outcome；restart 后关系相同。
- **[需实验]** outer success 下 request invariant、shadow price、pairing、收益门均与
  native path 相同；未清理 source code 后仍达到生产 `minNetSavingsTokens`。
- **[需实验]** outer failure/abort 后要么没有 DCP mutation，要么协议明确、模型可观察
  地保留一次已提交 side effect，并且重试 fail closed；不能出现“block 已提交但模型与
  用户都只看到普通失败、审计无法关联”的状态。
- **[需实验]** Code-only、both、native 三种 presentation 的 deterministic matrix 全绿，
  未选择 Code 支持时仍维持 M6.3 的明确拒绝。

#### 停止条件

- **[推断]** provenance 依赖进程内 token、outer failure 无法可靠分类、或必须解析/
  重写任意模型代码才能满足净收益/审计时，停止完整支持，保持 fail-closed；不得为此
  修改 dsh 核心。
- **[推断]** 实验通过只表示可以排入 M7.1，不自动使其成为 v0.2 release blocker。

### 3.3 优先级 3 — M7.0：storage-domain 与 `/dcp stats` 完整纵向切片

#### 目标

- **[推断]** 提供不会影响模型上下文与压缩成败、可跨重启追平、用户可从命令验证的
  多会话持久统计；这是 v0.2 的最小核心交付。

#### 输入

- **[事实]** `computeSessionStats()`、现有 adapter 与 memory test、rc.6
  DomainFacility/KvTable contract、dsh-storage-json、`/dcp stats` 快照、两 session 的
  deterministic fixture。

#### 动作

1. **[推断] 先冻结口径：** 区分 historical transactions、active blocks、gross
   shadowed、checkpoint cost、marker/artifact cost、prune、semantic expansion 的负
   delta 与 estimated net；不把 clamp 后的值称为精确 all-time saving。token 一律标
   heuristic estimate。
2. **[需实验]** 用 `defineDomain` + versioned zod schema 定义 per-session record；字段
   使用明确的 `eventCount/lastEventSeq`，保存完整可重算 snapshot 与 `updatedAt`。domain
   总计从 table entries 求和，不维护不可幂等 `+=`。
3. **[需实验]** 通过真实 async `KvTable.put` 接线，handle 由插件 lifecycle 关闭；服务
   缺失/open/read/write/version 错误均转成有界状态与 warning，不阻止 DCP 注册或已完成
   mutation。
4. **[需实验]** 在每次成功 DCP mutation 的完整 bracket/replace 之后调度 per-session
   重算，并在 `/dcp stats` 时追平当前 session；同 session 写入串行/合并，旧 snapshot
   不得覆盖新 snapshot。禁止在 summary 与 replace 相邻区间插入 await。
5. **[推断]** `/dcp stats` 同时展示：session snapshot；persistent domain 总计、记录
   session 数与 as-of；以及 `current/stale/unavailable`。若 domain 不可用，session 部分
   仍成功，不返回整个命令 error。
6. **[需实验]** 用真实 dsh-storage-json 做 clean profile、多 session、进程 dispose/
   restart、写失败、损坏/version mismatch、失败后追平 e2e；测试介质使用隔离临时目录。

#### 可证伪断言与验收标准

- **[需实验]** session A/B 各产生嵌套 compress、prune、expansion/recompress 后，domain
  每条 record 等于从对应 raw log 冷重算；聚合等于 records 逐字段求和，重复 sync 不
  double count。
- **[需实验]** dispose/restart 后 JSON 重新打开得到字节语义相同的 records 与 stats
  输出；给其中一 session 追加事件后，只更新该 record，聚合精确追平。
- **[需实验]** backend write 失败不改变 compress/control 的成功事实，不产生未处理
  rejection；命令显示 stale。恢复 backend 后下一次 sync 用全日志覆盖并清除 stale。
- **[需实验]** storageDomain 缺失、open 失败或 version mismatch 时，compress、marker、
  commands 与 `messages === deriveMessages()` 矩阵保持通过；只降级 persistent stats。
- **[需实验]** domain 接线不追加 session 消息、不改变 request header、system/tools 或
  provider KV prefix。
- **[需实验]** `/dcp stats` 快照明确区分 session/domain/estimated/status；如果输出不
  展示 domain 状态，本里程碑不算完成。

#### 停止条件

- **[推断]** 若 Cordis 生命周期无法把 storageDomain 做成“不在场可降级”的依赖，先
  保留 session stats 并记录宿主能力缺口，不得让统计后端决定核心插件是否激活。
- **[推断]** 若真实 backend 错误会反向使已提交 compress 报失败，立即停止接线并把
  sync 移出 correctness transaction。
- **[推断]** 若无法给 expansion/marker/active-vs-historical 建立不误导的口径，先缩减
  `/dcp stats` 字段并诚实命名，不发布含糊的“all-time net saved”。

---

## 4. 最可能遗漏的风险登记

| 优先级 | 风险与标注                                               | 影响                                                         | 缓解/停止条件                                                                     |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| P0     | **[事实/需实验] Code 子调用未 fail closed**              | 已发布限制可能与实际 mutation 相反                           | M6.3 real-code-runtime test；任何 mutation 前拒绝；失败阻塞功能扩张               |
| P0     | **[事实] probe oracle 把不同阶段合成一个 bool**          | 用错误证据调 prompt、误报 nested/correction 质量             | 按 attempt/blockRef/membership/error 分类；旧比例不作 v0.2 决策依据               |
| P0     | **[事实] storage adapter 同步接口与真实 async API 不同** | write rejection、生命周期、durability 语义可能接错           | 真实 DomainFacility/KvTable contract + failure/restart e2e                        |
| P0     | **[推断] stats 口径在持久化后固化误导**                  | expansion 成本被 clamp、active/history 混淆、all-time 被高估 | M7.0 先冻结字段与快照；不确定字段删掉或改名                                       |
| P1     | **[推断] optional storage 变成 required injection**      | 后端未配置的 profile 中整个 DCP 不激活                       | 缺服务/open 失败降级测试；做不到则停止接线                                        |
| P1     | **[推断] async catch-up 乱序覆盖**                       | 老 events snapshot 晚到，覆盖新 record                       | per-session coalescing/serialization；record 带 eventCount/lastEventSeq，拒绝倒退 |
| P1     | **[事实] JSON/domain 仅单进程一致**                      | 多 dsh 进程同 root 时 last-writer-wins                       | v0.2 明确单进程；不把它宣传成跨进程统计；不同 profile/root 隔离                   |
| P1     | **[推断] domain schema 无迁移**                          | v0.2 后改字段造成 version mismatch                           | 初版最小稳定 schema；显式版本错误/迁移决策，绝不静默清空                          |
| P1     | **[推断] Code outer failure 晚于 inner commit**          | 模型认为失败并重试，日志已有 side effect                     | E7-CODE fault matrix；无法可观察分类则保持拒绝                                    |
| P1     | **[事实/推断] Code provenance 与 native tool/call 不同** | author/call audit、cleanup、current-turn 排除错误            | root/sub-call 持久映射；任何字段只能靠进程内 token则停止支持                      |
| P1     | **[推断] message-mode 安全集合价值接近零**               | 扩大协议/测试矩阵但默认阈值下很少可提交                      | 先收集 profitable corpus；没有至少一类 range 无法表达的重复需求则延后             |
| P1     | **[推断] message/range mixed batch 产生新 partial 语义** | block ref、cleanup index、失败映射再次错位                   | 首版若做只允许单 mode/单 entry；先有协议与 property tests                         |
| P1     | **[事实/推断] child remote/local 不对称**                | remote 无 session，本地 session 可能 inactive/partial        | 父 surface 永远为基线；失败保留父结果；无 provider/authority contract 不实现      |
| P1     | **[推断] child deep-read 扩大可见数据集合**              | 隐私、秘密、prompt injection、递归与巨大 appendix            | 具体 corpus + 显式 authority/budget/redaction；否则移出 v0.2                      |
| P1     | **[事实] dsh 支持只证明 rc.6**                           | 新 RC 上 domain/code event/API 漂移                          | 每个版本逐个跑 M0 + AgentLoop + storage restart + Code matrix；失败不扩 peer      |
| P1     | **[事实] README/AGENTS 发布信息滞后且矛盾**              | 用户装旧 tag、误解仓库/npm 可见性                            | M6.3 统一 public、当前 tag、GitHub 正式源、npm NO-GO                              |
| P1     | **[推断] git 源发布的 source/lib 不一致**                | tag 安装与当前源码行为不同                                   | release gate 校验 clean install、构建产物、声明、tag 与 CHANGELOG 一致            |
| P2     | **[事实] KV A/B inconclusive**                           | 误称 marker cache-safe                                       | 保持 inconclusive；除非稳定 provider 指标与大样本，不阻塞本轮三项                 |
| P2     | **[推断] 在线探针 route 特化**                           | deepseek-v4-flash 结果外推到其他模型                         | 报告 route/model/date；支持新 route 时重新跑，不写全模型保证                      |

---

## 5. 延后功能的重新进入条件

### 5.1 message-mode

以下条件全部满足前继续延后：

1. **[需实验]** 至少一组可复现 corpus 表明 range 模式无法在不吞并无关内容的情况下
   压缩某个无 tool-call 单节点，而该节点在默认 256-token 门槛下有正收益；
2. **[推断]** 先形成 decision record，冻结 target ref/input schema、角色限制、单节点
   `sourceEventSeqs`、保护、收益、nested、stats、recovery 和旧 v1 decoder 行为；
3. **[需实验]** 首版只允许单 entry、无 tool-call、非 user instruction、非 current/
   recent turn；不与 range 混批。该最小子集仍无足够价值时直接取消，而不是继续放宽。

### 5.2 Code Mode 完整支持

- **[推断]** 只有 E7-CODE 全部断言通过才进入 M7.1；实现时继续先写失败测试。
- **[推断]** 即使通过，也不把 Code 支持与 storage-domain 绑成一个不可拆 release。
- **[推断]** 未通过时公开能力就是“native direct call 支持；Code sub-dispatch 在 mutation
  前明确拒绝”，这是一项完整、可测试的产品边界。

### 5.3 child-session 深读取

- **[推断]** 需要真实的父结果信息丢失案例、明确的 local/persisted provider 范围、父
  对 child 的读取 authority、最大 child/depth/bytes、running snapshot 语义与敏感内容
  处理策略。
- **[推断]** 任何读取失败都必须保留父 surface 内容；deep read 只能 enrichment，不能
  替代父结果。没有这些前提则留在 v0.3+ research。

---

## 6. 发布与版本门

### v0.1.0-rc.3（建议的小修复门）

**[推断] GO：**

- Code Mode sub-dispatch 在 mutation 前确定性拒绝，native path 不退化；
- probe oracle 与命名修正，旧在线比例不再被过度解释；
- 微小 range/净节省提示方向修正并更新快照；
- README/AGENTS/RELEASE/CHANGELOG/package 的 public/tag/rc.6/npm 状态一致；
- 全部既有门禁与 request invariant 全绿。

**[推断] NO-GO：** Code 子调用仍可能写 DCP bracket、任何 request desync、工具配对
破坏、或文档继续承诺无法证明的自然/纠正/nested 比例。

### v0.2.0 最小 GO

**[推断] 必需：**

- M6.3 已完成；
- M7.0 真实 dsh-storage-json 多 session/restart/failure/catch-up e2e 全绿；
- `/dcp stats` 明确展示 session + persistent domain + estimated/status；
- storage 缺失/失败不影响压缩与模型可见日志；
- rc.6 全套 gate 通过，peer 仍只覆盖实测版本；
- GitHub tag/source/lib/package 安装一致，npm 仍 NO-GO（除非 owner 另行完成现有决策门）。

**[推断] 可选：** E7-CODE 通过后的 M7.1。其失败或延期不阻塞 v0.2；message-mode、
child deep-read、KV 定论、exact decompress、增量 replay 均不阻塞。

### dsh 新 RC 扩围门

**[需实验]** 对每个实际候选版本逐个运行：M0 contract、deterministic AgentLoop、
request invariant、native coexist/restart、storage-domain JSON restart/failure、Code Mode
拒绝/支持矩阵、clean GitHub install。全部通过才把该精确版本加入 peer；不能用编译通过
或 semver `>=` 替代运行证据。

---

## 7. 对五个方向性问题的直接回答

1. **是否先做提示词与真实模型可靠性？**
   **是，但先修 oracle，再做一次窄而有因果方向的提示修复。** 不应根据现有 9/10、
   5/5、4/5 直接堆 prompt；这些比例分别混入强制工具选择、用户提供答案和错误的阶段
   判定。
2. **message-mode 是否继续延后？**
   **是。** metadata 的枚举占位不是已完成协议；当前没有证明安全单节点在生产收益门
   下有足够价值。完整 Code Mode 若通过实验，优先级更高。
3. **storage-domain 是否必须由 `/dcp stats` 展示才值得做？**
   **是。** 不展示就只有成本与风险，没有用户闭环；真实接线、持久聚合、状态口径和
   命令输出必须同一里程碑验收。
4. **Code Mode 应拒绝还是支持？**
   **立即明确拒绝，随后独立实验支持。** 拒绝是 v0.1 conformance；支持是条件式 v0.2
   功能，不能混在一个开关里边做边定义。
5. **child 深读取是否属于 v0.2？**
   **不属于 committed scope。** 保持父 surface 保护；只有具体信息丢失案例和完整
   authority/privacy/budget 契约出现后再进入。

最终方向不是“停止功能开发”，而是把 v0.2 从四个松散功能的打包，收缩为一个可验证
的产品闭环：**可信的模型行为证据 + 已发布边界的 fail-closed + 用户能实际看见的持久
统计**。这条线完成后，Code Mode 支持可以按实验结果追加；message-mode 与 child
deep-read 不再凭参考实现的功能列表自动获得优先级。
