# 优化备忘

> 记录待改进的零散事项

---

- [x] 达到限额之后没有自动切换模型 — **已修复**（c8794a3: provider 状态分离 + 按需冷却恢复 + 修复 handleUsageLimit bug）
- [ ] 评估任务完成情况时, 总是报警告" ⚠️  未找到评估报告，生成默认报告" — evaluator.ts:150，需要调查根因
- [ ] 优化: planner 和 generator 执行过程中的输出, 总是包含一个 emoji 图标, 删除它或选择更好看的方式 — message-handler.ts 的工具图标输出
- [ ] init 和 run 连续执行, 可以添加命令, 或直接 `autorun-harness init && autorun-harness run`
- [ ] max-tasks 默认是 10 个 task, 可以默认全部执行 — 当前在 commands/run.ts:41
