# Design

## Source of truth
- Status: Active (MVP interaction contract)
- Last refreshed: 2026-09-06
- Primary product surfaces: desktop material reader, sentence analysis panel, dictionary lookup surface, AI study workspace, extracted knowledge review
- Evidence reviewed: `docs/mvp-tech-and-phases.md`, `docs/LearningJ-plan-v5.md`, `docs/adr.md`, `docs/data-model.md`, `docs/prompt-contracts.md`

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
- Primary navigation: Library, Study, Review; reading remains the default working context
- Core routes/screens: material workspace, sentence study workspace, knowledge extraction review
- Content hierarchy: source material first, selected sentence second, lookup/analysis third, global collection state last

## Design principles
- Material stays spatially anchored. Lookup and AI may change focus, but never remove the source sentence.
- Interaction cost is a value signal. Lightweight lookup is ephemeral; explicitly starting AI study marks intentional learning.
- Do not compete with the browser Yomitan gesture. LearningJ uses an explicit click/tap gesture and does not claim the Option/Alt modifier plus hover path.
- Bookmarking and learning are separate verbs. A lookup is not a KnowledgePoint and does not schedule review.
- State transitions are legible: reading, lookup, focused study, and knowledge capture use distinct labels and surfaces.

## Visual language
- Color: warm paper for source reading, white tool surfaces, charcoal text, cinnabar for active study, teal for lexical support, amber for syntax; color is semantic
- Typography: Japanese serif for source text and quotations; compact sans serif for controls and metadata
- Spacing/layout rhythm: 4/8px base rhythm; dense toolbars and lists; generous line height in the reading column
- Shape/radius/elevation: 6px or less; borders and tonal separation over floating cards; minimal shadow for transient popovers
- Motion: 180-260ms opacity/transform/layout transitions; honor reduced motion
- Imagery/iconography: familiar monochrome symbols; material art may identify the work

## Components
- Existing experiment components: reader shell and token/analysis interaction patterns in `experiments/immersive_reader_demo/`
- New/changed production components: `DictionaryPopover`, `DictionaryDrawer`, `TokenActionButton`, `AnalysisDocView`, `TriagePanel`, `AggregateCard`, `ReviewCard`
- Lookup states: closed; selected token; loading; one or more dictionary sources; no result; import required; error
- Ownership: components remain shell-independent; a shell chooses whether lookup renders as a popover or drawer

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

## Content voice
- Tone: calm, precise, concise, learner-respecting
- Terminology: “查词” for dictionary lookup, “解析” for deterministic linguistic inspection, “AI 学习” for deliberate explanation, “知识点” for extracted learning objects, “复习” only after scheduling
- Microcopy: commands use verbs; provenance and state are explicit; do not call a lookup “收藏” or “学习”

## Implementation constraints
- Framework/styling: Vite + React + TypeScript; Tailwind + shadcn/ui; shell-independent components
- Dictionary contract: Yomitan ZIP is an import format, not a UI or domain model; the API returns source/version provenance and text/structured definitions
- Compatibility: do not intercept Option/Alt + hover, browser extension messaging, or Yomitan's modifier gesture
- Performance: opening a lookup surface should be local and immediate after token selection; dictionary search is local once imported
- Test expectations: verify click/tap lookup, keyboard invocation, Escape/focus return, popover-to-drawer responsive switch, no-result/error states, and coexistence with a browser Yomitan extension

## Open questions
- [ ] Should a second click on an already selected token pin the lookup drawer, or should an explicit pin control be required? / design / affects interruption cost
- [ ] Which dictionary source ordering should be the default when several Yomitan packages are imported? / product / affects trust and scan speed
- [ ] Should “open in external Yomitan” be offered as an explicit link, or omitted from MVP to keep browser-extension coupling out? / product + engineering / affects interoperability
- [ ] What exact parser and dictionary provenance must be exposed in production? / engineering + product / affects trust and licensing
