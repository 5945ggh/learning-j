# P0-integration：骨架集成验收

## 目标

确认 P0 后端和前端可以作为下一阶段的稳定基线。

## 验收

- 从空库执行 `alembic upgrade head` 成功。
- 后端 `pytest` 无 error；所有未实现不变量为严格 xfail，而不是被跳过。
- 前端 lint 和 build 成功。
- 组件反向依赖规则可实际拦截违规 import，且配置没有 disable 或豁免。
- 检查 `git diff --stat`，确认没有 agent 修改 `docs/`、`references/` 或 `DESIGN.md`。
- 输出下一阶段可依赖的目录、命令、数据库 revision 和前端启动命令。
