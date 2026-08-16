# AGENTS.md — dsh-dcp 开发/Agent 指南

本文件面向接手本仓库的 AI Agent 与开发者，是开发阶段的**硬性约定**。
使用者文档见 `README.md`；详细规划见 `docs/PLAN.md`。

## 项目是什么

dsh-dcp 是 DeepSeek Harness（dsh）的动态上下文管理插件：对标 opencode-dcp 的
原理与实现，提供模型驱动的上下文压缩、工具结果剪枝、错误输入清理、压缩块
嵌套、受保护内容保留、手动命令与统计。**纯上下文管理，不含 TUI/前端/HTTP
桥组件**，也不启动外部终端程序。

- 参考实现：`opencode-dynamic-context-pruning/`（本工作区兄弟目录，v3.1.15）
- 规划：`docs/PLAN.md`（当前唯一权威设计文档）
- 仓库：`chiro2001/dsh-dcp`（private）

## 硬性约束

1. **模型可见即日志**：`llm/stream` 请求的 `options.messages` 必须与
   `session.deriveMessages()` 逐字节一致（agent-loop invariant）。
   禁止“请求时临时改写/注入消息”的实现方式。
2. **不参考既有 TUI 插件**：项目存在一个目标不同的既有 TUI 前端插件（在 dsh
   进程内提供 HTTP/SSE 桥并拉起官方 TUI）。实现阶段**不要查看或复用它的代码
   与文档**；规划阶段已对齐背景，后续实现只依据 opencode-dcp 原理、dsh 官方
   扩展点与本仓库文档。
3. **人类可读文档不提及该 TUI 插件**：README、docs、AGENTS、expert-advice
   等一切人读文档中，不出现该插件的名称或路径；需要指代时用“既有 TUI 前端
   插件”。本约束同样适用于将来新增的文档。
4. **测试全权归实现 Agent**：用户不介入测试。写测试、跑测试、修测试、维护
   mock LLM/夹具/CI 都是开发工作的一部分；合并门槛 = 测试全绿。
5. **不修改 dsh 核心仓库**：只通过公开扩展点实现。

## 常用命令（M1 后逐步落地）

```bash
pnpm install
pnpm typecheck          # tsc --noEmit
pnpm lint               # oxlint + prettier check
pnpm test               # vitest（单测 + 集成）
pnpm build              # tsdown → lib/
pnpm run check:package  # 构建产物/入口/声明验证
bash scripts/check-all.sh            # 快速门禁
bash scripts/check-all.sh --e2e      # 全量门禁（含 e2e）
bash scripts/check-all.sh --coverage # 附加覆盖率门槛
```

门禁顺序：typecheck → lint → test → build → check:package → perf smoke →
（可选）coverage →（可选）e2e。任一失败即停。

## 测试驱动开发规则

- 每个功能/修复先写失败测试，再实现到通过；不把“先写代码后补测试”作为默认路径。
- 核心纯逻辑（状态重放、边界解析、策略、保护模式、配置）行覆盖 ≥ 85%。
- 命令输出与提示词文本用快照测试锁定格式；修改需显式更新快照并说明理由。
- 任何改动不得破坏“messages === deriveMessages()”集成断言。
- 每个里程碑（M1–M5，见 `docs/PLAN.md` §8）以测试门禁为验收，不设人工验收项。

## 顶级模型咨询流程（expert-advice）

流程约定与参考项目的“顶级模型困难求助”一致，本仓库按以下规则执行：

- 每轮使用不可覆盖的 `expert-advice/round-NNNN/`：
  `prompt.md`（请求与问题）、`context.md`（commit、输入文件、执行方式）、
  `response.md`（模型最终回复）、`decision.md`（执行 Agent 逐项处置）。
- 咨询以非交互 `codex exec` 启动：profile `sss`（已配置
  `model="gpt-5.6-sol"`、`model_reasoning_effort="max"`），沙箱
  `workspace-write`，`-C` 指向仓库根，`-o` 落盘 `response.md`，stdin 喂
  `prompt.md`。模型只允许写 `round-NNNN/` 目录：`revised-plan.md` 由模型
  直接写，`response.md` 由 CLI `-o` 自动落盘，不得改动源码、规划、测试或构建。
  精确命令见 `expert-advice/round-NNNN/context.md`。
- `prompt.md` 必须要求：对现状的反驳、最可能遗漏的风险、按信息增益排序的
  1–3 个实验、方向性判断、以及“事实/推断/需实验”三类标注。
- 顶级模型建议不是证明，不自动改变规划；执行 Agent 阅读 `response.md` 后写
  `decision.md`（accept/reject/defer + 理由），接受的建议必须落到
  `docs/PLAN.md` 或后续实现。
- 顶级模型不可用时只记录 `blocked.md` 与错误，不伪造回复、不阻塞主流程。
- 咨询属于异步顾问步骤，不阻塞主体开发；日常开发按 `docs/PLAN.md` 里程碑推进。

## 分支与提交规范

- `main`：稳定线；`develop`：集成交付线。
- 功能分支：`feat-*` / `fix-*` / `docs-*` / `perf-*` / `test-*` / `chore-*`。
- Conventional Commits：`feat/fix/docs/perf/test/chore/refactor`。
- 合并进入 `develop`/`main` 的唯一准入条件是 CI 与本地门禁全绿。

## 参考材料定位

- opencode-dcp 源码镜像：本工作区兄弟目录 `opencode-dynamic-context-pruning/`
- dsh 源码 checkout：`~/projects` 下名为 `deepseek-harness` 的目录
  （`find ~/projects -maxdepth 2 -type d -name deepseek-harness` 可定位；
  其父目录与既有 TUI 插件相邻，注意不要误入）
- 关键必读（开发前）：
  - `docs/architecture.md`、`docs/agent-lifecycle.md`、
    `docs/tool-execution-pipeline.md`
  - `packages/core/agent-loop/src/invariant.ts`（核心约束）
  - `docs/PLAN.md`（本仓库规划）

## 文档入口

- `docs/PLAN.md`：详细实现规划（架构、事件模型、功能映射、里程碑、测试/CI、
  配置、风险）
- `expert-advice/README.md`：咨询归档说明；`expert-advice/round-0001/`：首轮咨询
- `README.md`：使用者简介与范围说明
