STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P2-backend
BASELINE: HEAD=76d27cb（P1-integration 交接报告入册）。工作树未跟踪的 `demo/`、`experiments/`（及 backend/ 下历史遗留的 `learningj-backup-*.db` 快照文件）原样保留、未提交、未触碰；本包改动仅 backend/** 与本报告，frontend/** 零改动（无 fixture 透传需求，见 Changed）。

Contract ledger:
- `docs/mvp-tech-and-phases.md` §3 P2 必须完成第 1 条（算法 token API）— 交付 `GET /sentences/{sentence_id}/tokens` 作为「等价当前 API」：计划原文路径 `GET /sentences/{id}/analysis/algorithmic` 含旧 AI 端点标记 `/analysis`（test_contract_surface 的 FORBIDDEN_MARKERS 明确禁止），等价路径条款正是为此存在。响应携带 token 表层/规范化形/POS/reading/reading_source、code point 半开区间、确定性 lexeme_id（ADR-018）、`sidecar_generation_id` 与 segmenter/tokenizer/analyzer_dict 三版本戳（§8.3），并按 §2.0「查询结果必须带 source/version provenance」对已导入词典做目标集一次批量查询给出顶层 provenance 明细 + 逐 token source_id。
- plan P2 第 2 条 + `data-model.md` §2.0 + ADR-032 — Yomitan ZIP 导入：解析层（`dictionary/importer.py`）与持久化层（`dictionary/service.py`）分离，解析/资源落盘在写事务之外，发布是单个短事务（§11.3）；安全边界（穿越路径/盘符/反斜杠/绝对路径/重复成员拒绝、4096 文件与 512 MiB 解压总量、128 MiB 单文件上限、损坏/缺 index/未知 format/非法行结构均带定位拒绝）、archive hash 幂等（重复导入零重复行、仅记录重放运行、响应 200）、canonical 五表落地、structured content 原样保留 + 纯文本投影降级、精确查找（expression/reading）与 FTS5 前缀搜索（派生投影、可由 dictionary_entries 完整重建）、词典导入不创建 KP。
- plan P2 第 3 条 + `data-model.md` §5 + ADR-030 + ADR-009 — Annotation：用户选区只给 surface，char_start/char_end 由后端在规范化句文本 `find_all` 定位（code point 半开）；单命中按 token 对齐（aligned/partial/unaligned），>1 命中按 §1 为每处各产一个 Span 全标 ambiguous；跨句划线 = 有序 Span 数组（annotation_spans.ordinal）；列表检索 + 按文本（note/surface 子串）与时间筛选；span 位置数据即跳回原文数据；删除个人批注时清理不再被引用的 Span（§0.1 引用处理）；创建/读取/删除零 KP/KE/ReviewItem。
- plan P2 第 4 条 + `data-model.md` §2.2/§2.5/§0 + ADR-040 — Lexeme 证据入口：`scope_form_key` 由 `domain/scopes.py` 唯一派生（`lexeme:` / `form:`+NFC，不 trim 不折叠、空词形拒绝），KE 与 LexemeKnowledgeDecision 共用同一规则；known 与同目标同作用域 user_asserted KE 同事务产生（confidence 1.0、observed_at_basis=user_action、analyzer_dict_version+resolver_version 必填）；unknown 压过导入与 SRS 但不伪造负向 KE、不删历史；clear 清人工覆盖回到其他来源求值、不复活旧 user_asserted；决定按 `(lexeme_id, scope_form_key, decision_seq)` 唯一有序、读最新不扫全库（§11.1）；operation_key 同键同输入幂等返回（200）、异输入 409；撤回追加保存、两个目标键恰好一个非空且分别唯一、撤回当前 known 引用的 KE 时同事务追加该作用域 clear、同键重试返回原结果并说明已撤回；词形查询先取非 clear 词形裁定再回退 Lexeme 级，Lexeme 级摘要只算 Lexeme 级证据与裁定。
- plan §1.5 P2 行 — 「KE、词形/Lexeme 作用域裁定、撤回、按词摘要、写后读一致；查词不产生 KE」逐项落为 API 与测试；「每条写路径同事务失效记录」以 `lexeme_evidence_summaries` 同事务重算 + `lexeme_projection_state.revision` 持久变更序列承载，用户操作后读取立即可见（无任何缓存层，写后读一致由测试锁定）。
- `docs/data-model.md` §1 — Span 的 `alignment_sidecar_id`（[不可推迟]）随首个 Span 生产者（Annotation）落地补入 `spans` 表；存在 token 区间（aligned）时必填。
- `docs/mvp-tech-and-phases.md` §3.1 不变量矩阵 — #8（查词/阅读/注音不产 KE、身份空间隔离）与 #21（作用域裁定/unknown 压过/clear 不复活/撤回原子失效）首次验证点亮为真实断言；#5 作 KE 侧生产者扩面补测（原 ledger 测试 docstring 明言「KE 侧生产者扩面仍归 P2」）；#6 作 Annotation Span 生产者补测（切片回读==surface），其首次全量验证仍归 P4a（矩阵权威），ledger xfail 保持原位不机械沿用、不提前抢跑。
- `CURRENT-PACKETS.md` 顶部数据库政策 + ADR-042 — 删除重建唯一建库路径；开发基线表集合从 5 张 P1 表扩宽至登记表 + 5 张 P1 表 + 13 张 P2 证据层表（词典五表、known_evidence、决定/撤回/摘要/投影序列、annotations/spans/annotation_spans），基线身份升至 `learningj-development-schema-2026-09-12-p2`（沿用 P1-backend 扩宽 3→5 表并升 `-p1` 的先例）；occurrence_spans/analysis_section_spans 因父表未建而不入基线；FTS5 表是导入时创建的派生投影，不属基线。
- P2 明确不做 — token 点击/查词 UI（P2-frontend）、Anki/jpdb 已知词表导入（P2-known-import）、实验 11a（P2-integration）、KP/Occurrence/StudySession/提取/复习（P3+）、按代次读取 API（§8.3 契约缺口，报告不实现）、性能声明、pnpm approve-builds——均未做。
- 前任闸门输入核对 — P1-integration 报告 STATUS: done 且 CR 段未写入（报告正文即闸门），其 Verified 全部项目在本轮回归中仍绿；P1-backend Review 三条 finding：①报告计数 79→80 与 ②Changed 清单不完整均为记录性事项，本轮以实测输出为准；③「补 EPUB+ruby hints 重建幂等用例」已由 P1-integration d658f3e 闭合（test_epub_ruby_hints_survive_idempotent_rebuild_and_generation_switch 本轮原样通过）。P1-frontend Review findings: none；其残余风险中「生成 fixture 仅 txt/srt」由 P1-integration 四格式真实 API 测试闭合，「书目/视听计数」属前端展示取舍、「pnpm approve-builds」留 lead，均非本包边界。

Assumptions refused:
- 不实现按代次读取 token/摘要 API：§8.3 未定义该端点（P1-backend 已声明为契约缺口），token 视图只服务指针代次。
- 不给 known_evidence 加 import_run_id/session_id 列、不给撤回表的 import_run_id 建 FK：目标表 KnownImportRun/StudySession 属 P2-known-import/P3a；按 plan「新实体只落地实际需要的最小字段」与 ADR-042 重建制，由属主切片落地时补建（撤回表形状——恰一非空 CHECK——已按契约就位）。
- 不猜测 Yomitan format 2/3 的行结构：经官方 schema 核实 `format` 为整数枚举 1–3，本导入器只解析 format 1 与无声明旧布局，2/3 带定位拒绝（ADR-032「未知 schema 给出定位信息」），不静默错解。
- 不给合成导入事实实现生产者：unknown 压过导入的测试按 plan P2 测试边界直插 import_anki KE 行 + 摘要重建，不提前实现 KnownImportRun 或 ReviewEvent。
- 不冻结 P1 sidecar payload 形状：token 读取按已知键取值、额外键（如 ruby_hints、未来字段）原样忽略并有测试锁定；P1 素材面六个端点与全部 P1 模型字段零改动。
- 不用缓存换写后读一致：读取路径全部实时查库，§11.2 的「失效记录」由同事务摘要更新 + 持久 revision 序列承载。

Owned files:
- `backend/**`：新增 `dictionary/`、`evidence/`、`annotations/`、`tokens/` 四个服务包、`domain/scopes.py`、`domain/versions.py`、`fixtures/reader_fixture.py`、四个测试文件；修改 models（lexeme/span/dictionary/__init__）、api（app/schemas）、maintenance、ingest（版本戳来源统一）、invariants 台账、schema/contract-surface/conftest 测试；再生成 `fixtures/openapi.json`、新增 `fixtures/reader-fixture.json`；`docs/task-packets/reports/P2-backend-handoff.md`（本报告）。

Blockers:
- None。全部验收证据为新鲜通过的真实输出。

Changed:
- `backend/src/learningj/dictionary/importer.py`（新）— 纯解析层：官方 schema 对齐的 term bank v1 行解析（≥5 列、definitionTags 可空、空读音=expression、score 数字、tags 去重合并 definitionTags+rules）、sequenced 词典按 (expression, reading) 首现分配 sequence、structured content（dict 保留 + text 字段收集降级；list 按 legacy 保留）、路径穿越/重复成员/尺寸上限/损坏/未知 format 的带定位拒绝、index 其余字段整体保留为 license_metadata、term_meta bank 跳过并计数。
- `backend/src/learningj/dictionary/service.py`（新）— 幂等导入（hash 命中→零重复行+重放运行 200）、有界批次写入（§11.3）、资源落盘（无资源不建目录；失败清理）、FTS5 索引创建/填充/全量重建（`rebuild_search_index`）、精确查找（reading 过滤含空读音）与搜索（精确优先+FTS 前缀）。
- `backend/src/learningj/evidence/service.py`（新）— 裁定/撤回/摘要/known view：`record_decision`（known 同事务建 KE、seq 单调、operation_key 幂等与冲突判定——input_surface 仅 known 持久化故只对 known 参与重放比对，代码内注明）、`retract_evidence`（恰一目标、追加式、当前 known 引用时同事务追加 clear `{op}#clear`）、`recompute_scope_summary`/`rebuild_summaries`（可重建投影 + revision）、`compose_known_view`（form 非 clear > lexeme 非 clear > 导入支持的优先级组合；known 引用的 KE 失效时不贡献的防御）、`evidence_rows` 分页。
- `backend/src/learningj/annotations/service.py`（新）— find_all 定位（`domain/offsets.find_all_occurrences`）、ambiguous/aligned/partial/unaligned 判定、有序 annotation_spans、列表筛选（q/since/until/limit/offset）、删除清理孤儿 Span、`span_surface_matches`（不变量 6 生产者断言入口）。
- `backend/src/learningj/tokens/service.py`（新）— 已发布代次的句子 token 视图：payload 开放读取、缺 lexeme_id/缺区间显式 `PayloadIntegrityError`、词典 provenance 目标集一次批量查询。
- `backend/src/learningj/domain/scopes.py`（新）+ `domain/versions.py`（新）— scope_form_key 派生唯一实现（SCOPE_RESOLVER_VERSION/KNOWN_RULE_VERSION 版本戳）；SudachiDict 版本统一读取入口（ingest 同步改用，消除第二处 importlib 调用）。
- `backend/src/learningj/domain/offsets.py` — 新增 `find_all_occurrences`（§1 定位规则的后端实现，Python str 天然 code point）。
- `backend/src/learningj/db/models/lexeme.py` — KnownEvidence 扩列（scope_form_key NOT NULL、input_surface/input_reading、observed_at_basis、resolver_version、operation_key 唯一）+ §11.1 复合索引；新增 LexemeKnowledgeDecision（三元唯一 + known⇔evidence_id CHECK）、KnownEvidenceRetraction（恰一非空 CHECK；import_run_id 无 FK，注记属主切片）、LexemeEvidenceSummary（复合主键投影）、LexemeProjectionState（单行 revision）。
- `backend/src/learningj/db/models/span.py` — Span 补 `alignment_sidecar_id` FK（§1 [不可推迟]）。
- `backend/src/learningj/db/models/dictionary.py` — 补 expression/reading 跨来源查找索引。
- `backend/src/learningj/db/models/__init__.py` — 注册四个新模型。
- `backend/src/learningj/db/maintenance.py` — 基线表集合 5→18（含登记表）、身份升至 `-p2`、create_all 显式清单同步扩宽；快照/验证逻辑零改动（身份自动读新登记）。
- `backend/src/learningj/api/app.py` + `api/schemas.py` — 12 条新路由（tokens/dictionaries×4/annotations×3/lexemes×4/known-evidence）与 27 个 Pydantic 模型；`create_app` 增加 `assets_root` 参数（env `LEARNINGJ_ASSETS_ROOT`，默认 `./learningj-assets`）；路由负责 commit（服务层无 commit，事务边界在入口）；replay 用 `Response` 降为 200。
- `backend/src/learningj/fixtures/reader_fixture.py`（新）— P2 契约面 fixture：重建基线库 → 真实 TestClient 走完词典导入（代码内确定性 ZIP，ZIP_STORED+固定 date_time）/token/查找/搜索/划线/裁定/摘要/known-view，UUID→`fixture-id-*`、ISO 时间戳→`fixture-timestamp`，两次运行字节相同。
- `backend/fixtures/openapi.json`（再生成，6→18 路径）+ `backend/fixtures/reader-fixture.json`（新）；`material-fixture.json` 再生成逐字节不变。
- 测试：`test_dictionary_import.py`（11 例）、`test_annotations.py`（9 例）、`test_evidence.py`（10 例）、`test_tokens_api.py`（5 例）、invariants 台账（#8/#21 点亮 + #5 KE 侧生产者 + docstring 更新）、`test_contract_surface.py`（EXPECTED_PATHS 扩至 18 + reader fixture 可复现/内容/与 tracked 一致三测）、`test_schema.py`（EXPECTED_TABLES +4）、conftest（`build_yomitan_zip` 共享构造器、`dev_reader_environment` fixture）。

Public contract:
- 算法 token：`GET /sentences/{sentence_id}/tokens` → `{sentence_id, material_id, sidecar_generation_id, segmenter_version, tokenizer_version, analyzer_dict_version, dictionary_sources[{source_id, display_name, source_version}], tokens[{surface, normalized_form, pos, reading_form, reading_source, lexeme_id, char_start, char_end, dictionary_source_ids}]}`；无代次 404；payload 缺 lexeme_id 500（发布闸门拒于前、读取层防于后）。
- 词典：`POST /dictionaries/import`（201 新导入 / 200 幂等重放，`idempotent_replay` 标记）、`GET /dictionaries`、`GET /dictionaries/lookup?expression=&reading=`（无命中空 entries）、`GET /dictionaries/search?q`（精确优先+FTS5 前缀）。
- Annotation：`POST|GET /materials/{material_id}/annotations`（q/since/until/limit/offset）、`DELETE /annotations/{id}`；AnnotationOut 携带有序 spans（surface、code point 偏移、token 区间、alignment_status、alignment_sidecar_id）即跳回原文数据。
- 证据：`POST /lexemes/{lexeme_id}/decisions`（known/unknown/clear + operation_key；201/200/409/404）、`POST /known-evidence/{evidence_id}/retractions`（201/200/409；`appended_clear` 标记）、`GET /lexemes/{lexeme_id}/evidence`（分页 + 撤回标记）、`GET /lexemes/{lexeme_id}/evidence-summary`（按词摘要 + projection_revision）、`POST /lexemes/known-views/batch`（≤500 目标集批量：lexeme_scope/form_scope/effective{state,basis,decision_id,evidence_id}，`known_rule_version=learningj-known-rule-v1`）。
- 生成 fixture：`openapi.json`（18 路径）、`material-fixture.json`（逐字节不变）、`reader-fixture.json`（新，含 tokens/txt|srt、dictionary/source|lookup|search、annotations/txt、evidence/decision|summary|known-views，均确定性归一）。
- 开发基线：`learningj-development-schema-2026-09-12-p2` / `learningj-contract-2026-09-12-p2`；表集合=登记表+5 P1+13 P2（见 Contract ledger）；快照 manifest 身份自动携带新基线。
- P1 契约面（materials/sentences/sidecar/lexeme-counts/rebuild/healthz 与全部模型字段）零改动；P2-frontend 的起点仍是 P1-frontend props + `material-fixtures.ts`（本轮未触碰 frontend，其 88 例测试原样通过）。

Verified:
- `cd backend && uv run pytest -q` — pass：`129 passed, 21 xfailed in 13.41s`（基线 89+23=112 → 129+21=130 collected：本包新增 40 例；strict xfail 23→21，#8/#21 按矩阵点亮，其余台账原位，无意外失败）。
- CLI 探针 `uv run python -m learningj.db.maintenance rebuild-development-db --db /tmp/learningj-p2-probe.db` — pass：`-p2` schema/契约身份、app 0.1.0；表恰为登记表+18 张（5 P1 + 13 P2）；触发器恰为 `trg_sidecars_immutable_update/delete`；行数 materials=2/sentences=5/sidecars=2/lexemes=22/counts=24（fixture 与 P1 逐字节同源）；`integrity_check ok`、`foreign_key_check` 空。
- CLI 探针 `export-snapshot` + `verify-snapshot`（同库）— pass：manifest 身份 `-p2`、integrity/fk ok。
- 生成契约再生成比对 — pass：openapi.json / material-fixture.json / reader-fixture.json 三者 `diff -q` 全部与 tracked 一致（material-fixture 逐字节不变）；并分别由 `test_tracked_contract_artifacts_match_regeneration`（P1 两件）与 `test_tracked_reader_fixture_matches_regeneration`（新增）锁定。
- `cd frontend && pnpm test` — pass：`Test Files 12 passed (12)`、`Tests 88 passed (88)`；`pnpm lint` — pass（exit 0）；`pnpm build` — pass，产物哈希 `index-BJa1EWRe.js 158.67 kB` 与 P1-frontend 报告一致（证明 frontend 零改动）。
- 边界 rg 扫描 — pass：①frontend 旧 AI 端点/标记、②组件→shells/react-router、③裸 slice/substring/substr 三组零命中；④backend 旧标记仅 `db/models/analysis.py` 既有 docstring 一处（P0 起的历史说明，非本轮引入）；⑤四个新服务包零 KnowledgePoint/Occurrence/ReviewItem import（仅边界 docstring 提及）；⑥新服务文件零 `session.commit`（事务边界在路由入口）。
- `git diff --check` — pass：无空白错误；`git status` 与基线对照仅 backend/**（+本报告），demo/、experiments/ 原样未提交。

Known limitations:
- 无按代次读取 API（§8.3 契约缺口维持）：token/摘要只服务当前指针代次；旧代次在存储层保留。
- Annotation 无编辑（PATCH）端点：ADR-030 允许批注编辑，本包按验收最小面交付 create/list/filter/delete，编辑属后续小改。
- FTS5 用默认 unicode61 tokenizer：日文无词界，前缀搜索按 token 前缀匹配，不做任意子串；阅读器主路径是精确查找；索引为可重建投影（`rebuild_search_index` 有测试）。
- Yomitan format 2/3 档案拒绝（仅 format 1/旧布局）；term_meta bank（词频元数据）跳过并计数，不在 P2 建模。
- 词典资源（图片/音频）落盘于 `assets_root`（env `LEARNINGJ_ASSETS_ROOT`，默认 `./learningj-assets`）；快照导出仅覆盖数据库文件，资源文件不在 manifest 内——定义降级显示是契约支持的路径，资源随快照迁移属未来受支持基线工作（已登记 CR focus）。
- KE 的 import_run_id/session_id 列与撤回表的 import_run_id FK 随 P2-known-import/P3a 属主切片补建；整运行撤回（import_run_id 路径）P2 不可调用。
- known view 的 SRS 分量缺席（P5 资格信号落地后并入）；当前 effective 组合=用户裁定+导入支持，未合成掌握分（§10 红线不涉及）。
- 无 token 渲染/查词 UI、无 Anki/jpdb 导入、无实验 11a、无任何性能声明（各自属 P2-frontend/P2-known-import/P2-integration）。

Gate for next packet:
- Ready：P2-frontend 可依赖的契约面已双端锁定——18 路径 OpenAPI 与客户端零冲突（P1 消费面字段逐字节未动，frontend 88 例原样通过），reader-fixture.json 锁定 token/词典/划线/证据响应形状（含 `𠮟られた` code point 样例、词典 provenance、时间戳归一）；P2-integration 可在交付 API 上验证 token parity（对拍 Sudachi A mode）、ZIP 安全、无副作用（查词/划线零 KE）、unknown 优先级/clear、目标集批量读取与无扫描结构（实验 11a）。
- Not safe to assume：按代次读取 API（不存在）；词典资源的快照携带；Anki/jpdb 已知词表导入（P2-known-import）；known view 的 SRS 分量与资格摘要（P5）；任何性能结论；`pnpm approve-builds` 状态（lead 未决，无实际影响）。

CR focus:
- 撤回的原子失效语义：`retract_evidence` 在单事务内完成「撤回行插入 + 当前 known 引用该 KE 时追加 clear（operation_key=`{op}#clear`）+ 摘要重算 + revision 递增」；同键重试返回原结果（200，created=false），换键重复撤回同一 KE 返回 409（部分唯一约束兜底）。请确认「不能回退到更旧人工决定」的 clear-追加实现与 §2.2 一致。
- unknown 优先级的组合面：`compose_known_view` 的优先级为 form 非 clear 裁定 > lexeme 非 clear 裁定 > 有效导入支持；known 引用的 KE 被直插撤回（绕过服务）时该 known 不贡献的防御分支已实现——这是对「用户来源只有被当前 known 决定引用的有效 KE 可以贡献」的双重保障，请复核该解释。
- 发布闸门与读取层防御的分工：缺 lexeme_id 的 token 在 `_generation_counts`（发布前）与 token 读取层（防御历史残缺 payload，500 + 明确 detail）双重拒绝，测试同时覆盖两条路径；请确认读取层 500 的严格度是期望行为。
- operation_key 幂等的比较面：unknown/clear 决定不持久化 input_surface（决定契约无该字段），同键重放一致性按（lexeme, scope, decision, conjugated_form）判定、known 另比 input_surface/input_reading/material_id（经引用 KE）——同键不同 surface 的 unknown 无法检出，属契约形状决定的已知边界（代码内注明）。
- 开发基线 5→18 表与 `-p2` 身份：请对照 §1.5「P2 词汇判断/查词」行确认 P2 拥有证据层表集合的读法；occurrence_spans/analysis_section_spans 因父表未建而排除、FTS5 作为派生投影不入基线，是有意边界。
- Yomitan 安全拒绝面：穿越/盘符/反斜杠/重复成员/尺寸超限/损坏/缺 index/未知 format/非法行结构全部带定位拒绝（官方 schema 核实 format 为整数 1–3）；资源在事务外落盘、发布失败清理目录。评审可重点确认没有静默容错把坏数据写成行。
- Annotation 多命中语义：>1 命中每处一个 Span 全标 ambiguous 且不给 token 区间（§1「ambiguous 与 partial 是两回事」），单命中才做 aligned/partial 判定；请确认与 §1 定位规则表一致。

Open issues:
- None（阻塞级）。提交哈希：本包实现与测试 = 270ea62（仅 backend/** 32 个文件）；本报告入册提交紧随其后（见仓库 log「P2-backend 交接报告入册」）。

## Review

### 2026-09-12 独立复审（CR，reviewer）

```text
VERDICT: changes-requested
Findings:
- [P1] backend/src/learningj/api/schemas.py:237 — expected_decision_seq 仍可省略，evidence/service.py 仅在非 None 时验证；独立探针依次以 canonical 令牌、完全省略令牌、别名令牌写入同一作用域均得到 201（序号 1/2/3），只有 stale alias 返回 409。来源：data-model §0 修改提交边界、§2.2「每个作用域具有…预期版本检查」；最小修复：保留多个输入别名但将令牌设为必填，移除 None 绕过并更新调用者/测试。
- [P1] backend/src/learningj/dictionary/service.py:323 — 已有词典条目时 dictionary_search_fts 被删除，search_index_exists 返回 false 并静默降级；独立探针导入后 DROP TABLE、前缀查词返回 `200 {entries: []}`，遗漏真实命中。来源：P2 FTS5 验收与 ADR-032 可见失败边界；最小修复：区分「无词典的正常空结果」与「已有条目但 FTS 表缺失」，后者转 DictionarySearchError/503，并补真实 DROP TABLE 回归。
Evidence checked:
- 本轮只审查用户提供的修复工作树；此前 8 个实现缺陷均复核为已闭合：known 重放从引用 KE 比较输入、retraction reason 冲突、随机内部 clear 键、撤回目标分别 UNIQUE、canonical ZIP 路径去重、staging 落盘清理、DONE 的 finished_at/约束、非法/过期 FTS 引用和 MATCH 异常的 503。
- `cd backend && uv run pytest -q`：`134 passed, 21 xfailed in 15.32s`，无 skip；台账 xfail 无倒退。定向 evidence 12 passed、dictionary 14 passed。
- rebuild-development-db 到 `/tmp/learningj-p2-rerun-01a094ea.db`：schema/contract 均为 -p2、19 表、触发器恰为 trg_sidecars_immutable_update/delete、行数 2/5/2/22/24、integrity ok、FK 空；export-snapshot + verify-snapshot 的 manifest 身份为 -p2。
- OpenAPI/material-fixture/reader-fixture 全部重新生成并逐字节一致；frontend test/lint/build 通过（12 files、88 tests、25 modules、index-BJa1EWRe.js 158.67 kB）；边界 rg 与 git diff --check 通过，demo/、experiments/ 未触碰。
- Token 双重拒绝、Annotation 多命中语义、known-view 优先级和 unknown/clear 的已注明幂等边界仍符合契约。
Gate assessment:
- P2-frontend：暂不安全派遣；裁定 API 仍允许无版本令牌写入，无法为 UI 建立 required optimistic-concurrency 合约。
- P2-integration：暂不安全派遣；已有词典后的 FTS 投影丢失仍会被误报为无结果。
- P2-known-import：暂不安全派遣；虽撤回唯一性和 ImportRun 完成时间已闭合，但基础裁定写路径仍缺必需版本检查。
Residual risks:
- 当前修复实现尚在工作树、未作为独立实现提交入册；两项 P1 修复后仍须重跑完整闸门与真实缺表/缺版本令牌回归。
- 其余明确不做项（按代次读取 API、已知词表导入、实验 11a、性能、KP/Occurrence/StudySession/提取/复习）保持在包范围外。
```
