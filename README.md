# dsh-dcp

DeepSeek Harness（dsh）的动态上下文管理插件：对标
[opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
（opencode-dcp）的原理与实现，在 dsh 上提供模型驱动的上下文压缩、工具结果剪枝、
错误输入清理、压缩块嵌套、受保护内容保留、手动命令与统计。

> **状态**：规划阶段。详细方案见 [docs/PLAN.md](docs/PLAN.md)。

## 范围说明

dsh-dcp 是纯**上下文管理**插件：不含任何 TUI、前端或 HTTP 桥组件，也不启动
外部终端程序。项目存在一个目标不同的既有 TUI 前端插件（在 dsh 进程内提供
HTTP/SSE 桥并拉起官方 TUI），它属于界面层；实现本插件时**不要直接查看或复用
该 TUI 插件的代码与文档**。dsh-dcp 的设计依据是 opencode-dcp 的原理与 dsh
官方扩展点文档，bundle 结构使用 dsh 插件标准格式
（`package.json#dsh.bundle` + `cordis.patch.yml`）。

## 安装预览

```bash
dsh plugin --profile web add chiro2001/dsh-dcp
```

安装源为 GitHub 私有仓库 `chiro2001/dsh-dcp`（npm 包名
`@chiro2001/dsh-dcp`，未发布 registry）。固定版本/分支：

```bash
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#v0.1.0-rc.1'
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#develop'
```

pnpm 对 git 源插件执行 `prepare` 构建（本包已声明 `prepare: pnpm build`），
必要时按 pnpm 提示在 profile 的 `pnpm-workspace.yaml` 放行
`esbuild`/`koffi` 构建脚本；`lib/` 构建产物也随仓库提交，保证直装可用。

安装后插件以 `dsh.bundle.patch` 声明的 `cordis.patch.yml` 挂载到 profile，
并注册：

- 模型工具 `compress`（range / message 两种模式）
- 系统提示 section（压缩规则、边界索引、nudge）
- 人类命令 `/dcp` 与 `/dcp-compress`
- `dcp/*` 会话日志事件与表面替换（`user/message`、`tool/result`）

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 详细实现规划（目标、架构决策、功能映射、
  模块设计、里程碑、测试、风险）
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — 协议 v1（边界、持久化、命令、恢复、
  与原生 compaction 共存）
