# Round 0004 recommendation — 先冻结可审计的 signed ledger，再接真实 storage-domain

> 审阅基线：`context.md` 所列 `d39d757...`（`main`，`v0.1.0-rc.3`）。本轮只读取
> context 所列仓库输入、锁定版本的 storage 包接口/实现、相关 dsh 生命周期文档与
> 现有测试夹具；未执行安装、构建、测试或 git 写操作。除本文件外不修改其他文件。

## 0. 结论

1. **[推断] M7.0 有条件 GO，但不能把现有 `domain.ts` 直接换成 `KvTable` 后就发布。**
   先冻结统计语义及输出快照，再实现真实 domain 接线。当前最危险的不是 API 调用量，
   而是把含糊且不可审计的数字永久化。
2. **[事实]** 当前 `lastProcessedSeq` 写入的是 `events.length`，不是最后一条 event 的
   `seq`；空日志和非空日志都会产生典型 off-by-one 歧义。**[推断]** v1 record 只持久化
   `eventCount`，不同时保存可由它推导的 `lastEventSeq`。若实现坚持两者并存，schema
   必须强制 `lastEventSeq === (eventCount === 0 ? null : eventCount - 1)`。
3. **[事实]** 当前 `netSavedTokens = max(0, shadowed - checkpoint)`：marker 没有扣除，
   prune 的 token delta 没有计入，semantic expansion 的负成本被 clamp；checkpoint 又用
   `text.length / 4`，与宿主 `tokenMeter.estimateMessage()` 的结构开销不一致。
   **[推断]** 不应持久化 clamp 后的 “saved”。应保存可求和的基础 ledger，显示有符号的
   `estimated history reduction`；负值渲染为 `estimated history overhead`。
4. **[推断]** record 是“在 `eventCount` 边界从完整日志冷重算出的 session snapshot”，
   其中 historical counter 与 active gauge 必须分开。domain 是“每个 session 最新持久
   snapshot 的求和”，不是唯一操作计数、provider 账单或跨 session 原子快照。
5. **[事实]** `storageDomain` 是拓扑敏感服务；`DomainFacility.open()` 异步，读同步，
   `put/update/delete` 异步且先 durable 后更新内存；每个 domain 只有一条写链；consumer
   负责 `Domain.close()`。**[推断]** 顶层插件和 `cordis.patch.yml` 都不得把
   `storageDomain` 设为 required inject。用一个动态依赖子 fiber 打开/关闭 domain，核心
   tool、marker、策略、命令和 session stats 始终留在主 fiber。
6. **[推断]** storage 缺失、opening/open 失败、version mismatch、invalid record、同步
   read 异常或 write 失败，只能降级 persistent 部分。任何 stats Promise rejection 都
   不得改变已经提交的 DCP mutation、工具结果或 request reconstruction。
7. **[推断]** `/dcp stats` 必须始终先成功展示当前 session；persistent 部分显示
   `current / stale / unavailable`、记录数、record-sum、当前 session cursor 与最后一次
   durable update。`current` 仅表示本进程已知 live sessions，不得外推为多进程全局新鲜。
8. **[推断] E7-CODE 不应与 M7.0 在同一实现分支并行。** 它可由独立分支做不阻塞的
   spike，但不得同时改共享的 `index.ts`、AgentLoop fixture 或发布门。M6.3 的拒绝已经是
   完整边界；M7.0 只需锁定“被拒绝的 Code 子调用不产生 compression ledger 变化”。

---

## 1. 对候选方案的反驳与证据

### 1.1 现有统计不能原样持久化

- **[事实]** `computeSessionStats()` 的 `blockCount` 对所有带 DCP metadata 的
  `user/message` 加一，因此 summary、semantic expansion 和 recompression 都混在一个
  historical 数字里；它不表示当前 active block 数。
- **[事实]** replay 已能区分 block 的 `active / consumed / absorbed-native / expanded`。
  **[推断]** 不使用这一权威 membership，而持久化单一 `blockCount`，会使嵌套、expand
  和 native absorption 后的 `/dcp stats` 具有误导性。
- **[事实]** expansion 与 recompression 也使用 `compaction/summary` + DCP checkpoint；
  expansion 通常用较小摘要替换成较大 quoted transcript。当前 clamp 把该负 delta
  显示为 0。
- **[事实]** boundary message、alias 与 nudge 都进入模型 surface。当前 marker 只单列，
  不进入 net；静态 guidance 与 tool schema 的请求开销也没有计入。
- **[推断]** 因而本里程碑只能声称“session-history 的 heuristic delta”，不能声称总
  token 账单、provider 精确节省或包含 system/tool schema 的全请求节省。
- **[事实]** `compaction/summary.shadowedTokenCount` 和 DCP producer 的 prune shadow price
  来自宿主 token meter；当前 checkpoint/marker 却用另一个简化公式。
  **[推断]** ledger 的 added side 必须统一调用同一个固定
  `ctx.tokenMeter.estimateMessage()`，否则减法没有一致单位。

### 1.2 “snapshot”与“all-time”必须拆开

- **[推断]** 一个 record 的 `eventCount` 是观测边界；record 内可以同时包含：
  1. 截至该边界的 historical counters/ledger；2) 在该边界的 active gauges。字段名必须
     自己说明是哪一类，不能用裸 `blocks`。
- **[事实]** domain aggregate 来自独立 session records；不同 record 的 `updatedAt` 和
  event cursor 不同。**[推断]** `max(updatedAt)` 只能叫 `latest durable update`，不能叫
  “domain as-of”；不存在所有 session 同一时刻的原子快照。
- **[事实]** fork 会把父日志前缀复制进新 session。**[推断]** record-sum 会按每个
  session 的上下文效果重复计入共享前缀。这在“per-session snapshot sum”口径下合法，
  但绝不能描述为“去重后的唯一压缩次数”或 billing all-time total。
- **[事实]** native compaction 可吸收 DCP block。**[推断]** native delta 不进入 DCP
  ledger，但会改变 active gauges；historical DCP delta 保留为当时 DCP mutation 的归因。

### 1.3 真实 storage API 带来的约束

- **[事实]** `KvTable.get/entries/keys/size` 从权威内存同步读取；`entries()` 返回稳定
  snapshot iterator。`put()` 是 full overwrite，不做 partial merge。
- **[事实]** domain 的单条 write chain 覆盖该 domain 的所有表和 key，而不只是一个
  session。backend rejection 时 domain 内存不变；成功后才更新内存并发事件。
- **[事实]** `put()` 不在写边界重新跑 zod；返回的 record 也不 defensive-copy，并明确
  禁止原地修改。**[推断]** consumer 必须在 `put` 前显式 `schema.parse()`，每次构造全新
  immutable record，绝不能修改 `table.get()` 返回对象。
- **[事实]** JSON backend 每次写都原子重写整个 unit 文件，且无跨进程锁。
  **[推断]** session 数增长会同时放大 domain scan 和每次持久写；M7.0 可先接受 O(N)，
  但必须有规模 smoke，且公开单 host process 口径。
- **[事实]** 一个 invalid record 会使 `DomainFacility.open()` 整体失败，而不是只隔离一
  个 key；domain format version mismatch 也在读取 records 前失败。
  **[推断]** M7.0 不得静默清空、删除或跳过坏文件；降级为 unavailable，保留介质供
  明确迁移/修复。

### 1.4 顶层 required injection 会破坏降级目标

- **[事实]** Cordis required inject 在服务不存在时使整个 plugin fiber 保持 pending，
  服务替换时会卸载/重跑。`ctx.inject([...], callback)` 可把依赖限制在子 fiber。
- **[事实]** web composition 提供 JSON/domain storage，但其他 composition 可以没有该
  服务。当前 DCP 顶层只需要 sessions/tokenMeter/systemPrompt/tools/commands。
- **[推断]** 若把 `storageDomain` 加到 `src/index.ts` 的 exported `inject` 或 patch row，
  “persistent stats unavailable”会退化成“整个 DCP 不注册”，与目标直接冲突。

---

## 2. 应先冻结的统计语义

### 2.1 计数口径

**[推断]** v1 session snapshot 使用以下两组计数：

- `historical.summaryBlocks`：所有已提交/可恢复的 DCP `kind=summary` checkpoints；
  recompression 属于 summary。
- `historical.expansionBlocks`：所有已提交/可恢复的 `kind=expansion` checkpoints。
- `historical.pruneReplacements`：由冻结 classifier 识别的 DCP-owned prune replacements
  （dedup、purge-error、inline-summary cleanup）。
- `active.summaryBlocks`：当前 surface membership 为 active 的 summary checkpoints。
- `active.expansionBlocks`：当前 surface membership 为 active 的 expansion checkpoints。

**[推断]** `historical.blockCount` 与 `active.blockCount` 只作为以上字段的派生和，不在
record 中重复保存。`consumed/absorbed-native/expanded` 可从 historical-active 与 replay
诊断查看，M7.0 不必再持久化一套 membership 分类计数。

### 2.2 token ledger 与 net

**[推断]** 保存五个非负基础量；全部使用宿主固定 heuristic estimator：

```text
estimated.compactionShadowed
  = 与 DCP checkpoint 相邻配对的 compaction/summary.shadowedTokenCount 之和

estimated.checkpointAdded
  = 所有 DCP summary/expansion checkpoint replacement message 的 estimateMessage 之和

estimated.pruneShadowed
  = 所有冻结 classifier 认定为 DCP-owned prune 的 shadowedTokenCount 之和

estimated.pruneAdded
  = 上述 prune replacement message 的 estimateMessage 之和

estimated.markerAdded
  = 所有 DCP boundary/alias/nudge surface messages 的 estimateMessage 之和
```

**[推断]** 唯一派生 net 为：

```text
estimatedHistoryReduction =
  compactionShadowed + pruneShadowed
  - checkpointAdded - pruneAdded - markerAdded
```

- 正数表示 DCP-owned 历史 mutation 累计减少了 session-history heuristic tokens。
- 负数不 clamp；renderer 写 `estimated history overhead: ~N`，而不是
  `net saved: ~-N`。
- expansion 自动表现为较大的 `checkpointAdded`，recompression 随后可抵消该临时成本；
  不再需要特殊修正或隐藏负值。
- marker 若后来被 DCP range 遮蔽，其 token 同时进入 `compactionShadowed`，因此 ledger
  会自然抵消；若由 native compaction 遮蔽，removal 不归因给 DCP。
- **[推断]** derived net 不持久化，避免基础分量和派生值漂移。

**[推断] 明确排除：** provider 精确 usage、每请求重复成本、静态 system guidance、
`compress` tool schema、native compaction delta、未能可靠归属的 foreign prune。输出总标题
必须写 `Token counts are heuristic estimates`；不能只在部分数字前放 `~` 后又把 domain
total 写成精确值。

### 2.3 DCP-owned prune classifier 是发布前置条件

- **[事实]** `compaction/prune` 本身没有 owner 字段；只能与下一条相邻 replacement 的
  source、类型、placeholder 和 DCP call/block 关系一起分类。
- **[推断]** 在 PROTOCOL §8 冻结三种已知形状：dedup tool-result placeholder、
  purge-error plugin user message、仅改写 compress summary 为 `[stored in bN]` 的 assistant
  replacement。classifier 必须 fail closed；foreign/含糊 replacement 不纳入 DCP ledger。
- **[推断]** 若 inline cleanup 无法仅从日志确定性归属，就先从 v1 prune ledger 中排除并
  在输出写 `recognized prunes`，不能用启发式猜测后称为总 net。

---

## 3. Domain schema 决策

### 3.1 推荐 schema

**[推断]** domain 名使用满足宿主 `^[a-z][a-z0-9_]*$` 的 `dsh_dcp_stats`，table 名
`sessions`。domain physical format version 为 `1`；record 另有逻辑 discriminant `v: 1`。

```ts
interface DcpSessionStatsRecordV1 {
  v: 1
  sessionId: string
  sessionCreatedAt: number
  eventCount: number
  updatedAt: string
  historical: {
    summaryBlocks: number
    expansionBlocks: number
    pruneReplacements: number
  }
  active: {
    summaryBlocks: number
    expansionBlocks: number
  }
  estimated: {
    compactionShadowed: number
    checkpointAdded: number
    pruneShadowed: number
    pruneAdded: number
    markerAdded: number
  }
}
```

- **[推断]** table key 仍是 `SessionId`；value 内重复 `sessionId` 是可校验 identity，弥补
  DomainTable 的 key 只有 phantom TypeScript 类型、open 时不运行 key schema 的事实。
  每次 scan 要求 `key === record.sessionId`，否则整个 persistent view 标为 corrupt/
  unavailable，不默默求和。
- **[推断]** `sessionCreatedAt` 用于区分同 id 的新 lifecycle 与同 lifecycle 的日志倒退。
  resume 保留 header；同一 identity 出现 `stored.eventCount > observed.eventCount` 时不得当作
  普通 catch-up，应报 `session-log-regressed`。不同 `sessionCreatedAt` 才允许全量覆盖旧 key。
- **[推断]** 所有 count/token 字段使用 finite、non-negative、safe integer；`updatedAt`
  是严格 RFC 3339/ISO timestamp。schema 使用 strict object，写前 parse。
- **[推断]** `updatedAt` 只在成功准备一个新 cursor snapshot 时生成；失败 attempt 的时间
  保存在运行态，不冒充 durable update。相同 session identity + 相同 `eventCount` 的 sync
  必须 no-op，不刷新时间。
- **[推断]** aggregate 不落盘，不设 global `+=` record；每次用 `table.entries()` 的稳定
  snapshot 逐项求和，`sessionCount = table.size`，`latestUpdatedAt = max(record.updatedAt)`。

### 3.2 `eventCount` 与 `lastEventSeq` 的明确取舍

- **[事实]** dsh 保证 event `seq = log index`，`session.events.length` 是下一条 seq；所以
  `lastEventSeq` 对非空日志恒等于 `eventCount - 1`。
- **[推断]** 推荐只存 `eventCount`。它自然表达空日志 0，也与捕获的 immutable events
  snapshot 长度一致；现有 `lastProcessedSeq` 应直接更名，而不是保留错误含义。
- **[推断]** `eventCount` 是“record 从多少条 raw events 重算”的审计 cursor，不单独证明
  domain 全局 freshness。特别是 `/dcp stats` handler 执行前已有 `command/run`，handler
  返回后才追加 `command/done`；renderer 的 `current` 只能指 handler 观测边界。
- **[推断]** 如为诊断需要展示 last seq，在内存派生：
  `eventCount === 0 ? 'none' : eventCount - 1`。不要制造第二个可漂移字段。

### 3.3 两层 version 的迁移策略

- **[事实]** JSON backend 的 domain version mismatch 在 open 时直接失败，当前没有迁移
  hook；DomainFacility 又会在构造 handle 前验证全部 records。
- **[推断]** physical domain version `1` 只表示 unit/table layout。未来可把 record schema
  扩成 `v: 1 | 2` union，open 后显式逐 record 迁移并 durable rewrite；迁移完成前 reader
  仍能辨认旧 variant。
- **[推断]** 若未来必须改变 physical layout，先设计带备份的独立 migration/new domain，
  不简单 bump version 后把旧文件当空库。
- **[推断]** M7.0 对 unknown record `v`、domain version mismatch、malformed medium 和
  invalid record 的统一行为是：保留文件，persistent unavailable，session stats 可用。
- **[事实]** 当前 production manifest 没有直接声明 `zod`，但 domain record schema 需要
  runtime zod。**[推断]** 实现时必须声明直接 runtime dependency，不能依赖
  storage-domain 的传递依赖；clean GitHub install 要验证这一点。

---

## 4. 接线与生命周期计划

### 4.1 组件边界

**[推断]** 把职责拆成三个纯度层次：

1. `computeSessionStats(events, tokenMeter)`：纯冷重算，返回无时间戳 snapshot body；
2. `aggregateDomainRecords(entries)`：纯 record-sum + identity/schema 检查；
3. `StatsCoordinator`：唯一拥有 Domain handle、binding epoch、dirty queues、failure 状态和
   clock 的异步边界。

**[推断]** `renderStats` 改为 async，通过 coordinator 请求一次当前 session catch-up；
无 coordinator/handle 时仍用第 1 层同步渲染 session。命令 handler 已是 async，不需要
改变命令协议。

### 4.2 optional binding

**[推断]** 主 `apply()` 完成现有全部注册后，创建独立动态 child：

```text
main DCP fiber (required core services; always active)
  └─ ctx.inject(['storageDomain'], storage child)
       ├─ managed async DomainFacility.open(spec)
       ├─ bind handle/table to one generation token
       └─ cleanup: stop generation -> drain owned workers -> Domain.close()
```

- 不在 exported `inject` 或 `cordis.patch.yml` row 加 `storageDomain`。
- child 为 `opening` 时主插件已经能 compress、加 marker、执行所有命令。
- open rejection 在 child 内捕获并归一化，不让 child startup rejection 变成未处理 Promise；
  `/dcp stats` 可触发一次 coalesced retry，不设无限 timer retry。
- service 被移除/替换时先撤销该 generation；旧 open/write 的晚到 settlement 只能被旧
  generation 观察，不能覆盖新状态。该模式应仿照宿主 optional-service binding 的
  identity guard。
- cleanup 必须 await consumer-owned `Domain.close()`；不能只依赖 facility unmount 的
  `closeAll()` 兜底。

### 4.3 dirty、串行与合并

**[推断]** 所有触发入口只调用无抛错的 `markDirty(session)`；不得在同步 mutation stack
里重算或 `await table.put()`：

- `session/created`：seed 不会重发 `session/event`，所以对新/恢复 session 做一次 catch-up；
- binding 成功：扫描 `ctx.sessions.list()`，覆盖“DCP 晚于 session 加载”的顺序；
- `session/event`：DCP marker append、任意 surface replacement（含 native absorption）、
  DCP checkpoint/prune 完成时标脏；同一同步 commit stack 合并；
- `session/disposed` 与主 fiber teardown：捕获最后 immutable events snapshot，尽力 drain；
- `/dcp stats`：强制当前 session 至 handler 的观测边界并等待这一 session 的 attempt。

**[推断]** 每个 session 一个 worker，但所有入口（background、command、dispose）必须走
同一个 worker：

1. 先 `queueMicrotask`，保证 `compaction/summary -> replace` 和完整 bracket/inline cleanup
   的同步 stack 已结束；
2. 捕获一次 immutable `events` array、header identity 与 `eventCount`；
3. 冷重算、schema parse，调用 `table.put(sessionId, fullRecord)`；
4. await 成功后才更新 durable cursor/清除该 session failure；
5. 若运行期间又 dirty，循环一次最新完整 snapshot，而不是排队每个中间 revision；
6. failure 后保留 dirty/failure，但停止紧循环；下一事实变化、显式 stats 或重新 binding
   才做一次全日志覆盖追平。

**[事实]** Domain 自己已有 per-domain write chain，能保证 `put` 调用到 durability 的顺序。
**[推断]** 仍需要 per-session worker：它负责避免较早计算的 snapshot 晚于较新 snapshot
入队、合并高频事件、隔离旧 binding epoch，以及让 command/dispose 能等待明确 attempt。

### 4.4 读与 aggregate 的一致边界

- **[推断]** `/dcp stats` 先 await 当前 session worker，再同步捕获一次
  `[...table.entries()]`；该 iterator 是稳定 snapshot，扫描期间不会被后续 write 改写。
- **[推断]** 若当前 session write 失败，扫描仍读取 domain 的旧 durable in-memory state，
  输出数字并标 `stale`。不要把“write rejection 后 memory 未变”误报成 current。
- **[推断]** scan 的任何 schema/key/read 异常使 persistent section 整体 unavailable；
  不输出部分求和后假装完整。
- **[推断]** `latestUpdatedAt` 只是最大 record 时间；可另在 verbose/internal diagnostics
  计算 min/max，但 M7.0 不把它命名为 atomic `asOf`。

### 4.5 核心事务隔离

- **[推断]** 不从 `commitRange()`、automatic strategy 或 recovery mutation 直接 await
  stats；唯一连接是 post-commit session observer/dirty signal。
- **[事实]** `session/event` observer 是 post-commit、fire-and-forget，listener throw 被宿主
  contained。**[推断]** listener 本体仍应只做同步、无抛错的入队；所有 async tail 必须
  `.catch()` 并落 bounded diagnostic。
- **[推断]** stats 不追加 SessionEvent、不改 surface/header/system/tools，也不触发 LLM。
  所有 storage 状态组合都必须继续通过 `messages === deriveMessages()`。

---

## 5. 降级状态机

| 条件                                                                 | persistent 输出                                              | 核心行为                                               | 恢复                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------- |
| **[事实/推断]** `storageDomain` 服务缺失                             | `unavailable (service missing)`                              | DCP 全功能注册；session stats 正常                     | 服务出现时动态 child 打开并 catch up live sessions |
| **[推断]** opening                                                   | `unavailable (opening)`                                      | 同上                                                   | open 成功转 ready；失败归类                        |
| **[事实/推断]** backend-not-found / facet unsupported / open I/O     | `unavailable (open failed: <code>)`                          | 同上；一次有界 warning                                 | 服务 epoch 变化或显式 stats 做一次 retry           |
| **[事实/推断]** version mismatch / malformed medium / invalid record | `unavailable (<stable code>)`                                | 同上；不删除介质                                       | 明确迁移/修复后 retry/rebind                       |
| **[事实/推断]** `put` rejection                                      | 保留旧 aggregate，`stale (write failed)`                     | 已提交 compress/control 仍成功；无 unhandled rejection | 下一 trigger 从全日志覆盖；成功后清 stale          |
| **[事实/推断]** handle closed/read throws                            | `unavailable (closed/read failed)`，不展示 partial aggregate | 核心继续                                               | 撤销旧 binding；允许一次 reopen                    |
| **[事实/推断]** plugin/service dispose                               | 不再接受新任务；drain 已拥有任务后 close                     | teardown 不反向制造 tool/session failure               | 新 fiber 新 epoch                                  |

**[推断]** 对日志只记录稳定错误码/分类与一次状态转换；绝不打印 backend 文件正文、
任意 record 内容或无界重复 stack。`write failed` 的最近诊断可在 debug log 中保留，命令
输出不需要暴露绝对路径。

---

## 6. `/dcp stats` 输出契约

### 6.1 最小字段集

**[推断]** 用户可见最小集如下；更细 ledger breakdown 可保留现有信息量，但不应少于：

**Session（永远有）：**

- historical blocks（summary / expansion）与 active blocks；
- recognized prune replacements；
- estimated gross removed、artifacts added（checkpoint/prune/marker 可分项）；
- signed estimated history reduction 或 history overhead；
- current surface estimate。

**Persistent domain（可降级）：**

- status：`current | stale | unavailable` + 稳定 reason；
- stored sessions 数；
- historical/active block record-sum；
- signed estimated history reduction/overhead record-sum；
- 当前 session durable cursor（`stored eventCount / observed eventCount`）；
- latest durable update；
- scope 行：`latest per-session snapshots; single host process`。

### 6.2 status 的精确定义

- `current`：在本次 handler 观测边界，当前 session sync 成功，且本进程已知 live
  sessions 没有 pending/failed dirty record。它不证明另一个进程或未加载 session 没有
  更晚日志。
- `stale`：domain 可读，但当前 session cursor 落后/写失败，或本进程知道至少一个 live
  session 的 snapshot 待写/失败。仍显示旧 durable aggregate，并明确它是 stale。
- `unavailable`：无 handle、opening/open/version/schema/read/closed failure；不显示伪造的
  0 domain total。session section 仍返回 command success。

### 6.3 建议快照形状

**[推断] current：**

```text
DCP statistics
Token counts are heuristic estimates; net covers session history only.

Session (observed through 128 events):
  blocks:              3 historical (2 summary, 1 expansion), 1 active
  prune replacements: 2 recognized
  gross removed:       ~920
  artifacts added:     ~310 (checkpoints 240, prunes 20, markers 50)
  history reduction:   ~610
  current surface:     ~1,840

Persistent domain:
  status:              current
  scope:               latest per-session snapshots; single host process
  sessions:            2
  blocks:              5 historical, 2 active
  history reduction:   ~1,020
  current session:     128 / 128 events durable
  latest update:       2026-08-16T12:34:56.000Z
```

**[推断] 负值：** 把 session/domain 行改成
`history overhead: ~37`，不要输出 `history reduction: ~-37` 或 clamp 为 0。

**[推断] stale：**

```text
Persistent domain:
  status:              stale (write failed)
  scope:               latest durable per-session snapshots; single host process
  sessions:            2
  history reduction:   ~980 (stale)
  current session:     121 / 128 events durable
  latest update:       2026-08-16T12:30:00.000Z
```

**[推断] unavailable：**

```text
Persistent domain:
  status:              unavailable (version mismatch)
```

**[推断]** 时间和大数字格式必须固定（ISO UTC、是否千分位二选一），并由快照测试锁定。
`~` 与总标题的 estimated 声明不要在 session/domain 两部分使用不同规则。

---

## 7. 按信息增益排序的三个实施步骤/实验

### 7.1 优先级 1 — 统计 ledger oracle 与协议冻结

**输入 [事实]：** 当前 session/replay/token-meter、nested fixture、dedup/purge/inline cleanup、
expansion/recompress、native absorption 日志。

**动作 [需实验]：**

1. 先把本建议 §2 的定义写入 `docs/PROTOCOL.md` §8，并为 session/current/stale/
   unavailable/negative-net 输出写失败快照；测试先红。
2. 构造一个逐事件人工 ledger：marker → summary → nested summary → expansion →
   recompress → dedup/purge/inline cleanup → native absorption；每一步记录 removed/added、
   historical/active 预期。
3. 用同一个 `tokenMeter.estimateMessage()` 重算 added side，断言基础分量和手算完全一致；
   cold replay 与任意合法 prefix 的最终结果一致。

**可证伪断言 [需实验]：**

- expansion 单独发生时 net 可为负，绝不 clamp；recompress 后按实际 message price 抵消；
- 嵌套 checkpoint 的 added/后续 shadowed 自然抵消，不 double count；
- native delta 不进入 historical DCP ledger，但 active block 数会下降；
- 每个被计入的 prune 都能仅从 raw log 确定性归属；unknown shape 不计入。

**停止条件 [推断]：** 无法确定性识别某类 prune，或五项基础 ledger 不能解释所有展示
数字时，先删减字段/改名，不进入 domain schema；禁止用启发式和 clamp 掩盖缺口。

### 7.2 优先级 2 — optional Cordis + async KvTable 生命周期薄片

**输入 [事实]：** 真实 `Context`/storage hub/DomainFacility contract，gated fake KV backend，
现有 contract fixture 的 dispose 模式。

**动作 [需实验]：**

1. 先仅实现 coordinator binding：服务 absent、late provide、remove/reprovide、delayed open、
   delayed write、dispose during open/write。
2. 两个 session 并发产生 dirty revisions；人为让旧计算/写较慢，让一个 write fail once。
3. 检查 child effect、generation token、per-session worker、consumer `close()` 的确切顺序。

**可证伪断言 [需实验]：**

- absent/open failure 时主 DCP fiber 仍 active，tool/commands/guidance 已注册；
- 同 session 最终 durable record 总是最高已观测 revision，旧 snapshot 不能覆盖新；
- write rejection 不产生 unhandled rejection，table memory 保留旧 record，下一 trigger
  全日志追平；
- dispose 等待已拥有的 write，并恰好关闭 handle；late old-epoch settlement 不改变新状态。

**停止条件 [推断]：** 若 optional child 的失败/卸载会使主插件 pending/unload，或任何
stats rejection 能冒泡成 compress failure，停止纵向接线，保留 session-only stats 并记录
宿主/设计缺口。

### 7.3 优先级 3 — 真实 JSON restart/failure 纵向 e2e

**输入 [事实]：** `@deepseek-ai/dsh-storage-json`、storage-domain、两个真实 Session/AgentLoop
fixture、隔离 `.tmp-vitest` root、固定 clock。

**动作 [需实验]：**

1. 新 Context 中挂 storage hub → JSON backend → domain → DCP；session A/B 产生 marker、
   nested compress、prune、expansion/recompress，执行 `/dcp stats`。
2. 完整 dispose；用同一 JSON root 建全新 Context，恢复 A/B raw logs，再读 stats；给 B
   追加 mutation，只应覆盖 B record。
3. 用确定性文件系统故障让真实 JSON publish 失败（例如在隔离 root 下把 backend root
   暂时替换为普通文件，避免依赖 root 用户可绕过的 chmod），恢复目录后触发 catch-up。
4. 分别预置 wrong unit version、malformed JSON 和 schema-invalid record，验证不清库降级。

**可证伪断言 [需实验]：**

- restart 前后 records 的业务字段及输出语义相同；只有明确新写才改变 `updatedAt`；
- A/B aggregate 等于逐 record 纯函数求和，重复 sync 不 double count；
- write fail 时 DCP mutation 和 AgentLoop invariant 仍成功，输出 stale；恢复后一次全量覆盖
  转 current；
- version/malformed/invalid 介质保持原字节存在，session stats 和 compression 继续工作；
- storage 接线不新增 model message、request header 或 tool schema 变化。

**停止条件 [推断]：** real JSON restart 丢 record、恢复后仍无法追平、文件故障反向改变
tool success，或出现 request/derive desync，均为 M7.0 NO-GO。

---

## 8. 完整测试矩阵

### 8.1 纯逻辑与 schema

- **[需实验]** empty/no-DCP、单 summary、多 range、两/三层 nested；
- **[需实验]** consumed/expanded/absorbed-native 后 historical 与 active 分离；
- **[需实验]** expansion 负 net、recompress、marker 后被 DCP/native 分别遮蔽；
- **[需实验]** dedup、purge-error、inline cleanup 与 foreign prune fail-closed；
- **[需实验]** token ledger 全部使用宿主 estimator；signed integer property，绝不 clamp；
- **[需实验]** record strict schema、unsafe/non-finite/negative、key/value sessionId mismatch、
  unknown record v；
- **[需实验]** aggregate 交换/结合、records 求和、派生 net 不持久化；
- **[需实验]** same cursor no-op、same identity log regression、new identity overwrite。

### 8.2 coordinator 并发/故障

- **[需实验]** 100 次同 session dirty 合并为有界 writes，最终 cursor 最新；
- **[需实验]** A/B 交错、domain 全局 chain 与 per-session worker 协作；
- **[需实验]** older compute finishes later、write fail once/always、read after close；
- **[需实验]** command catch-up 与 background worker 同时进入只产生一个 session writer；
- **[需实验]** service absent/late/remove/reprovide，open fail/retry，dispose during open/write；
- **[需实验]** warning 有界、无 unhandled rejection、旧 generation 不污染新状态。

### 8.3 真实 storage-domain/json

- **[需实验]** missing file 首写 materialize、两 session、entries snapshot；
- **[需实验]** 完整 Context dispose/restart、同 root reopen、只更新一条 record；
- **[需实验]** 真实 publish failure + 恢复追平；
- **[需实验]** backend-not-found、facet unsupported、wrong domain version、malformed medium、
  invalid record；
- **[需实验]** 介质故障时不删除/覆盖原文件；
- **[需实验]** 至少 1k records 的 scan + JSON rewrite smoke；若明显越过现有 perf budget，
  先减少写频率，不引入不可重建 global counter。

### 8.4 command、AgentLoop 与 Code 拒绝

- **[需实验]** current/stale/unavailable/negative-net/domain-empty 输出快照；
- **[需实验]** `/dcp stats` 自身的 `command/run`/`command/done` 不造成永久假 stale；输出
  cursor 明确是 handler 观测边界；
- **[需实验]** backend write failure 下 native compress 仍返回成功、后续 request 仍严格
  等于 `deriveMessages()`；
- **[需实验]** M6.3 Code sub-dispatch 拒绝无 `compaction/*`、无 block/prune/net 变化；
  正常 step marker 可以按其独立口径变化，测试不得误报为 compression commit；
- **[需实验]** native tool path、control expansion/recompress、automatic strategy 都由同一
  session observer 追平，不给每条 mutation 维护分叉 stats callback。

### 8.5 package/composition

- **[需实验]** web composition 有 storage 时 ready；无 storage service 的最小/headless
  composition 仍加载核心 DCP；
- **[需实验]** clean GitHub install 能解析 storage-domain 与直接 zod runtime dependency；
- **[需实验]** `cordis.patch.yml` 不重复启动 backend/domain，也不把 optional service 变成
  required row injection；
- **[需实验]** build declaration不泄漏未声明依赖，package check 覆盖新增 runtime import。

---

## 9. 最可能遗漏的风险登记

| 优先级 | 风险与标注                                          | 后果                                 | 缓解/停止条件                                    |
| ------ | --------------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| P0     | **[事实] 当前 added/removed 使用不同 estimator**    | net 算术无同一单位                   | 全部 added 用 tokenMeter；golden ledger 不等即停 |
| P0     | **[事实] clamp 隐藏 expansion/marker 负成本**       | “saved”系统性高估                    | signed ledger；负值快照                          |
| P0     | **[推断] 顶层注入 storageDomain**                   | 无 storage 时整个 DCP 不激活         | 仅动态 child；composition test                   |
| P0     | **[推断] async stats 冒泡到 mutation**              | 已提交事实被报失败、模型重试         | post-commit observer；所有 Promise contained     |
| P0     | **[推断] 同 session 旧 snapshot 晚覆盖新**          | restart 后统计倒退                   | 单 worker/coalesce/generation；逆序故障测试      |
| P1     | **[事实] KvTable 写时不做 zod 校验、record 不复制** | 本进程内存被原地污染，重启才 invalid | 写前 parse + fresh immutable object              |
| P1     | **[事实] domain close 拒绝新写、drain 既有写**      | dispose/open race 丢最后 dirty task  | 先停 generation、drain owned worker、再 close    |
| P1     | **[事实] seed 不发 session/event**                  | restart/live-before-plugin 永不追平  | session/created + binding 后 sessions.list scan  |
| P1     | **[事实] command/done 在 handler 返回后追加**       | eventCount 比较制造假 stale          | 观测边界语义 + dirty state；专门测试             |
| P1     | **[事实] JSON 无跨进程锁**                          | 两进程同 root 最后写覆盖             | 明示 single process；不宣称 global counter       |
| P1     | **[事实] JSON 每次 whole-file rewrite**             | session 多时 marker 写放大           | coalesce + 1k smoke；不做每 event 即写           |
| P1     | **[推断] fork record-sum 重复共享前缀**             | 被误解成唯一 all-time 操作           | 输出/协议明确 per-session snapshots sum          |
| P1     | **[推断] 同 session id 日志倒退/重建**              | `eventCount >=` no-op 保留错误旧值   | sessionCreatedAt identity + regression status    |
| P1     | **[事实] 一个 invalid record 阻止整个 domain open** | 单点损坏让 aggregate 全不可用        | session stats 始终可用；保留介质，显式迁移       |
| P1     | **[推断] 多插件实例争同 domain name**               | 第二次 open 得 already-open          | M7.0 声明 host singleton；重复挂载测试/诊断      |
| P1     | **[推断] `latestUpdatedAt` 被叫作 domain as-of**    | 给出不存在的原子新鲜度               | 只写 latest durable update + scope 行            |
| P1     | **[事实] record schema 要 runtime zod**             | clean install 在模块加载失败         | 直接 dependency + clean install gate             |
| P1     | **[推断] Code rejection 测试要求 record 完全不变**  | marker/cursor 合法变化造成假失败     | 只断言 compression ledger/mutation 不变          |
| P2     | **[推断] 时间/locale 未冻结**                       | snapshot 跨机器漂移                  | injected clock、ISO UTC、固定数字格式            |

---

## 10. 实施顺序与方向性回答

### 10.1 建议实施顺序

1. **[推断] M7.0a：语义冻结 + failing tests。** 先更新 PROTOCOL §8、schema decision、
   signed ledger 和三种输出快照。
2. **[推断] M7.0b：纯重算/schema/aggregate。** 替换现有同步 adapter 的含糊字段，但尚不
   接生产 storage。
3. **[推断] M7.0c：optional coordinator + real DomainFacility。** 生命周期/fault tests
   通过后再接 command。
4. **[推断] M7.0d：真实 JSON vertical e2e + perf/package gates。** 全绿才算纵向切片完成。

### 10.2 是否先冻结统计语义文档

**是。 [推断]** schema 一旦进入 JSON 文件，就成为迁移责任；输出一旦称为 all-time
saved，也会形成用户契约。先冻结 §2 的计数、signed equation、排除项、fork/native 与
status scope，再写存储代码。若 golden ledger 证伪定义，修改文档和失败测试，不能让
storage schema 先决定产品语义。

### 10.3 E7-CODE 是否并行

**默认不并行实现。 [推断]** M7.0 与 E7-CODE 都会触及 `src/index.ts`、AgentLoop fixture、
tool lifecycle 与 request invariant；同一分支并行会降低故障归因。允许的并行仅是：独立
分支/执行者做只读或 disposable spike，保持 M6.3 fail-closed，不修改统计 schema，不阻塞
M7.0 GO。M7.0 合并后再决定 M7.1。

### 10.4 `/dcp stats` 最小字段

**[推断]** 不应少于：session historical/active blocks、recognized prunes、signed estimated
history delta、current surface；persistent status/reason、session count、historical/active
record-sum、signed estimated history delta、current-session cursor、latest durable update、
single-process scope。详细 gross/added 分项应保留，因为它们是用户审计 net 的最短证据链。

---

## 11. M7.0 验收标准与停止条件

### GO

- **[需实验]** PROTOCOL 和快照先冻结 signed、active/historical、estimated、scope 语义；
- **[需实验]** 每条 record 等于对应 raw log + tokenMeter 的冷重算，aggregate 等于
  records 逐字段求和，重复/乱序 sync 不 double count 或倒退；
- **[需实验]** 真实 JSON 多 session、完整 Context restart、write failure/catch-up、
  version/malformed/invalid 全绿；
- **[需实验]** absent/open/read/write/close 任一故障都只改变 persistent status；核心
  compress、marker、commands 与 control 继续工作；
- **[需实验]** 所有 stats async tail 被观察，dispose drain/close，无未处理 rejection；
- **[需实验]** `/dcp stats` 三种状态和负 net 快照稳定，不把 unavailable 渲染成 0；
- **[需实验]** storage 接线不追加 model-visible event、不改变 request header/system/tools，
  AgentLoop invariant 全绿；
- **[需实验]** M6.3 Code refusal 对 compression ledger 为 no-op；
- **[需实验]** typecheck/lint/test/build/package/perf 及既有 gate 全绿后才进入 v0.2 release。

### NO-GO / 立即停止

- **[推断]** 必须把 `storageDomain` 设为 required 才能接线；
- **[推断]** 任何 storage error 能使已提交 DCP mutation 报失败或使插件整体不激活；
- **[推断]** stats I/O 需要插入 `compaction/summary -> replace` 邻接区或同步 commit stack；
- **[推断]** signed ledger 无法解释 expansion/marker/prune，仍需 clamp 或启发式猜 owner；
- **[推断]** 同 session 旧 snapshot 可覆盖新、restart 后 record 不能从 raw log 追平；
- **[推断]** version/schema mismatch 的处理会静默删除或覆盖旧 JSON；
- **[推断]** real JSON 测试出现跨重启丢失、未处理 rejection、request/derive desync；
- **[推断]** 规模 smoke 表明 whole-file rewrite 已影响正常 agent step，且 coalescing/降低
  写频率仍不能达标。此时缩减为 session stats + command-time persistence，不引入全局
  `+=` 快捷计数器。

最终建议是把 M7.0 定义成一个可审计的 sidecar，而不是第二个真相来源：**raw session log
决定数字，per-session record 只是带 cursor 的可重建缓存，domain 只是 records 的最新求和，
storage 的任何失败都只能降低可见性，不能改变上下文事实。**
