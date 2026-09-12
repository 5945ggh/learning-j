# LearningJ agent guide

## Route reading by what the change touches

LearningJ's documents are contracts, not background reading. Do not read
everything by default: identify the surfaces the change touches, then read the
routed sources first. Phase is the primary routing key (see the shortcuts at
the end of this file); the table covers the remaining task types.

| When the change touches… | Read first |
|---|---|
| Product scope, MVP boundary, open decisions | `docs/LearningJ-plan-v5.md` — §15 is the project's only open-items index; §15.14 settles entry/entity naming and the retired queue label |
| Phase scope, sequencing, acceptance | `docs/mvp-tech-and-phases.md` — the assigned phase section, the §3.1 invariant matrix, and the phase shortcuts below |
| Persistent entities, fields, state transitions, Span/offset conventions, invariants, `[不可推迟]` fields | `docs/data-model.md` — §0 global conventions apply whenever anything is persisted |
| Creating, rendering, consuming, or storing analysis, extraction, memory, or prompt data | `docs/prompt-contracts.md` |
| Database schema or migrations | `docs/adr/042-development-schema-baseline.md` plus `mvp-tech-and-phases.md` §1.6: designated development/test datasets are delete-and-rebuild only; no legacy migrations, backfills, or compatibility branches; a supported baseline with upgrade protection is required only before the first real learning data or external release |
| Why a constraint exists, or whether a design was rejected | `docs/adr.md` as the index, then the matching `docs/adr/NNN-*.md` (`docs/adr/archived/` is historical context only); do not reintroduce a rejected design without escalating it |
| User-facing work: information architecture, visual language, interaction states, accessibility, responsive behavior, shell-independent component ownership | `DESIGN.md` |
| An experiment, or an implementation depending on an open empirical decision | `docs/spike-checklist.md` |
| A dispatched implementation slice | the assigned row in `docs/task-packets/CURRENT-PACKETS.md`, `docs/task-packets/protocols/implementation.md`, and the predecessor's report under `docs/task-packets/reports/` |

**Proportionality.** A change that touches none of the contract surfaces —
persistent fields, offsets and Spans, state machines, confirmation /
authorization / review semantics, prompt data, shell boundaries, audit and
idempotency — for example a copy fix, comment, or isolated style adjustment —
only needs the non-negotiable rules below plus the affected component's local
conventions. If the change touches any listed surface, read the routed contract
sections before editing. When in doubt, treat it as touched.

## Archived directories

Any directory named `archived/` contains historical material, not the current
behavior contract. Its local `README.md` may explain the scope of that archive,
but it cannot override this file or the current non-archived contract sources.

- Do not read archived material by default when implementing a current task.
  Read it when the current index links to it, when tracing why a decision was
  rejected or replaced, or when performing an explicit migration or historical
  review.
- Never implement a field, workflow, UI rule, or protocol solely because it
  appears in an archived document. If it conflicts with a current source, the
  current source wins according to the authority rules above.
- Do not rewrite archived material merely to make it agree with current
  behavior. Preserve the historical record; update the current document or
  index instead. Modify an archived document only when the task explicitly
  concerns historical maintenance, and state that intent in the change.
- Before moving, renaming, or deleting an archived file, search for links and
  stable identifiers and preserve historical references where practical.

## Authority and conflict handling

- `data-model.md` and `prompt-contracts.md` are the field- and protocol-level
  source of truth.
- `LearningJ-plan-v5.md` owns product boundary and open-decision tracking.
- `mvp-tech-and-phases.md` owns phase sequencing and acceptance.
- `adr.md` explains why a constraint exists; it does not override a current
  field contract.
- `DESIGN.md` is the source of truth for user-facing design decisions. UI
  components must remain independent of reader/review shells.

If documents conflict, stop the affected change and report the exact files,
sections, and conflict. Do not silently choose an interpretation or edit a
specification to unblock implementation.

## Non-negotiable implementation rules

- Protect referenced analysis versions and recorded learning facts. Current
  workflow state, user intent, notes, annotations and SRS projections may update
  under `data-model.md` §0.1. Automatic processing must not override user choices.
  `reference` pauses review; `retired_at` is for actual retirement, not pausing.
- Persisted text offsets use Unicode code points and half-open ranges. Never
  use JavaScript UTF-16 `String.slice` directly for persisted sentence spans.
- Models provide semantic judgements and original-text surfaces only; backend
  code derives offsets, token alignment, lexemes, anchors, and validations.
- Keep Lexeme, KnowledgePoint, Annotation, StudySession, Analysis, Occurrence, and SRS
  responsibilities separate. A lookup, imported word list, or annotation must
  not silently create a KnowledgePoint.
- Treat every invariant relevant to the phase as executable acceptance work;
  turn the corresponding xfail into a passing test rather than bypassing it.
- Prompt files are versioned artifacts: create a new version instead of editing
  a prompt in place.
- Do not modify `docs/` or `prompts/` as part of an implementation task. A
  separately authorized contract-audit pass may revise the named current core
  documents; it must preserve implementation facts, avoid claiming code or
  phase completion, and leave task-packets, archived material, prompt versions,
  and databases untouched. Everything else in `docs/` and all of
  `prompts/` is read-only input; report proposed documentation changes to the
  lead agent.

## Phase-oriented reading shortcuts

- **P2:** read P2 in `mvp-tech-and-phases.md`, `DESIGN.md`, data-model §§0–2,
  5 and 8, plus ADR-009 and ADR-032.
- **P3:** read P3, `prompt-contracts.md` §§1–4, data-model §§3–6, and ADR-017,
  ADR-020, ADR-029, ADR-037, ADR-038, and ADR-039. Multi-select and
  automatic-mode work also reads plan §6.3.
- **P4:** read P4, `prompt-contracts.md` §§5–7, data-model §§1, 3–4 and 7,
  ADR-005, ADR-017, ADR-034, ADR-035, ADR-037, ADR-039, and spike experiment 2 before treating
  the pattern DSL as frozen.
- **P5:** read P5, data-model §§7 and 10, plan §8, and ADR-019/ADR-023/ADR-039.

Before declaring a phase complete, run its stated acceptance checks and the
smallest relevant tests, then report any remaining open decision or validation
gap.
