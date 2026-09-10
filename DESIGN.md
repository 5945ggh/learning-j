# Design

## Source of truth
- Status: Active (MVP interaction contract)
- Last refreshed: 2026-09-10
- Design direction update: the application shell and material-library baseline now follow a modern, restrained Apple Books-like reading aesthetic. This is a product direction, not a pixel-level imitation of Apple UI.
- Contract migration: study-session, Agent, history, evidence, query-projection, and occurrence-review-target ([ADR-041](docs/adr/041-occurrence-review-targets.md)) changes are reflected in this document. The task-packet catalogue (`docs/task-packets/CURRENT-PACKETS.md`) was re-synced to ADR-041 on 2026-09-10. The top-level navigation is decided here (“主页”, “素材库”, “知识库”, “解析队列”, “学习中心”); `docs/LearningJ-plan-v5.md` §3 and §15 still record the previous entry names and need a lead-owned sync.
- Primary product surfaces: desktop application shell, material library, material reader/player, sentence analysis and dictionary lookup, AI study workspace, extracted knowledge review
- Evidence reviewed: `docs/mvp-tech-and-phases.md`, `docs/LearningJ-plan-v5.md`, `docs/adr.md`, `docs/data-model.md`, `docs/prompt-contracts.md`
- Accepted visual and interaction reference: Apple Books and related Apple native applications as a reference for calm hierarchy, sidebar navigation, restrained controls, and content-first surfaces. `experiments/frontend_samples_v2/reader.html` and `study.html` remain useful interaction mockups; `player.html` supplies a media-surface reference. These are mockups, not executable business contracts. Samples do not override the current document/editor conversation layout or session lifecycle.

## Brand
- Personality: focused, literate, technically capable, respectful of learner agency
- Baseline mood: modern, quiet, tactile, and book-like; the interface should feel suitable for long reading sessions rather than a dashboard or chat tool
- Trust signals: source context is visible; dictionary, parser, and AI output are clearly distinguished; provenance and persistence are previewed
- Inspiration: Apple Books, Finder, Photos, and other Apple native applications may inform spatial hierarchy, material surfaces, typography, and interaction restraint. Reuse the principles, not proprietary assets or an exact visual clone.
- Avoid: gamified streak pressure, classroom decoration, generic chat UI, marketing hero layouts, decorative gradients, and indiscriminate translucency

## Product goals
- Goals: keep authentic Japanese material primary; make lookup and syntax inspection immediate; turn deliberate AI study into reusable knowledge; preserve control over what is learned or reviewed
- Non-goals: replace Yomitan, automatically teach every sentence, prescribe a complete curriculum, or run whole-book AI analysis by default
- Success signals: a learner can inspect a word without losing sentence context, then deliberately escalate to AI study or knowledge capture

## Personas and jobs
- Primary personas: technically confident Japanese immersion learners using authentic novels, anime, audio, and existing dictionary/SRS tools
- User jobs: consume a work; resolve a word or structure with minimal interruption; deeply study a chosen sentence; accumulate reusable learning evidence
- Key contexts of use: long desktop reading or viewing sessions with keyboard, mouse, headphones, and optional external Yomitan/Anki data

## Information architecture
- Application shell navigation, in order: “主页”, “素材库”, “知识库”, “解析队列”, “学习中心”. A settings entry remains anchored at the bottom of the navigation rail.
- “主页” is reserved for a later product decision and is intentionally not specified in this revision.
- The four defined entries form one pipeline over the same records, separated by the user's scheduling decision: “素材库” holds the input material; “解析队列” holds unfinished learning sessions before that decision; “学习中心” holds what the user has chosen to learn together with review and session history; “知识库” holds the persistent knowledge assets. No entry introduces an entity, a second authority for StudySession, AnalysisRevision or extraction state, or a duplicated pending state.
- “解析队列” is the global, filterable view over unfinished learning sessions (`status = active`) and reuses the same component and query authority as the material-scoped queue ([data-model §4.1](docs/data-model.md#41-studysession学习会话)). Its navigation label names the dominant activity, not the entire content: an item may already be at 可讨论, 提取中 or 待确认. Stage is a filter inside this one queue and never a second queue. The entity keeps its own name (“学习会话”); “解析队列” is a view label, not a second entity and not a rename. Retire the older “学习队列” wording, which backed no user-facing label and collided with both “学习中心” and the internal job queue.
- Term layers, so the several “队列” usages stay apart: entity = “学习会话”; view = “解析队列” globally and the material-scoped session list; plan and scheduling = “学习中心”, whose due set is “今日到期”; history = “学习记录”; internal runtime = “执行任务队列”, never a user-facing label. A future recommendation feature proposes candidate sentences to analyze — not knowledge points to learn — and would feed “解析队列”.
- “学习中心” is the aggregation shell for the learning plan and review work: new-card introduction, due review, learning records, and material-scoped entries into the same views. It derives everything from existing scheduling records and adds no entity, no separate pending state and no second todo list.
- Material workspace: source text or player is primary, with a collapsible algorithm/dictionary area and a compact current-material learning queue. Three columns are not mandatory.
- Material library: provide a mode switch between “书目” and “视听”. Book materials use vertical cards with the cover as the visual anchor, concise metadata along the lower edge, and a three-dot overflow action for editing metadata and other material actions. Audio/video materials may use a different aspect ratio and playback affordances while reusing the same material-card ownership and spacing system.
- Material cards: provide a learning-queue entry with an accurately labeled active-session total; users can select a session without reopening the reader first. The overflow menu must not turn a lightweight material action into a hidden learning or deletion action.
- Study: desktop main area is the current analysis document; the right sidebar is the Agent conversation, with input and visible tool/edit feedback. A compact session navigator may collapse or open as a sheet; it must not displace the conversation or squeeze the document.
- Knowledge: global and material-scoped lists/details show KP, occurrences, source, verified relationship types, per-Occurrence retention together with the KP default policy it inherits or overrides, and actual review state. AggregateCard is reusable here and in candidate confirmation. A full interactive graph is deferred; do not invent edges or promise automatic grammar matches.
- Review: due cards with their recorded source content and optional audio, presented inside “学习中心” rather than as a separate navigation entry.
- Return-to-source restores the material, exact Sentence and reading/playback position.

### 解析队列 (learning queue) and records

Use “学习会话” for one learning activity; its global unfinished view is labelled “解析队列” in the shell, and the entity keeps its own name. Do not call that queue “学习队列”: the older wording backed no user-facing label and collided with “学习中心” and with the internal job queue. The queue is a view over StudySession, not an Inbox entity or the internal generation-job queue. Reader/player and material-card entries filter by material; the global entry uses the same records across materials. Lifecycle and query authority: [data-model §4](docs/data-model.md#4-学习会话工作文档与提取).

- Preparation: a row exists immediately and can open Study before generation finishes. Show source context, actual queued/running status and available draft. The user can draft a question; sending discussion waits for the initial document to be committed.
- Discussion: label “可讨论”, including sessions never opened by the user. The complete initial document is available; discussion can change quantity, wording and structure or simply answer a question.
- Extraction: label “提取中” and identify the fixed document version. Disable discussion writes. Failure offers extraction-only retry and keeps the selected source and document.
- Confirmation: label “待确认”; the candidate list is folded by KP for reading, but the confirmation unit is the Occurrence. For every distinct Occurrence of the current successful run, offer both “安排复习” and “仅作参考” and record a per-Occurrence decision. The KP fold is a display convenience and never changes what is confirmed—including when a KP appears as a single row, each of its Occurrences carries its own choice. A KP default is not an inherited user decision: it may be shown as the current default and may be pre-selected or greyed, but every Occurrence still requires its own explicit choice. When a KP already carries a user decision, display that value as the default and provide an explicit per-Occurrence accept; a bulk “一并沿用并完成” affordance must enumerate the affected Occurrences and the value it will record. Allow partial confirmation and later continuation. Choosing “安排复习” creates or reuses that Occurrence's ReviewItem in the same commit as the decision.
- Completion: the session leaves the active queue only once every distinct Occurrence of the current run has a confirmation for this run, and is retained in “学习记录”. A later retention change in Knowledge does not reopen the session. Zero-candidate results explain the outcome and provide “完成学习”.
- Parking: “暂时搁置” removes an unwanted unfinished session from the default queue without deleting it. Records provide resume; settle or cancel in-flight writes before parking.

Show actual stage totals, operation progress and local failures. No unread dots, inferred mastery, overdue debt or pressure to clear the queue — these are not surfaced even when the data exists. Entering a page is not confirmation. A queue item is a session even if its KP are already known globally.

### Learning center

“学习中心” is the shell for the user's learning plan and review work. It presents the unified new-and-due queue, learning records, and material-scoped entries into the same views.

- One queue, two legitimate segments. Introducing a new card and reviewing a due card use the same FSRS memory model; the only algorithm split is the one-time initialization of a card's memory state before it has any review history. Present “新卡” and “到期复习” as labeled segments of one session driven by daily budgets and user filtering, not as two applications.
- Segment derivation. Derive the segments from existing scheduling records rather than adding a card-type field: “等待新卡配额” is an item not yet admitted to scheduling, “新卡” is an admitted item that has not been graded yet and therefore has no memory state, and “复习” is a graded item with a memory state that is due (plan §8, [data-model §7](docs/data-model.md#7-srs)).
- Budget and selection. The daily new-card quota and the due set determine what today contains; the user may narrow, filter or reorder within that set. Ordering the user's already-added but not-yet-scheduled items is part of that quota mechanism, not a recommendation. The deferred recommendation feature (ADR-022) works one level upstream and its reason is structural: because the product does not run whole-material AI preprocessing, no knowledge points exist ahead of a study session, so the only thing that can be proposed is sentences that have not been analyzed yet, ranked by estimated information value, difficulty and density — and its output would feed “解析队列”. It never proposes knowledge points to learn, and it is not part of this shell.
- Review threshold. A user-configured due or recall threshold is a scheduling parameter over FSRS retrievability evaluated at an explicit time. It must not be presented as, or conflated with, a mastery or combined-estimate threshold, which remains uncalibrated (plan §15.16, [data-model §10](docs/data-model.md#10-统计口径与跨层依赖)).
- No pressure. Show what today contains and how far along it is, but never overdue debt, streak pressure, inferred mastery or unread dots — not even when the underlying data exists and could be computed. An empty day is a legitimate state, not a failure.
- Records. Completed and parked sessions live here as “学习记录”, retaining the document, conversation, extraction source and per-Occurrence outcome they recorded. A later retention change in Knowledge does not reopen them.
- The AI study workspace is not a navigation destination. Study opens as a full-screen surface pushed from “解析队列”, “素材库” or “学习中心”, keeping the same session, position and drafts; on narrow screens it switches between document and conversation.

### Document and Agent interaction

1. “加入 AI 学习” creates an interactive session with source, module choices and optional question, without forced navigation. Ordinary multi-select creates multiple such sessions, each still discussable.
2. “自动生成并提取” is a separate explicit mode. It skips discussion, uses one sentence per session in the first version, and still requires user review choices before new-card scheduling.
3. Study opens immediately. Generation output may stream as a draft; it is labeled unfinished and cannot be extracted. Once committed, the main pane shows the full document and the sidebar remains available for conversation.
4. The Agent can edit sections, reorganize text and update scoped notes/profile through tools. Show working, committed, conflict and failure states; distinguish “AI said it would edit” from a successfully committed change. Keep the reading anchor stable across edits where possible, and expose recent edit/undo information within the configured draft-history window.
5. “结束讨论并提取” waits for or explicitly cancels in-flight editing, then freezes a complete committed document version for extraction. Navigation and app/browser closure do not invoke this action. Hitting an execution budget pauses with a continuation path; it does not implicitly accept the document.
6. Existing backend mappings can navigate source spans to the correct section version. Before extraction, do not fabricate kind or Span links; after editing, do not reuse stale mappings from older document versions.
7. Confirmation records a review choice per Occurrence, separately from “等待新卡配额” and “已加入复习”. Choosing “安排复习” creates or reuses the ReviewItem for that Occurrence atomically, in the same commit as the decision; an item that has not yet received new-card quota is shown as waiting for quota, not as joined. Completing the session does not depend on quota allocation.

### Knowledge and review control

Knowledge retains both srs and reference items. Retention is decided per Occurrence, with the KP value acting as a default policy that an Occurrence may inherit or override; the local value and whether the user has actually confirmed it are separate facts. “仅作参考” pauses existing review for the affected Occurrences; switching back restores progress, with no new-card quota charge for an existing card. An Occurrence confirmed to srs without available quota waits as queued; a KP default policy alone never authorizes a card. Do not label reference as deleted, rejected knowledge or failed learning.

Counts and relationships identify their evidence: recorded explanations, algorithmic material occurrences, source links, and explicit merges are different facts. Full learning records remain accessible from each source occurrence. User intent, scheduled-card state and mastery estimates are distinct displays.

### Evidence, coverage and query feedback

- Show material occurrences, recorded evidence coverage, and eligible vocabulary-card review estimates separately. First-release evidence coverage uses the token denominator defined in data-model §10; label a distinct-Lexeme alternative explicitly. No evidence means an estimate has not been established, not zero mastery.
- Evidence details identify the actual source and observation time. Allow withdrawal of an erroneous assertion or imported source. “目前不认识” overrides import and SRS in its scope; “清除我的判断” removes that scope’s override without reviving older assertions. A form-specific clear can still inherit a Lexeme-level decision; show the remaining scope rather than silently changing its meaning.
- Do not equate a review choice, pause, retirement or successful generation with knowing a word. Import review previews selected known-list scope and unresolved/ambiguous/multi-token counts. An ordinary deck is not automatically a known list. Duplicate upload does not silently restore a withdrawn source.
- Show a committed user judgment immediately. A background summary update cannot temporarily reverse it. Import and rebuild surfaces show actual progress, retry/cancel state and atomic publication; do not expose partial counts as a complete result.
- Dynamic SRS estimates carry an evaluation time. Expired results and rebuilding summaries show updating/unavailable or an explicitly dated prior result; never show a fabricated zero during rebuild. Refresh visible data in bounded batches, not one request per token.
- LexemeActivity and reading exposure are deferred. “材料中出现” is supported by the content index; “你读过／见过” requires a future reading/activity producer. Return position does not supply that evidence.
- Orthography/kanji learning and candidate exclusion/extraction recovery remain decisions in plan §15. The current confirmation flow still confirms every distinct Occurrence of the current run or parks the session; a KP-level fold is a display convenience, not a completion unit, and reference is not rejection of an extraction candidate.

## Design principles
- Lookup keeps the source sentence visible in the material workspace. Study repeats that same Sentence text, retains material context and offers a precise return; it does not require the entire reader to remain alongside the AI document.
- Interaction cost is a value signal. Lightweight lookup is ephemeral; explicitly starting AI study marks intentional learning.
- Do not compete with the browser Yomitan gesture. LearningJ uses an explicit click/tap gesture and does not claim the Option/Alt modifier plus hover path.
- Bookmarking and learning are separate verbs. A lookup is not a KnowledgePoint and does not schedule review.
- State transitions are legible: reading, lookup, focused study, and knowledge capture use distinct labels and surfaces.

## Visual language
- Color: ivory and deep gray form the default theme. The application shell uses a restrained glass-like background board; content surfaces remain opaque or nearly opaque where reading, definitions, and controls need reliable contrast. Algorithm/dictionary and AI accents remain semantic and subdued rather than defining the whole palette. Amber and green express labeled status, not a separate learning-content taxonomy.
- Baseline token references: canvas `#EEEAE2`, glass surface `rgba(255, 255, 255, 0.62)`, page `#FFFCF5`, group `#F3F0E9`, secondary group `#E8E3DA`, text `#292929`, secondary text `#6F6B64`, divider `rgba(41, 41, 41, 0.12)`. These are initial references, not a substitute for contrast testing.
- Semantic accent references: algorithm/dictionary uses a restrained blue and AI uses a restrained violet; status colors remain labeled and low-area. Accent values must be defined as semantic variables so a future theme pack can replace them without changing component logic.
- Dark and alternate themes: do not hard-code light-theme values into components. Define semantic tokens for canvas, glass, opaque surface, page, grouped surface, text, border, shadow, algorithm, AI, warning, and success. Future color/style packs may change these variables while preserving interaction states and readable contrast.
- Typography: Japanese serif for source text and quotations; compact sans serif for controls and metadata
- Spacing/layout rhythm: 4/8px base rhythm; dense toolbars and lists; generous line height in the reading column
- Shape/radius/elevation: small controls about 7px, actions 10px, grouped cards 14px, and the reading page may use a restrained larger radius. Use fine separators and layered, soft shadows to establish the glass board/page relationship. Avoid making every paragraph a floating card or adding blur behind dense text.
- Motion: 180-260ms opacity/transform/layout transitions; honor reduced motion
- Imagery/iconography: familiar monochrome symbols; material art may identify the work

### Application shell and material surfaces

- The desktop shell is a glass-like background board with a left navigation rail and a spacious content region. Glass is a spatial material, not a content color: opaque or near-opaque pages, cards, dialogs, and text-heavy panels sit above it.
- The navigation rail presents the five primary entries in the defined order and keeps settings visually separate at the bottom. Selected state uses a quiet surface change, clear label, and accessible state—not color alone.
- The material library is the first detailed surface to design. Its two modes, “书目” and “视听”, share a view-switching pattern, page margins, search/import affordances, empty states, and material-card contracts.
- Book cards are vertically oriented. The cover occupies most of the card, while the lower edge carries the name and only the most useful metadata. A three-dot action opens material management without competing with the cover or primary open action.
- Entering a book opens a white or warm-white reading page over the glass board. The page is the reader’s stable content frame; background blur, decorative art, and shell motion must never reduce text legibility or shift the reading anchor.
- Material-specific treatment may vary by mode or future style pack, but navigation, card actions, source context, and return-to-source behavior remain consistent.

## Components
- Component responsibilities: application shell/navigation rail, material mode switch, material card, material overflow menu, dictionary lookup, token action, session list, analysis document/editor, Agent conversation, confirmation, aggregate and review card. Existing component names may be retained where ownership still fits; do not couple them to shells.
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
- Terminology: “查词” for dictionary lookup, “算法解析” for deterministic inspection, “加入 AI 学习” for creating a session, “学习会话” for one learning activity, “解析队列” for the global view of unfinished sessions, “学习记录” for session history, “学习中心” for the new-and-due learning shell, “知识库” for persistent KP, and “AI 学习” for the document/Agent workspace. “安排复习” states an intent to add an Occurrence to the learning plan; it is not a claim that the item has been learned. Distinguish a per-Occurrence review choice from an actually scheduled item, and a KP default policy from a decision the user has confirmed; “已加入复习” is reserved for an item that has actually been admitted to scheduling, not for a choice that is still waiting for quota.
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
- The sole open-decision index is `docs/LearningJ-plan-v5.md` §15. It tracks remaining toolbar/lookup details, onboarding and Agent operating defaults. The navigation labels decided in this document (“解析队列”, “学习中心”) and the absence of navigation-triggered extraction are settled; do not reopen them as unspecified behavior, and do not treat the older entry names still present in plan §3/§15 as the current ones.
