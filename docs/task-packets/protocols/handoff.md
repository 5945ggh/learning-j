# Handoff report protocol

Return this in the implementation agent's final message. It is evidence for the next agent and CR, not a replacement for source contracts.

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
