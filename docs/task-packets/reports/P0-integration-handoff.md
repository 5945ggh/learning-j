STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P0-integration
BASELINE: HEAD=58d2d0256f8ae6670f84e0364feab84a4d2bbfc9; preserved all pre-existing dirty and untracked files, including core documentation, predecessor reports, and frontend implementation files.

Contract ledger:
- `docs/task-packets/CURRENT-PACKETS.md` P0-integration — under the current dispatch row, this packet verifies designated development/test database deletion and rebuild boundaries, current-schema integrity, fixture generation, absence of obsolete AI calls, restricted imports, and publishes the P1 baseline only.
- `docs/task-packets/protocols/implementation.md` — package and predecessor reports are evidence, not overriding contracts; offsets are Unicode code-point half-open ranges; source conflicts or unmet gates must be reported rather than specified around.
- `docs/task-packets/protocols/handoff.md` — this is the only documentation file owned by this packet; the final body will retain an existing reviewer-owned `## Review` section if one is later added.
- `docs/task-packets/reports/P0-contract-handoff.md` — P0 material API is `/materials`, `/materials/{material_id}/sentences`, and `/materials/{material_id}/sidecar`; legacy Analysis state/API is excluded. Its earlier migration/backup material is historical evidence, not the current development dispatch gate.
- `docs/task-packets/reports/P0-backend-handoff.md` — its complete reviewer-owned `## Review（CR，reviewer）` is present and currently `VERDICT: approve`; it reviews the historical trigger/forward-migration implementation only. Its old completion does not establish the current P0 gate after the 2026-09-11 database-policy recalibration.
- `docs/task-packets/reports/P0-frontend-handoff.md` — the frontend has a material-only client, code-point helper, and shell/import gates. No reviewer-owned `## Review` section was present in this predecessor report at inspection time. Its fetch mock verifies client consumption of fixture-shaped responses; it is separate from the backend fixture generator's real FastAPI route exercise.
- `docs/task-packets/CURRENT-PACKETS.md` top-level policy and P0 rows — task packets are handoff material rather than contract authority; the current P0 integration row requires designated development/test database rebuild-boundary and current-schema integrity proof. The current P0-backend row does not require old-database migration or legacy compatibility.
- `docs/LearningJ-plan-v5.md` §5 — models supply semantic/original-text surfaces only; the backend derives offsets and alignments. P0 therefore must not expose or call an AI surface.
- `docs/data-model.md` §9 — invariant tests are phase-owned. The current `mvp-tech-and-phases.md` §3.1 matrix assigns P0 its first proof for #20; P1 owns #5/#6, P2 owns #8/#21 and experiment 11a #24/#25, P3a owns #9, P3b owns #7 and part of #19, P4a owns #1/#2/#10/#11/#14, P4b owns #4/#12/#13/#15-#18 and the confirmation part of #18, P5 owns #3/#23 and the remaining scheduling/aggregation work, and the independent import slice owns #22. The P0 #20 entrypoint now has a passing test; later producer follow-ups remain explicitly marked.
- `docs/mvp-tech-and-phases.md` §§1.6, 2.1, 3/P0, 3.1 and §5 — current P0 must establish an explicit delete-and-rebuild command for a designated development/test database, current schema/application/contract identifiers, reproducible fixtures, rebuild integrity and path-boundary checks, and current 1–25 invariant-test ownership. It explicitly does not require old-database migration or pre-upgrade backup for current development; §5 requires each handoff to state its actual contract/evidence and gaps. Old P0/P1 completion does not prove the recalibrated P0/P1 state.
- `docs/adr/042-development-schema-baseline.md` — the active development rule permits deletion/rebuild only for an explicitly designated disposable development/test database, without requiring a complex registry or legacy compatibility chain. Ordinary startup, opening a database, and version mismatch must not delete unknown data. A supported baseline plus migration/backup/isolated restore protection begins before real data or release. Snapshot export remains a P1 product capability.

Assumptions refused:
- Do not treat an old Analysis row, endpoint, or front-end marker as a current P0 public contract.
- Do not infer unimplemented P1-P5 behavior from generated fixtures.
- Do not rewrite any predecessor report, product implementation, migration, database, core contract document, prompt, or dirty change to make an integration check pass.
- Do not treat historical forward-upgrade/legacy-restore evidence as either a current P0 completion proof or a requirement or blocker for explicit disposable development/test database rebuild.
- Do not infer that this policy synchronization makes any other task-packet contract current or synchronized; this report updates only the database-policy interpretation.

Owned files:
- `frontend/src/lib/p0-integration.contract.test.ts` — integration-owned client/OpenAPI/fixture verification only.
- `docs/task-packets/reports/P0-integration-handoff.md` — packet handoff evidence only.

Blockers:
- Technical P0 integration blockers are resolved. The explicit rebuild command, path guards, current baseline identifiers, fixture loading, integrity/FK checks, post-replacement FastAPI reads, invariant #20 P0 entrypoint, and frontend contract checks all have fresh passing evidence below.
- Reviewer-owned re-review remains the release gate for dispatching P1; no legacy migration, compatibility chain, or snapshot-export evidence is required for this current development gate.

Changed:
- `frontend/src/lib/p0-integration.contract.test.ts` — integration-owned Vitest coverage requires P0 OpenAPI members without forbidding legal P1 additions; asserts the three material GET operations use `200 application/json` responses referencing `MaterialOut[]`, `SentenceOut[]`, and `SidecarOut`; requires `SentenceOut.anchor_payload`; consumes generated fixture responses through the frontend client mock; rejects forbidden legacy markers; and round-trips fixture token surfaces with the frontend code-point helper. Its mock proves client consumption only.
- `backend/tests/test_contract_surface.py` — backend OpenAPI baseline now requires P0 material members without freezing the path set, so legal P1 additions remain possible while legacy markers stay forbidden.
- `backend/tests/test_development_rebuild.py` and `backend/tests/invariants/test_invariants.py` — current rebuild boundary, post-replacement API reads, and P0 first proof for invariant #20.
- `backend/src/learningj/db/maintenance.py` and `backend/src/learningj/ingest/service.py` — rebuild uses an explicit P0 table set (`materials`, `sentences`, `sidecars`, plus baseline metadata); token payloads retain derived IDs without forcing the future Lexeme table into this baseline.
- `docs/task-packets/reports/P0-integration-handoff.md` — records the P0 integration ledger, current database-policy boundary, resolved rebuild/API/fixture evidence, deferred invariant ownership, and verification invocation details.

Public contract:
- Browser/backend contract: P0 requires `GET|POST /materials`, `GET /materials/{material_id}/sentences`, `GET /materials/{material_id}/sidecar`, and `/healthz`. OpenAPI checks require those members and their GET `200 application/json` schema references while allowing legal P1 paths/properties. The frontend client validates its required `MaterialOut`, `SentenceOut`, and `SidecarOut` JSON fields; the current rebuild/baseline gate is proven.
- Generated material fixtures are deterministic txt and srt API responses. `populate_fixture_database()` exercises `TestClient -> create_app -> FastAPI routes` against the staging database used by `rebuild-development-db`; the post-replacement test then reads the final target through the same routes. The frontend contract test separately consumes generated artifacts through `LEARNINGJ_P0_OPENAPI` and `LEARNINGJ_P0_FIXTURE` with a fetch mock.
- Persisted token boundaries are Unicode code-point half-open ranges. The generated `𠮟られた。` fixture proves the backend token `[0, 1)` surface `𠮟` is recovered by frontend `sliceByCodePoint()`.
- No Analysis, questions, extraction, retention, KnowledgePoint, StudySession, review, or other AI endpoint is exposed in OpenAPI, called by the frontend, or present in the built browser output. Components retain the one-way shell boundary.

Verified:
- Predecessor handoff inspection — historical evidence only: P0-contract, P0-backend, and P0-frontend bodies are `STATUS: done`. `P0-backend-handoff.md` also contains a reviewer-owned `## Review（CR，reviewer）`, current `VERDICT: approve`, which closes prior backend review findings. This does not prove the current P0/P1 gate because the current phase plan explicitly supersedes old completion as a phase-completion inference.
- `cd backend && uv run pytest tests/test_contract_surface.py tests/test_migration.py tests/test_schema.py tests/test_api_materials.py -q` — pass: `38 passed in 2.94s`.
- `cd backend && uv run pytest -q` — pass: `77 passed, 23 xfailed in 6.35s`. The 23 xfails are the deliberate future-owner invariant entries listed below; no unexpected failure occurred.
- `cd backend && uv run alembic heads` — pass: `d8b3f6a1c204 (head)`.
- Historical migration evidence, not a current gate: the prior integration run built a `1c1fc8f7fc96` regression database, backed it up, isolated-verified it, restored a copy, and upgraded it to `d8b3f6a1c204` with integrity/FK checks passing. Under the current delete-and-rebuild development policy, this evidence neither substitutes for the required current-schema rebuild/baseline proof nor creates a requirement to add migration-chain or legacy-compatibility work. Existing migration files remain untouched.
- `cd backend && uv run python -m learningj.api.export_openapi --out /tmp/learningj-p0-integration.THuCEB/openapi.json` — pass: generated `4` paths.
- `cd backend && uv run python -m learningj.fixtures.material_fixture --out /tmp/learningj-p0-integration.THuCEB/material-fixture.json` — pass: generated fixture.
- `cd frontend && pnpm exec vitest run src/lib/p0-integration.contract.test.ts` — pass after backend made `SentenceOut.anchor_payload` required and regenerated tracked OpenAPI/fixture artifacts: `1` file, `3` tests. The test now accepts legal P1 paths/properties, asserts the three P0 GET/200/application-json schema references, checks target component object types without requiring a redundant direct-ref `type`, and requires `anchor_payload`.
- `cd frontend && pnpm test` — pass: `3` files, `22` tests.
- `cd frontend && pnpm lint` — pass: no ESLint errors.
- `cd frontend && pnpm build` — pass: `tsc -b` and Vite production build; `20` modules transformed.
- `cd backend && uv run pytest tests/test_contract_surface.py tests/test_development_rebuild.py tests/test_sentence_schema.py tests/test_api_materials.py tests/invariants/test_invariants.py -q` — pass: `21 passed, 23 xfailed`; invariant #20 P0 first proof passes and only the separate P4b runtime follow-up remains xfailed.
- `cd backend && uv run pytest -q` — pass: `89 passed, 23 xfailed`.
- Disposable CLI + SQL/API probe — pass: baseline `learningj-development-schema-2026-09-11`, app `0.1.0`, contract `learningj-contract-2026-09-11`, support `designated-development-test-rebuild-only`; `integrity_check=ok`, `foreign_key_check=[]`, `materials=2`, `sentences=5`, and rebuilt target routes return HTTP 200 with linked fixture data.
- Rebuilt target table-set probe — pass: exactly `learningj_development_baseline`, `materials`, `sentences`, and `sidecars`; no P2–P5 ORM tables or review triggers are materialized.
- Frontend source/build scan for `AnalysisPanel`, obsolete endpoint paths, old Analysis state fields, and retention/KP markers — pass: no matches.
- Component shell/router import scan — pass: no matches. Bare `slice`/`substring`/`substr` scan outside `src/lib/text.ts` and test files — pass: no matches.
- `git diff --check` — pass: no whitespace errors.

Known limitations:
- The material fixture covers txt and srt only. P1 owns material import and format behavior for the remaining contract surface; this packet does not claim epub/vtt UI integration.
- The invariant suite retains 23 strict xfails for future owners; #20's P0 first proof passes, while its separately named P4b versioned-runtime follow-up remains intentionally xfailed. Snapshot export is intentionally excluded here because it is a later P1/P2 product capability.
- No P1 reader, token interaction, dictionary lookup, StudySession, AnalysisRevision, extraction, KnowledgePoint/Occurrence, ReviewItem creation, admission, scheduling, provider call, or reading-activity behavior exists.

Gate for next packet:
- Ready: all technical P0-integration acceptance evidence is complete and can be handed to the reviewer for re-review; after an approve verdict, P1 may start from the material API/fixture baseline.
- Not safe to assume: fixture breadth beyond txt/srt, generated type tooling, reader/player behavior, token interaction, or any P2-P5 domain capability. New persisted ranges must continue to use code-point half-open semantics and new components must not import shell/router state.

CR focus:
- Confirm generated backend OpenAPI and material fixture remain the client contract, with no legacy AI/Analysis surface or reverse component-to-shell dependency.

Open issues:
- Technical blockers are closed and the independent re-review below is `VERDICT: approve`; P1 may start from this material API/fixture baseline. Existing migration/backup output remains historical evidence only and snapshot export remains P1 scope.
- Corrected report error: the prior report incorrectly stated that no predecessor `## Review` section existed. `P0-backend-handoff.md` contains `## Review（CR，reviewer）` at line 148 with current `VERDICT: approve`; its historical review scope is now recorded accurately above.
- Resolved validation invocation issues: the first migration command was rejected before execution because its temporary-directory cleanup trap used prohibited `rm -rf`; the successful rerun omitted cleanup and retained only `/tmp/learningj-p0-integration.THuCEB`. The first production build caught test-only `noUncheckedIndexedAccess` errors; `itemAt()` now makes the fixture array bounds explicit, after which lint/build/test pass. An initial `alembic heads` invocation omitted `uv run`, and an initial static-scan regex was over-escaped; both corrected commands pass above.

## Review

### 2026-09-11 独立复审（CR，reviewer）

```text
VERDICT: approve
Findings: none
Evidence checked:
- rebuild-development-db 仅创建显式 P0 表 materials、sentences、sidecars 与基线登记表；完整表集合断言排除 P2–P5 ORM 表。
- 重建后真实 FastAPI `/materials`、`/sentences`、`/sidecar` 读取，fixture/OpenAPI 生成和 SQLite integrity/FK 检查通过。
- Lexeme 缺席分支仅保留 sidecar 派生 ID；完整 schema 导入测试仍验证 Lexeme 写入。
- 不变量 #20 的 P0 首次失败保留验证通过；版本化运行时补测仍严格 xfail 给后续阶段。
- Backend `89 passed, 23 xfailed`；frontend `22 passed`，lint/build 与 `git diff --check` 通过。
Gate assessment:
- P0 开发基线满足 ADR-042 与阶段边界，不预建 P2–P5 领域表；P1 可从当前 API/fixture 基线启动。
Residual risks:
- 23 个严格 xfail 由后续阶段所有者负责，不构成 P0 阻塞。
```

### Lead Repair Verification (2026-09-11)

- The original review below remains the recorded verdict pending independent re-review; current P0/P1 dispatch is not approved.
- Backend SentenceOut.anchor_payload is now required; regenerated backend/fixtures/openapi.json declares it required. New test_sentence_schema.py reproduced the missing-field bug before repair, then passed. Targeted backend schema/API/fixture tests: 8 passed.
- Frontend shares parseEpubSpineIndex and displays unavailable location instead of inventing spine 0; regression tests cover missing, negative, fractional, string, valid zero and non-EPUB input.
- Integration checks now allow additional paths/properties, require GET operations and 200 JSON response references, and accept reference-only object schemas.
- Lead verification: frontend lint and build passed; after schema repair frontend tests: 22 passed. git diff --check passed.
- Outstanding: backend development database rebuild and current invariant owner/history-protection evidence, then integration verification against that rebuilt schema. No legacy migration is required.

### Original Review

2026-09-11: Lead transcription of Lovelace's read-only review supplied in this task. This is a concise record of the findings, not a new verification run. Repairs and re-review are pending.

```text
VERDICT: blocked
Findings:
- [P1] frontend/src/lib/p0-integration.contract.test.ts:46,69 — Whole-document path/property equality blocks planned P1 additions. Require baseline members and prohibit specific legacy contracts.
- [P1] frontend/src/lib/p0-integration.contract.test.ts:46 — Assert GET operations and their 200 JSON response schema references, not only path names.
- [P1] frontend/src/lib/p0-integration.contract.test.ts:79 — Mocked fetch proves fixture consumption, not rebuilt-schema/live FastAPI integration. Obtain and verify backend rebuild evidence before claiming that gate.
- [P1] backend/src/learningj/db/maintenance.py — Current P0 needs the explicit designated development/test database rebuild path and boundary checks under ADR-042; the legacy sample command is not that capability.
- [P1] backend/tests/invariants/test_invariants.py — Invariant 20 is still P4b xfail although current phase ownership starts at P0. Supply actual current-scope history-protection evidence and align the owner ledger.
Evidence checked:
- Reviewer inspected integration/client tests, backend API/schemas/fixtures, current P0 contracts and ADR-042. Reported passing commands do not prove the missing gates.
Gate assessment:
- P1 remains blocked until backend completion, integration repair and re-verification.
Residual risks:
- txt/srt fixture coverage is acceptable for this P0 slice; no migration/legacy compatibility requirement is introduced.
```
