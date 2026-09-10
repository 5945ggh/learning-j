# LearningJ implementation handoff packets

This directory is the dispatch layer between the current product contracts and implementation agents. A packet is deliberately not a second specification: it names the precise reading path, owned write surface, acceptance evidence, dependency, and handoff boundary for one bounded delivery slice. Dispatch from [CURRENT-PACKETS.md](CURRENT-PACKETS.md).

## Dispatch procedure

The lead may dispatch an implementation agent with only: **“Read `docs/task-packets/CURRENT-PACKETS.md`, implement packet `<ID>`.”** The packet row requires the agent to locate and read the relevant contract sources itself.

1. Check the packet's **Start gate** and its predecessor's handoff report at `reports/<predecessor>-handoff.md`. `STATUS: done` alone is not a gate, and a missing report is an unmet gate — not permission to guess.
2. Give one agent one packet. Parallel agents share only declared public contracts and never edit the same owned files.
3. The agent records its contract ledger, implements its bounded slice, and returns [the handoff report](protocols/handoff.md), also writing it to `reports/<ID>-handoff.md`.
4. For CR, supply a new, read-only agent the exact packet path, predecessor report, implementation report, diff/commit, test output, and [the CR protocol](protocols/code-review.md); the reviewer records its verdict in the `## Review` section of `reports/<ID>-handoff.md`.
5. The lead resolves findings. An integration packet is the normal point where a phase's public contract is published.

`partial` and `blocked` are useful outcomes: never dispatch past an unmet start gate. Implementers may not edit `docs/`, `prompts/`, or `DESIGN.md`, except their own report under [reports/](reports/README.md). A packet has one report file: the handoff body plus any reviewer-owned `## Review` section. Reports are committed gate evidence — the lead commits them, and they are deliberately not gitignored so the next agent and the reviewer can read them from a fresh checkout.

## Current dependency graph

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
