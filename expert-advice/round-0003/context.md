# Round 0003 context — v0.2 范围与实施顺序审阅

## 仓库与当前状态

- 仓库根目录：`/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning`
- 当前 commit：`3989c8144d6440825b71f856b9315df4f5d0ead9`（`main`）
- 仓库：`chiro2001/dsh-dcp`（public；main + develop；tags rc.1/rc.2）
- 许可：AGPL-3.0-or-later + NOTICE；npm 发布 NO-GO（见 docs/RELEASE.md）

## 已完成（方向 D，round-0002 建议）

- M6.0：PROTOCOL v1 一致性（alias 全链路、config fail-closed、enabled 门、
  nudge/stats 语义、multi-range 映射、recovery header、adapter schema、
  dcp-compress、有界 peers）；deterministic AgentLoop 矩阵（compress/control/
  deny/abort/多 compress/native coexist/重启/请求不变式）；`check-all.sh
--e2e` 真实门禁；`v0.1.0-rc.2` 发布。
- M6.1：长会话热路径门禁（50k 事件 ~180ms，近线性，暂不实现增量 replay）；
  真实 KV cache A/B（inconclusive）；marker 唯一性断言。
- M6.2：dsh peers 锁定实测 rc.6；真实模型三场景探针（natural 10/10
  schema-valid、9/10 committed；correction 5/5；nested 5/5、prior-block 4/5）；
  发布决策（GitHub 源正式、npm NO-GO）。

## 当前已知待办/开放项

- storage-domain 实机接线：适配器（`src/stats/domain.ts`）已有单测，但未接
  `dsh-storage-json` 后端，`/dcp stats` 未展示聚合。
- message-mode 安全子集：config schema 当前拒绝 `message`；协议分支未实现。
- Code Mode：v0.1 无“mutation 前明确拒绝”的确定性测试。
- child-session 深读取：仅父 surface 保护，深读取 opt-in 未实现。
- 提示词优化：natural 探针 1/10 因微小 range 净节省不足失败；nested 1/5 未带
  `Included prior blocks` 标准段；KV cache 结论 inconclusive。
- purge-errors 默认关闭（实验）；exact decompress 不承诺。
- 版本：package.json `0.1.0-rc.2`；peer 精确 `0.1.0-rc.6`。

## 必读输入（按需读取）

- `expert-advice/round-0002/recommendation.md` 与 `decision.md`
- `docs/PLAN.md`、`docs/PROTOCOL.md`、`docs/ROADMAP.md`、`docs/RELEASE.md`
- `docs/real-model-probes-*.md`、`tests/contract/DECISIONS.md`
- `src/stats/domain.ts`、`src/compress/*`、`src/commands/*`、`src/index.ts`
- `README.md`、`AGENTS.md`、`docs/CHANGELOG.md`

## 执行方式

沿用专家咨询流程（非交互 `codex exec`，profile `sss`，gpt-5.6-sol / max /
workspace-write）。实际命令：

```sh
cd /home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning
codex -p sss \
  -c 'model="gpt-5.6-sol"' \
  -c 'model_reasoning_effort="max"' \
  -s workspace-write \
  -C "$PWD" \
  exec -o expert-advice/round-0003/response.md - < expert-advice/round-0003/prompt.md
```

`response.md` 由 CLI 落盘；`recommendation.md` 由模型写入。执行 Agent 随后写
`decision.md` 并落实建议。

## 禁止事项

- 不查看“既有 TUI 前端插件”项目，也不在本轮文档写出其名称或路径。
- 不修改 `expert-advice/round-0003/` 之外的文件。
- 不执行 pnpm/npm/git 写操作、构建、测试或安装。
