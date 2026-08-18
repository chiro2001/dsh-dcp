# dsh-dcp

DeepSeek Harness（dsh）的动态上下文管理插件：对标
[opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
（opencode-dcp）的原理与实现，在 dsh 上提供模型驱动的上下文压缩、工具结果剪枝、
错误输入清理、压缩块嵌套、受保护内容保留、手动命令与统计。

> **状态**：v0.1.0-rc.5 已实现并发布（public repo）。
> 详细方案见 [docs/PLAN.md](docs/PLAN.md)，协议见
> [docs/PROTOCOL.md](docs/PROTOCOL.md)，变更见
> [docs/CHANGELOG.md](docs/CHANGELOG.md)，下一阶段见
> [docs/ROADMAP.md](docs/ROADMAP.md)。

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

安装源为 GitHub 仓库 `chiro2001/dsh-dcp`（npm 包名
`@chiro2001/dsh-dcp`，未发布 registry）。固定版本/分支：

```bash
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#v0.1.0-rc.5'
dsh plugin --profile web add 'github:chiro2001/dsh-dcp#develop'
```

pnpm 对 git 源插件执行 `prepare` 构建（本包已声明 `prepare: pnpm build`），
`lib/` 构建产物也随仓库提交，保证直装可用。pnpm 11 默认禁止 git 源包执行
构建脚本，若安装报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，按报错提示把
**错误信息中打印的精确键**加入 profile 的 `pnpm-workspace.yaml`
（默认 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  '@chiro2001/dsh-dcp@https://codeload.github.com/chiro2001/dsh-dcp/tar.gz/<commit>': true
```

其中 `<commit>` 以报错里的 URL 为准、原样复制，保存后重新执行同一条
`dsh plugin ... add` 命令即可。若 pnpm 还拦截 `esbuild`/`koffi` 等依赖的
构建脚本，同样按提示追加对应条目。

安装后插件以 `dsh.bundle.patch` 声明的 `cordis.patch.yml` 挂载到 profile，
并注册：

- 模型工具 `compress`（range；message 模式延后）
- 系统提示 section（压缩规则、边界索引、nudge）
- 人类命令 `/dcp` 与 `/dcp-compress`
- 日志化边界 marker 与压缩检查点（标准 `user/message`/`tool/result`
  surface replace）

> 说明：v0.1 不写自定义 `dcp/*` 会话事件（宿主契约限制，见
> `tests/contract/DECISIONS.md`）；压缩/剪枝通过标准 surface replace 落地，
> 原始日志永不删除。

## 能力

- `compress` 工具：half-open range、工具配对校验、多 range 独立事务、
  `bN` 嵌套、同一步 inline 摘要清理。
- 保护：用户消息/`<protect>`/受保护工具/文件路径/来源 verbatim 附录；
  instructions/snapshot 硬保护。
- 自动策略：重复调用去重（pre-step，幂等）；错误单元清理（实验，默认关）。
- 命令：`/dcp help|context|stats|manual|compress|sweep|show|decompress|recompress`。
- 恢复：raw show 与 `--into-context` semantic expansion / recompress。
- 与 dsh 原生 compaction 共存（surface membership reconciliation）。

## 已知限制（v0.1）

- 无精确多节点 decompress；message-mode 与 Code Mode 延后。
- purge-errors 默认关闭；子代理 child-session 深读取默认关闭。

## 兼容矩阵

- 实测支持：dsh `0.1.0-rc.6`（M0 contract、deterministic AgentLoop、重启、
  e2e 安装、真实模型 smoke 全部通过）。
- 其他 dsh 版本：未实测前不进入 peer 范围（当前 peer 精确锁定
  `0.1.0-rc.6`）；新版本需先跑相同矩阵再扩范围。

## 自测

```bash
pnpm test                 # 单测/契约/集成（含真实 e2e 的跳过逻辑）
bash scripts/check-all.sh --coverage
pnpm run e2e:real         # 真实 Agent + 真实 LLM（opencode go / deepseek-v4-flash）
```

`e2e:real` 在隔离的临时 DSH_HOME 中运行，key 从 `~/litellm/.env` 读取且不打印、
不落盘；未配置 key 时自动跳过。本地 `/tmp` 受限时测试临时目录使用仓库内
`.tmp-vitest/`（已 gitignore）。

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 详细实现规划（目标、架构决策、功能映射、
  模块设计、里程碑、测试、风险）
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — 协议 v1（边界、持久化、命令、恢复、
  与原生 compaction 共存）
- [docs/STATS.md](docs/STATS.md) — 统计语义（signed ledger、domain record、
  `/dcp stats` 口径）
