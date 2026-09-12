STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P1-backend
BASELINE: HEAD=58d2d0256f8ae6670f84e0364feab84a4d2bbfc9; all pre-existing dirty and untracked files (core docs, frontend, demo/experiments, prior reports) preserved untouched. A working tree inherited from the interrupted predecessor round already contained partial P1 material-chain work; it was completed, corrected, and is reported here. One new user decision was taken mid-packet (see Open issues).

Contract ledger:
- `docs/task-packets/CURRENT-PACKETS.md` row P1-backend — immutable Material/Sentence/Sidecar for txt/srt/vtt/epub with storage/source/version anchors; sparse forward/reverse MaterialLexemeCount with atomic generation switch and recovery; snapshot export/isolated restore; deliverables are the material API, generation field, fixtures, export format.
- `docs/mvp-tech-and-phases.md` §1.5/§1.6 and P1 — content-index access point (immutable sidecar identity, dual sparse index, full-version publish and rebuild boundary); user-triggerable full-library snapshot export carrying schema/contract versions, sidecar/resource inventory and export time, verified on an isolated copy; acceptance points: counts equal a full rebuild, responses carry `sidecar_generation_id` with one generation per response, old generations stay readable with atomic pointer switch, fixture restores txt/srt sentence lists, export restores in isolation.
- `docs/data-model.md` §0/§2.1/§2.5/§8/§9.5–6/§11 — Material storage_mode/source_sha256/current_sidecar_id separation (content_hash stays the normalized-text hash, source_sha256 the raw file); Sidecar immutable version with three non-mixable version stamps; MaterialLexemeCount(material_id, sidecar_id, lexeme_id, token_count) sparse both directions, published together with the pointer after full validation; §11.1 minimal index paths and §11.3 short-transaction publication; offsets stay code-point half-open.
- `docs/adr/018-sudachi-identity.md` — lexeme_id derived from the NFC triple, dict version stamped but not hashed into the id.
- `docs/adr/033-source-storage.md` — storage_mode semantics; managed copy never rewrites the source file.
- `docs/adr/040-evidence-and-query-projections.md` — bounded-batch, short-transaction publication; generation switch only after the new generation is complete; rebuilds must not show fake zeros or mixed generations.
- `docs/adr/042-development-schema-baseline.md` — designated dev/test databases are delete-and-rebuild only; no legacy migrations, backfills or compatibility branches for this phase; a supported baseline plus versioned migration/backup/isolated-restore protection is required only before real data or external release.
- `docs/task-packets/protocols/implementation.md` and `docs/task-packets/reports/P0-integration-handoff.md` (VERDICT: approve) — started from the approved material API/fixture baseline; package text and predecessor reports are evidence, not contract.

Assumptions refused:
- Did not treat old packet text (forward migrations, pre-migration backups) as current gates; per the 2026-09-12 user decision recorded under Open issues, the legacy migration toolchain was deleted outright instead of maintained.
- Did not add DB-level immutability triggers for materials/sentences: §8.1 explicitly keeps title user-editable, and no mutation path exists in the API surface; the contract-mandated immutable artifact is the sidecar (§8.3).
- Did not materialize P2–P5 domain tables in the disposable baseline; the baseline widened only to the tables P1 owns (lexemes + material_lexeme_counts, the content index of §1.5/§11.1).
- Did not expose a GET for non-current generations: the published read surface is pointer-scoped by design; old generations remain intact at the storage layer (rows, payloads, counts) so referenced versions are never lost.

Owned files:
- `backend/**` (models, ingest, API, fixtures, maintenance, tests, generated artifacts), `frontend/src/lib/materials.ts` + `frontend/src/lib/materials.test.ts` (minimal client passthrough forced by the regenerated fixture), `docs/task-packets/reports/P1-backend-handoff.md`.

Blockers:
- None. All acceptance evidence below is fresh passing output.

Changed:
- Deleted `backend/alembic/` (env.py, script.py.mako, 4 tracked revisions; the untracked P1 draft migration `e1d5a0e37b21` removed with the directory), `backend/alembic.ini`, and `backend/tests/test_migration.py` — 2026-09-12 user decision; ADR-042 already removes any maintenance obligation and the chain contradicted the current schema shape (upgrade head produced the full legacy table set plus legacy backfills).
- `backend/pyproject.toml`, `backend/uv.lock` — alembic dependency removed.
- `backend/src/learningj/db/maintenance.py` — rewritten as rebuild + snapshot tooling only: `rebuild_development_database` now creates the P1 five-table baseline and installs only the sidecar-immutability triggers; baseline identity bumped to `learningj-development-schema-2026-09-11-p1` / `learningj-contract-2026-09-11-p1` (old evidence pinned to the 3-table P0 baseline stays accurate); `export_snapshot`/`verify_snapshot` manifest now records schema/contract identity read from the database's own baseline registry (null for unregistered DBs, verified for equality); migration-era `backup`/`verify-backup`/`upgrade`/`build-regression-sample` removed.
- `backend/src/learningj/ingest/service.py` — lexeme + count persistence is unconditional (the P1 baseline owns the content index); shared `_publish_generation` gate: derive counts (missing lexeme id rejected) → persist lexemes → insert counts → persisted-total cross-check against the payload → pointer switch, all in the caller's one short transaction; new `retokenize_material` builds the candidate outside the write transaction, carries stored ruby hints across generations, is idempotent (byte-equal payload + equal version stamps publishes nothing), and otherwise publishes a new immutable generation atomically.
- `backend/src/learningj/api/app.py` + `api/schemas.py` — Sidecar GET reads the published pointer and returns `sidecar_generation_id`; new `GET /materials/{material_id}/lexeme-counts` (single-generation response); new `POST /materials/{material_id}/sidecar/rebuild`; import accepts `storage_mode`; MaterialOut gained `storage_mode`/`source_sha256`/`current_sidecar_id`.
- `backend/src/learningj/db/models/material.py` — three new Material columns (NOT NULL storage_mode, nullable source_sha256, nullable FK current_sidecar_id) and `MaterialLexemeCount` (forward PK material_id+sidecar_id+lexeme_id, CHECK token_count>0, reverse index lexeme→material→sidecar).
- `backend/src/learningj/db/models/invariant_triggers.py` — sidecar immutability triggers (no UPDATE/DELETE) installed whenever the sidecars table exists; stale migration references removed from comments; retired-definition handling unchanged.
- `backend/src/learningj/domain/enums.py` — MaterialStorageMode enum.
- `backend/src/learningj/fixtures/material_fixture.py` — fixture database uses the P1 baseline table set; `populate_fixture_database` also captures `lexeme-counts/{txt,srt}` responses; regenerated `backend/fixtures/openapi.json` (6 paths) and `backend/fixtures/material-fixture.json`.
- New tests `backend/tests/test_sidecar_generations.py` (7) and `backend/tests/test_snapshot.py` (7); updated `test_development_rebuild.py` (baseline trigger assertion + counts API reads), `test_contract_surface.py` (P1 paths + fixture counts), `test_schema.py` (create_all-based full-metadata shape incl. material_lexeme_counts), `test_constraints.py` (storage_mode seed column), `test_invariants.py` (invariant 5 producer test lit for P1; ledger updated).
- `frontend/src/lib/materials.ts` + `frontend/src/lib/materials.test.ts` — client types/parser now consume `storage_mode`/`source_sha256`/`current_sidecar_id`/`sidecar_generation_id` and validate in field order; the regenerated fixture otherwise left frontend behavior untouched.

Public contract:
- Material chain API: `GET|POST /materials` (POST accepts `storage_mode`), `GET /materials/{id}/sentences`, `GET /materials/{id}/sidecar` (published generation, `sidecar_generation_id` required), `GET /materials/{id}/lexeme-counts` (`{material_id, sidecar_generation_id, counts[{lexeme_id, token_count}]}`, one generation per response), `POST /materials/{id}/sidecar/rebuild` (idempotent re-tokenization; publishes a new immutable generation with complete counts and the pointer switch in one transaction), `GET /healthz`.
- Immutability: sidecar rows reject UPDATE/DELETE at the database level; re-tokenization only inserts new generations and never overwrites referenced payloads.
- Snapshot format: `<name>.db` (full SQLite snapshot) + `<name>.db.manifest.json` (`type`, `created_at_utc`, `app_version`, `schema_id`, `contract_id`, `resources[]`, `sidecars[]` with `payload_bytes`); `verify-snapshot` performs the isolated restore check and requires inventory and identity equality.
- Development baseline: `rebuild-development-db --db <file>.db` rebuilds exactly `materials`, `sentences`, `sidecars`, `lexemes`, `material_lexeme_counts` + the baseline registry, loads the deterministic txt/srt fixture (22 lexemes / 24 count rows), and stamps `learningj-development-schema-2026-09-11-p1` / `learningj-contract-2026-09-11-p1`.
- Generated fixtures remain deterministic (`fixture-id-*` normalization; `𠮟られた。` code-point sample) and now include `lexeme-counts/txt|srt` entries for the frontend to lock.

Verified:
- `cd backend && uv run pytest -q` — pass: `79 passed, 23 xfailed`. The 23 strict xfails are the unchanged future-owner invariant entries (including the P4b versioned-runtime follow-up of #20); no unexpected failure.
- CLI probe `uv run python -m learningj.db.maintenance rebuild-development-db --db /tmp/learningj-p1-probe.db` — pass: report shows the `-p1` schema/contract ids, app `0.1.0`; resulting database tables are exactly the registry + five P1 tables; triggers are exactly `trg_sidecars_immutable_update`/`trg_sidecars_immutable_delete`; rows 2 materials / 5 sentences / 2 sidecars / 22 lexemes / 24 count rows; `PRAGMA foreign_key_check` empty.
- CLI probe `export-snapshot` + `verify-snapshot` on that database — pass: manifest identity `-p1`, `integrity_check: ok`, `foreign_key_check: ok`.
- New P1 coverage (all on the real rebuilt baseline): four-format txt/srt/vtt/epub API import with anchors (cue_index/spine_index/timestamps), generation-scoped counts, counts == full payload rebuild, idempotent re-tokenization (no new rows), analyzer-upgrade generation switch (two generations coexist, old payload intact, pointer switched), pre-commit crash rollback (old generation stays current, zero partial rows), sidecar UPDATE/DELETE rejected, unknown-material 404; snapshot export/refuse-overwrite/tamper/identity-mismatch/incomplete-manifest/null-identity/CLI roundtrip.
- `cd frontend && pnpm test` — pass: `22 passed (22)`. `pnpm lint` — pass. `pnpm build` — pass (tsc + Vite).
- OpenAPI/fixture regeneration reproducibility — asserted by `test_openapi_generation_is_reproducible` and `test_material_fixture_generation_is_reproducible` (byte-identical twice).
- `git diff --check` — pass: no whitespace errors.

Known limitations:
- No read API for a non-current generation; old generations are preserved and readable at the storage layer (row + generation-scoped counts), while the published surface stays pointer-scoped (data-model §8.3 does not define a by-generation endpoint).
- Snapshot manifests take schema/contract identity from the database's own baseline registry; unregistered databases export `null` identity rather than guessing.
- The interrupted predecessor round's P1 draft migration (legacy backfills) was deleted with the toolchain instead of being repaired; nothing in the current development path consumed it.
- Frontend work in this packet is the minimal client passthrough needed to stay green against the regenerated fixture; library/browser UI for counts and rebuild belongs to P1-frontend.
- No reader/token interaction, dictionary, KP/Occurrence, StudySession, review, or provider behavior exists (P2+ scope).

Gate for next packet:
- Ready: P1-frontend can lock the regenerated OpenAPI/fixture (MaterialOut with storage_mode/source_sha256/current_sidecar_id, SidecarOut with sidecar_generation_id, lexeme-counts entries) and build the library/browser on the shell-independent components; P1-integration can exercise all four formats, idempotency, atomic generation switch, snapshot export/restore, BYOK-free browse, and no-shell-reverse-dependency checks on the delivered API.
- Not safe to assume: restore into a *re-registered* baseline (the snapshot restores as a live database and reads correctly, but re-registration of the baseline row after restore is not automated); any dictionary/KP/review/AI capability; performance claims of any kind (experiment 11a is P2).

CR focus:
- `retokenize_material` idempotency compares raw msgpack bytes plus the three version stamps — confirm no path can (a) publish counts that do not reproduce the payload (the persisted-total cross-check is the gate), (b) overwrite or delete a referenced sidecar (trigger-enforced), or (c) drop ruby hints on EPUB re-tokenization (carry-over by sentence_index).
- The disposable baseline widened from three to five tables and the baseline/contract ids were bumped to `-p1` — verify this matches the §1.5 reading that P1 owns the content index (lexemes + counts) and that P0-integration's committed evidence stays historically accurate.
- The migration toolchain deletion is a user decision executed inside this packet; the record now sits in ADR-042 (2026-09-12 paragraph) — verify it matches what was actually removed and that no current test or runtime path still references alembic.

Open issues:
- 2026-09-12 user decision (this session, mid-packet): the entire legacy migration toolchain (alembic chain, env.py, forward upgrade, pre-migration backup/verify, regression sample, upgrade CLI, and the untracked P1 draft migration with its legacy backfills) is deleted rather than maintained; the future supported baseline will be a fresh chain anchored at the current schema (§1.6/ADR-042). The corresponding decision record has been added to `docs/adr/042-development-schema-baseline.md` under explicit user authorization on 2026-09-12; this report is the implementing evidence.
- None otherwise; all packet gates have fresh passing evidence.

## Review

### 2026-09-12 独立评审（CR，reviewer）

```text
VERDICT: approve
Findings:
- [P2] docs/task-packets/reports/P1-backend-handoff.md（Verified 节）— 报告记 `79 passed, 23 xfailed`；本次独立重跑为 `80 passed, 23 xfailed`（103 collected，无 skip、无失败）。数字疑为报告写就后仍有测试落地而未回填；以本节实测输出为准，无需代码改动。
- [P2] docs/task-packets/reports/P1-backend-handoff.md（Changed 节）— 清单未覆盖继承自中断前轮的契约对齐改动：`knowledge.py` 的 `retention`→`default_retention` 改名（并移除 `RetentionSetBy`）、`srs.py` 以部分唯一索引 `ux_review_items_occurrence_active`（occurrence_id WHERE retired_at IS NULL）替换旧 `(kp_id, occurrence_id)` 唯一键、`enums.py` 的 `KnownEvidenceSource` 对齐 ADR-040（user_asserted/import_anki/import_jpdb，移除 srs_matured/listening 取值）、`invariant_triggers.py` 的协调改名。已逐项核对与当前契约一致（data-model §3.1/§7.1/§2.2、ADR-040/041、AGENTS.md 契约迁移状态），HEAD 上列名与触发器自洽，仅记录清单不完整。
- [P2] backend/src/learningj/ingest/service.py — EPUB ruby hints 的重分词携带（hints_by_index，按 sentence_index 自当前代次取回）经代码核验成立，且被字节级幂等比较间接保护（hints 丢失会改变 payload 字节并触发新代次发布），但没有任何测试在带 ruby hints 的 EPUB 素材上执行 rebuild；导入路径的 hints 提取已由 test_ingest.py 覆盖。建议 P1-integration 补一条 EPUB+ruby 重建幂等用例。
Evidence checked:
- `ingest/service.py` 发布闸门与幂等（评审重点 1）：`_publish_generation` 按序执行词频派生（缺 lexeme_id 即拒绝）→ lexemes 落库 → counts 插入 → 持久化 SUM 与 token 总数交叉校验 → `current_sidecar_id` 指针切换，全部位于调用方单事务；`retokenize_material` 幂等比较为 msgpack 原始字节 + content_hash + segmenter/tokenizer/analyzer_dict 三版本戳，命中即不发布任何行；全服务无 UPDATE/DELETE sidecar 路径，触发器经重跑实证拒绝。`test_counts_match_full_payload_rebuild` 以逐 token 重算锁定「词频 == 全量重建」。
- 五表基线与 `-p1` 身份（评审重点 2）：`rebuild_development_database` 用显式表清单建表（规避 P2–P5 表泄漏，test_development_rebuild.py 断言表集合相等），staging 建成后原子替换、失败保留目标并留诊断；路径边界拒绝 symlink/目录/-wal 名。对 §1.5「P1 拥有内容索引」的解释成立：MaterialLexemeCount 的外键完整性要求 lexemes 先落地（阶段计划 §3「新实体的 DDL 跟随首次真实使用它的阶段」）；P0-integration 三表基线报告自 1812c17 提交后未被改动，作为历史事实保留。
- alembic 删除范围（评审重点 3）与 ADR-042 的 2026-09-12 段一致：`backend/alembic/`（env.py、script.py.mako、4 个 revision）、`alembic.ini`、`tests/test_migration.py` 已删，pyproject/uv.lock 依赖移除，maintenance.py 同步删除 backup/verify-backup/upgrade/build-regression-sample；全仓仅剩 test_development_rebuild.py 的反向断言 `"alembic_version" not in tables`，无任何存活引用。
- 不变量 5 生产者扩面（评审重点 4）为真实行为断言：在真实重建库上断言 sidecar 三版本戳与 `lexemes.first_seen_analyzer_dict_version` 非空且取值来自真实代次集合；23 个 strict xfail 台账未动（全部位于 test_invariants.py，仅 #4 的 reason 更新为"数据层部分唯一索引已就位"）。
- 快照 manifest 身份（评审重点 5）：`_baseline_identity` 读库内登记表，无登记表记 (None, None)，`verify_snapshot` 要求 manifest 与隔离副本逐项一致（含 null==null），`test_unregistered_database_exports_null_identity` 锁定；符合 §1.6 导出携带契约/schema 版本的要求。
- 前端透传（评审重点 6）：`materials.ts`/`materials.test.ts` 仅新增 storage_mode/source_sha256/current_sidecar_id/sidecar_generation_id 的类型、按字段顺序校验与 Sidecar 读取；SentenceContext/SentenceList 是已获批准的 P0 修复（parseEpubSpineIndex，「定位不可用」语义）；无 P1-frontend UI 越界，无 `String.slice` 直接用于持久化偏移。
- 实际重跑（真实输出）：backend `uv run pytest -q` → `80 passed, 23 xfailed in 5.58s`；`rebuild-development-db --db /tmp/learningj-p1-cr-probe.db` → `-p1` schema/契约身份、表集合恰为登记表+五张 P1 表、触发器恰为 trg_sidecars_immutable_update/delete（并实测拒绝 UPDATE/DELETE）、行数 materials=2/sentences=5/sidecars=2/lexemes=22/counts=24、integrity ok、FK 空；`export-snapshot`+`verify-snapshot` → manifest 身份 `-p1`、integrity_check ok、foreign_key_check ok；frontend `pnpm test` → `22 passed (22)`、`pnpm lint` 通过、`pnpm build` 通过；`git diff --check` 干净；git status 与基线对照无 docs 意外改动（ADR-042 的 2026-09-12 段与 P0-integration 报告已在 1812c17 提交，本轮 docs 新增仅本报告）。
- 评审进行期间 lead 并行提交 9dd60af（AGENTS.md 阅读指导改造：移除日期化契约迁移状态块、改为契约面路由表，清理失效 migrations 字样）。该提交只触及 AGENTS.md、不触及任何字段契约（字段契约权威仍是 data-model.md），不改变本节结论；正文引用「AGENTS.md 契约迁移状态」处以评审时点（170baa8 上的工作树）为准。
Gate assessment:
- P1-frontend 可锁定再生成的 OpenAPI/fixture（MaterialOut 新字段、SidecarOut.sidecar_generation_id、lexeme-counts 条目）并在 shell 无关组件上建库/浏览界面；P1-integration 可在交付 API 上验证四格式、幂等重分词、原子代次切换、快照导出/隔离恢复与无 shell 反向依赖。
Residual risks:
- 旧代次无按代次读取 API（存储层保留行与代次词频、发布面保持指针作用域）——报告 Known limitations 已声明，与 §8.3 未定义该端点一致。
- 快照恢复为活库后，基线登记行不自动重建（报告已声明，登记动作属未来受支持基线工作）。
- demo/ 与 experiments/ 无任务包归属且历轮交接均为"保留未跟踪"，本轮不提交、交 lead 决定：demo/ 为设计原型应用（其 README 自述"不是正式前端"），experiments/ 为 spike 试验（frontend_samples v1/v2、immersive_reader_demo、context_model_comparison）；两者自带 .gitignore，experiments/context_model_comparison/.env（含 API key 变量）、demo/dist/ 与 .DS_Store 均已被正确忽略，`git add demo experiments` 不会带入这些文件。
```
