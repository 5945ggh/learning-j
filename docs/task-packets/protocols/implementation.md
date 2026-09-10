# Implementation protocol

Before coding, read the packet and every named source, then inspect existing code and the predecessor report at `docs/task-packets/reports/<PACKET>-handoff.md`, including any `## Review` section (and, when reworking, the review of your own previous round). Start with a short **contract ledger**: confirmed facts with source sections, assumptions you refuse to make, owned files, and blockers. A packet, mock, legacy schema, or prior agent report cannot override a current contract.

Implement only the assigned slice and preserve unrelated working-tree changes. Add/adjust behavior tests before relaxing assertions. Persistent offsets are Unicode code-point half-open ranges; models supply semantics/original text only; provider I/O stays outside DB transactions; automatic work never overwrites user choices or historical references.

Inspect the diff and run acceptance commands before completion. Report real command output, never an assumed pass. On a source conflict, unmet gate, or cross-scope need, stop that part and report `blocked`; do not edit specifications to unblock code.
