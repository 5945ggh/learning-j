# LearningJ Task Packets

本目录存放可直接交给 subagent 的执行任务包。任务包是实现层的交接协议；产品边界、字段契约、ADR 与 prompt 契约仍以 `docs/` 为准。

## 使用顺序

1. 先派 `P0-contract.md`，确认当前仓库可以按 `docs/` 中的契约开始实现。
2. 派 `P0-backend.md` 与 `P0-frontend.md`。两者完成后执行 `P0-integration.md`。
3. P1 到 P5 每个阶段按同样方式执行：先读阶段包，再分别派后端、前端，最后执行集成包。
4. 下一阶段只能依赖上一阶段集成包报告中列为 `Public contract` 的内容。

后端与前端可以并行，但不得共享未声明的文件。前端消费后端生成的 OpenAPI/fixture，不手写平行契约。

## 权限边界

- 所有 subagent 对 `docs/`、`references/`、`DESIGN.md` 只读。
- 后端 agent 写 `backend/`、后端测试和 migration；除非任务包明确允许，不写 `frontend/`。
- 前端 agent 写 `frontend/`；除非任务包明确允许，不写 `backend/`。
- 集成 agent 写集成测试、契约测试和验证产物，不修改业务契约来迁就实现。
- 发现文档冲突时暂停受影响部分并报告；不得自行修改 `docs/`。

## 交接报告

每个 agent 结束时必须返回：

```text
STATUS: done | partial | blocked

Changed:
- <path>

Public contract:
- <下一阶段可以依赖的接口、字段或组件行为>

Verified:
- <command>: <result>

Known limitations:
- <明确未实现内容>

Open issues:
- <文档冲突、环境问题或需要主 agent 决定的事项>

Next handoff:
- <下一位 agent 可以直接开始什么>
- <下一位 agent 不能假设什么>
```

`done` 只表示本任务包的验收通过，不表示整个阶段完成。`partial` 或 `blocked` 必须列出阻塞条件和已经验证的部分。

## 阶段地图

| 阶段 | 后端包 | 前端包 | 集成包 |
|---|---|---|---|
| P0 | `P0-backend.md` | `P0-frontend.md` | `P0-integration.md` |
| P1 | `P1-backend.md` | `P1-frontend.md` | `P1-integration.md` |
| P2 | `P2-backend.md` | `P2-frontend.md` | `P2-integration.md` |
| P3 | `P3-backend.md` | `P3-frontend.md` | `P3-integration.md` |
| P4 | `P4-backend.md` | `P4-frontend.md` | `P4-integration.md` |
| P5 | `P5-backend.md` | `P5-frontend.md` | `P5-integration.md` |

`P0-contract.md` 是一次性的契约检查包，不替代主 agent 对文档的维护职责。
