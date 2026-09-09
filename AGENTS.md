# LearningJ agent guide

## Read the documentation before implementation

LearningJ's documents are a contract, not background reading. Before changing
code, identify the phase and read the relevant sources in this order:

**Contract migration status (2026-09-09):** the study-session, Agent, history,
evidence, and query-projection contracts are reflected in the current product,
data-model, prompt, ADR, design, and phase-plan documents. The task packets
still require a separate synchronization pass and are not ready for dispatch.
This status does not certify implementation or phase completion.

1. `docs/LearningJ-plan-v5.md` for product intent, MVP boundary, and the
   project's only index of open decisions.
2. `docs/mvp-tech-and-phases.md` for the current phase's scope, acceptance
   criteria, and delivery order.
3. `docs/data-model.md` for persistent entities, state transitions, text/span
   conventions, invariants, and fields marked `[不可推迟]`.
4. `docs/prompt-contracts.md` whenever a change creates, renders, consumes, or
   stores analysis, extraction, memory, or prompt data.
5. `docs/adr.md` as the decision index, then the matching
   `docs/adr/NNN-*.md` file (or `docs/adr/archived/NNN-*.md` only for
   historical context) for rationale and explicitly rejected alternatives
   behind a constraint. Do not reintroduce a rejected design without escalating it.
6. `DESIGN.md` for all user-facing work: information architecture, visual
   language, interaction states, accessibility, responsive behavior, and
   shell-independent component ownership.
7. `docs/spike-checklist.md` only when working on an experiment, or when an
   implementation depends on an open empirical decision.
8. The matching `docs/task-packets/P*-*.md` file, if present, for the assigned
   implementation slice.

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
- Do not modify `docs/` or `prompts/` as part of an implementation task. Report
  proposed documentation changes to the lead agent.

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
