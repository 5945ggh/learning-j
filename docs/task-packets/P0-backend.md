# P0-backend：后端骨架、全量数据模型与不变量

## 读取范围

公共前言见 `_template.md`。另读 `docs/data-model.md` 全文、`docs/adr.md` 的 ADR-020、ADR-023、ADR-032，以及 `docs/mvp-tech-and-phases.md` 的技术选型和 P0。

## 目标

建立 Python 3.11 + uv + FastAPI + SQLAlchemy 2.0 + Alembic 后端骨架，一次建出全部实体，并建立 §9 十一条不变量的 xfail 测试壳。

## 可写范围

`backend/`、后端 migration、后端测试。不得写 `frontend/`、`docs/`、`references/`。

## 必须完成

- 建立 `domain/`、`db/`、`ingest/`、`analysis/`、`extraction/`、`memory/`、`srs/`、`llm/`、`api/`、`prompts/` 和 `tests/invariants/` 的骨架。
- SQLAlchemy 模型覆盖 `data-model.md` 中全部实体及不可推迟字段。
- `spans` 为独立不可变表；实体通过真实外键关联表引用，不能使用 `owner_type/owner_id`。
- 创建 Alembic 初始 migration，空 SQLite 数据库执行 `alembic upgrade head` 成功。
- §9 每条不变量都有独立测试函数，当前阶段尚未实现的标记为 `xfail(strict=True)`，并注明点亮阶段。
- 版本戳字段、唯一约束、不可变 revision 字段和 `canonical_id` 等数据层约束不能被省略。

## 不做

不实现业务导入、LLM provider、API 行为、词典导入或 UI。

## 验收命令

- `alembic upgrade head`
- `pytest`
- 对 schema 做一次空库检查，确认全部表和关键唯一约束存在。
