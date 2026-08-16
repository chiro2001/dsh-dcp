# Round 0005 context — M7.0 收尾、rc.4/发布决策与 E7-CODE 取舍

## 仓库与当前状态

- commit：`6a7f975`（`main`；tags rc.1/rc.2/rc.3）
- public；npm NO-GO；peer 精确 dsh `0.1.0-rc.6`

## M7.0 已完成（round-0004 执行）

- signed ledger（`docs/STATS.md` 冻结）；domain record v1（eventCount 前向追平）；
  真实 dsh-storage-json 接线（动态子 fiber、可降级）；`/dcp stats` 展示
  session + persistent domain（current/stale/unavailable，单进程口径）；
  失败降级、catch-up、5-session reopen 聚合测试全绿。

## 待收尾/开放项

- 真实 JSON whole-file rewrite 在 5+ session 的规模影响未实测（STATS 只做功能）。
- `v0.1.0-rc.4` 是否发布未定；npm 决策仍 NO-GO。
- E7-CODE（Code Mode 完整支持可行性 spike）未开始；当前为 mutation 前拒绝。
- 探针结论：forced 8/10、autonomous 0/10、correction 2/5、nested 2/5；
  v0.2 不新增模型驱动模式。
- message-mode/child deep-read 延后/移出承诺。

## 必读输入

- `docs/STATS.md`、`docs/RELEASE.md`、`docs/ROADMAP.md`、`docs/CHANGELOG.md`
- `expert-advice/round-0004/recommendation.md`、`decision.md`
- `src/stats/*`、`src/commands/stats.ts`、`src/index.ts`
- `tests/integration/domain-store.spec.ts`、`tests/unit/domain-failure.spec.ts`

## 执行方式

沿用专家咨询流程（codex -p sss，gpt-5.6-sol / max / workspace-write）：

```sh
cd /home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning
codex -p sss -c 'model="gpt-5.6-sol"' -c 'model_reasoning_effort="max"' \
  -s workspace-write -C "$PWD" \
  exec -o expert-advice/round-0005/response.md - < expert-advice/round-0005/prompt.md
```

执行 Agent 随后写 `decision.md` 并落实 rc.4/收尾。

## 禁止事项

- 不查看既有 TUI 前端插件项目；不修改 round-0005 之外文件；不执行写操作。
