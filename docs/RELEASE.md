# Release & npm 决策（M6.2）

## 下一版本（尚未发布）

- 目标：`v0.1.0-rc.8`，精确支持 dsh `0.1.2-rc.1`。
- 范围：包含 rc.7 的宿主 API 兼容迁移，并优化压缩首次调用模板、结果状态机、
  失败后的 inline cleanup、精确 correction 与任意输入顺序的 multi-range 处理；
  DCP protocol 保持 v1。
- 兼容策略：不在一个构建中同时适配 dsh `0.1.1-rc.2` 和 `0.1.2-rc.1`；旧宿主
  固定使用 `v0.1.0-rc.6-1`。
- 发布前必须通过 `pnpm peers check`、`check-all.sh --coverage --e2e` 和可用时的
  `e2e:real`；tag 与 GitHub Release 不在功能修复提交中提前创建。

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

- `v0.1.0-rc.8`：dsh `0.1.2-rc.1`（下一发布目标，尚未创建 tag 或发布）。
- `v0.1.0-rc.7`：dsh `0.1.2-rc.1`（完整本地门禁与真实模型 E2E 已通过，尚未发布）。
- `v0.1.0-rc.6-1`：dsh `0.1.1-rc.2`（已通过 M0 contract、deterministic
  AgentLoop、重启、e2e 安装和真实模型 smoke/probes）。
- 其他版本未实测前不进入 peer 范围。
