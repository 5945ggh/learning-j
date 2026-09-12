# P0-backend · handoff

> 本文件由第二轮有界返工（ReviewState 建立时机 = 首次评分，`data-model.md`
> §7.1/§7.2 2026-09-10）覆盖 body；`## Review` 段保留评审者原文，由评审者更新。
> 前几轮的完整报告与 CR 记录见 git 历史（`306bb3c`、`d297358`、`5484224`、
> `880fc92` 及其之前的提交）。

```text
STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md → P0-backend（第二轮有界返工：ReviewState 建立时机改为首次评分）
BASELINE: HEAD=58d2d02（当前已落地的 P0-backend 第二次有界返工）；本轮确认 backend/ 与本报告相对 HEAD 无未提交改动；保留工作区中既有 AGENTS.md、DESIGN.md、docs/、demo/、experiments/ 等用户修改，未触碰
```

Contract ledger:

- `data-model.md` §7.1（2026-09-10）— queued：`admitted_at` 为空、无 ReviewState；
  active：`admitted_at` 非空、**ReviewState 可以缺失**（已准入但未首评）；paused
  可发生于准入前／准入后未首评／已首评之后，保留原准入标记；reference 走 paused
  并保留既有状态（尚未首评则 ReviewState 与 ReviewEvent 都不存在）。
- `data-model.md` §7.2 — ReviewState 是**已首次评分** ReviewItem 的当前投影，在首次
  评分时与首条 ReviewEvent 同一事务建立；准入不构造 S/D，因此不在准入阶段创建该行。
- `CURRENT-PACKETS.md` P0-backend 行 — “active: admitted_at set, ReviewState created
  only at first rating”；remove/replace `trg_review_items_active_requires_state`，
  keep `trg_review_states_requires_admission` valid；P0 不创建 ReviewItem 行、不排程。
- ADR-041 / §9 不变量 3、4、18 — reference 不得有 active 卡；retired ⇔ `retired_at`
  非空；新建复习项须有明确加入决定；P0 只落 schema 层语义。
- `docs/mvp-tech-and-phases.md` §3 P0 与 §P5 — 当前工作树版本已同步为“active 只需
  `admitted_at`、ReviewState 首次评分建立、准入不构造 S/D”，与 `data-model.md`
  §7.1/§7.2 及本包实现一致；本包未修改该文档。
- 拒绝的假设：不把“active ⇒ ReviewState”继续当作数据层不变量；不臆造历史准入时间；
  不为“旧三态中无 ReviewState 的 active”编造配额证据。

Changed:

- `backend/src/learningj/db/models/invariant_triggers.py` — 删除
  `_ACTIVE_REQUIRES_STATE` / `trg_review_items_active_requires_state`（前提废止）；
  删除 `_NO_DIRECT_ACTIVE_INSERT` / `trg_review_items_no_direct_active_insert`（active
  的跨表前提消失，同表 CHECK 已覆盖，保留会挡掉 §7.1 允许的“带配额直接建 active”）；
  保留并更正注释 `trg_review_states_requires_admission`；重写模块 docstring 的 P5
  写序（准入只写 `admitted_at`）；新增 `RETIRED_TRIGGER_NAMES`；`TRIGGER_NAMES`
  由 8 → 6。
- `backend/alembic/versions/d8b3f6a1c204_p0_drop_retired_review_state_triggers.py` —
  新增前滚 revision：`DROP TRIGGER IF EXISTS` 两个退役定义。安装器只
  `CREATE TRIGGER IF NOT EXISTS`，故必须由迁移清理既有库。
- `backend/src/learningj/db/models/srs.py` — active 语义 bullet 与 `admitted_at`
  CHECK 注释改为“ReviewState 可选、首次评分建立”；ReviewState docstring 与默认值
  注明初始 S/D 由首评决定、P0 不实现算法。
- `backend/alembic/versions/c66997d83060_p0_review_item_queued_status_and_.py` —
  docstring 把“无状态 legacy active → queued”重记为显式契约 owner 解释（非不变量
  推论）；新增回填后 `active_without_state = 0` 断言，并写明它只耦合该保守映射、
  不是 schema 不变量。
- `backend/src/learningj/db/maintenance.py` — 回归样本注释与 docstring 同步该解释。
- `backend/tests/test_constraints.py` — 断言翻转为 active 只需 `admitted_at`、
  ReviewState 可选；新增“准入未首评的 active 合法”“未准入项插 ReviewState 仍被拒”
  正向/反向覆盖。
- `backend/tests/test_migration.py` — HEAD 改为 `d8b3f6a1c204`；新增“已在
  `c66997d83060` 且装过退役触发器的库升级后不再带它们”的复演测试、回填
  `active_without_state=0` 耦合测试、升级库 ReviewState 仍须准入测试。
- `backend/tests/test_schema.py` — 退役触发器不得随安装器复活。
- `backend/tests/invariants/test_invariants.py` — 只改 owner reason/台账说明；25 条
  owner 结构不变。

Public contract:

- migration 链：`1c1fc8f7fc96 → a51c2aeea6cf → c66997d83060 → d8b3f6a1c204`（head）。
  最终 DDL 不变（`status` 枚举、两条语义 CHECK、`admitted_at`）；变化的是触发器集合。
- 触发器集合（6）：`trg_review_items_valid_requires_srs`、
  `trg_review_items_no_active_update`、`trg_knowledge_points_reference_switch_guard`、
  `trg_review_states_requires_admission`、`trg_review_items_retired_at_monotonic`、
  `trg_review_items_admitted_at_monotonic`；`RETIRED_TRIGGER_NAMES` 导出
  `trg_review_items_no_direct_active_insert`、`trg_review_items_active_requires_state`。
- 命令不变（`backend/` 下执行）：`python -m learningj.db.maintenance
  build-regression-sample|backup|verify-backup|upgrade`；
  `python -m learningj.api.export_openapi --out fixtures/openapi.json`；
  `python -m learningj.fixtures.material_fixture --out fixtures/material-fixture.json`。

Verified（真实输出）:

- `uv run pytest -q` — `77 passed, 23 xfailed in 8.95s`。
- `uv run pytest tests/test_constraints.py tests/test_schema.py tests/test_migration.py tests/test_contract_surface.py tests/invariants/test_invariants.py -q` — `59 passed, 23 xfailed in 4.53s`。
- `uv run pytest tests/test_constraints.py -q` — `21 passed`；`uv run pytest tests/invariants/test_invariants.py -q` — `2 passed, 23 xfailed`（25 owner：2 点亮 +
  23 strict xfail；台账未变）。
- `uv run pytest tests/test_contract_surface.py -q` — `5 passed`（OpenAPI 路径精确集合、无幽灵端点、
  可复现）。
- `uv run pytest tests/test_schema.py tests/test_migration.py -q` — `31 passed`。
- 迁移复演（`/tmp/learningj-p0-verify.WwIs4X`）：`build-regression-sample` →
  `backup`（`integrity_check: ok`、`foreign_key_check: ok`、`schema_version_before:
  1c1fc8f7fc96`）→ `verify-backup`（隔离副本同上）→ 恢复后 `upgrade`
  （`schema_version: 1c1fc8f7fc96 -> d8b3f6a1c204`，输出自动备份路径）。升级后：
  `schema_version=[('d8b3f6a1c204',)]`、`integrity_check: ok`、
  `foreign_key_check: []`、回填
  `[('active',admitted,¬retired),('retired',¬admitted,retired),('paused',¬,¬),('queued',¬,¬)]`、
  `active_without_state=0`、`queued_with_state=0`、`reference_active=0`、
  `retired_present=[]`、`current_missing=[]`；独立命令行检查确认恢复副本与空库均为
  `d8b3f6a1c204`、`integrity_check=ok`、`foreign_key_check=[]`、四种状态各 1 条、
  当前触发器 6 个且两个退役触发器不存在。
- **退役触发器关键证据**（`/tmp/p0replay2.LyH3xa`）：先升级到 `c66997d83060`，手工
  装回两个退役定义（共 8 个触发器：含 `trg_review_items_active_requires_state`、
  `trg_review_items_no_direct_active_insert`），再 `maintenance upgrade` →
  `c66997d83060 -> d8b3f6a1c204`；升级后 6 个触发器，`retired still present: []`、
  `current missing: []`，且产生迁移前自动备份（版本 `c66997d83060`）。即退役触发器
  是从**已升级**的库中清除，而非仅“全新 `create_all` 不含”。
- fixture 复现：`uv run python -m learningj.api.export_openapi` 与
  `uv run python -m learningj.fixtures.material_fixture` 输出到临时目录，两个生成物
  与跟踪文件 sha256 完全一致（`openapi.json`
  `16c8fff13a850b90ed5efa553799a1a044c3b99689a7a9933ce34f3aafb8f633`、
  `material-fixture.json`
  `99fa2f110686552d574313c3f2aec721578d7124c8655938d6ec373bd64b3153`）。
- `alembic heads` — 单一 head `d8b3f6a1c204`。

Known limitations:

- P0 仍不创建 ReviewItem 行、不实现配额/FSRS 排程；本包只把 schema 与触发器对齐
  §7.1/§7.2。
- 直接 `INSERT ... (status='active', admitted_at=…)` 现在合法；这是契约允许的
  “准入但未首评”形状。配额扣减与准入授权仍由 P5 服务层负责，数据层不校验配额。
- 未在真实历史库上穷举；旧库若含 a51 未纠正的 `reference + active` 行，迁移仍以断言
  失败中止并保留备份（既有行为，未改）。

Gate for next packet:

- Ready: ReviewItem schema/枚举/约束/触发器与迁移链已按 §7.1/§7.2 对齐；“active ⇒
  已有 ReviewState”已从数据层移除，“ReviewState ⇒ 已准入”仍生效；退役触发器在
  已升级库中被清除；存储形状与 `create_all` 命名一致。P0-integration 可据此验证
  前滚/恢复与 fixture 复现。
- Not safe to assume: P5 仍需按“准入只写 `admitted_at`；首次评分同事务建立
  ReviewState + 首条 ReviewEvent”实施；P0 不提供 ReviewEvent 或排程服务。

CR focus:

- 删除 `trg_review_items_no_direct_active_insert` 的取舍：active 的跨表前提已随
  ReviewState 时机消失，带 `admitted_at` 的直接 INSERT 属 §7.1 合法形状；确认
  不变量 3（reference 的 INSERT/UPDATE/KP 切换三条守卫）未受影响。
- 退役触发器路径：`d8b3f6a1c204` 只 DROP，依赖 `env.py` 事后安装当前 6 个；确认
  对“已在 `c66997d83060` 且装过旧定义”的库确实生效、no-op/重复升级安全、且不误伤
  当前定义。
- `c66997d83060` 新增 `active_without_state=0` 断言与保守回填的耦合是否表述清楚，
  不会被误读为“active 必须有 ReviewState”的 schema 不变量。
- `trg_review_states_requires_admission` 仍拒绝对未准入项插入 ReviewState；
  `create_all` 与迁移两条路径的触发器集合一致。

Open issues:

- 无契约冲突或越界修改。

---

## 2026-09-11 当前开发基线补齐（本轮，未放行 P0）

本轮按 ADR-042 的当前开发／测试数据集政策补齐 P0 第 3/6 项；这不是上方
2026-09-10 的迁移/回填返工，也不把其历史验证重新列作当前闸门。没有新增
Alembic revision、旧库回填、兼容分支或未来领域表，也没有删除任何工作区数据库。

新增内容：

- `backend/src/learningj/db/maintenance.py`：新增
  `rebuild-development-db --db <明确的 .db 路径>`。命令只接受显式普通 `.db`
  文件，拒绝目录、符号链接和 SQLite 辅助文件；不扫描数据库，也不由应用启动调用。
  它在目标同目录 staging 库以 `Base.metadata.create_all` 和现有触发器创建当前
  schema，灌入确定性 txt/srt 素材 fixture，写入唯一的
  `learningj_development_baseline` 记录，验证 `integrity_check` /
  `foreign_key_check` 后才原子替换该目标。记录包含
  `learningj-development-schema-2026-09-11`、应用版本、
  `learningj-contract-2026-09-11` 及
  `designated-development-test-rebuild-only` 支持范围；它不写 Alembic 版本。
  fixture 或检查失败时保留原目标，并写 `<target>.rebuild-failure.log`。
- 后续修复收缩了 P0 建表边界：重建只创建显式列出的
  `materials`、`sentences`、`sidecars` 与基线登记表，不再因全局 ORM metadata
  把 P2–P5 领域表带入 P0。素材导入在 Lexeme 表尚未由所属阶段建立时仍生成
  sidecar token/lexeme_id，但跳过 Lexeme 行写入；完整 schema 测试路径仍保留
  Lexeme 幂等写入。
- `backend/src/learningj/fixtures/material_fixture.py`：抽出
  `populate_fixture_database()`，使同一套通过真实素材 API 生成的确定性 txt/srt
  fixture 同时供 `build_fixture()` 和开发库重建使用。跟踪生成物
  `backend/fixtures/material-fixture.json` 已重新生成且字节未变化。
- `backend/tests/test_development_rebuild.py`：新增临时目录测试，覆盖显式目标替换、
  非 `.db` / 目录拒绝、普通应用启动不重置未知库、fixture 失败不替换原库并保留诊断、
  当前 schema/触发器/基线记录/fixture 完整性，以及不创建 StudySession、
  AnalysisRevision、ReviewEvent 空表。
- `backend/tests/invariants/test_invariants.py`：不变量 20 已补上 P0 首次验证，
  覆盖 fixture 失败时原指定库、代表性历史引用和完整性均保持；另保留独立的
  P4b strict xfail，等待各运行时生产者补测版本化历史引用保护。
- `backend/tests/test_development_rebuild.py`：新增重建后真实 FastAPI
  `/materials`、`/sentences`、`/sidecar` 读取断言，闭合 staging → 原子替换 → API
  的 fixture 证据链。

供 P0-integration 使用：

- 重建命令（目标必须由调用者明确提供）：
  `cd backend && uv run python -m learningj.db.maintenance rebuild-development-db --db /tmp/learningj-development.db`
- OpenAPI 生成物：`backend/fixtures/openapi.json`（其 SentenceOut 必填字段修复由并行
  schema 工作项所有，本轮未将其列为新增实现）。
- 素材 fixture：`backend/fixtures/material-fixture.json`，生成命令：
  `cd backend && uv run python -m learningj.fixtures.material_fixture --out fixtures/material-fixture.json`。

本轮验证（全部只用临时数据库）：

- `uv run pytest tests/test_development_rebuild.py tests/test_contract_surface.py tests/test_sentence_schema.py -q`
  -> 通过（含重建后真实 API 读取）。
- `uv run pytest tests/test_contract_surface.py tests/test_development_rebuild.py tests/test_sentence_schema.py tests/test_api_materials.py tests/invariants/test_invariants.py -q`
  -> `21 passed, 23 xfailed`；#20 P0 首次验证通过，P4b 运行时补测仍明确标记。
- `uv run pytest -q` -> `89 passed, 23 xfailed`。
- 临时 CLI 实测：`rebuild-development-db --db /tmp/learningj-p0-rebuild.IuxfFz/development.db`
  记录 schema/app/contract/support 标识；SQL 检查为 `materials=2`、`sentences=5`、
  `integrity_check=ok`、`foreign_key_check=[]`。
- 最终 CLI 实测（临时目标）：表集合严格为
  `learningj_development_baseline`、`materials`、`sentences`、`sidecars`；
  `integrity_check=ok`、`foreign_key_check=[]`，fixture 计数为 2 个素材／5 个句子。
- `git diff --check` -> 通过。

当前缺口与边界：

- P0-backend 技术验收已补齐；整体 P0 仍需 P0-integration 报告中的跨边界证据及
  reviewer-owned `## Review` 复审后，方可派发 P1。
- 开发基线只允许明确指定开发／测试路径重建。首次真实学习数据或发布前的支持版本范围、
  版本化升级、备份和隔离恢复属于 ADR-042 后续门，不由该 CLI 提前实现。
- P1 的用户快照导出/恢复能力仍未实现；现有历史迁移/备份工具和相关测试未作为本轮验收。

---

## Review（CR，reviewer）

### 2026-09-11 P0 基线复审（CR，reviewer）

```text
VERDICT: approve
Findings: none
Evidence checked:
- rebuild-development-db 仅创建显式 P0 表 materials、sentences、sidecars 与基线登记表；不再使用全局 metadata 建表。
- 重建库完整表集合断言、重建后真实 FastAPI materials/sentences/sidecar 读取、fixture 生成和 SQLite integrity/FK 检查均通过。
- Lexeme 缺席时素材导入保留 sidecar 派生 ID 但不写未来表；完整 schema 导入测试仍验证 Lexeme 写入。
- 不变量 #20 的 P0 首次失败保留验证通过；P4b 版本化运行时补测仍严格 xfail。
- OpenAPI anchor_payload 必填、前端 EPUB 锚点校验、可扩展 OpenAPI 断言未回退；backend 全量 `89 passed, 23 xfailed`，前端 `22 passed`，lint/build 与 git diff --check 通过。
Gate assessment:
- P0 开发基线不再预建 P2–P5 领域表，满足 ADR-042/P0 阶段边界；P1 可从当前 API/fixture 基线启动。
Residual risks:
- 23 个严格 xfail 仍由后续阶段所有者负责，不构成 P0 阻塞。
```

> 2026-09-10 并入（lead 从 CR 会话转录）。按 `reports/README.md` 的“一包一份”约定，复审不再单独成文件；原 `P0-backend-cr.md` 的内容移至此处，其历史保留在 git。
>
> **2026-09-10 第二轮有界返工复审（当前）**：对 `306bb3c` 之上、把 ReviewState 建立时机改为“首次评分”的未提交返工（`data-model.md` §7.1/§7.2 2026-09-10）做独立复核。当前 verdict 见下方代码块；本轮之前的 Review 记录原样下移至“上一轮 Review 记录”。

```text
VERDICT: approve
Findings: none
Evidence checked:
- 写范围：`git status --porcelain` = 8 个已跟踪 `backend/` 文件改动 + 新迁移 `backend/alembic/versions/d8b3f6a1c204_p0_drop_retired_review_state_triggers.py`（未跟踪）+ 本报告；`experiments/` 未跟踪且与本包无关；无 frontend/、prompts/ 或其它 docs/ 改动。
- `git diff HEAD -- backend`：删除 `_NO_DIRECT_ACTIVE_INSERT`/`_ACTIVE_REQUIRES_STATE` 及两个触发器名；保留 `trg_review_states_requires_admission`，其主体 DDL 与 HEAD 一致（仅注释改写）；`TRIGGER_NAMES` 8→6，新增 `RETIRED_TRIGGER_NAMES`；`UniqueConstraint("kp_id","occurrence_id")` 内容与 HEAD 一致（`srs.py:71`）未被触碰。
- `.venv/bin/python -m pytest -q` → `77 passed, 23 xfailed`（与声称一致）。
- `.venv/bin/python -m pytest tests/test_constraints.py -q` → `21 passed`。
- `.venv/bin/python -m pytest tests/invariants/test_invariants.py -q` → `2 passed, 23 xfailed`（25 条 owner 台账未变）。
- `.venv/bin/python -m pytest tests/test_contract_surface.py -q` → `5 passed`（精确路径集合、无幽灵端点）。
- `.venv/bin/python -m pytest tests/test_schema.py tests/test_migration.py -q` → `31 passed`。
- 关键非显然点（已复现退役触发器从**已升级**库清除）：`pytest tests/test_migration.py::test_upgrade_drops_retired_triggers_from_already_migrated_db -v` → `1 passed`；并独立复演（`/tmp/p0cr2.6m01Bu`）：`alembic -x db_url=… upgrade c66997d83060` → 按上一轮定义手工装回两个退役触发器（8 个）→ `alembic … upgrade head` → 版本 `d8b3f6a1c204`、退役触发器 `[]`、当前 6 个齐备、`integrity_check ok`、升级前自动备份（`c66997d83060`）。
- 迁移复演（`/tmp/p0cr.oXR66i`，maintenance CLI）：`build-regression-sample` → `backup`（`schema_version_before=1c1fc8f7fc96`、integrity/fk ok）→ `verify-backup`（ok/ok）→ 复制 → `upgrade`（`1c1fc8f7fc96 -> d8b3f6a1c204`）。升级后：`schema_version=d8b3f6a1c204`、`integrity_check=ok`、`foreign_key_check=[]`、四回填分支 `active(admitted,¬retired)/retired(¬admitted,retired)/paused(¬,¬)/queued(¬,¬)`、`active_without_state=0`、`queued_with_state=0`、`reference_active=0`、`retired_present=[]`、`current_missing=[]`。
- `alembic heads` → 单一 head `d8b3f6a1c204`（链 `1c1fc8f7fc96→a51c2aeea6cf→c66997d83060→d8b3f6a1c204`）；新迁移 `downgrade()` 抛 `NotImplementedError`（forward-only）。
- fixture：`export_openapi`、`material_fixture` 重生成到临时目录，sha256 与跟踪文件逐字节一致（`16c8fff1…`、`99fa2f11…`）。
- 契约源：`data-model.md` §0/§7.1/§7.2/§9（不变量 3/4/18）、ADR-041、`CURRENT-PACKETS.md` P0-backend 行与 2026-09-10 第二遍说明、`mvp-tech-and-phases.md` §1/§3 P0/§P5、三个 protocol；并读新迁移与 `invariant_triggers.py`/`srs.py`/`c66997d83060` 全文。
- 文档一致性：commit `63858ec` 已把 `mvp-tech-and-phases.md` 中 `active 必须已有 admitted_at 与 ReviewState`、`准入…初始化 ReviewState`（:46/:116/:122/:259-261）改为现行语义；handoff body 的 Open issue（:142-148）据此**已关闭**（body 按协议保留原文，本块记录关闭）。
Gate assessment:
- P4b/P5 可安全基于此实现：数据层已表达 queued（`admitted_at` NULL、无 ReviewState）/ active（`admitted_at` 非空、ReviewState 可缺）/ paused（保留原标记）/ retired（⇔`retired_at`），ReviewState 仅首次评分建立；`trg_review_states_requires_admission` 在 `create_all` 与升级库两条路径均生效（未削弱）；退役触发器在已升级库中被清除而非仅全新库不含。P4b 建 queued、P5 准入只写 `admitted_at`、首评同事务建 ReviewState+首条 ReviewEvent，与当前 schema 无冲突，且 `mvp-tech-and-phases.md` 验收文字已同步（commit `63858ec`）。
- 不应当作前提：P4b/P5 不得再假设 `active ⇒ ReviewState`；`UniqueConstraint("kp_id","occurrence_id")` 的替换仍是 P5 前滚迁移项。
Residual risks:
- `c66997d83060` 新增的 `active_without_state=0` 断言只对该 revision 尚未运行的库生效，已记录该 revision 的库不会重跑它；该断言由保守回填 SQL 结构性保证，未见数据风险。
- 真实历史库若存在 a51 未纠正的 `reference + active` 行，迁移仍以断言失败中止并保留备份（既有行为，未变；未在真实历史库穷举）。
- `docs/mvp-tech-and-phases.md` §2（:90）仍称第二次有界返工“待完成 / 仍有 active⇒ReviewState 触发器”；本返工提交后需 lead 更新该状态行（属状态同步，非契约冲突）。
```

### 上一轮 Review 记录（第一轮实现 + ADR-041 返工，`306bb3c`，VERDICT: approve）

```text
VERDICT: approve
Findings: none
```

已关闭 Findings（保留记录；当前无 open finding）：

- **[P1][closed]** `docs/task-packets/CURRENT-PACKETS.md`（P0-backend 行 Start gate “P0-contract clear”）——前置闸门当初没有可复核的报告：实现方明确“按派发指令视为 P0-contract 闸门已通过”，`git show HEAD:docs/task-packets/P0-contract.md` 显示该包文件已被删除，仓库内不存在任何 P0-contract handoff 产物。P0-contract 的**实质交付物**（旧库回归样本与旧触发器、旧状态机移除清单、25 条不变量 owner 台账、P0 gate 与来源链）已在仓库中逐项验证存在，因此当时不判 `blocked`，仅要求补齐闸门证据。**关闭证据：`5484224` 落盘 `docs/task-packets/reports/P0-contract-handoff.md` 并判 clear，lead 于 2026-09-10 接受该审计。**

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
- **start gate 现已满足**：`5484224` 落盘 `reports/P0-contract-handoff.md` 并判 clear，lead 于 2026-09-10 接受；原先的 P1 关闭。
- 边界：P0-integration 仍需 P0-frontend 报告；本 Review 只覆盖 `backend/`，对前端不作任何断言。

Residual risks:

- 旧 `active` 无 ReviewState → `queued` 是解释性映射；P0-contract 的实体对账表已把它登记为 “deliberate compatibility interpretation, not proof of historical quota admission”，lead 接受该审计。它不是历史事实的还原；若要改变该口径需另立决定。
- `occurrence_id` 粒度的非 retired 部分唯一索引属 P5 前滚迁移项；当前 `UniqueConstraint("kp_id","occurrence_id")` 更严且不等价于 Occurrence 唯一。
- 包外既有债（未在本包处理）：`KnownEvidenceSource` 仍含 ADR-040/data-model §2.2 已移除取值（P2）；`ReviewState.state` 注解 str 而列为 Integer（P5）；`backend/` 两份旧 manifest 缺 `foreign_key_check`，当前 `verify-backup` 会拒绝。
- 旧库若存在 a51 未纠正的 `reference + active` 存量行，迁移会以断言失败中止（保留备份），而非静默带入；行为已按此设计，未在真实历史库上穷举。

### 轮次记录（非当前 Findings）

**轮次 1（初次实现，返工前）** —— `VERDICT: approve-with-risks`。P2：

- [P2] 闸门可追溯性：前置 P0-contract 报告不在仓库，`clear` 无法复核（后升为 P1）。
- [P2] `db/maintenance.py` `build_regression_sample` 对 `--out` 无条件 `unlink` → 已加非空护栏 + `--force`。
- [P2] `tests/test_schema.py` 依赖 `uv run` 建库 → 已改 `sys.executable -m alembic`。
- [P2] 迁移前备份“自动化”未强制 → `env.py` 已对非空库自动备份，并与 `forward_upgrade` 握手。
- [P2] `db/models/srs.py` docstring 仍是每 KP 口径、且约束更严 → 已改 Occurrence 口径并登记 P5。
- [P2] 迁移注释“与 Base.metadata 逐字一致”不实 → 已改为“命名一致、顺序不保证”。

**轮次 2（CR 返工）** —— 复核通过，提交 `306bb3c`。新增：

- [P2] `_run_alembic` 未还原 `LEARNINGJ_MIGRATION_BACKUP_TAKEN`，同进程连续升级第二个非空库会静默跳过备份 → 已快照/还原该标记并加回归测试（lead 补，随 `306bb3c`）。
