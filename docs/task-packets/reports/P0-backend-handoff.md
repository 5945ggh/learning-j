# P0-backend · handoff

> 回填说明（lead，2026-09-10）：本文件从实现 agent 在会话中返回的两轮报告转录而成。
> 按 `reports/README.md` 的“每包每角色一份、返工覆盖”约定，这里把两轮合并保留，避免
> 初次实现的契约账本随覆盖丢失。报告是 gate 证据，不是规范；冲突时现行契约优先。

## 轮次 2 · CR 返工（最终交付状态）

```text
STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md → P0-backend（CR 返工轮）
BASELINE: HEAD=7144293，全部改动仍未提交；只动 backend/；docs/、prompts/、DESIGN.md、frontend/、experiments/ 未触碰
```

逐条处理（CR Finding → 修复）：

| CR 项 | 处理 | 落点 |
|---|---|---|
| #2 历史安全：`build_regression_sample` 无条件 `unlink` | 目标已存在且非空时 `FileExistsError` 拒绝覆盖，需显式 `force=True`/`--force`；覆盖前不自动备份的行为写入 docstring | `db/maintenance.py`（函数 + CLI + 帮助）|
| #3 空库验收依赖 `uv` 缓存 | 子进程改为 `sys.executable -m alembic`，不再依赖 `uv` | `tests/test_schema.py` |
| #4 备份“自动化”未强制 | `env.py` 在非空库前滚前自动 `backup_database`（no-op 到 head 与空库不备份）；`forward_upgrade` 通过 `LEARNINGJ_MIGRATION_BACKUP_TAKEN` 握手，同一次升级只产生一份备份 | `alembic/env.py`、`db/maintenance.py` |
| #5 唯一性口径 docstring 误导 | docstring 改为 **Occurrence 粒度**，并明确当前 `UniqueConstraint("kp_id","occurrence_id")` 既比 §7.1 更严、也不等价于 Occurrence 唯一；把“换 occurrence 粒度 / `status != 'retired'` 部分唯一索引”显式登记为 **P5 前滚迁移项** | `db/models/srs.py`、`tests/invariants/test_invariants.py`（不变量 4 reason） |
| #6 “与 Base.metadata 逐字一致”错误断言 | 注释改“约束/索引**命名**一致；重建后列/约束**顺序不保证**”（a51、c66 两处） | 两个 migration |
| Residual#2 存量 invariant 3 未扫描 | c66 回填后增加 `reference + active` 计数断言，非零即让迁移失败（备份保留） | `c66997d83060` |
| Residual#4 失败恢复指引 | 失败诊断与模块 docstring 写明“先从备份恢复再重试，SQLite DDL 非完全事务性，勿原地重跑” | `db/maintenance.py` |
| Residual#3 带数据旧库恢复证据弱 | 见下方“新证据” | |

新增测试：覆盖护栏、直接 `alembic upgrade` 自动备份（含 manifest 校验）、已到 head 不备份、`forward_upgrade` 恰好一份备份。

新证据（本轮实跑）：

- `pytest`（**不带** `UV_CACHE_DIR`）：`70 passed, 23 xfailed in 5.24s`（此前 66/23；+4 新测试；#3 修复后不再需要工作区缓存变量）。
- 带数据旧备份 → 恢复 → 升级：`legacy-backup-1c1fc8f7fc96-*.db` 复制为新路径后直接 `alembic upgrade head`，输出 `[learningj] pre-migration backup: …/restored-backup-1c1fc8f7fc96-….db`（#4 生效），版本 `1c1fc8f7fc96 → c66997d83060`。
- 恢复前后 **26 张表逐表行数完全一致**（总计 53 行，`count diffs: {}`）；`review_items` 回填 `[('active',admitted,¬retired),('retired',¬admitted,retired),('paused',¬,¬),('queued',¬,¬)]`；`fk violations: []`；`active without state: 0`、`queued with state: 0`。
- 覆盖护栏：二次 `build-regression-sample` 退出码 1，报“拒绝覆盖…本命令不会自动备份”；`--force` 可显式覆盖。

未在本包处理（需 lead/后续包裁决，不擅自改）：

- CR #1：P0-contract 交接报告不在仓库内，`clear` 无法独立复核。属 `docs/` 只读范围，建议把结论落进提交，实现方不改 docs。
- Residual#1：旧 `active` 无 ReviewState → `queued` 的映射已在 `c66997d83060` docstring 记录，但“是否登记进 P0-contract unmappable 清单”需前置报告/契约 owner 确认。
- CR #5 的实质修复（`occurrence_id` 粒度部分唯一索引）登记为 **P5 前滚迁移项**，P0 不改产品唯一性口径。

主要交付物：`backend/alembic/versions/c66997d83060_p0_review_item_queued_status_and_.py`、`backend/src/learningj/db/models/srs.py`、`backend/src/learningj/db/models/invariant_triggers.py`、`backend/alembic/env.py`、`backend/src/learningj/db/maintenance.py`、`backend/tests/test_migration.py`、`backend/tests/test_constraints.py`。

> 后续（非 agent 报告原文）：返工轮的 P2 修复后被 lead 追加一行——`_run_alembic` 也还原
> `LEARNINGJ_MIGRATION_BACKUP_TAKEN`（否则同进程连续升级两个库会静默跳过备份），并加回归
> 测试；该改动与返工内容一起提交为 `306bb3c`。

## 轮次 1 · 初次实现

```text
STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md → P0-backend 行（按 ADR-041 对既有实现返工）
BASELINE: 提交 7144293（“使现行契约与阶段计划保持一致”）；所有既有脏文件均已保留（AGENTS.md、DESIGN.md、docs/*、上一轮 backend/*、frontend/、experiments/）。磁盘上不存在前置包的 handoff 报告文件——我在整棵树上检索 PACKET: / STATUS: done / handoff 产物，只找到协议模板，因此前置基线就是这份未提交的工作区本身。按派发指令视为 P0-contract 闸门已通过。
```

契约账本：

- ADR-041 + `data-model.md` §7.1 —— ReviewItem 状态为 `queued`/`active`/`paused`/`retired`；queued ⇒ `admitted_at` 为空且无 ReviewState；active ⇒ `admitted_at` + ReviewState；retired ⇔ `retired_at` 非空；reference 走 `paused`，且绝不激活 queued 项。
- `data-model.md` §§0/7/9（不变量 3、4、18）—— 事实追加保存、当前投影可更新；不为迁就旧模型放宽断言。
- `mvp-tech-and-phases.md` §1.3/§1.6/§2.1 与 §3 P0 第 2 条 —— 只前滚、迁移前备份、P0 不创建 ReviewItem 行、不实现排程；新实体 DDL 跟随首次真实使用。
- ADR-020/039/040 已读；未发现冲突。
- 拒绝的假设：不臆造历史准入时间。`admitted_at` 仅由已记录的 `ReviewState` 证据推导；旧三态中“无 ReviewState 的 active”映射为 `queued`（唯一契约合法的非退役状态），绝不猜成 `active`。
- 仅动自有范围：`backend/`、migration、后端测试。

Changed：

- `backend/src/learningj/domain/enums.py` —— `ReviewItemStatus` 新增 `QUEUED`（顺序 queued/active/paused/retired）。
- `backend/src/learningj/db/models/srs.py` —— 新增 `admitted_at` 列；新增 `status_retired_at_equivalent` 与 `admitted_at_semantics` 两条 CHECK。
- `backend/src/learningj/db/models/invariant_triggers.py` —— 新增 `trg_review_items_no_direct_active_insert`、`trg_review_items_active_requires_state`、`trg_review_states_requires_admission`、`trg_review_items_admitted_at_monotonic`；安装守卫现在要求 `status` + `admitted_at` + `review_states`。
- `backend/alembic/versions/c66997d83060_p0_review_item_queued_status_and_.py` —— 新增前滚迁移。
- `backend/src/learningj/db/maintenance.py` —— 回归样本覆盖全部四种回填分支（active+state、无状态 active→queued、reference→paused、retired）。
- 测试：`tests/test_constraints.py`（重写）、`tests/test_migration.py`、`tests/invariants/test_invariants.py`（不变量 3/4/18 措辞 + P0 覆盖说明）、`tests/test_schema.py`（触发器集合）。
- `backend/fixtures/{openapi.json,material-fixture.json}` 重新生成（字节相同）。

Public contract：

- 迁移 revision `c66997d83060`（`down_revision = a51c2aeea6cf`）；最终 DDL：`status VARCHAR CHECK (status IN ('queued','active','paused','retired'))`、`ck_review_items_status_retired_at_equivalent`、`ck_review_items_admitted_at_semantics`、`admitted_at DATETIME NULL`。
- 触发器集合（8 个名字）由 `TRIGGER_NAMES` 导出；`alembic/env.py` 在迁移后幂等安装。
- 命令（在 `backend/` 下执行）：`python -m learningj.db.maintenance build-regression-sample|backup|verify-backup|upgrade`；`python -m learningj.api.export_openapi --out fixtures/openapi.json`；`python -m learningj.fixtures.material_fixture --out fixtures/material-fixture.json`。

Verified（真实输出）：

- `pytest` —— `66 passed, 23 xfailed`（返工前基线 49/23/6errors，6 个 error 只是 `test_schema.py` 里被沙箱限制的 `uv run`；把 `UV_CACHE_DIR` 放到工作区后通过，故无回归）。
- 旧库（1c1fc8f7fc96，带数据）→ head：`schema_version: 1c1fc8f7fc96 -> c66997d83060`；回填结果 `[('active','2026-01-15 00:00:00.000000',None),('retired',None,'…'),('paused',None,None),('queued',None,None)]`；`PRAGMA foreign_key_check = []`；`active without state = []`、`queued with state = []`。
- 空库 → head：`schema_version: none -> c66997d83060`；0 行；`foreign_key_check = []`。
- 既有开发库副本（`learningj.db`，a51）→ head：`a51c2aeea6cf -> c66997d83060`，外键干净。
- 迁移前备份 + 隔离恢复：`backup` → `integrity_check: ok`、`foreign_key_check: ok`；`verify-backup` → `integrity_check: ok`、`foreign_key_check: ok`、`schema_version: 1c1fc8f7fc96`。
- `create_all` 与迁移 DDL 一致性：`metadata constraints == migration constraints: True`。
- fixture 连续两次生成：sha256 完全一致。

Known limitations：

- P0 刻意不创建 ReviewItem 行、不实现配额/排程；只交付 schema、约束与触发器。
- “active ⇒ ReviewState”无法做即时 CHECK（ReviewState 外键依赖 ReviewItem 行先存在），故由触发器承担：直接 `INSERT … active` 被拒绝，`UPDATE … active` 必须先有 ReviewState。对 P5 的后果：同一事务内准入需按 `paused + admitted_at` → 插入 ReviewState → `active` 的写序（已写入 `invariant_triggers.py` 文档）。
- 旧三态中“无 ReviewState 的 active”回填为 `queued`（记录在迁移 docstring）；`admitted_at` 为证据推导而非精确值。
- 既有 `backend/learningj-backup-1c1fc8f7fc96-*.db` 的 manifest 由更早版本工具生成，缺少 `foreign_key_check` 字段，因此当前 `verify-backup` 会以“必备字段缺失”拒绝它们。该行为早于本次改动；这些 DB 副本本身在重新生成经校验的备份后可正常前滚。

Gate for next packet：

- Ready：ReviewItem 的 schema/枚举/约束/触发器与前滚迁移已符合 ADR-041 §7.1；回归样本覆盖每条回填分支；P0-integration 可据此验证前滚/恢复与 fixture 复现。
- Not safe to assume：P4b/P5 在未遵循“先写状态再转 active”的写序前，不应创建 ReviewItem 行；`admitted_at`/ReviewState 行为尚不存在。

CR focus：

- `c66997d83060` 的两阶段 SQLite 重建（放宽枚举 → 回填 → 落 admitted_at CHECK）；确认无历史丢失、且中间态不会放进非法行。
- 触发器互锁：`trg_review_items_no_direct_active_insert` / `trg_review_items_active_requires_state` / `trg_review_states_requires_admission` 只有一种可满足写序；确认这是契约推论而非过度约束，并确认 reference 项永不可能到达 active。
- 旧库真实历史行下 “无状态 active → queued”“reference → paused” 的回填映射。
- `Base.metadata`（`create_all` 路径）与迁移之间的 CHECK/触发器一致性。

Open issues：

- 磁盘上没有 P0-backend 的前置 handoff 报告（只有未提交的那一轮实现）；我以工作区为基线并如实记录，未做猜测。未改任何 spec；`docs/`、`prompts/`、`DESIGN.md` 均未触碰。
