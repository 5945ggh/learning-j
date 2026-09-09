# Design

## Source of truth
- Status: Active (MVP interaction contract)
- Last refreshed: 2026-09-09
- Contract migration: study-session, Agent, history, evidence, and query-projection changes are reflected in the current contract documents; task packets still require a separate synchronization pass.
- Primary product surfaces: desktop material reader, sentence analysis panel, dictionary lookup surface, AI study workspace, extracted knowledge review
- Evidence reviewed: `docs/mvp-tech-and-phases.md`, `docs/LearningJ-plan-v5.md`, `docs/adr.md`, `docs/data-model.md`, `docs/prompt-contracts.md`
- Accepted visual and interaction reference: `experiments/frontend_samples_v2/reader.html` and `study.html`; `player.html` supplies the dark media surface. These are mockups, not executable business contracts. Reader and player both use the independent Study flow specified below. Samples do not override the current document/editor conversation layout or session lifecycle.

## Brand
- Personality: focused, literate, technically capable, respectful of learner agency
- Trust signals: source context is visible; dictionary, parser, and AI output are clearly distinguished; provenance and persistence are previewed
- Avoid: gamified streak pressure, classroom decoration, generic chat UI, marketing hero layouts, purple-gradient aesthetics

## Product goals
- Goals: keep authentic Japanese material primary; make lookup and syntax inspection immediate; turn deliberate AI study into reusable knowledge; preserve control over what is learned or reviewed
- Non-goals: replace Yomitan, automatically teach every sentence, prescribe a complete curriculum, or run whole-book AI analysis by default
- Success signals: a learner can inspect a word without losing sentence context, then deliberately escalate to AI study or knowledge capture

## Personas and jobs
- Primary personas: technically confident Japanese immersion learners using authentic novels, anime, audio, and existing dictionary/SRS tools
- User jobs: consume a work; resolve a word or structure with minimal interruption; deeply study a chosen sentence; accumulate reusable learning evidence
- Key contexts of use: long desktop reading or viewing sessions with keyboard, mouse, headphones, and optional external Yomitan/Anki data

## Information architecture
- Primary navigation: Library, Study, Knowledge, Review. Library remains the starting material context; Study contains the learning queue and learning records; Knowledge is the persistent knowledge library.
- Material workspace: source text or player is primary, with a collapsible algorithm/dictionary area and a compact current-material learning queue. Three columns are not mandatory.
- Material cards: provide a learning-queue entry with an accurately labeled active-session total; users can select a session without reopening the reader first.
- Study: desktop main area is the current analysis document; the right sidebar is the Agent conversation, with input and visible tool/edit feedback. A compact session navigator may collapse or open as a sheet; it must not displace the conversation or squeeze the document.
- Knowledge: global and material-scoped lists/details show KP, occurrences, source, verified relationship types, retention choice and actual review state. AggregateCard is reusable here and in candidate confirmation. A full interactive graph is deferred; do not invent edges or promise automatic grammar matches.
- Review: due cards with their recorded source content and optional audio.
- Return-to-source restores the material, exact Sentence and reading/playback position.

### Learning queue and records

Use “学习会话” for one learning activity and “学习队列” for active sessions. The queue is a view over StudySession, not an Inbox entity or the internal generation-job queue. Reader/player and material-card entries filter by material; the global entry uses the same records across materials. Lifecycle and query authority: [data-model §4](docs/data-model.md#4-学习会话工作文档与提取).

- Preparation: a row exists immediately and can open Study before generation finishes. Show source context, actual queued/running status and available draft. The user can draft a question; sending discussion waits for the initial document to be committed.
- Discussion: label “可讨论”, including sessions never opened by the user. The complete initial document is available; discussion can change quantity, wording and structure or simply answer a question.
- Extraction: label “提取中” and identify the fixed document version. Disable discussion writes. Failure offers extraction-only retry and keeps the selected source and document.
- Confirmation: label “待确认”; show the current run's distinct KP and both “安排复习” and “仅作参考”. KP with an existing user decision display that choice with an explicit option to accept it for this session. A default value is not an inherited user decision; it requires an explicit choice. Allow partial confirmation and later continuation.
- Completion: remove the session from the active queue and retain it in “学习记录”. A later retention change in Knowledge does not reopen the session. Zero-candidate results explain the outcome and provide “完成学习”.
- Parking: “暂时搁置” removes an unwanted unfinished session from the default queue without deleting it. Records provide resume; settle or cancel in-flight writes before parking.

Show actual stage totals, operation progress and local failures. No unread dots, inferred mastery, overdue debt or pressure to clear the queue. Entering a page is not confirmation. A queue item is a session even if its KP are already known globally.

### Document and Agent interaction

1. “加入 AI 学习” creates an interactive session with source, module choices and optional question, without forced navigation. Ordinary multi-select creates multiple such sessions, each still discussable.
2. “自动生成并提取” is a separate explicit mode. It skips discussion, uses one sentence per session in the first version, and still requires user review choices before new-card scheduling.
3. Study opens immediately. Generation output may stream as a draft; it is labeled unfinished and cannot be extracted. Once committed, the main pane shows the full document and the sidebar remains available for conversation.
4. The Agent can edit sections, reorganize text and update scoped notes/profile through tools. Show working, committed, conflict and failure states; distinguish “AI said it would edit” from a successfully committed change. Keep the reading anchor stable across edits where possible, and expose recent edit/undo information within the configured draft-history window.
5. “结束讨论并提取” waits for or explicitly cancels in-flight editing, then freezes a complete committed document version for extraction. Navigation and app/browser closure do not invoke this action. Hitting an execution budget pauses with a continuation path; it does not implicitly accept the document.
6. Existing backend mappings can navigate source spans to the correct section version. Before extraction, do not fabricate kind or Span links; after editing, do not reuse stale mappings from older document versions.
7. Confirmation displays a choice to review separately from “等待新卡配额” and “已加入复习”. Completing the session does not depend on quota allocation.

### Knowledge and review control

Knowledge retains both srs and reference items. “仅作参考” pauses existing review; switching back restores progress, with no new-card quota charge for an existing card. A KP with no card waits for quota after an explicit srs choice. Do not label reference as deleted, rejected knowledge or failed learning.

Counts and relationships identify their evidence: recorded explanations, algorithmic material occurrences, source links, and explicit merges are different facts. Full learning records remain accessible from each source occurrence. User intent, scheduled-card state and mastery estimates are distinct displays.

### Evidence, coverage and query feedback

- Show material occurrences, recorded evidence coverage, and eligible vocabulary-card review estimates separately. First-release evidence coverage uses the token denominator defined in data-model §10; label a distinct-Lexeme alternative explicitly. No evidence means an estimate has not been established, not zero mastery.
- Evidence details identify the actual source and observation time. Allow withdrawal of an erroneous assertion or imported source. “目前不认识” overrides import and SRS in its scope; “清除我的判断” removes that scope’s override without reviving older assertions. A form-specific clear can still inherit a Lexeme-level decision; show the remaining scope rather than silently changing its meaning.
- Do not equate a review choice, pause, retirement or successful generation with knowing a word. Import review previews selected known-list scope and unresolved/ambiguous/multi-token counts. An ordinary deck is not automatically a known list. Duplicate upload does not silently restore a withdrawn source.
- Show a committed user judgment immediately. A background summary update cannot temporarily reverse it. Import and rebuild surfaces show actual progress, retry/cancel state and atomic publication; do not expose partial counts as a complete result.
- Dynamic SRS estimates carry an evaluation time. Expired results and rebuilding summaries show updating/unavailable or an explicitly dated prior result; never show a fabricated zero during rebuild. Refresh visible data in bounded batches, not one request per token.
- LexemeActivity and reading exposure are deferred. “材料中出现” is supported by the content index; “你读过／见过” requires a future reading/activity producer. Return position does not supply that evidence.
- Orthography/kanji learning and candidate exclusion/extraction recovery remain decisions in plan §15. The current confirmation flow still confirms every distinct KP or parks the session; reference is not rejection of an extraction candidate.

## Design principles
- Lookup keeps the source sentence visible in the material workspace. Study repeats that same Sentence text, retains material context and offers a precise return; it does not require the entire reader to remain alongside the AI document.
- Interaction cost is a value signal. Lightweight lookup is ephemeral; explicitly starting AI study marks intentional learning.
- Do not compete with the browser Yomitan gesture. LearningJ uses an explicit click/tap gesture and does not claim the Option/Alt modifier plus hover path.
- Bookmarking and learning are separate verbs. A lookup is not a KnowledgePoint and does not schedule review.
- State transitions are legible: reading, lookup, focused study, and knowledge capture use distinct labels and surfaces.

## Visual language
- Color: neutral white/black surfaces, grouped gray panels, charcoal/light text; blue identifies algorithm/dictionary support and purple identifies AI. Amber and green express labeled status, not a separate learning-content taxonomy. Use solid semantic accents rather than decorative gradients.
- Light token references: background `#FFFFFF`, group `#F5F5F7`, secondary group `#EFEFF2`, text `#1D1D1F`, secondary text `#6E6E73`, algorithm/dictionary `#0071E3`, AI `#5E5CE6`.
- Dark token references: background `#000000`, group `#1C1C1E`, secondary group `#2C2C2E`, text `#F5F5F7`, algorithm/dictionary `#0A84FF`, AI `#7D7AFF`. Reader, player and Study share semantic tokens. Low-contrast placeholder grays in the samples are not approved accessibility targets; adjust text/accent usage to meet the contrast requirement.
- Typography: Japanese serif for source text and quotations; compact sans serif for controls and metadata
- Spacing/layout rhythm: 4/8px base rhythm; dense toolbars and lists; generous line height in the reading column
- Shape/radius/elevation: small controls about 7px, actions 10px, grouped cards 14px; chips may be pill-shaped. Gray grouping, fine separators and restrained shadows follow the samples. Avoid making every paragraph a floating card.
- Motion: 180-260ms opacity/transform/layout transitions; honor reduced motion
- Imagery/iconography: familiar monochrome symbols; material art may identify the work

## Components
- Component responsibilities: dictionary lookup, token action, session list, analysis document/editor, Agent conversation, confirmation, aggregate and review card. Existing component names may be retained where ownership still fits; do not couple them to shells.
- Lookup states: closed; selected token; loading; one or more dictionary sources; no result; import required; error
- Ownership: components remain shell-independent; a shell chooses whether lookup renders as a popover or drawer
- Session lists, the document editor, conversation pane and confirmation components receive scope, records and callbacks through props. Shells assemble them without importing one another or hiding business lifecycle in route state.

## Accessibility
- Target standard: WCAG 2.2 AA where practical
- Keyboard/focus behavior: selected text and token controls are keyboard reachable; Escape closes a popover/drawer; focus returns to the invoking token; no modifier-only gesture is required
- Contrast/readability: color annotations also carry text labels, icons, or underlines
- Screen-reader semantics: lookup surface uses dialog semantics for a popover and complementary/region semantics for a drawer; source, reading, and definition have explicit labels
- Reduced motion: disable nonessential transitions under `prefers-reduced-motion`

## Responsive behavior
- Desktop-first at 1180px and above; compact layout down to 760px; stacked fallback below 760px
- On wide screens, dictionary lookup opens as a right-side drawer when the reader shell has room; otherwise it opens as an anchored popover
- On narrow screens, lookup becomes a bottom sheet or full-width dialog; never cover the selected sentence without a visible close/back action
- Touch/hover differences: lookup works by click/tap, never hover alone; controls are at least 40px in compact layouts
- Collapse the material queue and Study navigation first. On narrow screens, switch between document and conversation panes with clear tabs/back actions; preserve drafts, scroll and the same session. Do not require the right sidebar to remain visible at mobile widths or copy sample fixed widths.

### Toolbar and lookup boundaries

- Toolbar shape and exact grouping are not frozen by the samples. Keep material navigation, presentation controls and tool visibility compact and separate from the deliberate AI action. Icon controls need accessible names and adequate hit targets; sample icon dimensions do not set the hit area.
- Word lookup must allow changing the selected token without repeatedly backing out through a sidebar navigation stack. If a word detail replaces the algorithm panel, preserve an accessible token/context strip and restore focus on close.
- Horizontal/vertical reading controls and player sentence controls are compatible with this design. They do not create learning records by themselves.

## Interaction states
- Loading: show source name and a compact loading state without shifting the sentence
- Empty: explain that no imported dictionary matched and offer “Import dictionary” or “Search again”
- Error: keep the selected surface and show a local retry; do not discard reader position
- Success: show expression, reading, source label, definitions, tags, and optional metadata; preserve a link back to the sentence
- Disabled: explain unavailable AI or dictionary actions; algorithmic reading remains usable without BYOK
- Offline/slow network: local reader, tokenizer, and imported dictionaries remain available; only network-dependent AI actions show connectivity state

### Dictionary lookup flow (MVP)

1. The algorithm view renders selectable token buttons; a single click/tap (or Enter/Space when focused) selects one token and opens lookup.
2. On wide layouts, lookup opens in a right-side drawer so the sentence and nearby context remain visible. On compact layouts, it opens as an anchored popover; below the mobile breakpoint it becomes a bottom sheet/dialog.
3. Selecting another token updates the same lookup surface in place. A second click does not silently create a bookmark or KnowledgePoint; pinning a result, if needed, is an explicit later action.
4. Escape closes the surface and returns focus to the invoking token. Clicking outside closes only the popover; the drawer has an explicit close button.
5. The surface shows expression, reading, each dictionary source label/version, definitions, tags, and a clear “Start AI study” action that is separate from lookup.

Starting AI study from lookup creates the same asynchronous learning session as the reader and preserves the current reading context. “这个我认识”, “目前不认识”, and “清除我的判断” are explicit user actions in the Lexeme domain; show whether the action targets the Lexeme or only this encountered form. Annotation remains separate. None of these actions creates a KP or ReviewItem. Provenance must name actual dictionary/analyzer resources; an AI claim about syntax or word sense must not be labeled algorithmically verified without supporting backend evidence.

## Content voice
- Tone: calm, precise, concise, learner-respecting
- Terminology: “查词” for dictionary lookup, “算法解析” for deterministic inspection, “加入 AI 学习” for creating a session, “学习队列” for active sessions, “学习记录” for session history, “知识库” for persistent KP, and “AI 学习” for the document/Agent workspace. Distinguish a choice to review from an actually scheduled item; “已加入复习” is reserved for the latter.
- Microcopy: commands use verbs; provenance and state are explicit; do not call a lookup “收藏” or “学习”

## Implementation constraints
- Framework/styling: Vite + React + TypeScript; Tailwind + shadcn/ui; shell-independent components
- Dictionary contract: Yomitan ZIP is an import format, not a UI or domain model; the API returns source/version provenance and text/structured definitions
- Compatibility: do not intercept Option/Alt + hover, browser extension messaging, or Yomitan's modifier gesture
- Performance: opening a lookup surface should be local and immediate after token selection; dictionary search is local once imported
- Sample capability boundary: GiNZA/dependency visualization remains conditional; automatic grammar-pattern re-encounter remains outside MVP. Existing lexical matches and recorded Occurrences may be displayed with explicit provenance, without promising new grammar matches before AI extraction.
- Test expectations: verify click/tap lookup, keyboard invocation, Escape/focus return, popover-to-drawer responsive switch, no-result/error states, and coexistence with a browser Yomitan extension
- Study interaction checks: open preparing sessions from all entry points; submit ordinary multi-select without skipping discussion; commit Agent edits with visible outcomes; preserve context on navigation; extract a fixed version; accept existing choices for this session; keep completed records out of the queue after later Knowledge changes; resume paused review without losing history. These are current design checks, not a claim that the deferred phase acceptance documents have been updated.

## Open questions
- The sole open-decision index is `docs/LearningJ-plan-v5.md` §15. It tracks remaining toolbar/lookup details, onboarding and Agent operating defaults. Queue naming and the absence of navigation-triggered extraction are settled; do not reopen them as unspecified behavior.
