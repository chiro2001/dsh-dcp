# CHANGELOG

## Unreleased（v0.1.0-rc.2 准备）

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
