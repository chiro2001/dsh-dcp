# CHANGELOG

## Unreleased

- 修复 checkpoint 摘要可能被模型写入 `[bN]` 前缀的问题：
  `buildCheckpointText()` 现在会剥离开头的块引用标记；schema 也拒绝以
  `[b` 开头的 summary，并提示模型重写为实际技术正文。
- 强化模型提示/工具描述：明确一次可传多个 non-overlapping range、摘要必须
  是注入上下文的完整正文、不得使用 `[stored in bN]` 之类的指针占位。
- `docs/PROTOCOL.md`、`docs/STATS.md` 补充摘要正文规范与
  “区间压缩 token / inline-cleanup token”口径说明。
- 修复模型误读 inline-cleanup 的问题：compress 工具结果现在明确说明完整摘要
  保存在 checkpoint 中、`[stored in bN]` 只是清理标记；系统提示同步加入该
  语义说明，并把结果格式化为可单测的纯函数。

## 0.1.0-rc.6 (2026-08-28)

- **适配 dsh `0.1.1-rc.2`**：peer/dev 依赖从 `0.1.0-rc.6` 全部升至
  `0.1.1-rc.2`，并补齐新增的传递 peer（`dsh-attachment`、`dsh-brand`、
  `dsh-timeout`、`dsh-typert-protocol`、`dsh-atomic-write`、
  `dsh-home-paths`、`dsh-user-approval`、`dsh-code-runtime`），
  `pnpm peers check` 无告警。
- 适配 `commands.execute` 新签名（新增 `images` 参数）：更新
  agentloop/m7-topology/e2e-real 测试调用点。
- 兼容矩阵更新：实测支持 dsh `0.1.1-rc.2`（typecheck、lint、单测/集成
  79 项、build、check:package、真实模型 e2e 4 项全部通过）。

## 0.1.0-rc.5 (2026-08-18)

- 修复 dedup 替换丢字段导致 dsh 拒绝的回归：`applyDeduplication` 构造
  `tool/result` 替换事件时只带 `{turn, step, message}`，丢弃了原始事件中
  可选的非消息字段（如失败结果的 `error: {name, code}`），触发 dsh 的
  surface 不变量 `tool/result surface replacement may change only content`，
  会话在“继续”时直接报错并停止工作。现在替换事件保留原始 `data` 全部字段，
  仅替换消息 content。
- 新增回归单测：带 `error` 字段的重复工具结果可被 dedup 替换且不违反
  surface 不变量（旧代码该用例在 `session.append` 处抛出同样的错误）。

## 0.1.0-rc.4 (2026-08-16)

- round-0005 P0 关闭：
  - 生产拓扑：store 注册到外层 context，late-provide 后 `/dcp stats` 从
    unavailable 转 current（真实插件路径测试，不再手工注册）；
  - 三态状态机：`current | stale | unavailable` 带 reason/cursor/旧视图，
    log regression 不再误报 current；disposer await close；
  - ledger：marker 计入 `historyReduction`
    （`shadowed + prune - checkpoint + expansion - marker`）；
  - domain record schema 收紧并校验 ledger 方程（v1）；
  - 10-session 真实 JSON reopen 聚合测试。

## 0.1.0-rc.3 (2026-08-16)

- M6.3（round-0003 建议）：
  - Code Mode fail-closed：`run_code` 子调用在 mutation 前明确拒绝并单测；
  - 探针 oracle 重写：forced/autonomous/correction/nested 四组，结果如实记录
    （forced 8/10、autonomous 0/10、correction 2/5、nested 2/5）；
  - 净节省不足提示方向拆分（更大更旧区间或更紧凑摘要，不再建议“更小”）；
  - README/AGENTS/CHANGELOG 统一 public + 当前 tag + npm NO-GO。
  - M7.0 起步：统计改为 signed ledger（shadowed/prune/checkpoint/expansion/
    marker，historyReduction 不再 clamp，负值显示 overhead）；domain record v1
    （eventCount + ledger + updatedAt）；真实 dsh-storage-json 接线
    （DomainFacility/KvTable，动态子 fiber、可降级）；`/dcp stats` 展示
    session + persistent domain（current/stale/unavailable，单进程口径）；
    reopen 持久化集成测试。

### 决策

- autonomous 0/10：模型在无显式指令时不会自主调用 compress →
  **v0.2 不新增模型驱动模式**，维持 range 工具 + 手动/显式触发。
- correction 2/5、nested 2/5：结构错误后的自主恢复与嵌套触发可靠性不足，
  进入提示词/产品边界 backlog；不据此扩大模型驱动功能。

## 0.1.0-rc.2 (2026-08-16)

- M6.0 协议一致性第一批：
  - marker alias 接线：pre-step 在 native 遮蔽后生成 `alias mNNNN=s<seq>`，
    replay 消费 alias，resolver 经 alias 解析陈旧 ref；
  - ref 宽度放宽为 `m\d+`（支持 m10000）；
  - config fail-closed：`references.transport` 仅支持 marker，
    `subagents.*` 未支持项直接拒绝；`enabled=false` 时不再注册；
  - nudge 补 minRatio 重置与无容量迭代阈值；
  - 会话统计排除 native compaction shadow price；
  - multi-range inline cleanup 按下标映射，避免中间失败错位；
  - recovery 使用真实 request header 的 provider/model；
  - opencode-go 适配器支持嵌套 `content[]` XML 与全局唯一 call id；
  - 注册 `dcp-compress` 命令；peerDependencies 收窄为有界范围；
  - package.json 补 SPDX license / repository / publishConfig。
  - replay 不再对普通消息产生 metadata 误报诊断；
  - control mutation 失败写入日志；
  - deterministic AgentLoop 矩阵（scripted adapter：compress 主链路、
    control turn 零 LLM dispatch、重启重建、请求不变式由 invariant 强制）；
  - `check-all.sh --e2e` 真实执行 contract+integration+隔离安装；
  - 系统提示/帮助/checkpoint 文本快照。
  - 命令矩阵：非法参数 fail-closed、`dcp-compress` 注册；
  - inline cleanup 下标映射（部分失败不错位）。
  - deterministic AgentLoop 扩展矩阵：guard deny 无 DCP mutation、in-flight
    abort 无残留状态、单消息多 compress 各块独立提交与清理、native coexist
    alias 全链路（pre-step 生成 → replay 消费 → 经 alias 压缩成功）。
  - M6.1：长会话热路径门禁（1k/4k/16k/50k 近线性，暂不实现增量 replay）、
    真实 KV cache A/B（inconclusive）、marker 唯一性断言。
  - M6.2：dsh peers 精确锁定实测 rc.6、真实模型三场景探针（natural 9/10、
    correction 5/5、nested 5/5）、发布决策文档（GitHub 源正式；npm NO-GO）。

## 0.1.0-rc.1 (2026-08-16)

首个可安装里程碑。实现按修订版 PLAN（M0–M5）推进，全部以测试门禁验收。

### 新增

- **M0 宿主契约**：E-01 持久事务/计量/内联清理、E-02 边界协议（默认 marker）、
  E-03 崩溃/共存状态机全部通过并落 decision records。
- **压缩主链路（M1）**：`compress` 工具（exclusive + 宿主 approval）、
  half-open range、工具配对/保留/净节省校验、同步 compaction 事务、
  同一步 inline 摘要清理、`/dcp help|context`。
- **多范围/嵌套/保护（M2）**：批内独立事务与提交时重解析、`bN` 嵌套（旧摘要
  verbatim 保留）、硬保护（instructions/snapshot）、受保护工具/路径/来源、
  会话统计。
- **自动策略（M3）**：pre-step 去重与错误单元清理（默认关闭）、nudge
  （hysteresis，日志派生）、manual 模式重放、`/dcp manual|stats|sweep`。
- **恢复与命令（M4）**：`/dcp compress|show [--raw]|decompress
[--into-context]|recompress`、semantic expansion/recompression、跨会话聚合
  追平、`docs/PROTOCOL.md` v1 固化。
- **加固（M5）**：property/fuzz、覆盖率阈值、真实 perf smoke、e2e 安装冒烟、
  CI（typecheck/lint/test/coverage/build/package）+ e2e workflow。
- **真实 Agent e2e（本地）**：隔离 DSH_HOME + 真实 dsh agent-loop + opencode go
  `deepseek-v4-flash`；覆盖 compress 工具、边界 marker、命令生命周期。修复了
  pre-step marker 注入缺失、插件在缺 `commands` 服务时静默不激活两个真实缺口。

### 已知限制（v0.1）

- 无精确多节点 decompress（只提供 show / semantic expansion）。
- Code Mode 子调用不执行 `compress`；message-mode 延后。
- purge-errors 默认关闭；子代理 child-session 深读取默认关闭。
- 跨会话统计持久化（storage-domain）适配器已实现，真实后端接线在 e2e 矩阵
  中验证（v0.2 完成实机覆盖）。
