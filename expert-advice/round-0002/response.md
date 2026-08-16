已完成审阅并写入 [recommendation.md](/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning/expert-advice/round-0002/recommendation.md)。

核心判断：

- **[事实]** 当前门禁尚不能证明 M0–M5 的全部验收矩阵：`check-all.sh --e2e` 实际为空操作，CI e2e 仅验证安装；并发、abort/timeout、Code Mode 拒绝及真实 native coexist 等延期项仍缺测试。
- **[事实]** PROTOCOL v1 与生产路径存在差距，包括 marker alias 未接线、多个配置无效、nudge hysteresis 不完整、DCP stats 混入 native compaction、control mutation 失败静默，以及 `m10000` 无法被 replay 识别。
- **[事实]** 当前真实模型 e2e 的 XML fallback 参数结构与 `compress` schema 不匹配，也没有实际比较 KV-cache 指标。
- **[推断]** 最佳方向不是纯 A/B/C，而是方向 D：先做协议一致性与确定性真实 AgentLoop 入口门，目标版本应是 rc.2，而非立即进入 v0.2。
- **[推断]** 不应直接实现增量 replay；应先测完整 pre-step/prepare 热路径，因为当前所谓 incremental reducer 未被生产入口使用。
- **[推断]** v0.2 建议顺序为：storage-domain 实机接线 → message-mode 安全子集 → Code Mode 支持 → child-session 深读取。

建议的三个里程碑依次为：

1. M6.0：PROTOCOL v1 conformance、命令/工具/control 的 deterministic AgentLoop 矩阵及真实 `--e2e` 门禁。
2. M6.1：1k–50k 事件长会话、20k marker、完整热路径与真实 KV-cache A/B；由阈值决定是否实现增量 replay。
3. M6.2：dsh 有界兼容矩阵、定向真实模型重复实验、npm/public/private/许可与隐私发布决策。

本轮仅创建了 `recommendation.md`；未自行写入 `response.md`，也未运行安装、构建、测试或 Git 写操作。
