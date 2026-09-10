# Code-review protocol

## Input from the lead

Exact packet path, predecessor report, implementation handoff, diff/commit, verification output, and current repository state. The reports live at `docs/task-packets/reports/<PACKET>-handoff.md` and (for a prior round) `<PACKET>-cr.md`; treat a missing predecessor report as an unmet gate, not as permission to assume it passed.

## Reviewer instruction

Read `implementation.md`, the packet, named source sections, diff, and relevant tests. Verify the start gate, write scope, current-contract alignment, migration/history safety, idempotency/transaction rules as applicable, API/fixture compatibility, shell independence/accessibility as applicable, and whether tests prove acceptance. Inspect the repository; do not trust the summary. Do not alter code/docs unless commissioned to repair.

## Required output

```text
VERDICT: approve | approve-with-risks | changes-requested | blocked
Findings:
- [P0|P1|P2] <file:line> — <risk; source section; minimal fix>
Evidence checked:
- <diff/test/command/source>
Gate assessment:
- <whether next packet is safe and why>
Residual risks:
- <only real unverified risks>
```

Use P0 for data loss/security/corruption, P1 for a required contract break, P2 for a material non-blocker. With no findings say `Findings: none`.

Write the same output to `docs/task-packets/reports/<PACKET>-cr.md` (e.g. `P0-backend-cr.md`; overwrite on a re-run) as well as returning it in the final message. It is tracked gate evidence, not a contract source.
