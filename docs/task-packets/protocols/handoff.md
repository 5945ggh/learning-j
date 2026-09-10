# Handoff report protocol

Return this in the implementation agent's final message. It is evidence for the next agent and CR, not a replacement for source contracts.

Also write the same report to `docs/task-packets/reports/<PACKET>-handoff.md` (e.g. `P0-backend-handoff.md`), using the packet ID exactly as it appears in `CURRENT-PACKETS.md`. Create the file, or overwrite the previous round's version on a rework; git history keeps the earlier rounds. Writing this one file is the only write an implementation agent may make under `docs/` — see `docs/task-packets/reports/README.md`. The lead commits it; being tracked is what lets the next agent and the reviewer check the gate from a fresh checkout instead of a chat transcript.

When a review of this packet runs, its output is recorded as a reviewer-owned `## Review` section in that same file (see `code-review.md`); there is no separate CR file. On a rework, overwrite the body but leave an existing `## Review` section in place — the reviewer updates it, and open items there are the next packet's gate input.

```text
STATUS: done | partial | blocked
PACKET: <exact path>
BASELINE: <commit/ref inspected; dirty files preserved>

Contract ledger:
- <source section> — <implemented interpretation>
Changed:
- <path> — <why>
Public contract:
- <endpoint/type/fixture/component/migration/command>
Verified:
- <command or test> — <pass/fail/not run, concise result>
Known limitations:
- <deliberately absent behavior>
Gate for next packet:
- Ready: <demonstrably ready>
- Not safe to assume: <remaining boundary>
CR focus:
- <specific invariant/race/migration/UI/validation risk>
Open issues:
- <conflict, failure, or lead decision>
```

`done` means this packet's acceptance evidence passed and the next gate is explicit; it never completes a whole phase.
