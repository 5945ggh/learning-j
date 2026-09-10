# Packet reports (handoff and code review)

Durable evidence for the packet process. This directory holds the handoff report an
implementation agent produces and the code-review report a reviewer produces, so the
next agent, the CR, and a fresh checkout can read the predecessor's actual claims
instead of relying on a chat transcript.

## Naming

| File | Written by | Content |
|---|---|---|
| `<PACKET>-handoff.md` | the implementing agent | the [handoff report](../protocols/handoff.md) |
| `<PACKET>-cr.md` | the reviewer | the [code-review output](../protocols/code-review.md) |

Use the packet ID exactly as it appears in [CURRENT-PACKETS.md](../CURRENT-PACKETS.md)
(e.g. `P0-backend-handoff.md`, `P0-backend-cr.md`). Keep one current file per packet and
role; overwrite it on a rework or CR re-run. Git history preserves the earlier rounds, so
do not add `-r2` suffixes or separate archives.

## Ownership and commit

- The implementing agent writes `<PACKET>-handoff.md`; the reviewer writes `<PACKET>-cr.md`.
  Writing this one file is the **only** write an implementation agent may make under
  `docs/` (see `AGENTS.md`). Everything else in `docs/` stays read-only input.
- The lead commits the reports; an agent does not need to. They are normal working-tree
  files and show up as untracked until committed.
- Do not `.gitignore` these files. The dispatch procedure checks the predecessor report at
  its gate and CR is handed both reports; an ignored file is invisible to a fresh checkout,
  which is exactly how a report can go missing and leave the gate unverifiable. Keep bulky
  or transient outputs (database copies, raw logs, generated diffs) out of this directory —
  `temp/` is already ignored for that.

## Authority

A report is evidence, not a specification: it records what one agent did, verified, and
left open. On any conflict the current contract sources named by the packet win, and a
report never overrides `data-model.md`, `prompt-contracts.md`, `DESIGN.md`, the ADRs, or
`mvp-tech-and-phases.md`. Write it factually and self-contained enough to be read without
the originating session.
