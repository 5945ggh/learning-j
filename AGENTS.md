# LearningJ agent guide

## Reader-first dispatch and proportional verification

The user authorized the reader-first development arrangement switch on 2026-09-14.
Start new work at [the current dispatch entry](docs/reader-foundation/README.md).
Old task packets are retained evidence and paused plans, not automatic next tasks.
For newly dispatched work, follow [the testing standard](docs/reader-foundation/testing-standard.md)
to select checks by actual change impact; historical test counts and unrelated
full-suite runs are not automatic gates. This does not relax data integrity,
offset, security, or current feature invariants. An unchanged old packet must
not be reported fully verified when its required checks were omitted; name
the revised verification scope when dispatching under the new standard.

[Reader scope](docs/reader-foundation/scope-draft.md) and
[delivery planning](docs/reader-foundation/delivery-plan-draft.md) now govern the
near-term scope and sequence; their filenames are retained for existing links.
Specific format/interaction decisions remain open as recorded in plan §15.24.
The EPUB research is evidence for bounded decisions, not a field-contract change
or proof of production compatibility. Remote read-only advice must identify its
Git baseline; the local lead reconciles it with the actual worktree before edits.
This switch does not authorize deleting code/data, publishing changes, or claiming
old packets complete. Use the change-reconciliation role described in the dispatch
entry for contract-impacting work; routine visual changes need no extra gate.

## Route reading by what the change touches

LearningJ's documents are contracts, not background reading. Do not read
everything by default: identify the surfaces the change touches, then read the
routed sources first. The current user action is the primary routing key;
phase shortcuts apply only to relevant reused capabilities or explicitly resumed
phase work, not as whole-phase prerequisites for reader slices.

| When the change touches… | Read first |
|---|---|
| Product scope, MVP boundary, open decisions | `docs/LearningJ-plan-v5.md` — §15 is the project's only open-items index; §15.14 settles entry/entity naming and the retired queue label |
| Scope, sequencing, acceptance | `docs/reader-foundation/README.md` for current work; `docs/mvp-tech-and-phases.md` for relevant invariants or explicitly resumed phase work |
| Persistent entities, fields, state transitions, Span/offset conventions, invariants, `[不可推迟]` fields | `docs/data-model.md` — §0 global conventions apply whenever anything is persisted |
| Creating, rendering, consuming, or storing analysis, extraction, memory, or prompt data | `docs/prompt-contracts.md` |
| Database schema or migrations | `docs/adr/042-development-schema-baseline.md` plus `mvp-tech-and-phases.md` §1.6: designated development/test datasets are delete-and-rebuild only; no legacy migrations, backfills, or compatibility branches; a supported baseline with upgrade protection is required only before the first real learning data or external release |
| Why a constraint exists, or whether a design was rejected | `docs/adr.md` as the index, then the matching `docs/adr/NNN-*.md` (`docs/adr/archived/` is historical context only); do not reintroduce a rejected design without escalating it |
| User-facing work: information architecture, visual language, interaction states, accessibility, responsive behavior, shell-independent component ownership | `DESIGN.md` |
| An experiment, or an implementation depending on an open empirical decision | `docs/spike-checklist.md` |
| A dispatched implementation slice | `docs/reader-foundation/README.md`, `docs/work-guidance/<task-ID>.md`, the linked brief and supplied advice; only relevant historical reports. Old packet protocols apply only when explicitly resumed |

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
- `docs/reader-foundation/README.md` owns current dispatch; its linked delivery
  plan owns near-term sequencing. `mvp-tech-and-phases.md` retains phase acceptance
  and relevant invariants, not mandatory progression into paused phases.
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

For reader-first work, the preceding documentation rule has a bounded exception:
the local lead may maintain the assigned task's local plan/delivery record under
`docs/work-guidance/` following its [standard guide](docs/work-guidance/README.md), and
write advice supplied by the user. A separately identified contract-alignment pass
may edit only the contract files/sections explicitly named in the dispatch. Record
the accepted decision and its evidence before implementing the changed behavior;
remote advice alone is not authorization. Ordinary in-scope technical choices do
not need renewed permission. Escalate unresolved product semantics or destructive
changes only for the affected branch. Historical reports, archived material and
versioned prompts remain untouched. The 2026-09-14 arrangement switch separately
authorizes the routing changes to the two current task-packet entry files.

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
