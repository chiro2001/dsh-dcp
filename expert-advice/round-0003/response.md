已完成 [recommendation.md](/home/chiro/projects/dsh-dynamic-context-pruning/dsh-dynamic-context-pruning/expert-advice/round-0003/recommendation.md:1)。

核心建议：

- 先做 M6.3：修正真实模型探针 oracle、定向优化净节省提示、确保 Code Mode 子调用在 mutation 前拒绝。
- storage-domain 仍是首个 v0.2 功能，但必须与 `/dcp stats`、持久聚合、失败降级及重启追平一起交付。
- 完整 Code Mode 支持需通过独立实验后再纳入。
- message-mode 继续延后；child-session 深读取移出 v0.2 承诺范围。
- npm 继续 NO-GO；dsh peer 仅覆盖逐版本实测范围。

按约束未运行安装、构建、测试或 git 写操作，也未修改 round-0003 之外的文件。
