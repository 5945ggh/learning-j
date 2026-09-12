STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P0-frontend
BASELINE: HEAD=58d2d0256f8ae6670f84e0364feab84a4d2bbfc9; preserved all pre-existing dirty and untracked files

Contract ledger:
- docs/LearningJ-plan-v5.md §§1-3 and 3/P0 — P0 frontend is limited to material browsing and location preparation; it must not implement AI learning, analysis, extraction, candidates, review, or reading-activity claims.
- docs/mvp-tech-and-phases.md P0 §§1.2 and 3/P0 — consume the material-only OpenAPI/fixture contract; obsolete analysis endpoints must not be called; preserve the independent material browsing shell.
- DESIGN.md 组件／无障碍／响应式 — components receive data and callbacks through props, remain shell-independent, preserve readable source context, and keep keyboard-accessible controls and explicit status labels.
- docs/adr/023-shell-independence.md — components may not depend on reader, Study, review shells, routing, or hidden shell-owned lifecycle; shells compose independent components.
- docs/task-packets/reports/P0-contract-handoff.md — current material endpoints are `/materials`, `/materials/{material_id}/sentences`, and `/materials/{material_id}/sidecar`; legacy Analysis state/API is not authoritative; code-point offsets are half-open.
- docs/task-packets/protocols/implementation.md and handoff.md — preserve unrelated dirty changes, write this report as the only docs change, verify with real command output, and report a gate explicitly.

Assumptions refused:
- Do not infer or recreate an AnalysisPanel, StudySession, AI endpoint, provider state, extraction state, KP, Occurrence, ReviewItem, or reading-activity metric from legacy/demo material.
- Do not assume `anchor_payload` contains only numeric values; the frontend must preserve the generated OpenAPI/material fixture shape without inventing fields.
- Do not treat selecting a sentence as a learning action or a reading-exposure fact.

Owned files:
- `frontend/` implementation and behavior tests.
- This report only under `docs/task-packets/reports/`.

Blockers:
- None identified at ledger time.

Changed:
- `frontend/src/shells/MaterialWorkspace.tsx` — keeps loading, cancellation, selection, and error state in the shell while composing independent material components; no AnalysisPanel or AI lifecycle remains.
- `frontend/src/components/MaterialList.tsx` — renders material selection from props.
- `frontend/src/components/SentenceList.tsx` — renders source sentences and selection from props; EPUB anchor display narrows untrusted payload values before rendering.
- `frontend/src/components/SentenceContext.tsx` — renders selected source context only; EPUB anchor display is type-safe.
- `frontend/src/lib/materials.ts` — models the material-only OpenAPI surface, including sidecar provenance, validates JSON boundaries, URL-encodes IDs, and preserves arbitrary anchor payload values.
- `frontend/src/lib/text.ts` — provides the shared code-point length/slicing helper and branded sentence text type.
- `frontend/src/lib/materials.test.ts` — adds material/sentence/sidecar fixture-shaped API behavior tests, malformed response handling, URL encoding, and HTTP failure behavior.
- `frontend/src/lib/text.test.ts` — covers supplementary code points, half-open slicing, negative/out-of-range indices, and ZWJ code-point behavior.
- `frontend/eslint.config.js` — enforces shell/router independence for components and rejects bare string slicing.

Public contract:
- `GET /materials` returns validated `Material[]` with OpenAPI kinds `subtitle_video|subtitle_audio|text|epub`.
- `GET /materials/{material_id}/sentences` returns validated `Sentence[]`; `anchor_payload` remains an open JSON object and all persisted offsets are treated as code-point half-open ranges.
- `GET /materials/{material_id}/sidecar` returns validated sidecar provenance and payload without introducing an AI or analysis contract.
- Material and sentence components accept data and callbacks through props; components do not import shells or routing.
- `sliceByCodePoint()` is the only frontend string-range helper for persisted sentence offsets.

Verified:
- `cd frontend && pnpm lint` — pass; ESLint completed with no errors.
- `cd frontend && pnpm test` — pass; 2 test files and 13 tests passed.
- `cd frontend && pnpm build` — pass; `tsc -b` and Vite production build completed, output included `dist/assets/index-CdjKvpW4.js` and `index-Dl7-fXFe.css`.
- `cd frontend && rg -n -i 'AnalysisPanel|analysis\\.ts|/analysis|/questions|/extract|/retention|/knowledge-points|session_closed|turn_count|extraction_status|extraction_trigger' src --glob '!**/*.test.*'` — pass; no forbidden legacy frontend markers.
- `cd frontend && rg -n "from ['\\\"](?:\\.\\.?/)*shells|from ['\\\"]react-router" src/components` — pass; no component shell/router imports.
- `cd frontend && rg -n '\\.(slice|substring|substr)\\(' src --glob '!**/text.ts' --glob '!**/*.test.*'` — pass; no bare string slicing outside the helper.

Known limitations:
- P0 has no algorithmic tokenization, dictionary lookup, AI, extraction, review, or reading-activity behavior.
- The sidecar client is typed and validated for the current endpoint but is not fetched by the P0 browsing screen; token rendering belongs to P2.
- Backend OpenAPI generation and fixture generation are owned by P0-contract/P0-backend; this packet validates the frontend against their published material shapes through fixture-shaped tests.

Gate for next packet:
- Ready: P0-integration can verify the frontend against the generated backend OpenAPI and material fixture, with no obsolete AI calls and with ADR-023/code-point static gates passing.
- Not safe to assume: algorithmic tokens, Yomitan lookup, StudySession, AnalysisRevision, extraction, KP/Occurrence, ReviewItem, scheduling, or reading activity exist in the frontend.

CR focus:
- Verify no obsolete analysis/AI endpoint or embedded AnalysisPanel remains in frontend source or output, component imports preserve ADR-023 direction, and arbitrary fixture anchor payloads are not narrowed into a false numeric contract.

Open issues:
- None; no contract conflict or cross-scope change was required.

## Review

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
VERDICT: changes-requested
Findings:
- [P1] frontend/src/lib/materials.ts:97 — The client requires anchor_payload but SentenceOut currently makes it optional through default_factory. Backend must align the required field with data-model §8.2 and regenerate OpenAPI/fixtures; frontend must not silently weaken that contract.
- [P1] frontend/src/components/SentenceContext.tsx:7 and SentenceList.tsx:10 — Invalid/missing EPUB spine_index silently becomes 0, inventing a valid location. Validate nonnegative integers at the API boundary or represent unavailable location explicitly, with regression coverage.
- [P2] The two components duplicate untrusted anchor parsing. Centralize the validated result or a shared number/null parser.
Evidence checked:
- Reviewer inspected frontend changes, backend schemas/fixtures, data-model §8.2 and P0/P1 contracts; TypeScript diagnostics and static boundary scans were clean.
Gate assessment:
- P0-frontend requires repairs and re-review before a clean gate.
Residual risks:
- Existing passing tests omit optional anchor_payload and invalid EPUB spine_index cases.
```
