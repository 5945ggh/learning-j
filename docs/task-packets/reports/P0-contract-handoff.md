# P0-contract · handoff

```text
STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md → P0-contract
BASELINE: HEAD=f9c1a7e; preserved pre-existing untracked `experiments/` and `frontend/` directories. No product-code, prompt, or contract-document changes were made.
```

## Contract ledger

- `LearningJ-plan-v5.md` §§1–3 — the product boundary is material reading plus a future StudySession/knowledge/review flow; a legacy `Analysis` row is not the authoritative lifecycle owner.
- `mvp-tech-and-phases.md` §§1.3, 1.6, 2.1, 3/P0 — migration is forward-only with an automatic pre-migration backup and isolated restore check. P0 removes the old Analysis state machine, exposes only material APIs, and does not create future-domain rows or schedule cards.
- `data-model.md` §§0, 4, 7–9 — immutable referenced facts cannot be overwritten; P0 may preserve legacy read-only data but must not invent a StudySession/AnalysisRevision/ReviewEvent mapping. The current ReviewItem contract is `queued|active|paused|retired`, with `admitted_at`/`retired_at` semantics and 25 separately owned invariants.
- `prompt-contracts.md` §§1–3 — Analysis is a future versioned document and discussion capability, not an API/state-machine contract available in P0; initial generation must not also imply extraction.
- ADR-020 — local Python/FastAPI is the sole backend boundary and secrets do not belong in data/API artifacts.
- ADR-023 — shells compose independent learning components; no old embedded Analysis surface may define the new contract.
- ADR-037/038/039 — StudySession, AgentRun and fixed-version extraction replace old state fields; provider calls are outside transactions; historical references are protected while current projections may change.
- ADR-040 — legacy KE source values are not evidence for the current P2 decision model; evidence/query migration belongs to P2, not P0.
- ADR-041 (current catalogue re-sync dependency) — ReviewItems target Occurrences, queued items are not admitted, and a local/default intent never authorizes card creation. P0 only supplies schema guards and migration evidence; P4b/P5 own creation/admission behavior.

## Actual legacy schema/API reconciliation

| Legacy surface | Forward P0 disposition | Evidence |
|---|---|---|
| `analyses.status`, `extraction_status`, `extraction_trigger`, `session_closed`, `turn_count` and their two CHECKs | No lawful current-contract mapping. `a51c2aeea6cf` drops all five fields; their values remain recoverable only in the mandatory pre-migration backup and are never re-derived. | `backend/alembic/versions/a51c2aeea6cf_p0_baseline_debt_removal_drop_legacy_.py`; `test_upgrade_removes_second_state_machine_and_keeps_history` |
| Legacy `Analysis` identity/context columns (`model`, `prompt_version`, `context_kp_ids`, `context_note_ids`) | Kept read-only for history; current ownership moves to AgentRun when P3a/P3b implements it. | `backend/src/learningj/db/models/analysis.py` |
| Legacy analysis API / front-end contract | Removed from the OpenAPI surface: only `/healthz`, `/materials`, `/materials/{material_id}/sentences`, and `/materials/{material_id}/sidecar` remain. Forbidden legacy markers include analysis/questions/extract/retention paths and all five old state fields. | `backend/tests/test_contract_surface.py` |
| ReviewItem without a status column | `a51` adds status and then `c66997d83060` establishes the current four-state enum plus `admitted_at`. `queued` has no ReviewState/admission; `active` requires both; `retired` iff `retired_at`; reference is paused. | `c66997d83060_p0_review_item_queued_status_and_.py`; `test_constraints.py` |
| Legacy active ReviewItem with ReviewState | Total evidence-backed mapping: retain as `active`, deriving `admitted_at` from `review_states.created_at`. | `test_upgrade_backfills_review_item_admitted_at_from_state` |
| Legacy active ReviewItem without ReviewState | Mapped to `queued`, not guessed as admitted. This is a deliberate compatibility interpretation, not proof of historical quota admission. | `c66997d83060` migration docstring; `test_upgrade_backfills_review_item_status` |
| Legacy non-retired ReviewItem under `KP.retention=reference` | Mapped to `paused`, preserving history rather than treating reference as retirement. | `a51` migration; migration/constraint tests |
| Old retired-at-only reference guard | Stale triggers are dropped and the current status/admission trigger set is installed after migration. It rejects reference→active and preserves legal paused items. | `backend/src/learningj/db/models/invariant_triggers.py`; `test_invariant_triggers_installed` |

## Backup fixture and P0 gates

- The reproducible old-state fixture is `learningj.db.maintenance.build_regression_sample`: it creates a populated `1c1fc8f7fc96` database with all five Analysis state fields, all seven legacy KE source values, historical analysis-section/run data, and all four ReviewItem backfill branches.
- Normal migration commands (from `backend/`) are `uv run python -m learningj.db.maintenance build-regression-sample --out <path>`, `backup --db <path>`, `verify-backup --backup <path>`, and `upgrade --db <path>`. Direct `alembic upgrade head` also takes one pre-migration backup for a non-empty database.
- The fixture refuses to overwrite a non-empty target without `--force`; backup verification opens an isolated copy and requires integrity, foreign-key, schema-version, application-version, and timestamp manifest data.
- **P0-contract is clear** for P0-backend and P0-frontend dispatch: the legacy/current boundary, forward migration path, backup fixture, API surface, invariant owner ledger, and deferred/unmappable data are now independently reviewable.
- **P0-integration is not yet clear**: it still requires both P0-backend and P0-frontend handoff reports. This audit does not assert P0-frontend completion.

## Unmappable or deliberately deferred legacy data

| Surface | Why it cannot be silently mapped | Owner / required future action |
|---|---|---|
| Five dropped Analysis state fields | They describe a rejected second lifecycle; deriving StudySession/AgentRun/extraction completion would invent user intent or execution history. | Preserve in pre-migration backup only; P3a/P3b/P4a introduce real owners. |
| `extraction_runs.analysis_revision_id` for old rows | There was no immutable AnalysisRevision manifest to reference. | Nullable compatibility column in P0; P3a/P4a must add the real non-null FK when that entity exists. |
| Legacy `known_evidence.source` values (`reading_inferred`, `analysis_marked`, `srs_matured`, listening values, plus import values) | ADR-040 limits current KE facts to current sources and forbids converting reading/listening/SRS history into new positive evidence without an explicit P2 decision. | P2 evidence migration/audit; do not silently reinterpret P0 rows. |
| `review_states.history` | It is not a ReviewEvent stream and cannot establish modern eligibility/provenance. | P5 ReviewEvent/eligibility work. |
| `analysis_sections.kind`, `superseded_by`, `origin_turn` legacy shape | It is not a P3 AnalysisRevision manifest or P4 ExtractionSection mapping. | P3a–P4a versioning/extraction migration; retain as legacy history until a lawful mapping exists. |
| Existing `UniqueConstraint(kp_id, occurrence_id)` | It is stricter than, and not equivalent to, ADR-041’s non-retired occurrence-grained identity. | P5 forward migration to occurrence-grained partial unique index; P0 must not change the product uniqueness rule. |
| `ReviewState.state` annotation versus SQLite Integer column | Type correction is unrelated to P0’s migration boundary and would misrepresent unimplemented FSRS semantics. | P5. |

## Invariant-owner ledger (data-model §9)

| # | Test entry | Owner / current P0 state |
|---:|---|---|
| 1 | Occurrence KP existence, merge preservation, canonical acyclicity | P4b — strict xfail |
| 2 | Occurrence fixed revision/section reference | P4b — strict xfail |
| 3 | reference never has active ReviewItem | P5 — strict xfail; P0 trigger guards covered |
| 4 | Occurrence-grained non-retired ReviewItem uniqueness and lifecycle | P5 — strict xfail; P0 status/timestamp guards covered |
| 5 | trigram records carry analyzer dictionary provenance | P1 — P0 schema assertion passing; producer semantics deferred |
| 6 | Span code-point half-open range round-trips to surface | P4b — strict xfail |
| 7 | note/profile limits enforced on write | P3b — strict xfail |
| 8 | identity spaces and non-KE producers remain separate | P4b — strict xfail |
| 9 | discussion phase gate and fixed extraction input | P4b — strict xfail |
| 10 | completed extraction maps every section without body mutation | P4b — strict xfail |
| 11 | KP anchor upsert concurrency and run idempotency | P4b — strict xfail |
| 12 | pattern anchor equals versioned payload serialization | P4b — strict xfail |
| 13 | pattern slot-binding key set correctness | P4b — strict xfail |
| 14 | pattern grammar version / opaque reason | P0 — passing data-layer assertion |
| 15 | slot order and cross-slot span separation | P4b — strict xfail |
| 16 | slot-binding values reference ordered Occurrence spans | P4b — strict xfail |
| 17 | session completion uses current-run confirmation only | P4b — strict xfail |
| 18 | explicit Occurrence decision, atomic item creation, quota admission | P5 — strict xfail; P0 distinguishes queued from active |
| 19 | extraction/confirmation/tool/review writes are atomic and idempotent | P4b — strict xfail |
| 20 | mutable current state preserves historical references | P4b — strict xfail |
| 21 | Lexeme decision scope, precedence, and atomic withdrawal | P2 — strict xfail |
| 22 | known-import idempotency and publish boundary | P2-known-import — strict xfail |
| 23 | SRS-to-Lexeme eligibility provenance | P5 — strict xfail |
| 24 | target-set index queries and rebuild equivalence | P5 (with P2 experiment 11a structure check) — strict xfail |
| 25 | temporal validity and generation-consistent reads | P5 (with P1 generation prerequisite) — strict xfail |

Changed:
- `docs/task-packets/reports/P0-contract-handoff.md` — recorded the read-only P0 contract audit, migration/data ledger, and gate evidence.

Public contract:
- P0’s forward-only migration revisions `a51c2aeea6cf` and `c66997d83060`; backup/restore commands; exact material-only OpenAPI surface; reproducible legacy regression fixture; strict invariant-owner test ledger.

Verified:
- `cd backend && uv run pytest` — pass: 71 passed, 23 expected strict xfails, 0 unexpected failures (2026-09-10).
- `backend/tests/test_migration.py` (included above) — covers legacy fixture construction, backup/isolated restore, empty/legacy upgrades, four ReviewItem backfill cases, API-adjacent historical preservation, and failure diagnostics.
- `backend/tests/test_contract_surface.py` (included above) — confirms exact material API paths, forbidden legacy fields/endpoints, and deterministic OpenAPI/fixture generation.
- `backend/tests/invariants/test_invariants.py` (included above) — confirms the 25-entry owner ledger; #5 and #14 pass, the other 23 remain deliberate `strict=True` xfails.

Known limitations:
- This is a read-only audit: it does not implement P0-frontend, P0-integration, StudySession/AnalysisRevision, ReviewItem creation, quota admission, FSRS, provider I/O, or P2 evidence migration.
- `legacy active without ReviewState → queued` is the only evidence-preserving current-state interpretation, but does not recover an historical admission timestamp.

Gate for next packet:
- Ready: P0-backend/P0-frontend may use this audit as their required P0-contract-clear evidence; P0-backend’s existing report/test evidence is consistent with the current ADR-041 contract.
- Not safe to assume: P0-integration cannot start until P0-frontend has an independently verified handoff; P4b/P5 must not treat P0 schema as authorization to create, admit, or schedule ReviewItems.

CR focus:
- Confirm that each deferred/unmappable surface remains explicitly owned and is not treated as a covert P0 implementation; in particular scrutinize the `active without ReviewState → queued` interpretation and the deferred occurrence-grained unique index.

Open issues:
- No blocking P0-contract conflict found. The known deferred legacy values and P5 uniqueness/type debt are listed above as explicit follow-on work, not silently accepted current behavior.
