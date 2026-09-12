STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P1-frontend
BASELINE: HEAD=c49253d9141a8f3d30f8c6e618af1bef359c7497。P1-backend 的切片与报告在此 HEAD 已提交（c49253d/492f9cc/cdbd716）；未跟踪的 `demo/`、`experiments/` 原样保留、未提交；本包全部改动留在工作树，未做任何提交。

Contract ledger:
- `docs/task-packets/CURRENT-PACKETS.md` P1-frontend 行 — 交付生成类型驱动的 library/browser（kind 适配锚点、状态处理、code point 安全文本），不认领 AI/阅读活动；发布物为 P2 props/fixtures。开工门槛（P0-integration `VERDICT: approve`）已满足。
- `docs/mvp-tech-and-phases.md` §3/P1 — 前端只做 Library/reader 的素材浏览与定位准备，不实现 AI 学习、候选、复习或假造阅读活动统计；素材列表、句子列表、加载／空／错误状态保持可用，未配置 BYOK 不影响浏览；组件无 shell 反向依赖。
- `docs/data-model.md` §8.1/§8.2/§8.3 — Material 的 storage_mode/source_sha256/current_sidecar_id；锚点取值表（subtitle `{cue_index}`；plain_text `{char_start, char_end}` 相对规范化全文；epub `{spine_index, char_start, char_end}` 相对 spine item 规范化文本）；「素材 = 有序 Sentence 序列 + 可选时间戳 + 可选 locator」的统一抽象。实现为：定位解析只接收 Sentence（`parseSentenceAnchor`），不接收 Material——统一抽象写成测试（`anchors.test.ts`「素材类型无关的统一定位抽象」）。
- `DESIGN.md` 应用外壳与素材界面／组件／无障碍／响应式／文案 — 书目／视听两种模式共用视图切换、空状态与素材卡片契约；卡片承载名称与最有用元数据；加载中展示紧凑状态、不使句子位移（加载占位与列表共用 min-h 容器）；错误保留界面并给局部重试；选中态用清晰标签 + `aria-pressed`，不只靠颜色。
- 生成契约 `backend/fixtures/openapi.json`（6 条路径）与 `backend/fixtures/material-fixture.json` — 客户端消费 `GET /materials`、`/sentences`、`/sidecar`、`/materials/{id}/lexeme-counts`（`MaterialLexemeCountsOut`：`{material_id, sidecar_generation_id, counts[{lexeme_id, token_count}]}`）；fixture 的 `lexeme-counts/txt|srt` 条目与 `𠮟られた。` code point 样例继续锁定前端。未新增任何第二份契约。
- `docs/adr/023-shell-independence.md` + `frontend/eslint.config.js` — 组件不得 import shells/路由；本轮新增组件全部 props 驱动。
- `docs/task-packets/reports/P1-backend-handoff.md`（VERDICT: approve）— client 已透传 `storage_mode`/`source_sha256`/`current_sidecar_id`/`sidecar_generation_id`；「library/browser UI for counts belongs to P1-frontend」由本包交付。
- `docs/task-packets/protocols/implementation.md`、`handoff.md` — code point 半开偏移经 `sliceByCodePoint()`；本报告是本轮唯一 docs 写入。

Assumptions refused:
- `anchor_payload` 保持开放 JSON：只按 `anchor_type` 读取三种已知形状并显式校验；任何缺失/非法取值呈现「定位不可用」，绝不虚构位置（不把缺失 spine_index 当 0、不把非法偏移当 0–0）。
- 不实现导入 UI：包行只要求浏览与定位准备；`POST /materials` 由后端与 P1-integration 验证。DESIGN 提到的「搜索／导入入口」记入 Known limitations，不伪造。
- 选择句子只是浏览定位：不创建学习、阅读曝光、播放或进度记录；界面无任何「开始 AI 学习／查词」入口（有测试断言）。
- 不给 sidecar payload 的 tokens 定义类型或渲染：token 呈现属 P2，payload 保持开放 JSON，避免提前冻结 P2 契约。
- 不伪造数据：`current_sidecar_id === null` 时内容索引面板呈现缺席态；词频代次与 sidecar 代次不一致时显式呈现契约违例而非隐藏。

Changed:
- `frontend/src/lib/materials.ts` — 新增 `MaterialLexemeCount`/`MaterialLexemeCounts` 类型、`parseLexemeCounts`（按字段顺序校验）与 `fetchLexemeCounts`（URL 编码 material_id），形状严格取自生成 OpenAPI。
- `frontend/src/lib/anchors.ts`（新）— `SentenceLocation` 联合类型 + `parseSentenceAnchor` + `formatSentenceLocation`：subtitle 用 cue+时间戳、plain_text 用 code point 偏移、epub 用 spine（复用 P0 的 `parseEpubSpineIndex`）+可选偏移；非法一律「定位不可用」。
- `frontend/src/lib/time.ts`（新）— `formatTimestamp`/`formatTimeRange`（毫秒 → `mm:ss.mmm` / `h:mm:ss.mmm`；任一端缺失返回 null）。
- `frontend/src/lib/library.ts`（新）— 书目／视听模式映射、过滤与标签（DESIGN 素材库契约）。
- `frontend/src/lib/material-fixtures.ts`（新）— **P2 props/fixtures 发布物**：txt/srt 条目照抄生成 fixture；epub 条目按 data-model §8.2 锚点表本地构造（生成 fixture 仅覆盖 txt/srt）；附「定位不可用」样例句、sidecar 与词频样例。文件内声明其 props-fixture 边界，不是第二份 API 契约。
- `frontend/src/components/MaterialList.tsx` — 卡片元数据补 kind 中文标签、句数、内容索引已建/未建状态。
- `frontend/src/components/MaterialLibrary.tsx`（新）— loading/error(带重试)/ready 状态、书目／视听模式切换（含各模式计数与模式专属空状态）、整体空状态。
- `frontend/src/components/SentenceList.tsx` — 定位展示改经 anchors 库（三种 kind 适配 + 可选时间戳独立展示）；空状态与选择回调保留。
- `frontend/src/components/SentenceContext.tsx` — 同样经 anchors 库；非字幕句的可选时间戳单独成行；无学习语义文案。
- `frontend/src/components/ContentIndexPanel.tsx`（新）— 内容索引面板：sidecar 代次、三版本戳、单代次词频汇总（条目数/token 总计）、代次不一致显式告警、absent/loading/error(带重试) 状态。
- `frontend/src/shells/MaterialWorkspace.tsx` — 三条独立加载流（素材、句子、内容索引），各自可取消（AbortController）与局部重试（attempt 计数）；模式状态在 shell（选中素材时切换到所属模式）；装配以上组件；BYOK 提示文案保留。
- 测试：`src/lib/anchors.test.ts`、`src/lib/time.test.ts`、`src/lib/library.test.ts`、`src/lib/materials.test.ts`（+lexeme-counts 五例）、`src/components/{MaterialLibrary,SentenceList,SentenceContext,ContentIndexPanel}.test.tsx`、`src/shells/MaterialWorkspace.test.tsx`（stub fetch 的端到端状态流）。
- `frontend/package.json`、`frontend/pnpm-lock.yaml` — 新增组件测试 devDependencies：jsdom、@testing-library/react、@testing-library/dom、@testing-library/user-event、@testing-library/jest-dom。

Public contract:
- Client：`fetchLexemeCounts(materialId, signal?)` → `GET /materials/{material_id}/lexeme-counts`，返回 `MaterialLexemeCounts {material_id, sidecar_generation_id, counts: [{lexeme_id, token_count}]}`（生成形状，无第二契约）；既有 `fetchMaterials/fetchSentences/fetchSidecar` 不变。
- 组件 props（P2 可直接装配，全部 shell/路由无关）：`MaterialLibrary{status, materials, error, mode, onModeChange, selectedId, onSelect, onRetry}`；`MaterialList{materials, selectedId, onSelect}`；`SentenceList{material, sentences, selectedId?, onSelect?}`；`SentenceContext{sentence}`；`ContentIndexPanel{status: loading|error|ready|absent, sidecar, counts, error, onRetry}`。
- lib：`parseSentenceAnchor`/`formatSentenceLocation`（`SentenceLocation` 联合）、`formatTimestamp`/`formatTimeRange`、`libraryModeForKind`/`materialsForMode`/`LIBRARY_MODE_LABELS`、`material-fixtures.ts` 全部导出。
- UI 状态面：素材（loading/error+重试/ready；整体空态与书目/视听模式空态）、句子（loading/error+重试/未选素材/空列表）、内容索引（loading/error+重试/ready/absent；代次不一致告警）。

Verified:
- `cd frontend && pnpm test` — pass：`Test Files 11 passed (11)`、`Tests 83 passed (83)`（含 P0 契约测试原样通过；组件与 shell 状态流为 jsdom + testing-library 实测）。
- `cd frontend && pnpm lint` — pass：exit 0，无错误（含 `learningj/no-bare-string-slice` 与 ADR-023 双栅栏）。
- `cd frontend && pnpm build` — pass：`tsc -b && vite build`，25 modules，`dist/assets/index-BJa1EWRe.js 158.67 kB`。
- `rg -n -i 'AnalysisPanel|analysis\.ts|/analysis|/questions|/extract|/retention|/knowledge-points|session_closed|turn_count|extraction_status|extraction_trigger|/study|/review' src --glob '!**/*.test.*'` — pass：无命中（无旧 AI 端点调用）。
- `rg -n "from ['\"](?:\.\.?/)*shells|from ['\"]react-router" src/components` — pass：无命中（组件→shell 反向依赖为零）。
- `rg -n '\.(slice|substring|substr)\(' src --glob '!**/text.ts' --glob '!**/*.test.*'` — pass：无命中（业务偏移切片为零；本轮 UI 无持久化偏移切片需求，未人为制造切片）。
- `git diff --check` — pass：无空白错误；`git status` 确认仅 frontend/** 改动 + 本报告，demo/、experiments/ 原样。

Known limitations:
- 无导入 UI、无搜索入口：`POST /materials` 目前没有前端界面；DESIGN 的「搜索／导入入口」留给后续有导入职责的包（lead 决定归属）。
- 无播放器/阅读活动行为：字幕时间戳只作定位展示，不做播放控制、进度或曝光统计。
- 无 token 渲染：sidecar payload 保持开放 JSON，未定义 tokens 类型（P2 拥有 token 交互面）。
- 素材卡片无封面与三点溢出菜单：OpenAPI `MaterialOut` 无封面字段，后端无素材管理端点；卡片契约现为「名称 + 元数据」，不虚构美术资源或管理动作。
- 组件测试依赖为 devDependencies 新增（jsdom + @testing-library/*）；pnpm 安装时按其默认策略忽略了一个传递依赖的构建脚本（unrs-resolver），lint/build/test 实测不受影响。

Gate for next packet:
- Ready：P1-integration 可在其自有测试中锁定生成 OpenAPI/fixture 与客户端消费面（含 lexeme-counts）、验证 BYOK-free 浏览与无 shell 反向依赖；P2-frontend 可从本包组件 props 与 `src/lib/material-fixtures.ts` 起步（句子/锚点/时间戳/素材形状均已 props 化并有测试示例）。
- Not safe to assume：token 点击/查词界面、sidecar payload tokens 类型、词典、KP、StudySession、复习、导入 UI、播放行为、封面/管理菜单——均不存在。

CR focus:
- 锚点校验严格性：三种 anchor_type 的非法/缺失取值必须呈「定位不可用」（尤其 epub 不得出现虚构 spine 0）；`anchor_payload` 不得被收窄成纯数字契约（开放键如 `label` 有测试保护）。
- 统一抽象测试（data-model §8.2「上层不得感知素材类型」的前端可验证形式）：定位解析只依赖 Sentence 字段、不接收 Material；`library.ts` 的书目/视听分组是 DESIGN 授权的库视图规则，不属于该禁令范围（报告此解释供 CR 复核）。
- 单代次不变量的 UI 呈现：`ContentIndexPanel` 对 `counts.sidecar_generation_id !== sidecar.sidecar_generation_id` 显式告警而非静默渲染。
- 状态完备性：三条加载流的取消/重试路径（shell 测试覆盖错误→重试→恢复）；加载占位与列表共用容器高度，句子不位移（DESIGN 交互状态）。
- 边界：无 AI/阅读活动语义、无伪数据；demo/ 与 experiments/ 未触碰。

Open issues:
- pnpm 10 在安装新增 dev 依赖时忽略 `unrs-resolver@1.12.2` 的构建脚本（其默认安全策略）；当前 lint（type-aware）/build/test 全部通过，无实际影响；是否 `pnpm approve-builds` 由 lead 决定。
- 「书目/视听」模式计数基于全量素材列表而非当前模式（两种模式的切换按钮各自显示对应数量），属实现取舍，CR 如有异议属小改。

## Review

### 2026-09-12 独立评审（CR，reviewer）

```text
VERDICT: approve
Findings: none
Evidence checked:
- 生成契约一致性（评审重点 1）：独立解析 backend/fixtures/openapi.json —— 共 6 条路径（/healthz、/materials、/materials/{material_id}/lexeme-counts、/materials/{material_id}/sentences、/materials/{material_id}/sidecar、/materials/{material_id}/sidecar/rebuild），MaterialLexemeCountsOut 必填 {material_id, sidecar_generation_id, counts[{lexeme_id, token_count}]}；frontend/src/lib/materials.ts 的 MaterialLexemeCount(s) 类型与 fetchLexemeCounts 逐字段吻合、无额外字段，URL 编码 material_id。未发现任何第二份契约；material-fixtures.ts 自带边界声明且 txt/srt/词频取值照抄生成 fixture。P0 契约测试 p0-integration.contract.test.ts 相对基线 c49253d 零改动且原样通过。
- 锚点严格性（评审重点 2）：anchors.ts 三种 anchor_type 均显式校验——subtitle 的 cue_index、plain_text 的偏移对（负值/分数/字符串/倒置一律 unavailable）、epub 经 parseEpubSpineIndex（缺失/负值/分数/字符串均为 null，绝不虚构 spine 0；spine 合法而偏移非法时只展示 spine 不补 0–0）。anchors.test.ts 22 例覆盖全部非法分支；「开放 payload 上的额外键不破坏定位解析」测试确认 anchor_payload 未被收窄成纯数字契约。
- 统一抽象（评审重点 3，data-model §8.2）：parseSentenceAnchor 只接收 Sentence，签名无 Material；anchors.test.ts「素材类型无关的统一定位抽象」用同一锚点/时间戳断言跨素材逐字一致。library.ts 的书目/视听分组系 DESIGN.md「应用外壳与素材界面」明文授权的库视图规则（「书目与视听两种模式共用视图切换」），不属于 §8.2 禁止的「解析、抽取、复习、聚合」感知面——报告请 CR 复核的该解释成立。
- 单代次不变量（评审重点 4）：ContentIndexPanel 对 counts.sidecar_generation_id !== sidecar.sidecar_generation_id 渲染显式告警（含两个代次值与「契约要求同一响应只携带一个代次」文案），非静默；ContentIndexPanel.test.tsx 有专测，就绪态断言 not.toHaveTextContent('不一致')。
- 状态完备性（评审重点 5）：shell 三条加载流（素材/句子/内容索引）各自 AbortController 取消 + attempt 计数重试；句子加载占位与列表共用 min-h-48 容器不使句子位移；MaterialLibrary/MaterialList/SentenceList/SentenceContext/ContentIndexPanel 的 loading/空（整体空 + 模式空 + 未选素材 + 空句列表）/错误+局部重试/缺席（current_sidecar_id === null）状态在组件测试与 shell stub-fetch 端到端测试中均有断言（含错误→重试→恢复流）。
- 边界与纪律（评审重点 6）：三组 rg 扫描全部零命中（旧 AI 端点/标记；组件→shells/react-router import；裸 slice/substring/substr，text.ts 与测试除外）；MaterialWorkspace.test.tsx 断言界面无「开始 AI 学习/加入 AI 学习/查词」文案；选择句子仅上抛回调，无播放/进度/曝光语义；sidecar payload 保持开放 JSON 未定义 tokens 类型。
- 报告真实性：交接报告 Verified 节五项输出与独立重跑逐项一致——pnpm test 11 files/83 passed、lint exit 0、build 25 modules/158.67 kB（产物哈希 index-BJa1EWRe.js 与报告相同）、三组 rg 零命中、git diff --check 干净；git status 与基线对照确认改动仅 frontend/** 加本报告，demo/ 与 experiments/ 未被触碰。
Gate assessment:
- P1-integration 可安全启动：OpenAPI/fixture 与客户端消费面一致且可锁定，无 shell 反向依赖、无伪数据；P2-frontend 可从 MaterialLibrary/SentenceList/SentenceContext/ContentIndexPanel 的 props 与 material-fixtures.ts 起步。
Residual risks:
- 书目/视听切换按钮的计数基于全量素材列表（报告 Open issues 已声明）；属展示取舍，如需改为当前模式计数属小改，不构成 P1-integration 阻塞。
- 生成 fixture 仍仅覆盖 txt/srt，epub 锚点形状由本地 material-fixtures.ts 按 data-model §8.2 构造（有边界声明）；P1-integration 验证四格式时以真实后端为准。
- pnpm 对 unrs-resolver 构建脚本的默认忽略未处理（报告 Open issues 已声明，lead 决定是否 approve-builds）；当前 lint/build/test 实测不受影响。
- 本轮实现提交 1acbf72（实现 P1-frontend：生成类型驱动的素材库/浏览器、kind 适配锚点与内容索引面板，仅 frontend/** 22 个文件）；本报告入册提交紧随其后（见仓库 log「P1-frontend 交接报告入册」）。
```
