# CHANGELOG

## 0.1.0-rc.3 (2026-08-16)

- M6.3（round-0003 建议）：
  - Code Mode fail-closed：`run_code` 子调用在 mutation 前明确拒绝并单测；
  - 探针 oracle 重写：forced/autonomous/correction/nested 四组，结果如实记录
    （forced 8/10、autonomous 0/10、correction 2/5、nested 2/5）；
  - 净节省不足提示方向拆分（更大更旧区间或更紧凑摘要，不再建议“更小”）；
  - README/AGENTS/CHANGELOG 统一 public + 当前 tag + npm NO-GO。

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
