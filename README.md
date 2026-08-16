# dsh-dcp

DeepSeek Harness（dsh）的动态上下文管理插件：对标
[opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
（opencode-dcp）的原理与实现，在 dsh 上提供模型驱动的上下文压缩、工具结果剪枝、
错误输入清理、压缩块嵌套、受保护内容保留、手动命令与统计。

> **状态**：规划阶段。详细方案见 [docs/PLAN.md](docs/PLAN.md)。

## 与 dsh-oc 的关系

`~/projects/dsh-oc` 是此前实现的 **TUI 前端插件**（把 opencode 官方 TUI 接到 dsh
上），与 dsh-dcp 的**上下文管理**目标不同。

> 本项目在实现阶段**不要直接查看或复用 `~/projects/dsh-oc` 的代码与文档**；
> 规划阶段为了对齐项目背景做过浏览，但 dsh-dcp 的设计依据是 opencode-dcp 的原理
> 与 dsh 官方扩展点文档。两者的 bundle 结构（`cordis.patch.yml`）可以相似，但
> dsh-dcp 不包含任何 TUI/HTTP 桥代码。

## 安装预览

```bash
dsh plugin --profile web add github:chiro2001/dsh-dcp
```

安装后插件以 `dsh.bundle.patch` 声明的 `cordis.patch.yml` 挂载到 profile，
并注册：

- 模型工具 `compress`（range / message 两种模式）
- 系统提示 section（压缩规则、边界索引、nudge）
- 人类命令 `/dcp` 与 `/dcp-compress`
- `dcp/*` 会话日志事件与表面替换（`user/message`、`tool/result`）

## 文档

- [docs/PLAN.md](docs/PLAN.md) — 详细实现规划（目标、架构决策、功能映射、
  模块设计、里程碑、测试、风险）

