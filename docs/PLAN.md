# dsh-dcp 实现规划（Round 0001 修订版）

> 状态：规划修订稿；M0 宿主契约实验通过前，不进入功能性大规模编码。
>
> 证据快照：dsh-dcp `27743f2bc25c0cf90c11c3c6c19248f1269e8934`；
> DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a`
> （包版本 `0.1.0-rc.5`）；参考实现 v3.1.15。
>
> 本文可直接替换 `docs/PLAN.md`。若宿主版本变化，先重跑 §4 的契约实验，
> 不把本轮源码观察外推为永久 API 保证。

## 0. 标注规则与规划原则

本文对重要判断统一使用以下标注；同一条同时含不同性质的内容时拆开标注。

- **[事实]**：由本轮输入文件或已读取的目标版本源码直接支持。
- **[推断]**：基于事实作出的设计判断、取舍或实施建议，不等同于宿主保证。
- **[需实验]**：必须用最小原型或测试验证；通过前不得作为实现前提。

未单独标注的目录名、命令名和清单项，是其所在已标注决策的执行展开。

- **[事实]** dsh 的模型调用不变式要求 agent-loop 请求的 `messages` 与
  `session.deriveMessages()` 逐字节一致，并要求 system、tools 与最新
  `request/header` 一致。
- **[推断]** dsh-dcp 的首要设计原则是“模型可见即日志”：不在
  `agent/request` 或 `llm/stream` 临时改写 agent-loop 请求。
- **[推断]** 所有关键状态先以可重放的宿主已知日志与当前 surface 为准；
  `storageDomain` 只保存可重算的跨会话索引或统计缓存。
- **[需实验]** 任何依赖未明确承诺的宿主行为——尤其外置插件写
  `compaction/*`、消息 `source` 扩展字段、同一步 assistant replacement——
  必须先通过 M0，失败即停在决策门，不以类型断言绕过。

---

## 1. 项目目标、范围与成功标准

### 1.1 目标

- **[推断]** 实现外置 profile bundle `@chiro2001/dsh-dcp`，为 dsh 提供模型驱动的
  动态上下文管理，不修改 dsh 核心。
- **[推断]** v0.1 的主路径是：模型选择已经闭合的历史区间并在 `compress`
  工具参数中给出摘要；插件校验、补入受保护内容，再以持久 surface replace
  落地一个摘要检查点。
- **[推断]** 支持连续区间压缩、嵌套块、工具结果去重、压力提示、保护规则、
  人类命令、会话/跨会话统计与重启重建。
- **[推断]** 优先保证正确性、可重放、工具配对与计量一致；参考实现的每一项
  表面功能不自动获得同等优先级。

### 1.2 v0.1 成功标准

- **[事实]** 每一个 agent-loop `llm/stream` 请求继续通过
  `messages === session.deriveMessages()` 与 request-header 不变式。
- **[推断]** 插件停用后，宿主仍能加载已有会话；已落地摘要仍按普通已知
  `user/message` surface 节点重建，不依赖插件私有事件解释历史。
- **[推断]** 所有 surface replace 都有完整 `sourceEventSeqs`，且紧邻合法的
  shadow-price 事件，`tokenMeter.measure()` 与持久投影不漂移。
- **[推断]** 压缩只覆盖当前 surface 上闭合、工具配对平衡、非活跃的区间；
  失败不删除原始日志，部分提交可检测并可在重启后确定性分类。
- **[推断]** 核心纯逻辑行覆盖率不低于 85%，本地与 CI 门禁全绿是里程碑
  唯一验收条件，用户不参与测试。

### 1.3 非目标与延期项

- **[推断]** 不包含 TUI、前端、HTTP/SSE 桥，也不启动外部终端程序。
- **[推断]** 不查看或复用既有 TUI 前端插件的代码与文档。
- **[事实]** README、docs、AGENTS、expert-advice 等人类可读文档只可使用
  “既有 TUI 前端插件”这一泛称，不写其名称或路径。
- **[推断]** 不 fork、不补丁式修改 dsh 核心；若 M0 证明缺少必需公开能力，
  记录上游需求并阻塞对应功能，而不是偷偷绕过不变式。
- **[推断]** 不做请求时消息变换、toast/chat 伪通知、npm 自更新或另一套
  ask/allow/deny 权限表。
- **[事实]** 当前 surface replace 把一个连续区间折叠成一个新节点，没有把
  一个节点原位展开为多节点的公开操作。
- **[推断]** 因而 v0.1 不承诺“精确恢复原角色、原顺序、原工具配对”的
  decompress；§10 定义只读查看与显式的单节点语义展开，精确恢复延期。
- **[推断]** v0.1 默认不在 Code Mode 的 `run_code` 子调用内执行 `compress`；
  该路径无法可靠定位并清理外层 assistant 代码参数，见 §8.6。
- **[推断]** 项目级 `dcp.jsonc`、自动更新、子会话深读取增强和真实模型质量门槛
  延后到 v0.2+。

---

## 2. 参考实现行为与移植边界

### 2.1 可复用的产品语义

- **[事实]** 参考实现由当前模型在 `compress` 工具参数中内联生成摘要，插件本身
  不额外调用模型。
- **[事实]** 参考实现具有 range/message 两种模式、`mNNNN`/`bN` 引用、嵌套块、
  dedup、purge-errors、保护内容、nudge、命令族和持久统计。
- **[推断]** dsh-dcp 复用这些产品语义与测试场景，但重新实现宿主集成、状态协议、
  提示文本和代码，不复制请求变换架构。

### 2.2 不能照搬的机制

| 参考机制                    | 当前 dsh 事实                                                                                                         | 修订结论                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 请求前临时删改消息          | **[事实]** agent-loop 请求由日志重建并强校验                                                                          | **[推断]** 禁止；必须先写日志/surface                                  |
| 每会话私有 JSON 是压缩真相  | **[事实]** dsh 已有 append-only session log 与 surface                                                                | **[推断]** 活跃状态从日志和 surface 重建                               |
| 任意隐藏/恢复原消息         | **[事实]** 当前 replace 只有“多节点 → 一节点”                                                                         | **[推断]** 不声称 exact decompress                                     |
| 直接清理错误工具输入        | **[事实]** dsh 工具参数存在于 `assistant/message` 的 tool-call block；`tool/result` 只能 content-only 改写            | **[推断]** purge-errors 改为完整闭合单元实验                           |
| 拉取 child session 扩展结果 | **[事实]** 父会话已可能持有前台 tool result、report、settlement 或 job notice；远程 provider 未必有本地 child session | **[推断]** 默认按父 surface 的工具名与 source kind 保护                |
| 动态 system index/nudge     | **[事实]** system 改变会写完整 `request/header change`；动态 runtime context 会追加完整 snapshot                      | **[推断]** system 只放静态规则，动态信息走尾部日志化 marker 或按需工具 |

---

## 3. dsh 宿主契约基线

### 3.1 请求重建

- **[事实]** `agent/pre-step` 可以返回进入步骤的 `UserMessage[]`；agent-loop 随后把
  每条返回消息追加为 `user/message`，因此该扩展点可产生日志化上下文。
- **[事实]** `agent/request` 只能替换调用配置，不能替换消息。
- **[事实]** `llm/stream` 前置不变式检查冻结请求、session id、派生消息，以及
  provider/model/system/tools 等 header 字段。
- **[推断]** DCP 可在 `agent/pre-step` 返回小型 marker，但不得在
  `llm/stream` 观察器中补标签、删工具输出或注入 nudge。

### 3.2 Session 与 surface

- **[事实]** surface 成员的闭集是 `user/message`、`assistant/message`、
  `tool/result`。
- **[事实]** replace 的 `start`/`end` 是当前 surface 位置上的节点 seq；在既有
  replace 后，surface 顺序不保证按数值 seq 递增。
- **[事实]** 一个 replace 只插入一个新节点，且 `sourceEventSeqs` 必须包含所有
  被遮蔽的当前 surface 节点。
- **[事实]** `tool/result` replace 必须只改一个当前 result 的 content；callId、
  turn、step、message id、error 与 meta 等其余字段必须相同。
- **[事实]** `assistant/message` 必须位于其声明的开放 step 内；晚于原 step 的
  assistant replacement 会违反 session/token-meter 生命周期。
- **[推断]** 范围解析一律以 `session.surface.nodes` 的位置顺序为准，绝不以
  `seq` 数值区间代替。

### 3.3 自定义事件与 `ignorable`

- **[事实]** `SessionEventMap` 在 TypeScript 层可声明合并，事件 envelope 也定义了
  `ignorable?: true`。
- **[事实]** 当前公开 `Session.append(type, data, surfaceIntent?)` 没有设置
  `ignorable` 的参数；它构造的普通 log-only 事件不带该标记。
- **[事实]** 持久化重载使用宿主构建时生成的静态
  `KNOWN_SESSION_EVENT_TYPES`；外置插件事件不在其中，未知且未标记的事件会使
  加载失败。
- **[推断]** v0.1 不写任何 `dcp/*` 自定义 SessionEvent。原规划中的
  `dcp/compress`、`dcp/prune-tool`、`dcp/manual` 全部撤销。
- **[推断]** 即使将来宿主允许写 `ignorable`，影响历史重建的状态也不能仅因
  “能跳过”就放入可忽略事件；需要重新做兼容性设计。
- **[事实]** 当前 session format version 为 `0`，加载时不接受其他版本且没有迁移；
  普通事件词汇扩展本应由逐事件 `ignorable` 处理，而不是由插件伪造 header 版本。
- **[推断]** DCP 不修改 session format version；自己的 message-source metadata 使用
  独立协议版本，并对未知版本 fail closed。

### 3.4 原生 compaction 与 token 计量

- **[事实]** 成功的原生摘要事务为
  `compaction/start → compaction/summary → user/message replace → compaction/end`；
  `start/end` 同时构成日志化锁。
- **[事实]** `compaction/summary` 或 `compaction/prune` 必须紧邻它定价的 replace，
  并携带相同范围的 `shadowedTokenCount`。
- **[事实]** `tokenMeter.measure()` 保留当前 surface 节点价格并可正确重算；持久
  O(1) projection 无法从任意 replace 反推旧范围，缺失相邻 shadow price 时会
  以零 delta 继续，造成 projected/context-breakdown 漂移。
- **[事实]** compaction 边界必须工具配对平衡，宿主公开了按 surface cut 校验的
  helper。
- **[需实验]** 外置 DCP 作为同一日志协议的第二个生产者，能否在同时挂载原生
  backend 与 invariant companion 时稳定写上述事务，是 E-01 的硬门槛。

### 3.5 工具、命令、权限与并发

- **[事实]** 未声明 `isConcurrencySafe` 或分类不返回严格 `true` 的工具被调度为
  exclusive；exclusive 调用是同一步工具队列的屏障。
- **[事实]** 工具执行经过 `tools/pre-execute`、guards、execute、post、result；
  approval/deny 在执行体之前阻止副作用。
- **[事实]** 命令注册名不带 `/`；命令结果不进入模型历史，但
  `command/run`/`command/done` 会进入日志，默认保存原始参数。
- **[事实]** `agent.runMaintenance()` 只在 idle 时接纳维护任务；
  `agent.followup()` 会排入下一 turn 并唤醒 driver。
- **[推断]** `compress` 不声明并发安全，完全复用宿主 approval；DCP 不新增权限表。
- **[推断]** 直接 surface mutation 必须在开放 turn/step 的合法位置，或在明确允许
  standalone user replacement 的 idle maintenance 中执行；命令不能任意写日志。

---

## 4. M0：开始 M1 前的三个高信息增益实验

M0 产物进入 `tests/contract/` 或 `spikes/`，可抛弃实现但必须保留能防回归的测试、
输入、观察结果和决策记录。三项实验按信息增益排序。

### E-01 — 持久事务、计量与内联参数清理

**类别：[需实验]；优先级：1；阻塞 M1。**

最小 fixture 同时挂载 session invariant、agent-loop invariant、token meter、session
projection、compaction invariant 与一个外置测试插件，验证：

1. **[需实验]** 自定义 `plugin/test` 事件经公开 `Session.append` 写入后，重载确实因缺少
   `ignorable` 被拒；该用例锁定“不写 `dcp/*`”结论。
2. **[需实验]** 在开放 turn 内写入
   `compaction/start → compaction/summary → DCP metadata 的 user/message replace →
compaction/end`，随后持久化、重启并在未加载 DCP 逻辑的 composition 中恢复。
3. **[需实验]** replacement `source` 采用标准 compaction checkpoint provenance 与最小 `dcp`
   扩展字段；验证 JSON round-trip、compaction invariant、client/adapter 容错。
4. **[需实验]** 对任意 user range、单个 tool result、当前 step 的 assistant tool-call 三类 replace，
   对比 `measure().surfaceTokens`、`contextBreakdown.messageTokens`、
   `projectedTokens` 与从 surface 全量重算的结果。
5. **[需实验]** 模型原始 assistant 消息含内联 summary；`compress` 正在执行且原 step 尚未关闭时，
   用 `compaction/prune` + assistant replacement 只把 summary 参数改为合法短占位符，
   保持 call id、tool 名和其他 blocks；随后正常追加 tool result 并发起下一请求。
6. **[需实验]** 证明一个 summary 节点无法仅用现有 replace 原位展开为多个原角色节点；把失败
   作为 exact-decompress 的契约测试，而不是待修 bug。

通过条件：上述成功路径无 invariant failure，重启可读，请求逐字节可重建，两个
token 口径不漂移；故障注入后状态可分类。若第 2 或第 4 项失败，M1 阻塞并记录宿主
能力缺口；不得回退到无 shadow price 的 replace。若第 5 项失败，内联摘要仍可实验，
但必须先证明即使保留参数仍有最低净收益，否则缩减/阻塞该路径；辅助 LLM 不是自动
fallback，见 D6 与 §8.1.1。

### E-02 — 边界可用性、日志成本与 KV cache A/B

**类别：[需实验]；优先级：2；阻塞边界协议冻结。**

在相同的 30 组含多步工具调用、嵌套摘要、中文/英文混合和原生 compaction 的转录上
比较三个候选：

- **[需实验]** A：每步变化的完整 system index；
- **[需实验]** B：步骤入口追加一个小型、日志化、原位 boundary marker，并仅为失去原位 marker
  的当前节点追加 alias delta；
- **[需实验]** C：静态 system guidance + 模型按需调用只读 `dcp_context` 工具取得 refs。

记录：引用是否唯一、无效/陈旧引用率、工具配对边界命中率、每步新增 token、
`request/header change` 数、日志增长、可复用前缀长度，以及脚本化模型完成一次压缩
所需额外 step。固定 mock 做确定性协议测试；若有 API key，再做不进入合并门槛的
真实模型小样本。

决策规则：任何有歧义或依赖 seq 数值排序的候选淘汰；A 只要每步造成 header change
即不作为默认；B 若引用正确率与 C 相当且增量开销可控，默认选 B；否则默认 C，B 仅作
可选模式。最终格式写入快照并在 M1 后冻结为协议 v1。

### E-03 — 并发、崩溃与原生 compaction 状态机

**类别：[需实验]；优先级：3；阻塞 M2 嵌套与 M4 恢复。**

构造可控 scheduler 和 append fault injector，覆盖：

- **[需实验]** `start` 前、`start` 后、`summary` 后、replace 后、`end` 后进程中止；
- **[需实验]** DCP prepare 期间出现 idle injection、native compaction、surface generation 变化；
- **[需实验]** DCP 与原生 compaction 两种挂载顺序；
- **[需实验]** 一个 assistant 同时请求多个工具、多个 `compress`、deny/abort/timeout；
- **[需实验]** session seed/fork、`session/end-seed`、重启后的 orphan bracket；
- **[需实验]** native compaction 遮蔽 DCP block、boundary marker、nudge marker 或 expansion。

通过条件：没有未配对 tool call，没有静默 token 漂移，没有把不可确认的部分提交报告为
完整成功；同一事件日志在冷重放与增量重放得到相同状态。若 source metadata 或共享锁
协议不稳定，缩减 v0.1 功能并形成上游接口请求，不引入进程内假锁伪装持久正确性。

---

## 5. 修订后的架构决策

| ID  | 类别         | 决策                                                                             | 状态/理由                         |
| --- | ------------ | -------------------------------------------------------------------------------- | --------------------------------- |
| D1  | **[事实]**   | agent-loop 请求只取 `deriveMessages()` 与 folded header                          | 宿主硬不变式                      |
| D2  | **[推断]**   | 所有模型可见 DCP 内容先成为已知 surface 事件                                     | 保留原规划的正确方向              |
| D3  | **[推断]**   | v0.1 不写 `dcp/*` SessionEvent                                                   | 当前 append/重载契约不支持        |
| D4  | **[需实验]** | 摘要块复用标准 compaction transaction；DCP 元数据放在 replacement message source | E-01 通过后冻结                   |
| D5  | **[推断]**   | 活跃状态由 raw log + folded surface + message source 重建；storage-domain 非权威 | 避免双写真相                      |
| D6  | **[需实验]** | v0.1 优先保留模型内联摘要，并在同一步安全清理 summary 参数                       | E-01 决定；辅助摘要需另立契约实验 |
| D7  | **[推断]**   | system prompt 仅含稳定规则；动态 refs/nudge 放在尾部日志化消息或按需工具         | 避免每步 header churn             |
| D8  | **[推断]**   | range 使用 half-open、surface-position、工具配对平衡的闭合单元                   | 防止跨越活跃工具状态              |
| D9  | **[推断]**   | `compress` 为 exclusive，走宿主 approval；自动策略是显式配置的 pre-step policy   | 不复制权限系统                    |
| D10 | **[推断]**   | 原生 compaction 与 DCP 共享日志锁语义并做 block reconciliation                   | “只复位 nudge”不足                |
| D11 | **[推断]**   | exact decompress 延期；提供 raw show 与显式 semantic expansion                   | 与当前 surface 能力一致           |
| D12 | **[推断]**   | 不扩展 dsh 核心、不改用请求 rewrite                                              | M0 失败时缩减/上游提案            |

### 5.1 总体数据流

```text
静态注册
  ├─ system section: DCP 的稳定规则（不含动态索引/nudge）
  ├─ tool: compress（exclusive，宿主 approval）
  ├─ command: dcp / dcp-compress（注册名不带 /）
  ├─ agent/pre-step: 自动策略、boundary/nudge 消息
  ├─ session/event: 只读增量缓存与统计协调
  └─ settings/storage-domain: 配置与可重算聚合

每个模型 step
  1. pre-step 下游决策完成；若 enter，重放最新 surface
  2. 在合法开放 turn 中执行幂等自动策略
  3. 返回 boundary/nudge UserMessage；agent-loop 负责 append
  4. request/header 与 deriveMessages 由 agent-loop 正常构造

模型调用 compress
  1. approval/guards 先执行；DCP body 尚未写状态
  2. 按 current surface 解析 half-open refs，校验保护/配对/收益
  3. 无 await 地重新校验并提交 compaction bracket + replace
  4. 可选地同一步清理 assistant 内联 summary 参数
  5. 返回结构化结果；统计 sidecar 异步、幂等追平
```

---

## 6. 持久协议与状态重建

### 6.1 DCP 摘要检查点 metadata

**[需实验]** E-01 通过后采用以下逻辑形状；字段名在 M1 快照冻结。

```ts
interface DcpCheckpointMetaV1 {
  v: 1
  kind: 'summary'
  blockRef: `b${number}`
  mode: 'range' | 'message'
  topic: string
  startRef: string
  endRef?: string // range 为 half-open end；message 可省略
  authorMessageId: string
  compressCallId: string
  consumedBlockRefs: string[]
  protectedKinds: string[]
  recompressedFrom?: `b${number}`
}

type DcpCheckpointSourceV1 = CompactionCheckpointSource & {
  dcp: DcpCheckpointMetaV1
}
```

- **[事实]** `user/message.source` 在运行时要求非空 `kind`，且消息 source 类型是
  merge-extensible；普通插件 source 已被广泛使用。
- **[推断]** 使用标准 `compactCheckpointSource(compactionId)` 维持 compaction
  关联，再添加小型 `dcp` JSON metadata；摘要正文不在 metadata 重复保存。
- **[推断]** `compaction/summary.summary` 与 replacement message content 保存最终
  摘要；`tool/call` 保留模型原始参数，形成审计链。
- **[推断]** decoder 按版本严格校验。未知版本或畸形 metadata 不使 session 加载
  失败：把对应消息当普通受保护内容，禁止对它做 DCP mutation，并输出诊断。

### 6.2 一块 range 压缩的日志顺序

**[需实验]** 目标顺序如下：

```text
compaction/start      { compactionId, turn }
compaction/summary    { compactionId, summary, shadowedRange,
                        shadowedSeqs, shadowedTokenCount,
                        provider, model, rawOutput? }
user/message          source = compactCheckpointSource + dcp metadata
                      surfaceOp = replace(start, end)
                      sourceEventSeqs = [startEvent, summaryEvent, ...shadowedSeqs]
compaction/end        { compactionId, turn }
```

- **[推断]** inline summary 不冒充一次新的 `ctx.llm.stream` 调用：
  `llmStreamCall` 缺省，provider/model 取产生该 tool-call 的 assistant provenance。
- **[推断]** `compaction/summary` 必须紧邻 replacement，确保 token projection 消费
  正确 shadow price；`start` 在它之前，`end` 在 replacement 之后。
- **[推断]** prepare 阶段可以计算保护内容，但 commit 阶段从最后一次 surface
  generation/节点列表校验开始，到 `end` 为止不得 `await`。
- **[推断]** batch 中多个不连续 range 各自是一笔事务；先整体校验，再按当前
  surface 逐笔重校验。工具结果明确列出成功、失败和未尝试项，不声称跨 range 原子性。

### 6.3 inline summary 参数清理

- **[事实]** summary 作为 tool-call argument 留在 assistant surface 消息中；若又写入
  历史位置的 checkpoint，下一请求会暂时携带两份摘要。
- **[需实验]** 主事务成功后、原 step 仍开放时，定位当前 surface 上包含
  `compressCallId` 的 assistant 节点，生成保留所有 block/callId 的副本，只把已提交
  entry 的 summary 改成 `[stored in bN]`；先写 `compaction/prune` shadow price，
  再做单节点 assistant replace。
- **[推断]** 清理失败不回滚已成功的历史压缩；工具返回 `cleanupWarning`，统计按实际
  surface delta 计算。清理成功前不报告最终净节省。
- **[推断]** 同一 assistant 含多个 `compress` 时，每次从当前 surface 节点继续改写；
  其他工具调用与文本逐字保持。Code Mode 子调用不走此路径。

### 6.4 重放得到的状态

```ts
interface DcpReplayState {
  protocolVersion: 1
  blocks: Map<string, DcpBlock>
  activeBlockRefs: Set<string>
  boundaryRefs: Map<string, BoundaryTarget>
  successfulCommands: Map<string, ParsedDcpCommand>
  manualMode: boolean
  pruneReplacements: Map<number, DcpPruneRecord>
  nudgeState: DerivedNudgeState
  diagnostics: DcpDiagnostic[]
  maxBlockNumber: number
  maxMarkerNumber: number
}
```

- **[推断]** 扫描 raw log 解码 DCP source、成功配对的 `command/run`/`command/done`、
  compaction/prune 与 canonical placeholder；同时用 canonical surface fold 建 replacement
  图。
- **[推断]** checkpoint seq 当前在 `session.surface.nodes` 中才是 active；被 DCP
  checkpoint 遮蔽为 `consumed`，被原生 checkpoint 遮蔽为 `absorbed-native`，被
  expansion 遮蔽为 `expanded`。
- **[推断]** `bN`/marker 计数从所有历史 DCP metadata 的最大值继续，不因 block
  inactive、restart 或 fork 而复用。
- **[推断]** 冷重放与 `session/event` 增量应用共享同一个 reducer；增量缓存只按
  `(session identity, consumed event count, surface.replaceGeneration)` 加速。
- **[推断]** surface 成员资格比 sidecar 标志权威；sidecar 丢失不能让已遮蔽原文
  重新进入模型请求。

### 6.5 崩溃/部分提交分类

| 已持久化前缀                 | surface 结果 | 重启处理                                                                 |
| ---------------------------- | ------------ | ------------------------------------------------------------------------ |
| 无 `start`                   | 无变化       | **[推断]** 无操作                                                        |
| `start`                      | 无变化       | **[推断]** orphan attempt；新 lifecycle 后不当作活锁                     |
| `start + summary`            | 无变化       | **[推断]** 未提交摘要，忽略为 active block                               |
| `start + summary + replace`  | 摘要已可见   | **[需实验]** 标为 `recovered-unclosed`，以 surface 为准，不伪造 rollback |
| 完整到 `end`                 | 摘要已可见   | **[推断]** committed                                                     |
| `end { error }` 且无 replace | 无变化       | **[推断]** failed attempt                                                |

- **[事实]** restart seed boundary可使上一生命周期未闭合的 compaction start 失去活锁
  效力；确切组合仍由 E-03 覆盖。
- **[推断]** 不尝试删除或改写部分日志。若 replace 已落地而 close 失败，恢复状态显式
  暴露该事实；后续 mutation 只有在宿主锁检查允许时继续。

### 6.6 跨会话统计

- **[推断]** 当前会话统计从日志与 token metadata 重算，区分：shadowed、added、
  net saved、marker overhead、inline cleanup、dedup、purge 与 native compaction。
- **[推断]** `ctx.storageDomain` 表按 session id 保存 `{ lastProcessedSeq, aggregate }`；
  更新是从该 session 日志重算后覆盖，不做不可幂等的全局 `+=`。
- **[推断]** domain 写失败只影响 all-time 展示，记录 warning 并在下次加载追平；
  不把已完成压缩改报失败。
- **[推断]** 所有 token 数明确标为宿主 heuristic estimate；provider usage 与
  heuristic delta 不混成“精确节省”。

---

## 7. 边界引用、静态提示与 nudge

### 7.1 默认候选：原位 cut marker

**[需实验]** 若 E-02 选择候选 B，协议 v1 如下：

- **[需实验]** 每个即将进入的 step 在返回消息数组首部加入一个小型 `UserMessage`：

```text
<dcp-boundary ref="m0007" turn="4" step="2" />
```

- **[推断]** `mNNNN` 在 dsh-dcp 中定义为一个稳定的 **surface cut/marker**，不是
  任意原始消息的临时标签。工具 range 使用 `[startRef, endRef)`：包含 start 所在
  节点，排除 end 所在节点。
- **[推断]** 当前 step 的 marker 可安全充当历史区间的 end；模型不能选择 marker
  之后仍活跃的当前 step。
- **[推断]** marker 自己是已知 `user/message`，source kind 为版本化
  `dcp-boundary`；它进入日志后才进入请求，满足不变式。
- **[推断]** 原生 replace 若留下一个没有原位 marker 的旧 checkpoint，下一 marker
  只追加最小 alias delta，把 ref 映射到稳定 message id；resolver 再映射到当前
  surface 位置。alias 不能以 seq 数值大小推断顺序。
- **[推断]** 被压缩范围内的旧 marker 一同被遮蔽；陈旧 ref 在 resolver 中失败，
  工具返回最近合法 cuts，不默默扩大范围。

### 7.2 备选：按需 `dcp_context`

- **[需实验]** 若 marker 的 token/行为成本不合格，注册只读模型工具
  `dcp_context`，返回当前可压缩单元、refs、主题摘录和 token 估算；其普通
  tool result 自然日志化，模型下一 step 再调用 `compress`。
- **[推断]** 该模式多一个工具 round-trip，但不需要每 step 写 index；适合低压会话。
- **[推断]** 完整动态 system index 不作为默认 fallback，因为它同时改变早期 prefix
  和 request header。

### 7.3 静态 system guidance

- **[推断]** `ctx.systemPrompt.section('dcp:guidance')` 只包含稳定内容：何时压缩、
  half-open 语义、保护规则、只选闭合区间、`bN` 格式、失败重试方式。
- **[推断]** 动态 refs、压力百分比、最近主题和 manual 状态不进入 system section。
- **[事实]** section/tools 的真实变化仍会由 agent-loop 写完整 `request/header`；
  配置热更新导致一次合法 change 是可接受的。

### 7.4 Nudge

- **[推断]** 压力取 `ctx.tokenMeter.measure(session)` 与当前 route 的 context window；
  无容量时只启用 step/turn 阈值，不伪造百分比。
- **[推断]** 超过 `maxRatio` 时在当次 boundary marker 追加短 nudge；低于
  `minRatio` 才重新武装，形成 hysteresis。频率、上次压缩和 marker membership
  全由日志重放派生。
- **[推断]** nudge 不单独 append 第二条通知、不写 system header、不在
  `llm/stream` 临时注入。
- **[推断]** native/DCP replace 后重新测量；不以“看见 compaction/summary 就清空
  一个内存锚点”替代真实 surface reconciliation。

---

## 8. 压缩管线、嵌套与保护

### 8.1 `compress` 工具输入

**[推断]** v0.1 range schema：

```ts
{
  topic: string
  content: Array<{
    startRef: string
    endRef: string // exclusive
    summary: string
  }>
}
```

- **[推断]** `topic`、refs、summary 必须非空并有长度上限；数组数有上限。
- **[推断]** ranges 必须在当前 surface 中存在、按 surface position 有序、互不重叠。
- **[推断]** start/end cut 都必须工具配对平衡；默认至少保留最近 N 个 turn。
- **[推断]** range 不能包含当前 assistant、当前 `compress` call、未完成 approval/tool workflow、
  当前 boundary 或硬保护节点。
- **[推断]** 组装最终摘要后必须达到 `minNetSavingsTokens`；否则返回 no-op，不写事务。

#### 8.1.1 摘要生成策略

- **[事实]** 当前模型已经拥有完整 agent context，并能在 tool arguments 中给出
  summary；插件自调用模型会增加一次生成、延迟和新的重建/审计边界。
- **[推断]** v0.1 保持 inline-only：不在 `compress` body 内自调 LLM。E-01 通过时清理
  参数；清理失败时，只有“checkpoint + 未清理参数”仍满足最低净节省才允许提交。
- **[推断]** 不把 native compaction 的 direct LLM 先例自动推广成 DCP 权限。未来若
  评估辅助摘要，必须单独证明调用输入/输出、purpose、signal、模型路由、usage 与日志
  可重建，并重新审查本项目对 `llm/stream` 的不变式；该实验不属于 v0.1 fallback。

### 8.2 prepare/commit 流程

1. **[推断]** 从 `exec.agent.session` 取得同一 session，捕获当前 surface generation、
   nodes、request header、turn/step 与调用 assistant。
2. **[推断]** 重放 DCP state，解析 refs 为 surface position；用宿主 pairing helper
   验证两侧 cuts。
3. **[推断]** 收集选中节点、tool call/result 配对、DCP/native checkpoints、保护内容
   与 heuristic token 价格。
4. **[推断]** 规范化模型 summary，追加 nested/protected appendix，构造 checkpoint；
   若不缩小则拒绝。
5. **[推断]** 在第一次 append 前重新验证 generation、精确 shadowed seqs、开放 turn、
   compaction lock 与 abort signal。
6. **[需实验]** 按 §6.2 同步提交；失败按提交阶段分类并尽力写配对 error end。
7. **[需实验]** 按 §6.3 清理 inline 参数；返回 block refs、实际估算和 warning。

### 8.3 嵌套压缩

- **[事实]** 新 replace 的 `shadowedSeqs` 会列出当前 surface 中被覆盖的旧 DCP
  checkpoint；raw log 中旧 block 与原始叶节点仍在。
- **[推断]** 新 block metadata 记录直接 `consumedBlockRefs`；parent/ancestor、effective
  leaf seqs 由 replacement DAG 派生，避免重复保存巨大集合。
- **[推断]** 若模型 summary 未明确包含被消费 block，插件追加
  `Included prior blocks` 段并逐块保留旧摘要；最终仍必须通过净节省检查。
- **[推断]** 检测循环、重复 block ref、跨 session ref 与 inactive ref，全部 fail closed。
- **[推断]** 原生 checkpoint 默认作为不可拆原子内容；是否允许再次概括由显式配置
  决定，不能假定 native summary 等价于 DCP block。

### 8.4 保护分类

| 类别     | 默认处理                              | 例子                                                               |
| -------- | ------------------------------------- | ------------------------------------------------------------------ |
| 硬保护   | **[推断]** 拒绝包含该节点的范围       | 当前 step/tail、未配对工具、当前 instruction/snapshot、DCP control |
| 原文附录 | **[推断]** 摘要后按确定格式附加       | `<protect>`、受保护工具输出、受保护路径、配置要求保留的用户消息    |
| 原子摘要 | **[推断]** 可被整体再次概括或原文带入 | DCP block、native checkpoint、subagent report                      |
| 普通内容 | **[推断]** 依赖模型 summary           | 已闭环对话、旧工具输出、解释文本                                   |

- **[推断]** 保护提取以 raw logged content/tool arguments 为输入，不从渲染 UI 抓文本。
- **[推断]** `<protect>` 解析支持多段、未闭合标签与恶意 delimiter；附录使用可逆转义
  或长度前缀，快照锁定格式。
- **[推断]** 文件保护先按工具专用 extractor 解析 JSON 参数；未知工具不猜测路径。
- **[推断]** 当前用户指令、`form: instructions` 与最新 snapshot 默认硬保护；
  `protectUserMessages` 只控制更旧普通用户消息是否进入原文附录。
- **[推断]** 保护附录导致 summary 不再缩小时拒绝压缩，不为了“成功”截断受保护内容。

### 8.5 Subagent 与后台任务

- **[事实]** 父 surface 可能通过 tool result、`subagent-report`、
  `subagent-settled`、job notice 等多种来源获得结果；remote provider 不保证存在本地
  child session。
- **[推断]** 默认保护算法只读父 session：匹配配置中的子代理工具名、已知 source kind
  与 settlement/report 消息，保留父模型实际看见的内容。
- **[推断]** child-session 深读取为后续 opt-in enrichment；读取失败或远程 provider
  缺失时保留父结果并 warning，绝不以空字符串替换。
- **[推断]** 子代理自身默认禁用 `compress` 执行；是否在 child agent 开启由明确配置
  与递归/性能测试决定。

### 8.6 Native 与 Code Mode 调用边界

- **[事实]** Code Mode 子调用只把外层 `run_code` assistant call/result 放回模型
  surface；内层 dispatch 事件不形成普通 tool message。
- **[推断]** v0.1 检测带 parent/子调用关联的 `compress` 并在 mutation 前拒绝，提示
  改用 native tool presentation 或 `/dcp compress`。
- **[推断]** `both` 模式提示模型将 `compress` 作为独立 native call；同一 assistant
  的其他 native calls 可以保留，但 E-03 必须验证调度与参数清理。
- **[推断]** 若全局工具名 `compress` 已注册，插件启动失败并给出明确冲突，不静默
  shadow；可配置工具名属于后续兼容功能。

---

## 9. 自动策略

### 9.1 运行时机与幂等性

- **[推断]** 自动策略挂在 `agent/pre-step`，只在下游最终 decision 为 `enter`、signal
  未 abort、开放 turn 存在时执行；每次 mutation 前重新读取 current surface。
- **[推断]** 无论 DCP 与原生 compaction 的 listener 注册顺序如何，都不能依赖旧
  generation；E-03 测两种顺序。
- **[推断]** canonical placeholder + current surface membership 决定是否已经处理，
  多次 pre-step 或重启不会重复剪枝。
- **[推断]** manual mode 可关闭自动策略；它从成功的 `/dcp manual ...`
  command lifecycle 重放，而不是私有事件。

### 9.2 Deduplication（v0.1）

- **[事实]** tool name/raw arguments 在 `tool/call` 中可按 callId 与
  `tool/result` 配对；result content 可合法单节点替换。
- **[推断]** 对成功且未保护的调用，按 `tool name + 递归键排序后的 JSON 参数`
  分组，保留 current surface 上最后一次；非法 JSON 使用原始字符串的稳定签名。
- **[推断]** 对旧 result 先写 `compaction/prune`，再 content-only replace 为短文本，
  保留 callId、error/meta 与所有非 content 字段。
- **[推断]** replacement 文本说明“被哪个较新 call 取代”，但不复制新结果。
- **[推断]** 文件保护、工具保护、当前/最近 turn 保护先于 dedup。

### 9.3 Purge errors（实验，默认关闭）

- **[事实]** 仅替换 `tool/result` 无法清除 assistant tool-call arguments；原规划的
  “同上”映射错误。
- **[事实]** 在 N turn 后再写旧 turn 的 assistant replacement 会违反开放 step/token
  生命周期。
- **[需实验]** 候选实现按一个完整、配对平衡的旧工具单元做 model-free
  `compaction/prune + user/message replace`：删除参数，只把工具名、精确错误文本、
  必要相邻 assistant 文本和非目标 tool 结果写入确定性 checkpoint。
- **[推断]** 一个 assistant 含多个调用时必须整体处理并保留所有非目标语义；无法形成
  小于原单元的确定性 checkpoint 时跳过。
- **[推断]** M3 原型通过 provider 序列化、pairing、token 与质量测试后才允许开启；
  v0.1 默认 `enabled: false`，不以错误的“只剪 output”冒充 parity。

### 9.4 Sweep

- **[事实]** tool-result replacement 在完全 idle、无开放 turn 时会被 session invariant
  拒绝。
- **[推断]** `/dcp sweep` 通过一个日志化 command + internal control followup 打开短
  turn；pre-step 消费 control、不把它送给模型，执行策略后若无其他输入则无 LLM call
  关闭 turn。
- **[需实验]** inbox/control 的崩溃恢复与“恰好一次或幂等重试”由 E-03 覆盖。

---

## 10. 命令与恢复语义

### 10.1 注册与并发规则

- **[事实]** 实际注册名为 `dcp` 和 `dcp-compress`；用户界面显示 `/dcp`、
  `/dcp-compress`。
- **[推断]** 只读命令可在 agent 活跃时运行；直接 surface mutation 使用同步接纳的
  `runMaintenance()`，busy 时返回错误；需要开放 turn 的操作使用 control followup。
- **[推断]** 命令输出不作为模型消息；凡需要模型行动的 `/dcp compress [focus]`
  使用 `agent.followup()` 发送有 source 的真实用户上下文，随后由 agent-loop 落日志。

### 10.2 v0.1 命令表

| 命令                                  | 类别       | 行为                                                                     |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `/dcp help`                           | **[推断]** | 静态帮助与协议版本                                                       |
| `/dcp context`                        | **[推断]** | 当前 header/surface/blocks/marker/压力估算，不变更会话                   |
| `/dcp stats`                          | **[推断]** | 会话重算统计 + storage-domain 聚合/陈旧提示                              |
| `/dcp manual [on\|off\|status]`       | **[推断]** | 由成功 command pair 重放状态；下一 marker 告知模型                       |
| `/dcp sweep [all\|last=N]`            | **[推断]** | control turn 中运行 dedup/可用策略                                       |
| `/dcp compress [focus]`               | **[推断]** | followup 提示模型在下一 turn 选择闭合范围                                |
| `/dcp show <bN> [--raw]`              | **[推断]** | 只读展示摘要、metadata、直接 shadowed 节点或递归叶节点                   |
| `/dcp decompress <bN>`                | **[推断]** | 默认等同只读 raw show，并明确“未改变模型上下文”                          |
| `/dcp decompress <bN> --into-context` | **[推断]** | 显式单节点语义展开，见下文                                               |
| `/dcp recompress <bN>`                | **[推断]** | 只对 active semantic expansion 恢复摘要，分配新 block ref 并关联旧 block |

### 10.3 Decompress 的准确边界

- **[事实]** raw source events 永远留在 append-only log；人类命令可以读取并按
  replacement DAG 递归展示。
- **[事实]** 当前 surface API 不能用一个 replace 恢复多条原始 role/tool 节点。
- **[推断]** `--into-context` 把原转录按明确标头序列化为一个
  `dcp-expansion` user message，替换 active block；文本必须声明它是 quoted transcript，
  不是原角色重放。
- **[推断]** expansion 的 source metadata 记录 block ref/checkpoint seq/leaf seqs；
  `recompress` 用 standalone compaction bracket 将这一节点替回旧摘要，分配新的
  `bN`，并以 `recompressedFrom` 指向旧 block，避免一个 ref 对应多个历史 checkpoint。
- **[推断]** 已被 native/DCP 上层摘要吸收的 inactive block 只能 show，不能在旧位置
  expand；不得把内容追加到尾部并声称恢复。
- **[推断]** 若未来产品必须 exact decompress，先向宿主提“一个节点原位替换为多个
  已有/新节点”的正式 API 与计量/来源契约；v0.1 不因此 fork 核心。

---

## 11. 与原生 compaction 的共存

- **[事实]** native compaction 可选择并遮蔽任何当前 surface span，包括 DCP
  checkpoint、marker、nudge 和 expansion。
- **[推断]** DCP 每次读取状态都按当前 surface membership 重分类，而不是只监听
  `compaction/summary` 后“复位 nudge”。
- **[推断]** 遇到 live unmatched `compaction/start`，DCP compress 返回 busy；DCP 的
  同步 bracket 也使 native writer 看见同一锁。
- **[推断]** native checkpoint 遮蔽 DCP block 后，该 block 标为
  `absorbed-native`，refs 失效，统计不把 native 节省算成 DCP。
- **[推断]** native compaction 遮蔽 boundary 后，下一个 pre-step 重建 refs/alias；
  在此之前 compress 对陈旧 ref fail closed。
- **[推断]** DCP 不关闭、不替换 `ctx.compaction` provider，也不劫持 `/compact`。
- **[需实验]** 两者的 hook 顺序、overflow recovery、manual maintenance 与 crash
  bracket 组合必须在 E-03 和 e2e 共存场景中全绿。

---

## 12. 功能映射与版本分层

| 参考功能                         | dsh-dcp 映射                                     | 版本/状态                               |
| -------------------------------- | ------------------------------------------------ | --------------------------------------- |
| range compress                   | compaction transaction + user replace            | **[需实验]** M0/M1 主路径               |
| message compress                 | 仅无 tool-call 的安全单节点或闭合单元            | **[推断]** M2 experimental              |
| nested blocks                    | replacement DAG + `consumedBlockRefs`            | **[推断]** M2                           |
| message refs                     | step cut marker 或 `dcp_context`                 | **[需实验]** E-02 决定                  |
| block refs                       | source metadata +摘要 footer `bN`                | **[推断]** M1/M2                        |
| dedup                            | `compaction/prune` + tool-result content replace | **[推断]** M3                           |
| purge-errors                     | 完整平衡单元 deterministic prune                 | **[需实验]** M3，默认关闭               |
| protected tags/tools/files/users | prepare 阶段的 hard protect/verbatim appendix    | **[推断]** M2                           |
| subagent result                  | 父 surface 工具/source 保护                      | **[推断]** M2；child enrichment 延期    |
| nudge                            | boundary marker 或按需工具结果                   | **[需实验]** E-02/M3                    |
| manual mode                      | 成功 command lifecycle 重放                      | **[推断]** M3/M4                        |
| decompress                       | raw show + opt-in semantic expansion             | **[推断]** M4；exact 延期               |
| all-time stats                   | 日志重算 + storage-domain 可重建缓存             | **[推断]** M4                           |
| request transform                | 不实现                                           | **[事实]** 与 agent-loop invariant 冲突 |
| self-update/UI notification      | 不实现                                           | **[推断]** 非目标                       |

---

## 13. 模块与仓库结构

**[推断]** 目标结构如下；M0 后按实际公开 import 边界微调。

```text
dsh-dynamic-context-pruning/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ tsdown.config.ts
├─ cordis.patch.yml
├─ LICENSE
├─ NOTICE
├─ README.md
├─ AGENTS.md
├─ docs/
│  ├─ PLAN.md
│  ├─ PROTOCOL.md
│  └─ ROADMAP.md
├─ src/
│  ├─ index.ts                      # plugin 注册与 scoped lifecycle
│  ├─ config.ts                     # schema、默认值、热更新边界
│  ├─ protocol/
│  │  ├─ metadata.ts               # source metadata v1 decoder/encoder
│  │  ├─ replay.ts                 # raw log + surface → DcpReplayState
│  │  ├─ transaction.ts            # compaction/prune 相邻协议
│  │  ├─ replacements.ts           # DAG、active/absorbed/expanded
│  │  └─ recovery.ts               # orphan/partial commit 分类
│  ├─ refs/
│  │  ├─ marker.ts                 # marker/alias 构造
│  │  ├─ resolver.ts               # ref → surface position
│  │  └─ context-tool.ts           # E-02 备选
│  ├─ compress/
│  │  ├─ schema.ts
│  │  ├─ prepare.ts
│  │  ├─ commit.ts
│  │  ├─ inline-cleanup.ts
│  │  ├─ nested.ts
│  │  └─ protected.ts
│  ├─ strategies/
│  │  ├─ deduplication.ts
│  │  ├─ purge-errors.ts
│  │  └─ sweep-control.ts
│  ├─ prompts/
│  │  ├─ system.ts
│  │  ├─ nudge.ts
│  │  └─ command-followup.ts
│  ├─ commands/
│  │  ├─ index.ts
│  │  ├─ context.ts
│  │  ├─ stats.ts
│  │  ├─ manual.ts
│  │  ├─ sweep.ts
│  │  └─ recovery.ts
│  ├─ protection/
│  │  ├─ classify.ts
│  │  ├─ patterns.ts
│  │  └─ subagents.ts
│  ├─ stats/
│  │  ├─ session.ts
│  │  └─ domain.ts
│  └─ logger.ts
├─ tests/
│  ├─ contract/
│  ├─ unit/
│  ├─ integration/
│  ├─ fixtures/
│  └─ e2e/
├─ scripts/
│  ├─ check-all.sh
│  ├─ check-package.mjs
│  └─ perf-smoke.mjs
└─ .github/workflows/
   ├─ ci.yml
   ├─ e2e.yml
   └─ release.yml
```

- **[推断]** 不再创建 `src/events.ts` 或以 `dcp/*` 为核心的 state apply 层。
- **[推断]** `protocol/` 不直接依赖 UI；纯 decoder/reducer 可用构造日志单测。
- **[推断]** dsh peer 版本范围在 M0 用实际发布包编译/运行后确定；rc 阶段不使用无
  上界的 `>=` 假定兼容。
- **[推断]** `cordis.patch.yml` 只挂载 DCP 所需服务，不包含任何 TUI/HTTP 组件；
  required 与 optional inject 以 M0 实测公开 API 为准。

---

## 14. 配置方案（v0.1 草案）

**[推断]** 只暴露已经有明确宿主语义的开关；E-02 候选模式在冻结前保留为
实验配置，不写入稳定 README。

```jsonc
{
  "enabled": true,
  "debug": false,

  "compress": {
    "enabled": true,
    "mode": "range",
    "maxRangesPerCall": 3,
    "minNetSavingsTokens": 256,
    "retainRecentTurns": 2,
    "protectUserMessages": false,
    "protectTags": true,
    "protectedTools": ["subagent", "skill", "todo_write"],
    "protectedSources": ["subagent-report", "subagent-settled"],
  },

  "references": {
    "transport": "auto",
    "maxAliasEntries": 32,
    "excerptChars": 80,
  },

  "nudge": {
    "enabled": true,
    "maxRatio": 0.8,
    "minRatio": 0.6,
    "frequencySteps": 8,
    "iterationThreshold": 12,
  },

  "manualMode": {
    "default": false,
    "automaticStrategies": true,
  },

  "strategies": {
    "deduplication": {
      "enabled": true,
      "protectedTools": [],
    },
    "purgeErrors": {
      "enabled": false,
      "turns": 4,
      "protectedTools": [],
    },
  },

  "protectedFilePatterns": [],
  "subagents": {
    "enableCompressionInChild": false,
    "readChildSession": false,
  },
}
```

- **[推断]** ratio 必须满足 `0 < minRatio < maxRatio < 1`；整数必须有合理上限，
  glob/字符串数组去重并限制总长度。
- **[推断]** 删除原草案 `compress.permission`：是否 ask/deny 由宿主工具 policy/approval
  决定；`compress.enabled` 只决定注册/可用性。
- **[推断]** 删除 `pruneNotification`、`showCompression`、`summaryBuffer` 等尚无稳定
  dsh 语义的键，避免配置先于行为。
- **[推断]** `ctx.settings.register('dcp', schema)` 是唯一 v0.1 配置入口；热更新若
  改变工具 schema/system guidance，接受并测试一次真实 header change。
- **[推断]** `manualMode.default` 仅用于没有成功 manual command 的会话；命令状态
  是 session-local，配置变化不覆盖已显式选择。

---

## 15. 里程碑与测试驱动实施

### M0 — 宿主契约证伪

- [ ] **[需实验]** 搭建最小 TypeScript/vitest fixture，只实现 §4 三个实验所需代码。
- [ ] **[需实验]** 记录 dsh commit、包版本、公开 import 路径与每个观察结果。
- [ ] **[需实验]** 给 E-01/E-02/E-03 写 decision record：pass/fail、选中候选、被拒
      候选及证据。
- [ ] **[推断]** 把通过的 spike 测试迁入正式 contract suite；失败分支保留回归。

验收：三个实验都有可重复命令和机器断言；D4/D6/D7 的状态已冻结，或明确阻塞并缩减
范围。未通过不得把原规划的事件协议直接搬进 M1。

### M1 — 脚手架、协议与单块 range 链路

- [ ] **[推断]** package、tsconfig、tsdown、vitest、oxlint/prettier、CI、LICENSE/NOTICE。
- [ ] **[推断]** metadata v1 decoder、surface/replacement replay、diagnostics。
- [ ] **[推断]** settings schema；静态 DCP guidance；选定的 boundary transport。
- [ ] **[推断]** exclusive `compress` range：单个 half-open range、校验、净节省、
      一笔事务、结构化结果。
- [ ] **[需实验]** 若 E-01 通过，落地 inline cleanup；否则实现 decision record 选定的
      替代策略，不同时维护两套未验证路径。
- [ ] **[推断]** `/dcp help`、`/dcp context` 最小只读命令。

验收：构造会话 → 模型 native `compress` → checkpoint 出现在旧位置 → 下一请求不含
shadowed range 且逐字节可重建；重启和“未加载 DCP 逻辑”均能读 session；token
measure/projection 一致。

### M2 — 多范围、嵌套与保护

- [ ] **[推断]** 多 range 独立事务、partial-result 语义、surface-position 排序。
- [ ] **[推断]** block refs、replacement DAG、nested appendix、active/inactive 分类。
- [ ] **[推断]** hard/verbatim/atomic 保护分类；tag、工具、路径、用户消息。
- [ ] **[推断]** 父 surface 的 subagent/job/report 保护，不读 child session。
- [ ] **[需实验]** 安全子集的 message mode；任何 tool-bearing 节点仍走完整 unit/range。
- [ ] **[推断]** session stats（不含 domain 聚合）。

验收：两层/三层嵌套、non-monotonic seq、受保护内容过大 no-op、batch 部分失败、
native checkpoint 混入范围均有测试；无原始事件被删除。

### M3 — 自动策略、nudge 与 manual 状态

- [ ] **[推断]** dedup 签名与 content-only replacement，相邻 shadow price。
- [ ] **[需实验]** purge-errors 完整平衡单元原型；通过后仍默认关闭。
- [ ] **[推断]** boundary/按需 transport 上的 nudge + hysteresis。
- [ ] **[推断]** 成功 command lifecycle 重放 manual mode。
- [ ] **[推断]** internal control turn 与 `/dcp sweep`。
- [ ] **[推断]** 两种 pre-step listener 挂载顺序的集成测试。

验收：策略幂等、重启一致、protected skip、busy/abort、无 LLM 的 sweep turn、无
request-header churn；purge 未通过时保持 disabled 且不影响 M3 其余交付。

### M4 — 命令、恢复、共存与聚合统计

- [ ] **[推断]** `/dcp stats/manual/compress/show/decompress/recompress/help` 全部命令。
- [ ] **[推断]** raw replacement DAG 展示与 semantic expansion/recompress。
- [ ] **[推断]** storage-domain per-session aggregate 与追平逻辑。
- [ ] **[推断]** orphan/partial commit diagnostics、fork/restart 规则。
- [ ] **[需实验]** native compaction 共存全矩阵；inactive/absorbed refs 的用户提示。
- [ ] **[推断]** `docs/PROTOCOL.md` 固化事件相邻关系、source schema、恢复限制。

验收：每个命令快照稳定；exact decompress 不被误报；native compaction 前后 state、
refs、nudge、stats 均重放一致；所有故障点有可预测诊断。

### M5 — 加固、文档与发布

- [ ] **[推断]** 全量单元/集成/e2e、property/fuzz、性能与长会话回归。
- [ ] **[推断]** README、PROTOCOL、AGENTS、ROADMAP、CHANGELOG、迁移/兼容说明。
- [ ] **[推断]** 构建产物、exports、声明、bundle patch、git 源安装检查。
- [ ] **[推断]** 本地与 CI `check-all.sh --coverage --e2e` 全绿。
- [ ] **[推断]** 发布 `v0.1.0-rc.1`，列出 exact decompress、Code Mode、child deep read
      等已知限制。

---

## 16. 测试策略

### 16.1 TDD 硬规则

1. **[推断]** 每个功能/修复先提交失败测试，再做最小实现；协议文本先有快照。
2. **[推断]** 用户不承担测试、mock、fixture、CI 或故障排查工作。
3. **[推断]** 每个里程碑只以自动门禁验收，不设“人工点一下”项目。
4. **[推断]** 任意 surface/protocol 改动必须运行 request reconstruction、token
   projection、restart 和 native coexist 回归。
5. **[推断]** 发现宿主契约不同于规划时，先补证伪测试和 decision record，再改实现。

### 16.2 单元测试

```text
tests/unit/
  metadata.spec.ts              # v1 decode、未知版本、畸形 fail closed
  replay.spec.ts                # 冷/增量等价、active/absorbed/expanded
  replacement-dag.spec.ts       # 嵌套、cycle、递归 leaves
  refs.spec.ts                  # half-open、surface position、陈旧 alias
  boundary-marker.spec.ts       # 格式与 source 快照
  range.spec.ts                 # 反序/重叠/tail/protected/pairing
  nested.spec.ts                # consumed blocks 与 appendix
  protected-tags.spec.ts        # 多段、未闭合、delimiter 攻击
  protected-tools.spec.ts       # tool/path/source 分类
  inline-cleanup.spec.ts        # 仅 summary 变化、多个 calls
  dedup.spec.ts                 # canonical JSON、非法 JSON、最后一次
  purge-errors.spec.ts          # 完整单元、精确错误、默认关闭
  nudge.spec.ts                 # ratio、hysteresis、无容量、重放
  manual-mode.spec.ts           # run/done 配对、失败命令不生效
  stats.spec.ts                 # 可重算、native 排除、幂等追平
  config.spec.ts                # 默认、边界、未知键、热更新
  commands/*.spec.ts            # 解析与输出快照
```

### 16.3 Contract / integration 断言

- **[事实]** 核心断言：每次 loop-built request 的 JSON messages 等于该 dispatch
  时刻 `deriveMessages()`，header 也等于 folded `request/header`。
- **[推断]** 每个 replace 断言：目标为 current surface position、source seq 完整、
  tool-result 仅 content 变化、shadow-price 紧邻且范围/价格一致。
- **[推断]** 每次 mutation 后断言：`measure().surfaceTokens === sum(nodes.tokens)`；
  context-breakdown message tokens 相等；projected delta 与全量 fold 相等。
- **[推断]** 使用真实 Session、invariant companions、token meter 与最小 Cordis
  composition，不用宽松 mock 掩盖 append 约束。
- **[推断]** persistence round-trip 至少覆盖：插件加载、插件逻辑未加载、fork seed、
  crash orphan、未知 metadata 版本。
- **[推断]** tool pipeline 覆盖 allow/deny/abort/timeout、exclusive barrier、同 assistant
  多 call、Code Mode 子调用拒绝。
- **[推断]** native compaction 覆盖两种 hook 顺序、pressure、manual `/compact`、
  overflow recovery 与 DCP block 被吸收。

### 16.4 Property / fuzz

- **[推断]** 随机生成合法 surface append/replace 序列，比较冷 fold 与增量 reducer。
- **[推断]** 随机生成 non-monotonic seq surface，验证 resolver 只按位置。
- **[推断]** 随机故障点验证“未落 replace 无 active block；已落 replace 不丢失”。
- **[推断]** 随机 tool-call/result 图验证所有允许 range cuts 配对平衡。
- **[推断]** 对 metadata/tag/parser 做 JSON/text fuzz，保证不抛出未分类异常、不越界、
  不把畸形控制文本当授权。

### 16.5 E2E

- **[推断]** `e2e-install`：隔离 DSH_HOME 安装、本地 bundle 挂载、dump config。
- **[推断]** `e2e-native-compress`：脚本 adapter 产生独立 native `compress` call，下一请求验证
  shadow/cleanup/invariant。
- **[推断]** `e2e-nested-restart`：两层 block、退出、恢复、再压缩。
- **[推断]** `e2e-strategies`：dedup、control sweep、purge disabled/enabled 实验。
- **[推断]** `e2e-commands`：只读、busy、followup、show、semantic expand/recompress。
- **[推断]** `e2e-compaction-coexist`：原生压缩先/后遮蔽 DCP artifacts。
- **[推断]** `e2e-fault-recovery`：可注入 append/flush 中止时验证诊断。
- **[推断]** 可选 `e2e-real-model`：仅有 API key 时运行，报告摘要质量与 cache usage，不作为
  普通 PR 的强制门槛。

### 16.6 覆盖率、快照与性能

- **[推断]** `protocol/replay`、refs/range、nested/protection、strategies、config 的
  行覆盖率均不低于 85%；分支覆盖率作为报告，M2 后设基线。
- **[推断]** system guidance、marker、tool output、placeholder、命令文本使用快照；
  更新快照必须在提交说明中解释协议变化。
- **[推断]** perf smoke 构造 200/1000 surface 节点与多层 replacement；断言近线性
  增长并设宽松 wall-clock 防退化，不用脆弱的单机绝对毫秒数替代复杂度检查。
- **[推断]** 长会话测试统计 marker/context overhead、header change 次数和 domain
  checkpoint 大小，防止“压缩插件自身无限增长”。

---

## 17. 本地门禁与 CI

### 17.1 命令

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm run check:package

bash scripts/check-all.sh
bash scripts/check-all.sh --coverage
bash scripts/check-all.sh --e2e
```

### 17.2 顺序

**[推断]** `check-all.sh` 任一步失败即停：

1. **[推断]** typecheck；
2. **[推断]** oxlint + prettier check；
3. **[推断]** unit + contract + integration；
4. **[推断]** build；
5. **[推断]** package exports/declarations/bundle check；
6. **[推断]** perf smoke；
7. **[推断]** 可选 coverage；
8. **[推断]** 可选 e2e。

### 17.3 CI

- **[推断]** `ci.yml` 在 push/PR 跑 Node 22、锁定 pnpm、typecheck/lint/test/build/
  package/perf/coverage。
- **[推断]** `e2e.yml` 使用隔离 DSH_HOME、脚本 adapter、超时与 failure artifact；
  稳定子集在 PR 跑，全量可手动/定时跑。
- **[推断]** dsh rc 依赖使用 lockfile 与记录的兼容矩阵；升级 dsh 时先跑 M0 contract
  job，再允许普通 CI。
- **[推断]** `release.yml` 只在全部门禁通过的 tag 构建；public 仓库通过固定 tag 的
  git spec 安装。

---

## 18. 风险登记与停止条件

| 风险                                          | 类别         | 影响                          | 缓解/停止条件                                        |
| --------------------------------------------- | ------------ | ----------------------------- | ---------------------------------------------------- |
| 外置 writer 不被 compaction 协议支持          | **[需实验]** | 主路径不可提交                | E-01 失败即阻塞 range，提上游能力需求                |
| source 扩展字段被某 adapter/client 丢弃或拒绝 | **[需实验]** | 状态无法稳健关联              | round-trip/client 测试；失败则重新设计 metadata 载体 |
| inline summary 重复                           | **[事实]**   | 短期收益下降                  | 同一步 cleanup；失败时量化后决定辅助摘要             |
| dynamic index 破坏 prefix/cache               | **[事实]**   | 成本、日志增长                | 静态 system + E-02 marker/tool                       |
| 任意 refs 切断工具配对                        | **[事实]**   | provider 请求非法             | half-open cuts + 宿主 pairing helper                 |
| exact decompress 不可实现                     | **[事实]**   | 功能不对等                    | 明确 show/semantic expansion；不虚假验收             |
| purge-errors 不能晚改 assistant               | **[事实]**   | 原映射无效                    | 完整单元实验，默认关闭                               |
| native compaction 吸收 DCP artifacts          | **[事实]**   | refs/state/nudge 陈旧         | surface membership reconciliation                    |
| partial bracket                               | **[事实]**   | busy 或可见未闭合摘要         | 无 await commit、fault tests、recovered 状态         |
| pre-step listener 顺序                        | **[推断]**   | stale selection/重复 mutation | downstream decision、每次重校验、两种顺序测试        |
| child session 不存在                          | **[事实]**   | 保护内容缺失                  | 父 surface 为主，深读取 opt-in                       |
| Code Mode 无法清理内联参数                    | **[推断]**   | 重复/错误关联                 | v0.1 拒绝子调用                                      |
| marker 自身增长                               | **[推断]**   | 抵消节省                      | delta、同范围被压缩、长会话预算                      |
| rc API 漂移                                   | **[事实]**   | 编译/运行破坏                 | 锁版本、M0 contract 先行                             |
| 参考实现为 AGPL-3.0                           | **[事实]**   | 许可选择与发布义务            | §19 决策门，不作法律结论                             |

停止条件：出现 request reconstruction desync、工具配对破坏、无 shadow price replace、
不可重放状态或跨重启静默丢失时，立即停止功能扩张，先修协议与回归测试。

---

## 19. 版本、许可与发布

- **[事实]** 参考实现仓库使用 GNU AGPL v3 许可证。
- **[推断]** 在 M1 写可发布代码前，由仓库所有者明确选择：
  采用 `AGPL-3.0-or-later`；或在有充分 clean-room/法律判断的前提下选择其他许可。
  本计划不把“行为兼容”自动判定为某种法律结论。
- **[推断]** 无论选择何种许可，`NOTICE` 记录参考项目、版本、仅参考的行为/架构范围；
  提示词使用自有措辞，代码独立实现。
- **[推断]** 版本从 `0.1.0-rc.1` 开始；PROTOCOL v1 一旦发布，metadata 字段只做
  向后兼容扩展，破坏性变化提升协议版本并保留旧 decoder。
- **[推断]** 发布说明必须列明：支持的 dsh 版本、boundary transport、purge 默认、
  exact decompress/Code Mode/child deep-read 限制、与原生 compaction 的测试矩阵。

---

## 20. 方向性结论与决策门摘要

1. **[推断]** 不改变“模型可见即日志”方向，不采用请求时 rewrite。
2. **[推断]** 不扩展或 fork dsh 核心来启动 v0.1；先验证公开 compaction/surface
   契约，缺口只阻塞对应功能。
3. **[推断]** 撤销 `dcp/* log-only + ignorable` 作为既定架构，改由已知事件、
   replacement source 与 command lifecycle 承载。
4. **[推断]** range 默认使用闭合 step cuts/half-open 区间；逐消息压缩仅保留安全
   子集，边界 transport 由 E-02 决定。
5. **[需实验]** v0.1 摘要由当前模型内联生成，必须证明同一步参数 cleanup 与净
   token 收益；若不能则缩减或阻塞此路径。辅助 compaction 调用需另立契约实验，
   不是自动 fallback。
6. **[推断]** exact multi-message decompress 延期，不通过语义近似伪造“精确恢复”。
7. **[推断]** 原生 compaction 是同一 surface 的共同写者；必须共享锁语义、重放
   reconciliation 和 token 口径，而不是只清一个内存 nudge anchor。

只有 E-01、E-02、E-03 的证据与决定落盘后，本文中标为“需实验”的对应部分才能转为
实现承诺。

---

## 21. 实现时必读资料

- **[事实]** 本仓库：`AGENTS.md`、`README.md`、本计划、M0 decision records。
- **[事实]** dsh：
  - `docs/architecture.md`
  - `docs/agent-lifecycle.md`
  - `docs/tool-execution-pipeline.md`
  - `packages/core/agent-loop/src/invariant.ts`
  - session `types.ts` / `index.ts` / `surface.ts` / invariant
  - compaction service README、types、invariant 与 basic region transaction
  - token-meter surface projection 与 measurement fold
  - tools、commands、system-prompt、subagent、storage-domain 文档
- **[事实]** 参考实现 v3.1.15：range/message pipeline、state、refs、strategies、protected
  content、commands、tests；只提取行为与测试意图，按 §19 执行许可决策。
