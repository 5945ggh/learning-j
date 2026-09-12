STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P2-frontend
BASELINE: HEAD=f3d22c1（恢复 P2 证据与词典写入的并发幂等与索引完整性契约）。工作树未跟踪的 `demo/`、`experiments/` 原样保留、未提交、未触碰；本包改动仅 frontend/** 与本报告，backend/**、docs/（除本报告）、prompts/、DESIGN.md 零改动。按用户指示本轮不做任何 git 提交，全部改动保留在工作树交 CR 复核。本报告为第 2 轮（rework）正文：第 1 轮 Review 的 5 项 finding 已全部修复并补回归证据（见 Changed ①–⑤ 与 Verified）；reviewer 拥有的 `## Review` 段原样保留在后。

Contract ledger:
- `CURRENT-PACKETS.md` P2-frontend 行 — token 点击/键盘查词、响应式 drawer/popover/sheet、Escape 焦点恢复、来源/版本/错误/无结果状态、Lexeme 裁定 UI；无假 AI/语法解析/再次遭遇统计/SRS/后台任务。开工门槛（P2-backend 报告 + Review）已核对：Review 的两项 P1 finding（expected_decision_seq 可省略、FTS 表缺失静默空结果）已由 f3d22c1 修复，本包以修复后的工作树与再生成的 `backend/fixtures/openapi.json`（18 路径）、`backend/fixtures/reader-fixture.json` 为契约唯一来源。
- `mvp-tech-and-phases.md` P2 + §1.5 — 「前端阅读器按 DESIGN 支持 token 点击/键盘查词、来源区分、无词典/无结果/错误/响应式状态；没有 BYOK 时算法区仍可用」逐条落为组件/测试；「查词不产生 KE」落为请求面断言（打开面板/查词/搜索全 GET，仅显式点击裁定控件才有 POST /lexemes/{id}/decisions）。
- `DESIGN.md` 查词流程/组件/无障碍/响应式行为/工具栏与查词边界/交互状态 — 六种查词状态齐全；宽屏≥1180px 右侧抽屉（complementary 语义+显式关闭）、紧凑 760–1179px 锚定 popover（dialog 非模态、点击外部关闭）、<760px 底部面板（dialog 模态：背景垫层阻断指针交互 + Tab/Shift+Tab 焦点陷阱，Rework ①）；Escape 关闭焦点回到触发 token；更换 token 原地更新同一面板；来源/读音/释义显式标签；紧凑布局控件 ≥40px；「开始 AI 学习」以禁用态+解释呈现（DESIGN 禁用状态），不伪装会话创建；不拦截 Yomitan 扩展的修饰键手势（只用单击/Enter/Space）。
- ADR-023 — 查词/token/裁定组件全部位于 `src/components/`，零 shells/react-router import（ESLint 双栅栏原样强制）；shell 负责形态选择（`useLookupVariant` 在 shell 层调用）与数据接线。
- ADR-032 — 词典来源/版本按响应真实展示；FTS 503（派生索引缺失/损坏）映射为显式 `fts_unavailable` 错误分类并使用专用文案，不静默降级为「无结果」。
- ADR-040 + data-model §2.2/§0 — 裁定 UI 只做 Lexeme 级（`lexeme:` 作用域）并明确标注「针对整个词元……本次遇到的词形不会单独记录」；`expected_decision_seq` 作为必填版本令牌：客户端在请求发出前强制校验（缺失/负值抛 `MissingExpectedDecisionSeqError`，不发请求），无裁定历史时预期 0，409 映射 `DecisionConflictError` 并自动刷新摘要后提示重试，201/200（幂等重放 created=false）分别处理；operation_key 采用确定性键 `lexeme-decision:{decision}:{lexemeId}:{seq}`，网络重试同键安全重放。裁定请求以「请求代数 + 词元身份」双守卫（Rework ②）。
- data-model §0/§9 + 项目硬约束 — 偏移全部来自后端 code point 半开区间，前端零裸字符串切片（`learningj/no-bare-string-slice` 通过；扫描仅命中 text.ts 内的数组 slice）；token surface 在解析层即品牌化为 `SentenceText` 类型（Rework ④）；查词/阅读/播放不创建 KP/ReviewItem/KE（除显式裁定）。
- 已拒绝的假设：①未给未裁定词元假设 summary 带 `lexeme:` 行——实测真实后端返回空 `scopes` 数组，客户端把「摘要已加载但无该行」解释为未裁定、expected seq 0（该解释已由真实后端端到端回归锁定，见 Verified）；②不实现词典导入 UI（交付清单未含 `POST /dictionaries/import` 接入，「需要导入」状态为纯提示）；③不实现词形级（conjugated_form）裁定按钮——DESIGN 要求展示作用域归属，Lexeme 级是最小显式面，词形级留待后续包。

Owned files:
- `frontend/src/lib/`：`tokens.ts`、`dictionary.ts`、`lexemes.ts`、`viewport.ts`（新客户端层）+ 同名 `.test.ts`；`reader-fixtures.ts`（P3 props fixture）。
- `frontend/src/components/`：`TokenizedSentence`、`LookupPanel`、`DecisionControls`、`LookupSurface`（新组件）+ `.test.tsx`。
- `frontend/src/shells/MaterialWorkspace.tsx` + 测试（shell 装配扩展）；`vite.config.ts`（dev proxy 加 `/sentences`、`/dictionaries`、`/lexemes`）。
- `frontend/src/lib/p2-frontend.contract.test.ts`（新契约测试）；`docs/task-packets/reports/P2-frontend-handoff.md`（本报告）。

Changed:
- Rework 修复（对应第 1 轮 Review findings）：
  - ① `src/components/LookupSurface.tsx` — sheet 实现真实模态边界：`aria-hidden` 背景垫层（`data-lookup-backdrop="sheet"`）阻断背景指针交互 + `Tab`/`Shift+Tab` 焦点在面板内循环（Escape/显式关闭退出）；popover 保持非模态且无垫层。测试：焦点循环（正/反向）、垫层存在且点击不关闭、popover 无垫层、open=false 无垫层。
  - ② `src/shells/MaterialWorkspace.tsx` — 裁定 POST 与摘要刷新携带「请求代数（decisionRequestIdRef）+ 词元身份（lookupLexemeIdRef）」双重守卫：每次打开/关闭、换 token/切句都会使旧请求失效；POST 后续摘要 GET 完成后再次校验代数，旧响应（含 409 后的刷新与 finally 的 pending 清理）一律丢弃，不写回新语境面板。测试：挂起的 POST 或摘要 GET 完成晚于切换/关闭重开同一 token 时，面板保持新词元「未裁定」，旧 known 状态不出现，无额外提交；关闭/重开同一词元的迟到摘要窗口也已覆盖。
  - ③ `src/shells/MaterialWorkspace.tsx` — 新增 `resetLookup()`：切换句子（含切素材导致的换句）与切换素材时统一关闭面板并清空 lookupToken/lookupTrigger/词条/裁定/错误/搜索状态并作废在途请求代数。测试：打开面板后切句/切素材，面板与旧词元内容消失、无裁定写入。
  - ④ `src/lib/tokens.ts` + `src/lib/reader-fixtures.ts` — `AlgorithmToken.surface` 类型改为 `SentenceText`，解析时保存 `asSentenceText(requireString(...))`（删除原返回值被丢弃的写法）；fixture surface 同步品牌化。品牌随类型面对所有下游组件生效。
  - ⑤ `src/lib/lexemes.ts` — `parseDecision` 对必填 `created` 做布尔严格解析，缺失/非布尔抛「裁定响应缺少有效的 created」，不再把 malformed 201 误判为幂等重放。测试：missing/`"yes"` 两种畸形 201 均拒绝。
- `src/lib/tokens.ts`（新）— `GET /sentences/{id}/tokens` 客户端：逐字段校验 SentenceTokensOut/AlgorithmTokenOut/TokenProvenanceOut（含偏移半开区间合法性），surface 品牌化为 SentenceText。
- `src/lib/dictionary.ts`（新）— `GET /dictionaries`、`GET /dictionaries/lookup?expression=&reading=`、`GET /dictionaries/search?query=` 客户端；503 → `DictionaryRequestError(kind='fts_unavailable')`，其余非 2xx → `kind='http'`；结构化定义保留原始 payload、纯文本始终渲染。
- `src/lib/lexemes.ts`（新）— `POST /lexemes/{id}/decisions`（发前强制 expected_decision_seq；201/200/409/422 分类）与 `GET /lexemes/{id}/evidence-summary` 解析（含未裁定空 scopes）。
- `src/lib/viewport.ts`（新）— `resolveLookupVariant`（1180/760 断点，DESIGN 取值）+ `useLookupVariant`（innerWidth+resize，jsdom 兼容）。
- `src/components/TokenizedSentence.tsx`（新）— token 渲染为可点击按钮：单击/聚焦 Enter/Space（原生 button 语义）触发；aria-label 含 surface/读音/词性；aria-pressed 选中态+下划线视觉（不只靠颜色）；加载/错误/空状态可重试且句子文本不消失。
- `src/components/LookupPanel.tsx`（新）— 查词面板内容：六状态齐全；搜索框（查找失败时保留「重新搜索」出口）；来源 `display_name · 版本 source_version`、标签、有序释义；算法来源（代次 id + 三版本戳）；裁定区；禁用的「开始 AI 学习」+解释。
- `src/components/DecisionControls.tsx`（新）— 当前判断展示（known/unknown/clear/未裁定）、Lexeme 作用域说明、三控件（提交中禁用并显示进行中）、409/422 错误显式展示可消除；`summaryLoaded` 区分「加载中」与「已加载未裁定」。
- `src/shells/MaterialWorkspace.tsx` — 新增三组数据流：选中句子的 token 表加载（可取消/重试）；查词状态机（token 候选先规范化形后表层、无命中时经 `GET /dictionaries` 区分无词典/无结果、请求 id 计数防陈旧结果）；裁定提交、竞态守卫与 409 自动刷新。readerArea 按 variant 装配 drawer/popover/sheet；切句/切素材统一 resetLookup。
- `vite.config.ts` — dev proxy 新增 `/sentences`、`/dictionaries`、`/lexemes`（P1 面零改动）。
- `src/lib/reader-fixtures.ts`（新）— P3 props fixture：`fixtureSentenceTokens`（照抄 reader fixture `tokens/txt` 全部 7 token，surface 品牌化）、lookup/search/decision/summary（照抄对应条目）、`fixtureDictionaries`（照抄 `dictionary/source.source`）、`fixtureEvidenceSummaryUndecided`（本地构造：空 scopes，与真实后端行为一致并注明）。
- 测试新增 82 例（88→170）：`tokens.test.ts`（5）、`dictionary.test.ts`（8）、`lexemes.test.ts`（10，含 malformed created 拒绝）、`viewport.test.ts`（4）、`TokenizedSentence.test.tsx`（5）、`LookupPanel.test.tsx`（13）、`LookupSurface.test.tsx`（9，含焦点陷阱与垫层）、`p2-frontend.contract.test.ts`（14）、shell 测试扩 14 例（含切句/切素材 reset、未裁定 seq 0、裁定 POST/摘要 GET 竞态守卫及关闭后重开）；`p0/p1-integration.contract.test.ts` 与其余 P0/P1 测试零改动原样通过。

Public contract:
- 发布给 P3 的 reader props/fixtures：`src/lib/reader-fixtures.ts`（token 表/词条/裁定/摘要形状，与生成 reader-fixture.json 的一致性由 `p2-frontend.contract.test.ts` 锁定）；组件 props 即 `TokenizedSentence`/`LookupPanel`/`DecisionControls`/`LookupSurface` 的类型面。
- 组件消费的后端面：`GET /sentences/{id}/tokens`、`GET /dictionaries(+/lookup|/search)`、`POST /lexemes/{id}/decisions`、`GET /lexemes/{id}/evidence-summary`；请求面无 headers/credentials（BYOK-free），URL 仅 `^/(materials|sentences|dictionaries|lexemes)/`。
- 行为契约：查词/阅读/播放零写入；唯一写路径是显式裁定点击（POST body 恒含 `expected_decision_seq`，首次裁定 seq 0）；Escape 焦点恢复；sheet 为真实模态（垫层+焦点陷阱）；切句/切素材绑定查词语境；形态断点 1180/760。
- P1 面与全部 P1 模型字段零改动；`p0/p1-integration` 契约测试原样通过。

Verified:
- `cd frontend && pnpm test` — pass：`Test Files 20 passed (20)`、`Tests 170 passed (170)`（基线 88 + 本包新增 82；含 Rework 五项回归及同 token 重开/摘要迟到竞态回归）。
- `cd frontend && pnpm lint` — pass：exit 0（含 `learningj/no-bare-string-slice` 与 ADR-023 双栅栏）。
- `cd frontend && pnpm build` — pass：`tsc -b && vite build`，产物 `index-DZLiNqgo.js 185.06 kB`。
- 契约一致性 — `p2-frontend.contract.test.ts` 14 例通过：生成 OpenAPI 必需路径子集、`DecisionCreateIn` 必填含 `expected_decision_seq`（锁 f3d22c1 修复）、SentenceTokensOut/AlgorithmTokenOut/TokenProvenanceOut/DecisionOut/EvidenceSummaryOut 必填集合；客户端对 `reader-fixture.json` 各条目解析与 `reader-fixtures.ts` 逐字段相等；token code point 切片 == surface（对生成 fixture）；请求面无凭证。
- 边界扫描三组 — 全部零命中：①旧 AI 端点/标记（`AnalysisPanel|analysis\.ts|/analysis|/questions|/extract|/retention|/knowledge-points|session_closed|turn_count|extraction_status|extraction_trigger|/study|/review`，src 非测试文件）；②组件→shells/react-router import；③裸 slice/substring/substr（仅 `src/lib/text.ts:46` 的数组 `codePoints.slice`——正是授权的 code point 工具内部实现）。
- 视觉 QA + Rework 回归（真实后端 + 截图，QA 进程已停）— 在重建的 `-p2` 开发库（`rebuild-development-db --db /tmp/learningj-p2-frontend-qa.db`）+ 导入 `build_fixture_yomitan_zip()` 后以 Vite dev + 真实 API 完成：①token 视图按 Sudachi token 渲染；②1440px drawer 呈现词条、来源/版本、算法代次与三版本戳；③显式裁定 → 面板写后读一致更新，后端 `evidence-summary` 确认 user_asserted KE 持久化（打开面板期间零 POST）；④Escape 关闭后焦点为触发 token（DOM 断言）；⑤600px sheet（aria-modal=true + 垫层渲染，背景可见变暗阻断）、1024px popover（aria-modal=false、无垫层）；⑥外点关闭 popover、点触发 token 面板保持；⑦搜索「頑」走真实 FTS5 命中「頑張る」；⑧Rework 残余风险回归：600px 下打开未裁定词元（空 scopes）→ 面板显示「未裁定」→ 点击「这个我认识」→ 后端确认 `current_decision: known, seq 1` 持久化（首次 POST 携带 expected_decision_seq=0）→ Escape 关闭后焦点回到触发 token、垫层移除。
- `git diff --check` — pass：无空白错误；`git status` 仅 frontend/**（+未跟踪 demo/、experiments/ 原样）与本报告。

Known limitations:
- 无词典导入 UI：`POST /dictionaries/import` 未接入；「需要导入」状态为提示文案（导入面属独立切片/后续授权）。
- 裁定仅 Lexeme 级：词形级（conjugated_form → `form:` 作用域）裁定 API 客户端已支持参数，但 UI 未提供词形级控件；DESIGN 要求的作用域归属已显式标注。
- 无撤销/撤回 UI：`POST /known-evidence/{id}/retractions` 未接入（「清除我的判断」走 clear 裁定路径；来源撤回 UI 属后续）。
- 无 Annotation UI、无播放器、无 StudySession（各自属 P3+）；「开始 AI 学习」为禁用占位+解释，不伪装可用。
- known-views 批量端点（`POST /lexemes/known-views/batch`）未接入：当前逐 token 查词路径用单词元 summary 即可，批量预取留待 P3 上下文/性能需要时接入。
- 409 的真实后端触发未在视觉 QA 中演练（需并发写）；该路径由客户端/组件测试以真实响应形状覆盖，竞态丢弃路径由挂起 POST 的确定性测试覆盖。
- popover 锚定采用阅读区右上角定位（非逐 token 精确锚定）：DESIGN 要求紧凑布局下「锚定 popover」且不遮盖所选句子，本实现满足语义与可见性，像素级锚定留样式打磨。

Gate for next packet:
- Ready：P2-integration 可依赖的前端消费面已锁定——18 路径 OpenAPI 与客户端零冲突、reader-fixture 双端一致、请求面（BYOK-free、零旧 AI 端点、查词零写入、裁定恒带版本令牌）由测试持续护航；四形态查词面板与裁定链路已对真实后端端到端验证（含 KE 同事务产生、写后读一致、空 scopes 首裁定、模态边界、切句/切素材语境绑定与裁定竞态守卫）。
- Not safe to assume：词典导入 UI、来源撤回 UI、词形级裁定控件（均未实现）；`GET /dictionaries` 之外新增词典管理端点的消费；任何性能结论（实验 11a 属 P2-integration）；未决的 `pnpm approve-builds`（lead 事项，无实际影响）。

CR focus:
- Rework ②的守卫语义：submitDecision 以 `decisionRequestIdRef`（请求代数）+ `lookupLexemeIdRef`（词元身份）双条件判活，打开/关闭会使旧请求失效，POST 后摘要 GET 完成后再次判活，`finally` 也受守卫约束——被丢弃的旧请求不清新面板的 pending 态。请确认「换 token 或关闭后重开同一 token，旧 POST/摘要响应全部被跳过」是期望的严格度（面板由 resetLookup 或 open/close 失效逻辑重置）。
- Rework ①的模态实现：sheet 垫层是渲染在阅读区内的 fixed 元素（非 portal），焦点陷阱监听 document keydown；若未来出现更高层级浮层（如全局对话框）需重新审视层叠与陷阱范围。
- 未裁定摘要的实况差异：真实后端对从未裁定的词元返回 `scopes: []`；客户端以 `decisionSummaryLoaded` 区分加载态、以 seq 0 提交首次裁定，且该路径已由真实后端端到端回归（浏览器）与 shell 测试双重锁定。若后端未来改为恒含 `lexeme:` 行，客户端两种形状都兼容（find ?? null）。
- 裁定 operation_key 的确定性：`lexeme-decision:{decision}:{lexemeId}:{seq}`——同键重试安全重放，但也意味着用户在同一 seq 下先失败后手动重试会得到 200 重放而非 201；这与幂等语义一致，请确认可接受。
- token 查找候选顺序：先 `normalized_form` 后 `surface`（去重、跳过空形）；两次 GET 都空时才查词典列表区分无词典/无结果。
- 视觉 QA 对 /tmp QA 库的两次真实写入（君 known、次 known，均 seq 1）：QA 库为 /tmp 下重建库，非 designated 目录，无契约影响；如需可复现请删除 /tmp/learningj-p2-frontend-qa.db。

Open issues:
- None（阻塞级）。按用户指示，第 1 轮与 Rework 的全部实现与测试改动（frontend/**）保留在工作树未提交，交由 CR agent 复核后由 lead 入册；本报告为第 2 轮正文，`## Review` 段（reviewer 拥有）原样保留。

## Review

### 2026-09-12 第 1 轮（CR，reviewer；Rework ①–⑤ 由本轮触发）

VERDICT: changes-requested
Findings:
- [P1] `frontend/src/components/LookupSurface.tsx:85-96` — `sheet` 被声明为 `role="dialog" aria-modal="true"`，但没有 backdrop、焦点陷阱或背景 `inert`；用户仍可点击/Tab 到阅读器背景，ARIA 模态语义与 DESIGN.md 无障碍/响应式条款不一致。最小修复：为 sheet 实现可验证的模态边界（背景 inert/阻止交互 + 焦点循环，保留 Escape/显式关闭），或在未实现模态前不要声明 `aria-modal=true` 并补相应验收测试。
- [P1] `frontend/src/shells/MaterialWorkspace.tsx:297-332` — 裁定 POST 完成后的 `refreshDecisionScope` 无当前 token/request 代数校验；用户在请求进行中切换 token、句子或素材时，旧 lexeme 的摘要/错误会写回当前面板，导致显示与可提交的 `expected_decision_seq` 属于不同词元。最小修复：让裁定请求携带并校验 lookup request id/token identity（或在切换/关闭时 abort），只允许仍对应当前 token 的响应更新状态，并为该竞态补测试。
- [P2] `frontend/src/shells/MaterialWorkspace.tsx:73,334-337` — 选择新句子/素材时没有关闭或清空 `lookupOpen`、`lookupToken`、`lookupTrigger` 及裁定状态；旧面板在新句子下会重新出现并继续请求旧 lexeme，触发 token 已卸载时焦点恢复也失效。这违反查词面板与当前阅读语境绑定的交互边界。最小修复：在句子/素材变更时统一调用带状态清理的 close/reset（并取消在途请求），补“打开面板后切句/切素材”的回归测试。
- [P2] `frontend/src/lib/tokens.ts:23-24,123` — `AlgorithmToken.surface` 仍是普通 `string`；`asSentenceText(token.surface)` 的返回值被丢弃，因此报告所称的 SentenceText code-point 品牌并未进入客户端类型面，后续组件可无感地把未验证字符串当 token 表层。最小修复：将字段声明为 `SentenceText`，解析时保存 `asSentenceText(requireString(...))`，并以类型/回归测试锁定。
- [P2] `frontend/src/lib/lexemes.ts:101-117` — `parseDecision` 将缺失或非布尔的必填 `created` 静默解释为 `false`（`item.created === true`），会把 malformed 的 201 响应误判为幂等重放；OpenAPI `DecisionOut.created` 是 required，现有契约测试没有覆盖该拒绝边界。最小修复：增加布尔必填解析并在缺失/错误类型时抛错，补 malformed-response 测试。

Evidence checked:

- `cd frontend && pnpm test`：20 files passed，162 tests passed；`pnpm lint`：exit 0；`pnpm build`：成功（`index-C9Usfa4c.js`）。
- 三组边界扫描：旧 AI 端点/标记、组件反向依赖 shells/react-router、裸字符串 slice 均无新增命中；`git diff --check` 通过。
- `cd backend && uv run pytest -q`：135 passed，21 xfailed；定向 `tests/test_evidence.py tests/test_dictionary_import.py`：27 passed。后端缺版本令牌 422 与已有词典缺 FTS 表 503 的回归均已核对，`f3d22c1` 修复有效。
- 生成 `backend/fixtures/openapi.json` 中的 P2 路径、`DecisionCreateIn.expected_decision_seq` required 集合及 `reader-fixture.json` 字段与前端契约测试/解析器对照；未发现前端请求路径或 query 名称与当前后端的直接冲突。

Gate assessment:

- P2-integration：暂不安全派遣。前端已能消费当前 API，但 sheet 模态边界、切换竞态和当前语境绑定仍有 P1/P2 缺陷；应先修复并补回归证据，再把“零副作用/响应式/焦点”作为集成闸门结论。
- P2-known-import：可安全独立派遣（backend-only independent）。本轮前端 finding 不改变其后端范围；其依赖的 P2-backend 版本令牌与 FTS 修复已由完整/定向测试核实。若 lead 要求严格等待 P2-integration 报告，则仍应遵守该流程门槛。

Residual risks:

- 视觉 QA 声称的 popover“锚定”仍是阅读区右上角近似定位，未有像素级/不同内容长度的自动视觉断言；本报告未把它单独升级为阻断 finding。
- `fixtureEvidenceSummaryUndecided` 的空 `scopes` 解释仍只由 mock/已有实测报告支撑，前端未建立真实后端端到端回归；当前未发现与 data-model §2.2 的直接冲突。

### 2026-09-12 第 2 轮复审（Rework 后，CR，reviewer）

```text
VERDICT: approve
Findings:
- none（第 1 轮 5 项 finding 全部闭合，逐项核对源码与回归测试：①sheet 真实模态=aria-hidden 垫层阻断指针+Tab/Shift+Tab 焦点陷阱，保留 Escape/显式关闭；②裁定请求以 decisionRequestIdRef 请求代数+lookupLexemeIdRef 词元身份双守卫，POST 后摘要 GET 与 finally 清理均再判活，换 token/关闭重开/摘要迟到三个迟到响应场景各有确定性测试且旧请求不写回、不产生额外提交；③resetLookup 统一接线切句（含切素材换句）与切素材，面板与裁定/搜索状态清空、在途请求作废；④AlgorithmToken.surface 声明为 SentenceText 并在解析层保存 asSentenceText(...)，品牌随类型面生效且契约测试锁 code point 切片==surface；⑤parseDecision 对必填 created 严格布尔解析，missing/"yes" 均拒绝）
Evidence checked:
- cd frontend && pnpm test：Test Files 20 passed (20)、Tests 170 passed (170)；其中 p0-integration（3）与 p1-integration（5）契约测试文件零改动原样通过。
- cd frontend && pnpm lint：exit 0；pnpm build：tsc -b && vite build 成功，产物 index-DZLiNqgo.js 185.06 kB，与报告一致。
- 三组边界扫描独立重跑全部零命中：旧 AI 端点/标记（src 非测试文件）、组件→shells/react-router 反向依赖、裸 slice/substring/substr（仅 src/lib/text.ts:46 授权的 code point 工具内部数组 slice）；git diff --check 无空白错误。
- 开工门槛对提交态直接核实：backend/src/learningj/api/schemas.py DecisionCreateIn.expected_decision_seq 必填（f3d22c1）、backend/src/learningj/dictionary/service.py 已有词条但缺 dictionary_search_fts 时抛 DictionarySearchError（503）、backend/fixtures/openapi.json 18 路径且 DecisionCreateIn.required 含 expected_decision_seq；cd backend && uv run pytest -q：135 passed, 21 xfailed。
- 范围核对：git status 仅 frontend/**（3 个修改 + 17 个新增）与本报告；demo/、experiments/ 未跟踪且未触碰；无 docs/、prompts/、DESIGN.md、backend/** 改动。
- 契约对读：DESIGN 查词六状态/交互状态/无障碍/响应式条款、ADR-023（组件零 shells 依赖、shell 持形态选择）、ADR-032（来源/版本展示、FTS 503 显式分类）、ADR-040 与 data-model §0/§2.2（Lexeme 级 lexeme: 作用域标注、expected_decision_seq 客户端发前强制、operation_key 确定性幂等、查词/阅读零写入）逐条对源码核实；prefers-reduced-motion 由 P1 基线 index.css 全局规则覆盖。
Gate assessment:
- P2-integration：可安全派遣。前端消费面（18 路径 OpenAPI 子集、reader-fixture 双端逐字段一致、BYOK-free 请求面、查词零写入、裁定恒带版本令牌）由 14 例契约测试持续锁定；四形态查词与裁定链路的模态边界、竞态守卫与语境绑定有确定性回归。残余风险不触及集成闸门（token parity、ZIP 安全、无副作用、unknown/clear 优先级、目标集查询结构测试均属后端/集成侧）。
- P2-known-import：不受本轮影响，可按其独立门槛派遣。
- 记录性事项（非本包缺陷）：P2-backend 报告的 Review 段止于 changes-requested，其两项 P1 修复已在 f3d22c1 入册；本轮已对提交态直接核实（必填令牌 + FTS 503 + 后端全绿），建议 lead 对该复审记录补一条 f3d22c1 后的确认使台账闭合。
Residual risks:
- popover「锚定」为阅读区右上角近似定位（非逐 token 像素锚定）：第 1 轮已评估未升级为 finding，本轮维持；DESIGN 硬性条款（有可见关闭操作时方允许遮盖）已满足，像素级锚定留样式打磨。
- 真实后端浏览器级视觉 QA（含空 scopes 首裁定端到端、Escape 焦点、四形态截图）为实现方声称，本轮 CR 未独立复跑；自动化面（组件/shell/契约测试 + 真实响应形状）已复核为绿。
- 409 的真实后端触发未演练（需并发写）；该路径由客户端/组件测试以真实响应形状覆盖。
- sheet 垫层与焦点陷阱为阅读区内非 portal 实现 + document 级 keydown；未来出现更高层级浮层（如 P3+ 全局对话框）时需重审层叠与陷阱范围（实现方已注明）。
- 紧凑布局下 inline token 按钮触摸目标为文字尺寸（按阅读内容而非面板控件处理 DESIGN ≥40px 规则）；若后续触摸设备实测反馈不佳可再收紧。
```
