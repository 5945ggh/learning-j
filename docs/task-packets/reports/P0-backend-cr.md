# P0-backend · code review

> 回填说明（lead，2026-09-10）：本文件从该包的 CR 会话转录（reviewer 输出），按
> `reports/README.md` 的“每包每角色一份”约定合并两轮。报告是 gate 证据，不是规范；
> 冲突时现行契约优先。

```text
VERDICT: approve-with-risks
```

Findings:

- **[P1]** `docs/task-packets/CURRENT-PACKETS.md`（P0-backend 行 Start gate “P0-contract clear”）——前置闸门从未产出可复核的报告：实现方明确“按派发指令视为 P0-contract 闸门已通过”，`git show HEAD:docs/task-packets/P0-contract.md` 显示该包文件已被删除，仓库内不存在任何 P0-contract handoff/CR 产物。P0-contract 的**实质交付物**（旧库回归样本与旧触发器、旧状态机移除清单、25 条不变量 owner 台账、P0 gate 与来源链）已在仓库中逐项验证存在，因此不判 `blocked`；但“clear”这一裁决本身不可独立复核。最小修复：dispatch P0-contract（无 start gate 的只读审计），把结论落盘到 `docs/task-packets/reports/P0-contract-handoff.md` 并 CR。归属：lead。**此项仍未关闭。**

本轮返工前提出的 P2 已全部关闭，记录见文末“轮次记录”。

Evidence checked:

- 协议与行：`docs/task-packets/protocols/{code-review,implementation,handoff}.md`、`CURRENT-PACKETS.md` P0-backend 行、`git show HEAD:docs/task-packets/{P0-backend,P0-contract}.md`。
- 契约源：`data-model.md` §0/§0.1/§4.5/§7.1/§7.2/§9；`mvp-tech-and-phases.md` §1.3/§1.6/§2.1/§3 P0；ADR-020/039/040/041；`LearningJ-plan-v5.md` §7/§8。
- 测试：`pytest`（无 `UV_CACHE_DIR`）→ `71 passed, 23 xfailed`；`test_constraints.py`（queued 无 ReviewState、active 须 admitted_at+ReviewState、retired ⇔ retired_at、reference 允许 paused 且 `_admit` 被 invariant 3 拒绝、时间戳单向写入）；`test_migration.py`（四分支回填、CHECK/触发器、备份往返、篡改 manifest 拒绝、孤儿外键拒绝、失败保留备份+诊断、护栏、直接 alembic 自动备份、握手不重复/不漏备）；`test_contract_surface.py`（OpenAPI 路径精确集合、无幽灵端点、可复现）；`test_invariants.py`（25 条 owner，2 点亮 / 23 strict xfail 标注阶段）。
- 迁移复演（独立新路径）：`build-regression-sample` → `backup` → `verify-backup`（隔离副本）→ `upgrade`（1c1fc8f7fc96 → c66997d83060）→ `alembic downgrade -1` 抛 `NotImplementedError`；带数据旧备份恢复后直接 `alembic upgrade head` 自动备份并升级；迁移前后 26 张表行数逐一比对无变化；`analyses` 行与只读列保留；迁移前备份内保留旧第二状态机值与 7 个遗留 KE source；`review_items` 回填 `active(+admitted_at)/paused/queued/retired`；`foreign_key_check` 空、`integrity_check=ok`、8 个触发器齐备无残留；二次 `upgrade head` 为 no-op；存量 invariant 3 断言 `reference_active=0`、`active_without_state=0`、`queued_with_state=0`。
- 模式收敛：空库前滚 vs 旧库前滚的 101 个 table/index/trigger 对象比对，仅约束顺序差异，逐行多重集相等；`create_all` 与迁移的命名约束集合一致。
- 生成物：`export_openapi`、`material_fixture` 重新生成与已提交 fixture 字节一致。
- 写范围：代码改动全在 `backend/`（dry-run 显示 22 个路径，无 `*.db`/`.venv`/`__pycache__`）；提交 `306bb3c` 无 backend 以外路径；`docs/` 契约同步与 `frontend/`、`experiments/` 由独立提交/工作树承载。

Gate assessment:

- P0-backend 自身验收达成（迁移、备份、四态语义、无 ReviewItem 创建/排程、OpenAPI/fixture 可复现、旧第二状态机不再权威），代码已可作为 P0-integration 的输入。
- 但 **start gate 未被真实满足**（P1）：没有 P0-contract 审计报告，“clear”只是假设。因此本包不能作为“P0-contract 已通过”的证据，P0 阶段收尾与 P4b/P5 派发前必须补做 P0-contract 并落盘；本 CR 已把该证据路径制度化（`reports/`）。

Residual risks:

- 旧 `active` 无 ReviewState → `queued` 是解释性映射（`c66997d83060` docstring 已记录），需在 P0-contract unmappable 清单中确认，未被 lead 接受前仍是判断。
- `occurrence_id` 粒度的非 retired 部分唯一索引属 P5 前滚迁移项；当前 `UniqueConstraint("kp_id","occurrence_id")` 更严且不等价于 Occurrence 唯一。
- 包外既有债（未在本包处理）：`KnownEvidenceSource` 仍含 ADR-040/data-model §2.2 已移除取值（P2）；`ReviewState.state` 注解 str 而列为 Integer（P5）；`backend/` 两份旧 manifest 缺 `foreign_key_check`，当前 `verify-backup` 会拒绝。
- 旧库若存在 a51 未纠正的 `reference + active` 存量行，迁移会以断言失败中止（保留备份），而非静默带入；行为已按此设计，未在真实历史库上穷举。

---

## 轮次记录（非当前 Findings）

**轮次 1（初次实现，返工前）** —— `VERDICT: approve-with-risks`。P2：

- [P2] 闸门可追溯性：前置 P0-contract 报告不在仓库，`clear` 无法复核（后升为 P1）。
- [P2] `db/maintenance.py` `build_regression_sample` 对 `--out` 无条件 `unlink` → 已加非空护栏 + `--force`。
- [P2] `tests/test_schema.py` 依赖 `uv run` 建库 → 已改 `sys.executable -m alembic`。
- [P2] 迁移前备份“自动化”未强制 → `env.py` 已对非空库自动备份，并与 `forward_upgrade` 握手。
- [P2] `db/models/srs.py` docstring 仍是每 KP 口径、且约束更严 → 已改 Occurrence 口径并登记 P5。
- [P2] 迁移注释“与 Base.metadata 逐字一致”不实 → 已改为“命名一致、顺序不保证”。

**轮次 2（CR 返工）** —— 复核通过，提交 `306bb3c`。新增：

- [P2] `_run_alembic` 未还原 `LEARNINGJ_MIGRATION_BACKUP_TAKEN`，同进程连续升级第二个非空库会静默跳过备份 → 已快照/还原该标记并加回归测试（lead 补，随 `306bb3c`）。
