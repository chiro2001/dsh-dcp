# Round 0005 recommendation — 当前提交先 NO-GO；收完 M7.0 即发 rc.4，不等待 E7-CODE

> 审阅基线：`context.md` 所列 `6a7f975`（`main`，当前包版本
> `0.1.0-rc.3`）。本轮读取了 context 指定的文档、round-0004 产出、M7.0
> 实现和测试，并只读核对了与发布判断直接相关的 package、CI、安装脚本以及锁定
> dsh storage/Cordis 契约。遵守本轮约束，未执行安装、构建、测试或 git 写操作。

## 0. 执行结论

| 问题                            | 判断                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6a7f975` 能否直接发布为 rc.4   | **NO-GO。** 不是只差规模 smoke；真实插件接线、状态机和 signed ledger 契约均有发布阻断缺口。                                                        |
| 修完后发 rc.4，还是等待 E7-CODE | **修完即发 rc.4，不等 E7-CODE。** rc.4 应是可独立回滚、可独立说明的 M7.0 slice。                                                                   |
| E7-CODE 现在是否并行            | **不并行实现。** rc.4 前只允许不改共享文件的只读 API 审计/实验设计；实现 spike 在 rc.4 后独立开展。                                                |
| npm                             | **维持 NO-GO。** owner 决策门未变化；它不阻塞 GitHub rc。                                                                                          |
| 当前模型探针能否支撑发布声明    | **只足以支撑负向边界，不足以支撑正向可靠性声明。** 可据此继续不承诺 autonomous/correction/nested 可靠性，不能宣称模型驱动压缩“可靠”。              |
| “v0.2 最小核心已交付”           | 当前只能说 **implementation candidate 已出现，尚未交付**。下述门全部关闭后，才可限定为“single-process、GitHub-source 的 v0.2 最小核心 RC 已交付”。 |

这里的 NO-GO 不否定已完成工作。**[事实]** per-session 冷重算、真实
`DomainFacility/KvTable` 的直接打开、5-session record-sum、JSON reopen、forward-only
cursor 和 write rejection containment 都已有代码或测试。问题是这些证据尚未贯通到用户实际
加载的插件和所宣称的状态语义。

## 1. 对“核心已落地”的反驳

### 1.1 生产接线当前很可能永远取不到已打开的 store

- **[事实]** `src/index.ts` 的动态 injection callback 把 store 注册到
  `registerDcpStatsStore(child, ...)`；命令注册闭包却把外层 `ctx` 传给
  `renderDomainStats(ctx, ...)`。
- **[事实]** store registry 是 `WeakMap<Context, DcpStatsStore>`，按对象身份查找；Cordis
  为嵌套 plugin/inject 创建继承于父 context 的新 child context，并非同一对象。
- **[推断]** 因此实际 `/dcp stats` 使用外层 context 查询时看不到以 child 为 key 的 store，
  即使 domain 已成功打开，也会落到 unavailable 分支。
- **[事实]** 当前 integration test 没有经 exported plugin + command 路径证明这一点；它手工
  `openDcpStatsStore(ctx)`，再手工 `registerDcpStatsStore(ctx, store)`，恰好绕过了 identity
  mismatch。
- **[事实]** `if (ctx.get('storageDomain') !== undefined)` 又把动态 injection 的创建本身放在
  一次性预检查之后。若服务在 DCP 之后才出现，根本没有 child 可被激活。
- **[事实]** disposer 使用 `void handle.close()`，不等待 consumer-owned handle 完成关闭。

**[推断] 这是 rc.4 的第一 P0。** 建议去掉按 child identity 的全局 WeakMap 隐式关联：由
稳定的外层 coordinator 直接传给 commands，或明确以外层 context 注册并用 generation
token 防旧 child 回写。无论采用哪种形式，都必须无条件创建 optional injection，并让 disposer
`await close()`。

### 1.2 `current / stale / unavailable` 目前不是三个已实现状态

- **[事实]** 当前 renderer 只有两种结果：成功就输出 `current`；store 缺失、open/read/write
  任一失败都折叠为 `unavailable or stale`。
- **[事实]** `syncToDomain()` catch 后丢弃错误类别、旧 aggregate、stored cursor 和 failure
  状态；因此 write failure 时不能展示“旧 durable aggregate + stale”，恢复原因也不可审计。
- **[事实]** `syncDomainStats()` 对 `existing.eventCount >= observed eventCount` 一律返回 existing；
  当 stored cursor 大于当前日志时，renderer 仍会称 `current`。
- **[事实]** 当前 write-failure 单测只证明函数返回含 `unavailable or stale` 的文字；所谓
  “catch-up”是另一个从未失败的内存 store 的 5→6 forward update。没有同一 store 的
  fail→old durable view→recover→catch-up 状态迁移。
- **[事实]** 5-session JSON 测试直接调用 `syncDomainStats()`；没有启动 DCP production wiring，
  没有通过 `/dcp stats` 写五个 session，也没有注入 publish failure。

**[推断]** “失败降级与追平测试全绿”只能按窄义理解为两个独立机制各有浅测试，不能作为
真实故障恢复已经闭环的发布证据。

### 1.3 domain freshness 的产品契约尚未选定

- **[事实]** production 中唯一调用 `syncToDomain()` 的入口是 `/dcp stats`；没有
  `session/event`、session created/disposed 或 binding catch-up observer。
- **[事实]** 因而未在某个 session 运行 `/dcp stats`，就不会为它创建/更新 persistent
  snapshot；其他 session 在最近一次命令后发生变化，也不会被当前进程知道。
- **[推断]** 此实现可以成为安全的“command-time snapshot fallback”，但不能同时把 domain
  称为本进程 live sessions 已追平的 `current`。

rc.4 前必须二选一并冻结：

1. **推荐：完成 round-0004 的 coordinator 口径。** post-commit dirty/coalescing、binding
   catch-up、per-session 单 writer、current/stale 状态均按已接受设计落地；规模实验决定写频率。
2. **允许的收缩方案：正式采用 command-time persistence。** 文档和输出必须明确
   “current session 已同步；domain 是各 session 最近一次 durable snapshot 的求和，其他
   session freshness 未检查”，不得输出无条件 domain `current`。这应被记录为 fallback，
   不能仍宣称完整 live catch-up。

**[推断]** 不能接受第三种状态：代码采用 fallback，文档和 release note 却沿用完整
coordinator 的 `current/stale` 承诺。

### 1.4 signed ledger 与 round-0004 已接受决策不一致

- **[事实]** round-0004 `decision.md` 接受的是 history reduction “含
  marker/expansion/prune”。
- **[事实]** 当前 `docs/STATS.md` 与 `computeSessionStats()` 都使用
  `shadowed + prune - checkpoint + expansion`，没有减去 `markerTokens`；marker 只单列展示。
- **[推断]** 模型可见 marker 是 DCP 引入的 history artifact。若 net 不扣 marker，正数会系统性
  高估；marker 后来被 DCP shadow 时，还会进入 gross shadowed，却从未在 added side 付过成本。
- **[事实]** prune ownership 目前靠 replacement 文本包含 `[duplicate ` 或
  `[errored tool unit removed]`；marker ownership靠任意 user message 文本包含
  `<dcp-boundary`。两者都没有完整锁定 source/surface-op/相邻事务身份。
- **[推断]** foreign/quoted text 可被误归因，尚不满足“模型可见日志可独立审计、classifier
  fail closed”的目标。
- **[事实]** record schema 只用宽泛 `z.number()`/`z.string()`；没有 eventCount/count 的
  non-negative safe-integer、ISO timestamp、strict object 或
  `historyReduction` 方程一致性约束。aggregate 直接信任并累加持久化的派生 net。
- **[事实]** stats 的 current/stale/unavailable、负 net 和 domain 输出没有快照测试；这也没有
  满足本仓库“命令输出用快照锁格式”的门。

**[推断] 这是第二 P0。** rc.4 前应优先让基础 ledger 成为唯一持久事实，net 在读取/展示时
派生；至少也要 schema 校验方程。建议把 marker 纳入 added side。若坚持排除，必须显式推翻
round-0004 决策并把指标改名为“excluding marker artifacts”，不能继续使用无修饰的 history
reduction。

## 2. rc.4 必做清单

### P0 — correctness / truthfulness

- [ ] **[需实验]** 用 exported plugin + 真实 storage composition 调通 `/dcp stats`，不得在测试
      内手工 open/register store；修复 outer/child context identity、late provide、remove/reprovide、
      awaited close。
- [ ] **[需实验]** 实现可观测的 `current | stale | unavailable` 状态对象：稳定 reason、stored /
      observed cursor、旧 durable aggregate、binding generation 和最近失败；log regression 绝不报
      current。
- [ ] **[需实验]** 同一 session 所有 sync 走一个串行/coalesced worker。覆盖“新 cursor write
      pending 时，旧 snapshot 后入队”的反例，证明旧 record 不能覆盖新 record。
- [ ] **[需实验]** 冻结 marker 是否进入 net，并用逐事件 golden ledger 覆盖 summary、nested、
      expansion/recompress、dedup、purge、inline cleanup、quoted/foreign lookalike、native
      absorption；所有归属 classifier fail closed。
- [ ] **[需实验]** 真实 JSON publish failure 后展示旧值为 stale；介质恢复后同一 session 从
      raw log 全量覆盖追平为 current。storage 的任一状态都不得改变 compress/control/tool result，
      后续 LLM request 仍逐字节等于 `deriveMessages()`。
- [ ] **[需实验]** 为 session 正/负 net、domain current/stale/unavailable、empty domain 和
      regression 写快照。

### P1 — schema / scale / delivery

- [ ] **[需实验]** 把 record schema 收紧到各字段真实值域，并验证 derived equation；预置
      malformed JSON、physical version mismatch、unknown record version、invalid record 时不删除、
      不重写原介质，session stats 仍可用。
- [ ] **[推断]** rc.3 已公开包含 record `v: 1` 与 physical domain version 1，rc.4 不应静默
      改写 v1 含义。若 marker net 或结构变化，使用 `v1 | v2` reader，从 v1 的基础字段确定性迁移；
      不要简单 bump physical version 后把旧文件当空库。
- [ ] **[需实验]** 对真实 JSON 做 10/100/1000 session 的 update、aggregate、close/reopen
      规模 smoke，记录文件字节数、p50/p95 与增长率；测试结果决定 event-driven 还是已文档化的
      command-time fallback。
- [ ] **[事实/推断]** JSON backend 是 whole-file rewrite 且无跨进程协调。rc.4 可继续只支持
      single process，但 README/STATS/release note 必须明确：两个进程共享同一 root 可能整文件
      last-writer-wins，`current` 不表示跨进程全局新鲜，domain 不是 billing/all-time 唯一计数。
- [ ] **[需实验]** 从 clean candidate SHA、再从最终 tag 安装到隔离 profile，实际启动并执行
      `/dcp stats`；只检查 dump-config 不足以证明模块激活或 storage wiring 可用。
- [ ] **[事实]** rc.4 发布面至少要同步 package version、README status/install tag、RELEASE、
      ROADMAP、CHANGELOG、committed `lib/` 和 GitHub Release notes。当前 `docs/RELEASE.md` 甚至只列
      rc.1/rc.2，尚未登记 rc.3。

### 不阻塞 rc.4

- **[推断]** E7-CODE、message-mode、child deep-read、autonomous 改进、跨进程一致实现、SQLite
  backend 和 npm publish 都不应进入 rc.4 critical path。
- **[推断]** 当前探针不必因纯 stats/storage 改动机械重跑；只有修复触及 system prompt、tool
  schema、pre-step 或 AgentLoop 时才重跑对应场景。

## 3. 最可能遗漏的风险

| 优先级 | 风险与证据                                                                               | 后果                                                               | rc.4 处置                                                                  |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| P0     | **[事实]** nested child 注册、outer ctx 查询                                             | 真实 storage 已 open，用户仍只看到 unavailable                     | full-composition command test；稳定 coordinator ownership                  |
| P0     | **[事实]** stale/unavailable 被同一个 catch 分支吞并                                     | 失败时无法判断旧值、缺服务或损坏；`current` 可误报                 | typed state + reason + cursor；快照锁定                                    |
| P0     | **[事实]** marker 未进入 accepted net                                                    | history reduction 系统性偏高，v1 语义产生迁移债                    | 修正公式或明确改名；v1 fixture 迁移                                        |
| P0     | **[推断]** pending 新写与稍后旧 snapshot 可逆序排队                                      | durable cursor 倒退，restart 后长期错误                            | per-session worker + adversarial gated-write test                          |
| P1     | **[事实]** 每次 JSON mutation 重写完整 unit 并 fsync/rename                              | session 数增加后命令变慢；若 event-driven 会放大 IO                | 1k real-json envelope；coalesce；失败则正式 fallback                       |
| P1     | **[事实]** JSON 没有跨进程 lock/CAS                                                      | 两进程各自从旧内存重写，可能丢另一进程 record                      | single-process support boundary；不宣称 global current                     |
| P1     | **[事实]** 一个 invalid record 会让 domain open 整体失败                                 | 单条损坏使 persistent view 全不可用                                | fail closed、保留介质、明确 migration/recovery                             |
| P1     | **[事实]** lib 静态 import storage-domain，而 peer 又标 optional                         | 某些无该模块的 clean composition 会在服务降级前先 module-load 失败 | clean minimal-profile import test；要么保证宿主依赖，要么调整打包/依赖声明 |
| P1     | **[事实]** tag push 不在当前 branch-filtered workflows 的触发面                          | tag 本身可能没有独立绿门证明                                       | 只 tag 已绿且 source-identical 的 SHA，或增加 release/tag gate             |
| P1     | **[事实]** `check:package` 只检查路径存在；e2e-install 安装 `$PWD` 且只 grep dump-config | stale `lib`、GitHub ref、prepare、runtime activation 缺口未被发现  | pack/import + exact SHA/tag clean install + actual command                 |
| P2     | **[事实]** npm NO-GO 仅由文档约束，manifest 仍有 public publishConfig                    | 人工误发 registry 的操作风险                                       | owner gate 前加发布审批/显式 guard；不影响 GitHub 安装                     |

### whole-file rewrite 的正确解读

**[事实]** 当前代码只在 `/dcp stats` 写 storage，所以目前不会拖慢普通 agent step；代价是
domain 不会自动追平。**[推断]** 这意味着“正常 step 性能安全”和“live domain current”不能
同时从现有实现推出。规模实验必须在最终选定的写策略上运行，而不是只测一个直接调用
`syncDomainStats()` 的微基准。

### 跨进程的正确发布口径

**[推断]** 单行 `single-process scope` 是必要但还不充分。release note 应直接写“不支持多个
dsh 进程共享同一 JSON stats root 的一致聚合；最后写入可能覆盖另一进程的 snapshot；原始
session log 仍是唯一真相，stats cache 可重建”。这是支持边界，不是待用更多测试洗成 GO 的
未知项。

## 4. 按信息增益排序的三个收尾动作/实验

### 4.1 优先级 1 — production-topology truth test

**输入 [事实]：** exported `src/index.ts` plugin、真实 Cordis Context、commands、sessions、
token meter、storage hub + JSON + domain、一个有 DCP mutation 的 agent；另备 absent/late
storage 和 gated publish-failure 组合。

**动作 [需实验]：**

1. 先写失败测试：只通过 `ctx.plugin(dcpPlugin, config)` 加载，禁止调用
   `open/registerDcpStatsStore` 测试 helper；从 command runtime 执行 `/dcp stats`。
2. 覆盖 storage 先于 DCP、晚于 DCP、remove/reprovide、dispose during open/write。
3. 写成功后故障一次，读取 stale 旧 aggregate，再恢复并触发全日志 catch-up；同时跑一次真实
   AgentLoop request invariant。

**可证伪断言 [需实验]：**

- service ready 时命令确实看到同一 handle；late provide 后无需重载主 DCP 即可从 unavailable
  转 current；
- write failure 输出 stale + 旧 durable aggregate + 落后 cursor，而不是模糊 unavailable；
- recovery 后 cursor 等于命令观测边界，旧 generation/旧 snapshot 都不能回写；
- 所有 storage 组合下 compress/control 的 success、session log 和
  `messages === deriveMessages()` 不变；dispose 等待 close 且无 unhandled rejection。

**停止条件 [推断]：** 任一有 storage 的 production command 仍 unavailable、log regression
报 current、stats failure 改变核心 mutation/request，或 teardown 留下 late write，rc.4 继续
NO-GO；先修 topology/state machine，不进入性能调参。

### 4.2 优先级 2 — ledger/schema golden + real-JSON scale envelope

**输入 [事实]：** marker→summary→nested→expansion→recompress→prune→native absorption 的
逐事件 fixture、rc.3 v1 JSON fixture、invalid/wrong-version fixture，以及 10/100/1000 个
固定大小 session records。

**动作 [需实验]：**

1. 手算每一步基础 ledger；用宿主 estimator 验证 classifier、signed equation 和 aggregate；
   加入 quoted/foreign lookalike 反例。
2. 用 rc.4 reader 打开 rc.3 v1；若公式变化，验证无损、确定性 v1→v2 migration；坏介质记录
   open 前后字节完全相同。
3. 在隔离真实 JSON root 上分别测单 record update、aggregate scan、close/reopen；每档 warmup
   后记录至少 20 次 p50/p95、文件大小和写次数。若采用 event-driven，再用 100 次同步 dirty
   burst 验证每 session 合并为不超过 2 次 durable writes。

**可证伪断言 [需实验]：**

- `historyReduction` 只由基础字段唯一派生；marker/foreign/prune 归属没有字符串碰撞；
- rc.3 合法 record 不丢失、不变成空 domain；unknown/invalid 只降级 persistent view；
- 100→1000 的 scan/update 没有明显超线性失控；建议预先冻结 release hard cap：1k update 和
  aggregate 各自 p95 < 2s，且正常 pre-step 不等待 storage；event burst 无无界 backlog。

**停止条件 [推断]：** ledger 仍需 clamp/含糊 ownership、迁移需删旧介质、1k 任一操作越过
2s hard cap、或 event-driven 使 pre-step 等待/积压。性能失败时正式采用并文档化
command-time fallback；不得改成不可重算的 global `+=`。

### 4.3 优先级 3 — candidate SHA/tag delivery rehearsal

**输入 [事实]：** 关闭 P0/P1 后的 clean candidate SHA、精确 dsh `0.1.0-rc.6`、空
`DSH_HOME`、GitHub SHA/ref 与拟发布 tag、预期 release manifest。

**动作 [需实验]：**

1. 按规定顺序跑 typecheck→lint→test→build→package→perf→coverage→e2e；任何 skip 在
   release gate 中都按未证明处理。
2. build 后断言 committed `lib/` 与源码构建无 diff；执行 pack dry-run，并从无 workspace
   link、无仓库 `node_modules` 的 clean profile 安装精确 GitHub SHA。
3. 实际启动插件，在有/无 storage 两种 composition 执行核心命令和 `/dcp stats`；切 tag 后
   再用 tag 安装，核对 tag SHA 与已绿 SHA 相同。
4. 核对 package/README/RELEASE/ROADMAP/CHANGELOG/lib/GitHub notes 的版本、能力和限制矩阵。

**可证伪断言 [需实验]：** GitHub SHA/tag 安装无需本地状态；module import、prepare 或
committed-lib fallback 均不缺 runtime dependency；有 storage 显示正确 domain 状态、无 storage
只降级 persistent 部分；所有版本字符串和 release notes 指向同一 rc.4。

**停止条件 [推断]：** 任一 gate skipped/failed、tag 不指向已绿 SHA、build 产生未提交 lib
diff、只在 `$PWD` link 下可用、或 dump-config 有条目但命令未激活，均不得创建 GitHub Release。

## 5. rc.4、E7-CODE 与 npm 的取舍

### 5.1 rc.4：有条件 GO，且不等待 E7

**[推断]** 上述三项全部关闭后，应发布 `v0.1.0-rc.4`。原因是 M7.0 的风险域是可重算
storage sidecar、统计语义和交付工件；E7-CODE 的风险域是嵌套 tool lifecycle、日志邻接、abort
与 inline cleanup。把两者放入同一 tag 会扩大回归面，并让问题归因和回滚都变差。

建议 rc.4 release note 只做以下限定声明：

> M7.0 single-process preview：DCP 统计从 raw session log 冷重算，以 per-session durable
> snapshot 作为可重建缓存；token 数为 heuristic session-history estimate；persistent stats
> 故障只降低可见性，不改变上下文或 agent-loop request。

并紧邻列出：exact dsh rc.6、GitHub source、JSON single-process、无跨进程一致保证、Code Mode
仍 fail closed、无 autonomous/correction/nested 成功率承诺、npm 未发布。

### 5.2 E7-CODE：rc.4 后独立、time-boxed spike

**[推断]** 现在不应并行改 `src/index.ts`、tool lifecycle、AgentLoop fixture 或发布文件。
rc.4 前可以并行做的只有只读宿主 API 审计和实验草案。rc.4 发布后再开独立 spike，并保持
production 默认 fail closed。

E7 的 GO 条件不应是“模型偶尔会调用”：

- **[需实验]** Code 子调用的 call/result 能通过公开扩展点形成可恢复、顺序确定的 session
  facts；
- **[需实验]** compress transaction、inline cleanup、abort/retry 与普通 tool path 具有同一
  原子性；
- **[需实验]** 任何实现仍满足 request/derive invariant，不要求请求时改写，不修改 dsh core；
- **[推断]** 若只能依赖不可见的内联参数、无法记录相邻事务、或需请求时注入/宿主私有 hook，
  E7 立即 NO-GO，继续明确拒绝。失败的 spike 也是完整结论，不应阻塞 v0.2 minimum core。

### 5.3 npm：维持 NO-GO

- **[事实]** `docs/RELEASE.md` 的 owner 决策（公开 registry 包名、AGPL/source 获取义务、
  privacy/secret 边界）没有在本轮得到新授权。
- **[推断]** 所以 npm 继续 NO-GO；GitHub rc.4 可独立发布。
- **[事实]** 新增的 storage runtime/import surface 反而要求重新跑 clean install，不能沿用
  rc.2 的“技术门已通过”作为 rc.4 证据。
- **[推断]** 若 NO-GO 是硬政策，应增加显式 publish approval/guard，避免仅靠文档阻止误发；
  owner 作出 GO 决策时再移除。

## 6. 探针 oracle 与可靠性声明

### 6.1 当前数据能说明什么

- **[事实]** 当前记录为 forced 8/10、autonomous 0/10、correction 2/5、nested 2/5。
- **[事实]** forced 的两个失败都是 `minNetSavingsTokens=1` 拒绝短范围，而不是 schema
  invalid；现有 headline 把模型行为、policy rejection 和 commit 结果混成一个成功率。
- **[事实]** autonomous 只有两轮短 corpus，没有证明达到真实 context pressure/nudge 条件。
- **[事实]** oracle 的 `schemaValid` 只检查第一条 compress call；nested 的
  `priorBlockPreserved` 只检查 surface 含固定 `Included prior blocks` 文本，不衡量摘要语义
  忠实度。
- **[事实]** 样本来自单一 provider/model、单次小样本运行；脚本自己声明不是 CI gate。

**[推断]** 这些结果足以作保守决策：不新增 autonomous 模式，不承诺错误自修复或 nested
自主触发，forced path 只称 real-model smoke。它们不足以估计稳定成功率，也不足以在 rc.4
写“模型能可靠自主压缩/纠错/嵌套”。

### 6.2 未来若要做正向声明，oracle 必须先改

**[需实验]** 把结果拆成 attempted / schema-valid / boundary-valid / policy-accepted /
committed / post-commit invariant 六层；检查全部调用及因果顺序；forced corpus 预先保证有明确
正 net，另设 policy-rejection 场景；nested 用结构 membership + 事实回忆 rubric，而不是固定
boilerplate；固定模型标识/参数并跨多批次报告置信区间。E7-CODE 应复用这个分层 oracle，而
不是把一次成功 call 当完整支持。

## 7. 最终方向性判断

### 当前 baseline

**结论：M7.0 尚未达到可发布状态；“v0.2 最小核心已交付”应暂缓。**

这不是因为必须先实现 E7-CODE，也不是因为需要把 JSON 做成跨进程数据库，而是因为当前证据
尚未证明用户实际加载路径能使用 domain，输出状态与 ledger 又比文档承诺更弱。

### 关闭本轮门之后

**结论：发布 rc.4，并把它定义为“v0.2 最小核心的 single-process RC 已交付”。** 这个结论
只覆盖：range compression 主链路、可审计 signed session ledger、可重建 per-session
persistent snapshots、明确降级状态和精确 dsh rc.6 GitHub 安装。它不覆盖 Code Mode 完整
支持、模型自主可靠性、跨进程一致统计或 npm 分发。

下一步顺序应是：

1. 关闭 production topology / status / ledger 三个 P0；
2. 跑 schema+规模和 exact-ref delivery gates；
3. 切 rc.4；
4. rc.4 稳定后独立执行 E7-CODE spike；成功进入后续 rc，失败则维持 fail closed 并结束该
   stretch，不回头扩大 v0.2 minimum core。

最终发布原则不变：**raw session log 是唯一真相；domain 是带 cursor 的可重建缓存；任何
storage 失败最多降低统计可见性。rc.4 必须用真实插件路径证明这句话，而不能只由直接调用
storage helper 的测试代替。**
