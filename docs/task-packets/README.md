# LearningJ implementation handoff packets

This directory preserves the earlier phase-based dispatch layer. A packet names the reading path, owned write surface, acceptance evidence, dependency, and handoff boundary for one delivery slice; it is not a second specification. See [CURRENT-PACKETS.md](CURRENT-PACKETS.md) for the retained catalogue and explicit restoration rules; new work starts at [reader-foundation](../reader-foundation/README.md).

## Dispatch status (2026-09-14)

The current implementation entry point is [docs/reader-foundation/README.md](../reader-foundation/README.md). New work is dispatched from that reader-foundation plan; the packet catalogue below is retained as historical delivery evidence and as a restoration registry for explicitly resumed legacy packets. Unstarted packets, including `P2-known-import`, `P3`–`P5`, and future experiments, are paused and are not automatically dispatched. If one is resumed, re-scope it against the current reader-foundation plan and current contracts before dispatch.

Existing handoff reports and review records remain historical evidence exactly as recorded. Their presence does not declare the old roadmap complete or require its continuation. The packet procedure, dependency graph, layered ownership, and universal gates below apply only when the lead explicitly restores a legacy packet.

## Legacy packet dispatch procedure

When a legacy packet is explicitly restored, the lead may dispatch an implementation agent with: **“Read `docs/task-packets/CURRENT-PACKETS.md`, implement packet `<ID>`.”** The packet row requires the agent to locate and read the relevant contract sources itself. Current reader-foundation work follows [its own dispatch guidance](../reader-foundation/README.md) and [the reader testing standard](../reader-foundation/testing-standard.md).

1. Check the packet's **Start gate** and its predecessor's handoff report at `reports/<predecessor>-handoff.md`. `STATUS: done` alone is not a gate, and a missing report is an unmet gate — not permission to guess.
2. Give one agent one packet. Parallel agents share only declared public contracts and never edit the same owned files.
3. The agent records its contract ledger, implements its bounded slice, and returns [the handoff report](protocols/handoff.md), also writing it to `reports/<ID>-handoff.md`.
4. For CR, supply a new, read-only agent the exact packet path, predecessor report, implementation report, diff/commit, test output, and [the CR protocol](protocols/code-review.md); the reviewer records its verdict in the `## Review` section of `reports/<ID>-handoff.md`.
5. The lead resolves findings. An integration packet is the normal point where a phase's public contract is published.

`partial` and `blocked` are useful outcomes: never dispatch past an unmet start gate. Implementers may not edit `docs/`, `prompts/`, or `DESIGN.md`, except their own report under [reports/](reports/README.md). A packet has one report file: the handoff body plus any reviewer-owned `## Review` section. Reports are committed gate evidence — the lead commits them, and they are deliberately not gitignored so the next agent and the reviewer can read them from a fresh checkout.

## Legacy dependency graph

```text
P0-contract → P0-backend + P0-frontend → P0-integration
  → P1-backend + P1-frontend → P1-integration
  → P2-backend + P2-frontend → P2-integration → experiment-11a
  → P3a-backend + P3a-frontend → P3a-integration
  → P3b-backend + P3b-frontend → P3b-integration
  → P4a-backend + P4a-frontend → P4a-integration → experiment-2-patterns
  → P4b-backend + P4b-frontend → P4b-integration
  → P5-backend + P5-frontend → P5-integration → experiment-11b
```

The `P2-known-import` row is an independent packet after P2 and must not block P3–P5. Conditional GiNZA work needs its own approved packet; never hide it in P2.

## Authority rule

On conflict, stop the affected work and name exact sections. `data-model.md` and `prompt-contracts.md` own fields/protocols; `LearningJ-plan-v5.md` owns product scope; `mvp-tech-and-phases.md` owns sequence/acceptance; `DESIGN.md` owns UI; named current ADRs give rationale. Archived ADRs and mock samples are never current authority.
