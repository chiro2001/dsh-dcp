# Round 0004 context — M7.0 storage-domain + /dcp stats 纵向切片

## 仓库与当前状态

- 仓库根目录：`/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning`
- 当前 commit：`d39d757...`（`main`，`v0.1.0-rc.3` 已 tag + Release）
- 仓库：`chiro2001/dsh-dcp`（public；main + develop）
- 许可：AGPL-3.0-or-later；npm NO-GO（docs/RELEASE.md）
- dsh peer 精确锁定 `0.1.0-rc.6`

## 已完成（M6.3 / rc.3）

- Code Mode fail-closed：`exec.parent` 在 mutation 前拒绝 + 单测。
- 探针 oracle 重写：forced 10/10 schema、8/10 committed；autonomous 0/10；
  correction 2/5；nested 2/5。autonomous 0/10 → v0.2 不新增模型驱动模式。
- 净节省不足提示方向修正；发布面统一 public/rc.3/npm NO-GO。

## M7.0 目标（round-0003 recommendation §3.3）

- 真实 `DomainFacility`/`KvTable` 接线（dsh-storage-domain + dsh-storage-json）。
- 每 session 可重算 snapshot（含 eventCount/lastEventSeq/updatedAt），domain
  聚合从 records 求和，不做全局 `+=`。
- 降级：storageDomain 缺失/open/read/write/version 错误不阻止 DCP 注册或
  已提交 mutation；`/dcp stats` 显示 session + domain + estimated/status。
- 测试：真实 JSON 后端、多 session、dispose/restart、写失败、损坏/version
  mismatch、失败后追平 e2e（隔离临时目录）。

## 当前相关代码/文档

- `src/stats/session.ts`（computeSessionStats：native 已排除、marker 单列、
  netSavedTokens = max(0, shadowed - checkpoint)）
- `src/stats/domain.ts`（同步 read/write 适配器 + 单测；非真实 API）
- `src/commands/stats.ts`（只展示 session 指标）
- `src/index.ts` / `cordis.patch.yml`（未注入/打开 storageDomain）
- `docs/PROTOCOL.md` §8（统计口径）；`docs/ROADMAP.md`（v0.2）
- `expert-advice/round-0003/recommendation.md`（M7.0 详细要求）

## 必读输入

- `round-0003/recommendation.md` §3.3、§4（风险）、§5/§6（进入条件与 GO 门）
- `src/stats/session.ts`、`src/stats/domain.ts`、`src/commands/stats.ts`
- `src/index.ts`、`cordis.patch.yml`、`docs/PROTOCOL.md`
- `node_modules/@deepseek-ai/dsh-storage-domain` 与
  `dsh-storage-json` 的类型/README（DomainFacility.open、KvTable、defineDomain）
- 现有集成测试模式（tests/integration/*、tests/contract/fixture.ts）

## 执行方式

沿用专家咨询流程（codex -p sss，gpt-5.6-sol / max / workspace-write）：

```sh
cd /home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning
codex -p sss -c 'model="gpt-5.6-sol"' -c 'model_reasoning_effort="max"' \
  -s workspace-write -C "$PWD" \
  exec -o expert-advice/round-0004/response.md - < expert-advice/round-0004/prompt.md
```

执行 Agent 随后写 `decision.md` 并落实 M7.0。

## 禁止事项

- 不查看“既有 TUI 前端插件”项目，也不在文档写出其名称或路径。
- 不修改 round-0004 之外的文件；不执行安装/构建/测试/git 写操作。
