# Packet reports

Durable evidence for the packet process. One report per packet,
`reports/<PACKET>-handoff.md`, written by the implementing agent and — when a review runs —
carrying a reviewer-owned `## Review` section. Keeping it in version control lets the next
agent, the reviewer, and a fresh checkout read the actual claims and their verification
instead of a chat transcript.

## Naming

| File | Written by | Content |
|---|---|---|
| `<PACKET>-handoff.md` | the implementing agent | the [handoff report](../protocols/handoff.md) |
| its `## Review` section | the reviewer | the [code-review output](../protocols/code-review.md) |

Use the packet ID exactly as it appears in [CURRENT-PACKETS.md](../CURRENT-PACKETS.md)
(e.g. `P0-backend-handoff.md`). Keep one file per packet; overwrite it on a rework. Git
history preserves the earlier rounds, so do not add `-r2` suffixes or separate archives.

There is no separate `<PACKET>-cr.md`: the review lives in the handoff so a packet has one
evidence file, while the review output keeps its own format inside that section.

## Ownership and commit

- The implementing agent writes the handoff body; the reviewer writes the `## Review`
  section. Writing this one file (and only this file) is the only write an implementation
  agent may make under `docs/` — see `AGENTS.md`. Everything else in `docs/` stays read-only.
- On a rework the implementer overwrites the handoff body but **must leave the existing
  `## Review` section in place**; the reviewer updates it on the next review. If a review
  left items open, those items are the next packet's gate input — dropping the section
  silently deletes that evidence.
- A review is not required for every packet; the lead decides when to run one. When a review
  does run it records at least the `VERDICT`, any open findings, and residual risks; a clean
  pass may be a short block. Never write an empty review section.
- The lead commits reports. They are normal working-tree files and show up as untracked
  until committed.
- Do not `.gitignore` reports. The dispatch procedure checks the predecessor report at its
  gate and the reviewer is handed it; an ignored file is invisible to a fresh checkout, which
  is how a report goes missing and leaves the gate unverifiable. Keep bulky or transient
  outputs (database copies, raw logs, generated diffs) out of this directory — `temp/` is
  already ignored for that.

## Authority

A report is evidence, not a specification: it records what one agent did, what was
independently verified, and what was left open. On any conflict the current contract sources
named by the packet win, and a report never overrides `data-model.md`, `prompt-contracts.md`,
`DESIGN.md`, the ADRs, or `mvp-tech-and-phases.md`. Write it factually and self-contained
enough to be read without the originating session.
