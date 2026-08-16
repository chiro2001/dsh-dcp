# CHANGELOG

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
