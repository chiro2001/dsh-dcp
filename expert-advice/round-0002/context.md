# Round 0002 context — dsh-dcp 下一步方向审阅

## 仓库与当前状态

- 仓库根目录：`/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning`
- 当前 commit：`08d024c8f845092fd8c0e1f9c55ad1e67f470511`（`main`，
  `v0.1.0-rc.1` 已打 tag 并发布 GitHub Release）
- 仓库：`chiro2001/dsh-dcp`（private）；npm 包名 `@chiro2001/dsh-dcp`，
  安装走 `dsh plugin ... add chiro2001/dsh-dcp`（GitHub 源）
- 许可：AGPL-3.0-or-later + NOTICE（独立实现声明）

## 已实现能力（M0–M5 全部完成）

- 协议：边界 marker（pre-step 自动注入 `mNNNN`）、half-open range、`bN` 块引用、
  compaction 事务（start/summary/replace/end）、dcp source metadata v1、
  shadow price 相邻、崩溃分类 7 态、surface membership reconciliation
  （active/consumed/absorbed-native/expanded）。
- 压缩：`compress` 工具（exclusive + 宿主 approval）、工具配对/保留/净节省校验、
  多 range 独立事务、嵌套（旧摘要 verbatim 保留）、同一步 inline 摘要清理。
- 保护：用户消息/`<protect>`/受保护工具/文件路径/来源 verbatim 附录；
  instructions/snapshot 硬保护。
- 自动策略：dedup（幂等）、purge-errors（默认关）、nudge（hysteresis）、
  manual 模式（command lifecycle 重放）。
- 命令：`/dcp help|context|stats|manual|compress|sweep|show|decompress|recompress`；
  mutation 走 control turn。
- 恢复：raw show / semantic expansion / recompression（exact decompress 不承诺）。
- 跨会话聚合：store 适配器 + catch-up（真实 storage-domain 后端接线未做）。
- 真实 Agent e2e：隔离 DSH_HOME + `dsh-agent-loop-testkit` + AgentLoop +
  opencode go `deepseek-v4-flash`；自定义 LlmAdapter（非流式 chat.completions，
  含 XML `<invoke>` 工具调用解析）；key 取自 `~/litellm/.env` 不打印不落盘，
  无 key 自动跳过。

## 测试与覆盖率现状

- 本地全量：52 passed + 1 skipped（真实 e2e 无 key 时跳过）；lint/typecheck/
  build/package/perf/coverage 全绿；CI `ci` + `e2e` 最新提交均 success。
- 覆盖率（v8，行/语句/分支/函数）：84.23% / 81.88% / 71.93% / 86.13%；
  核心纯逻辑模块 ≥85%（protocol 97.7、refs 96.6、strategies 88、
  protection 92、config 95.2）。
- 薄弱区：`src/commands/*` 约 48.8%（部分文件 0–25%），`src/compress/tool.ts`
  约 4%，`src/index.ts` 约 42%，`pipeline.ts` 84.4%（接近门槛）。
- 真实 e2e 目前只有一条场景（compress 主链路 + 两个命令）；命令全族、
  自动策略、嵌套/恢复闭环、重启、原生 compaction 共存均未在真实模型下覆盖。

## 已知限制与开放问题

- message-mode 延后；Code Mode 子调用不执行 compress；子代理 child-session
  深读取默认关闭；purge-errors 默认关闭。
- exact decompress 不可实现（宿主 replace 只能单节点替换）；semantic
  expansion 是替代方案。
- replay 目前每次全量重放 O(n)（增量 fold 是 M3 遗留优化位）。
- 长会话 marker/上下文开销与 KV cache 影响没有实测。
- `compress` 权限语义：v0.1 只有注册开关，无 ask/allow/deny 映射。
- 真实模型工具调用可靠性依赖 prompt/纠正循环（网关返回 XML 文本格式）。
- 包只走 GitHub 源，未发 npm；profile 集成文档较简。

## 候选方向（待审阅）

- **A（优先真实回归矩阵）**：扩真实 e2e（命令全族、dedup/purge、嵌套/恢复、
  重启、原生 compaction 共存）+ 补 commands/tool/index 覆盖率到 90%+。
- **B（直接 v0.2 功能）**：message-mode 安全子集、storage-domain 实机接线、
  Code Mode 策略、子代理深读取。
- **C（性能/发布面）**：增量 replay、npm 发布决策、dsh 上游“单节点展开为
  多节点”提案、长会话 marker 开销与 KV cache 实测。

## 必读输入（按需读取）

- `docs/PLAN.md`（修订版，M0–M5 与决策门）
- `docs/PROTOCOL.md`（协议 v1）
- `docs/ROADMAP.md`、`docs/CHANGELOG.md`
- `tests/contract/DECISIONS.md`（M0 决策记录）
- `src/index.ts`、`src/compress/*`、`src/strategies/*`、`src/commands/*`
- `tests/e2e-real/agent.spec.ts`、`tests/e2e-real/opencode-go-adapter.ts`
- `README.md`、`AGENTS.md`

## 执行方式（本次咨询的等价命令）

流程沿用参考项目的顶级模型咨询流程（非交互 `codex exec`）。已核对本机 CLI：
`codex-cli 0.147.0`，profile `sss`（`model="gpt-5.6-sol"`、
`model_reasoning_effort="max"`）；`-o` 对应 `--output-last-message`。实际命令：

```sh
cd /home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning
codex -p sss \
  -c 'model="gpt-5.6-sol"' \
  -c 'model_reasoning_effort="max"' \
  -s workspace-write \
  -C "$PWD" \
  exec -o expert-advice/round-0002/response.md - < expert-advice/round-0002/prompt.md
```

`response.md` 由 CLI 落盘；`recommendation.md` 由模型在会话内直接写入。
执行 Agent 随后写 `decision.md`，并把接受的建议落到 `docs/ROADMAP.md` 或
后续实现。

## 禁止事项

- 不查看“既有 TUI 前端插件”项目（在 dsh 进程内提供 HTTP/SSE 桥并拉起官方
  TUI 的那个仓库），也不在本轮任何文档中写出其名称或路径。
- 不修改 `expert-advice/round-0002/` 之外的任何文件。
- 不执行 pnpm/npm/git 写操作、构建、测试或安装。

