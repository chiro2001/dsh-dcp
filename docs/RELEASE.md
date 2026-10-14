# 发布与安装策略

## 下一版本（尚未发布）

- 目标：`v0.1.0-rc.9`，精确支持 dsh `0.2.0-rc.2`、Cordis `4.0.4`、
  Schemastery `3.18.4`。
- 范围：包含 rc.7/rc.8 的历史工作，并完成 dsh 0.2 宿主 API 迁移、低开销提示、
  system/developer 硬保护、模型消费原生结果后的延迟 cleanup，以及真实模型验证
  和可审计的费用评估。DCP protocol 保持 v1。
- 兼容策略：一个构建只声明已验证的宿主兼容范围，不维护跨 breaking rc shim。
  dsh `0.1.1-rc.2` 用户固定 `v0.1.0-rc.6-1`；其它旧 rc 用户升级到
  `0.2.0-rc.2` 后再使用当前分支。rc.7/rc.8 未创建 tag，不作为可安装的发布版本。
- 发布前必须通过 `pnpm peers check`、`check-all.sh --coverage --e2e` 和可用时的
  `e2e:real`；tag 与 GitHub Release 不在功能修复提交中提前创建。

## 主分支安装与正式发布

默认 GitHub 源跟随 `main`，主分支合入后，新安装或更新会得到 rc.9 工作版本及
其 dsh `0.2.0-rc.2` peer 要求。升级前先核对宿主版本；旧宿主使用上面的固定 tag。
直接使用分支不要求该版本已经发布到 npm 或创建 tag。

合入 `main` 前，目标提交必须通过本地门禁和 GitHub CI/安装 E2E，并同步构建
产物、README、支持矩阵与已知限制。合入本身不创建 rc.9 tag 或 GitHub Release；
正式发布仍需单独执行发布流程，npm 继续遵守下方决策门。

## rc.9 的验证与结论边界

- 最新离线 suite 为 280 项通过、5 项真实模型测试跳过，行覆盖率 90.54%；
  contract/integration E2E 47/47、隔离安装激活与 Harbor 控制器测试 3/3 通过。
  源码对应提交的 GitHub CI、Coverage、Package check 与安装 E2E 均须为绿。
- 官方 `deepseek-flash`、thinking disabled 的三轮真实回归 15/15 通过；
  默认配置复验 5/5 通过。报告及指纹见 [README 自测](../README.md#自测)。
- [单场景费用报告](evaluation-runs/2026-10-14T13-30-33-997Z-single-ledger/report.md)
  中两边独立验收均通过，但平均输入下降 93.1% 后续作费用增加 6.7%。
  费用稳定收益和自动阶段选择尚未证实，不能将功能验收当作省钱承诺。
- 当前仍有最近 turn 保护粒度较粗等限制；闭合 step 候选属于后续设计，
  见 [评估方案](EVALUATION.md)。精确多节点 decompress、message-mode、Code Mode
  和 child-session 深读取的限制见 [README](../README.md#已知限制v01)。

## 当前发布路径（已执行）

- 仓库：`chiro2001/dsh-dcp`（public）。
- 分支：`main`（稳定）、`develop`（集成交付）。
- 版本：`v0.1.0-rc.1`、`v0.1.0-rc.2`、`v0.1.0-rc.3`、`v0.1.0-rc.4`、
  `v0.1.0-rc.5`、`v0.1.0-rc.6`、`v0.1.0-rc.6-1`
  （git tag + GitHub Release）。
- 安装：`dsh plugin --profile <p> add 'github:chiro2001/dsh-dcp#<tag>'`。
- 打包验证：`pnpm pack --dry-run` 通过，tarball 含 `lib/`、`LICENSE`、
  `NOTICE`、`cordis.patch.yml`、README/AGENTS/docs。

## npm publish 决策门（未开放）

依据 round-0002 recommendation §3.3/§5：

- 技术门：license/source 链接可达、tarball 可加载、构建产物与 tag 源码一致、
  clean profile 安装无需本地状态 —— 当前均通过（`pnpm pack --dry-run` +
  CI e2e-install）。
- 待 owner 决策：是否公开发 npm 包名 `@chiro2001/dsh-dcp`、AGPL 对应源码获取
  义务、secret/privacy 边界（在线探针仅合成输入，key 不落盘）。
- 结论：**继续 GitHub 源作为正式安装路径；npm 发布保持 NO-GO**，直到 owner
  明确公开策略。该决策只阻塞 npm，不阻塞 GitHub rc 交付。

## 支持矩阵

- `v0.1.0-rc.9`：dsh `0.2.0-rc.2`（当前工作版本，尚未创建 tag 或发布）。
- `v0.1.0-rc.7` / `v0.1.0-rc.8`：历史工作版本，目标为 dsh `0.1.2-rc.1`，未发布。
- `v0.1.0-rc.6-1`：dsh `0.1.1-rc.2`（已通过 M0 contract、deterministic
  AgentLoop、重启、e2e 安装和真实模型 smoke/probes）。
- 其他版本未实测前不进入 peer 范围。
