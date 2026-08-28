# dsh-dcp 协议（v1）

> 状态：M4 固化。宿主基线：`@deepseek-ai/*@0.1.1-rc.2`。
> 本文定义模型可见内容如何由日志重建、压缩块如何落地、边界如何解析、
> 命令与恢复语义，以及原生 compaction 的共存规则。

## 1. 核心不变式

- agent-loop 请求的 `messages` 必须与 `session.deriveMessages()` 逐字节一致；
  system/tools 必须与最新 `request/header` 一致。
- dsh-dcp **不做请求时改写**；一切模型可见内容先成为已知 surface 事件。
- 不写 `dcp/*` 自定义 SessionEvent（公开 append 不支持，M0 E-01 锁定）。

## 2. 边界协议（E-02 决策：候选 B）

- 每个 step 入口追加一条日志化 boundary marker：
  `<dcp-boundary ref="mNNNN" turn="T" step="S" />`（user message，
  source.plugin = `dsh-dcp`）。
- 原生 compaction 遮蔽 marker 后，下一条 marker 追加 alias delta：
  `alias mNNNN=s<seq>`（seq 为遮蔽它的原生 checkpoint 节点），保持旧引用可解析。
- 引用一律按 **surface position** 解析，绝不按 seq 数值大小。
- range 是 half-open：`[startRef, endRef)`；endRef 节点本身不被压缩。
- 活跃压缩块也是边界：`bN` 可作 startRef/endRef（嵌套压缩）。
- 陈旧/无效引用 fail closed，工具返回最近合法 cuts 的提示，不扩大范围。

## 3. 压缩块与持久协议

一次 range 压缩的日志顺序（同步、无 await 提交）：

```text
compaction/start      { compactionId, turn }
compaction/summary    { compactionId, summary, shadowedRange,
                        shadowedSeqs, shadowedTokenCount,
                        provider, model }
user/message          source = compaction checkpoint + dcp metadata v1
                      surfaceOp = replace(start, end)
                      sourceEventSeqs = 全部被遮蔽 surface 节点
compaction/end        { compactionId, turn }
```

### dcp metadata v1（`user/message.source.dcp`）

```ts
{
  v: 1,
  kind: 'summary' | 'expansion',
  blockRef: `b${number}`,
  mode: 'range' | 'message',
  topic: string,
  startRef: string,
  endRef?: string,
  authorMessageId: string,
  compressCallId: string,
  consumedBlockRefs: string[],
  protectedKinds: string[],
  recompressedFrom?: `b${number}`
}
```

- 未知版本/畸形 metadata 不阻止会话加载：该消息按普通受保护内容处理，
  禁止 DCP mutation，并输出诊断。
- 摘要正文只保存在 `compaction/summary.summary` 与 replacement message
  content；`tool/call` 保留模型原始参数形成审计链。
- 相邻 shadow price：`compaction/summary`（压缩）或 `compaction/prune`
  （剪枝/恢复）必须紧邻其定价的 replace，否则持久 projection 会漂移。

### 崩溃分类

`none / live-orphan-start / stale-orphan-start / summary-without-replace /
recovered-unclosed / committed / failed-attempt`（M0 E-03 锁定）。
`session/end-seed` 之后的未闭合 bracket 是陈旧孤儿，不阻塞。

## 4. compress 工具

- exclusive 调度，走宿主 approval；config `compress.enabled=false` 时不注册。
- 参数：`topic` + `content[]`（`startRef`、`endRef`、`summary`）。
- 一次可传多个 non-overlapping、已闭合的 range；每个 range 各自独立提交，
  工具按当前 surface 逐笔重解析，失败项返回 partial result。
- 校验：refs 可解析、范围按 surface 顺序且不重叠、两侧 cuts 工具配对平衡、
  不进入最近 `retainRecentTurns` 个 turn、不含当前 compress 调用、
  不含硬保护（instructions/snapshot）、净节省 ≥ `minNetSavingsTokens`；
  summary 必须包含实际技术正文、不得以 `[bN]` 块引用前缀开头（schema 拒绝，
  checkpoint 构造时也会剥离，blockRef 只能由 `<dcp-message-id>` 表达），
  也不允许写 `[stored in bN]` 这类指针式占位作为摘要正文。
- 多 range 各自独立事务；批内后续 range 在提交时按当前 surface 重解析；
  失败项返回 partial result，不伪造跨 range 原子性。
- 嵌套：范围内 active `bN` 被消费，旧摘要 verbatim 保留在
  `Included prior blocks` 附录。
- inline 摘要参数在同一步清理为 `[stored in bN]`（保留 block/callId 与
  message id）。

## 5. 自动策略（pre-step）

- 只在下游 decision 为 `enter`、signal 未 abort、开放 turn 存在时执行。
- `tool/result` 剪枝：`compaction/prune` + content-only replace（保持
  message id 与除 content 外所有字段）；开放 turn 且无 step 时合法（M3 契约）。
- 幂等：只处理 `surfaceOp === 'append'` 的原始结果；replacement 节点跳过。
- dedup：工具名 + 规范化 JSON 参数分组，保留 surface 上最后一次。
- purge-errors：完整平衡单调用单元原型，v0.1 默认关闭。
- manual 模式下 `manualMode.automaticStrategies=false` 时策略不运行。

## 6. 命令与 control turn

- `/dcp help|context|stats|manual [on|off|status]|compress [focus]|sweep|
show <bN> [--raw]|decompress <bN> [--into-context]|recompress <bN>`
- 命令结果不进模型历史；`command/run`/`command/done` 落日志。
- manual 状态由成功 command lifecycle 对重放（不是私有事件）。
- 需要 mutation 的命令（sweep、expand、recompress）通过
  `<dcp-control>...</dcp-control>` followup 打开 control turn；pre-step 消费
  控制消息、执行 mutation、返回 `enter([])`，不产生模型请求。
- `/dcp decompress <bN>` 默认只读 show；`--into-context` 生成 quoted
  transcript 的 semantic expansion（新 `bN`，kind=`expansion`），不是精确
  原角色重放；`/dcp recompress <bN>` 用新 `bN`（`recompressedFrom`）恢复摘要。

## 7. 与原生 compaction 共存

- 原生 compaction 可遮蔽 DCP block/marker/nudge/expansion；DCP 每次读取都按
  surface membership 重分类：`active / consumed / absorbed-native / expanded`。
- DCP 不替换 `ctx.compaction`，不劫持 `/compact`；两者共享 compaction
  bracket 锁语义；遇到 live unmatched `compaction/start`，DCP 返回 busy。
- 被 native 吸收的 refs 失效并提示；统计不把 native 节省算成 DCP。

## 8. 统计口径

- 会话统计从日志重算：shadowed / checkpoint / marker / prune / net saved；
  token 一律标为 heuristic estimate。
- 跨会话聚合走可追平的 store（`lastProcessedSeq` + aggregate），写失败只影响
  展示，不把已完成压缩改报失败。

## 9. 已知限制（v0.1）

- exact decompress（多节点原位恢复）不可实现；只提供 show 与 semantic
  expansion。
- Code Mode 子调用不执行 `compress`；message-mode 延后。
- 子代理 child-session 深读取默认关闭，只保护父 surface 可见结果。
- purge-errors 默认关闭（实验）。
