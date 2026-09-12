STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P1-integration
BASELINE: HEAD=1366fda9（P1-frontend 交接报告入册）。工作树在开工时仅有未跟踪的 `demo/`、`experiments/`，全程原样保留、未提交；本包改动只有两个新增测试文件与本报告，未修改任何 tracked 文件。

Contract ledger:
- `docs/task-packets/CURRENT-PACKETS.md` P1-integration 行 — 集成包只拥有跨边界测试/验证：type/API 一致性、全格式、幂等、原子代次、恢复、BYOK-free 浏览、无 shell 反向依赖；发布 P2 contract。开工门槛（P1-backend、P1-frontend 两份 `VERDICT: approve`）已满足，其 Review 段逐条核对（闭合说明见下）。
- `docs/mvp-tech-and-phases.md` §3/P1 验收点 — 逐条落为测试：材料词频与全量重建一致；响应携带 `sidecar_generation_id` 且同一响应单代次；重建期间旧代次持续可读、指针原子切换后才读新代次；fixture 能端到端还原 txt/srt 句子列表；导出可在隔离库恢复；组件无 shell 反向依赖。
- `docs/mvp-tech-and-phases.md` §1.5 — P1 内容索引接入点（不可变 sidecar 身份、正反向稀疏索引、完整版本发布与重建边界、重建期间不显示假零或混合代次）按 API 可观察面验证：counts 响应单代次、词频 == payload 全量重算、失败/重建期间读者只读旧代次完整词频（无假零、无混合）。
- `docs/mvp-tech-and-phases.md` §1.6 + `docs/adr/042` — 删除重建是唯一建库路径；快照导出/隔离恢复是产品能力；不实现兼容分支。恢复后基线登记行不自动重建的限制如实验证并报告（见 Known limitations），未实现任何兼容代码。
- `docs/data-model.md` §8.1–8.3 — Material 的 storage_mode/source_sha256/current_sidecar_id；§8.2 锚点表（subtitle `{cue_index}`、plain_text `{char_start,char_end}` 相对规范化全文、epub `{spine_index,char_start,char_end}` 相对 spine 规范化文本）与「统一抽象」；§8.3 sidecar 三版本戳与不可变代次——全部经 API 断言（锚点 payload 键集合逐类型严格成立、锚点/词元切片按 code point 等于句文本/surface）。
- `docs/data-model.md` §2.5/§11 — MaterialLexemeCount 单代次稀疏性（lexeme 去重、计数 == token 总数、逐条为正）；一次响应固定一个完整代次。
- `docs/data-model.md` §9 — P1 拥有的不变量 #5/#6：#5 以 API 面验证（四格式 sidecar 三版本戳非空）；#6 以 fixture 与真实 API 双向验证（token/锚点切片等于 surface/句文本，含 BMP 外「𠮟」）；其余 23 条的 xfail 台账未动。
- 前任闸门输入 — P1-backend Review 三条 finding：报告计数 79→80 与 Changed 清单不完整两条为记录性事项，本轮以实测输出为准；「补 EPUB+ruby hints 重建幂等用例」的建议已由本包闭合（见 Changed）。P1-frontend Review findings: none；其残余风险（生成 fixture 仅 txt/srt）按评审指出的路径以真实后端验证四格式闭合。

Assumptions refused:
- 不实现按代次读取 API：data-model §8.3 未定义该端点（P1-backend 已声明为契约缺口），集成只报告不实现。
- 不手改生成契约产物：`openapi.json`/`material-fixture.json` 只读取/再生成比对；不给 fixture 增补 epub 条目（那需要改实现代码 `material_fixture.py`，超出集成包边界）。epub 形状由真实后端四格式测试与 P1-frontend 的 props fixture（本地构造 + 边界声明）覆盖。
- 不冻结合法新增路径：OpenAPI 断言为「必需路径子集 + 禁止标记缺席」，不断言路径/模式总数，P2+ 合法扩展不受影响。
- 不执行 `pnpm approve-builds`（unrs-resolver 构建脚本批准属 lead 决定，本包验证 lint/build/test 均不受影响）。
- 集成测试不 mock 被测结果：全部用例跑在真实重建的开发基线库上；monkeypatch 仅用于模拟真实世界事件（词典升级）或制造观察窗口（重建事务进行中），断言全部来自真实 API/数据库探针。

Owned files:
- `backend/tests/test_p1_integration.py`（新，9 例）、`frontend/src/lib/p1-integration.contract.test.ts`（新，5 例）、`docs/task-packets/reports/P1-integration-handoff.md`（本报告）。

Blockers:
- None。

Changed:
- `backend/tests/test_p1_integration.py`（新）— 九个跨边界用例：①四格式（txt/srt/vtt/epub）端到端素材链：§8.1 资源边界字段、§8.2 锚点表键集合与 code point 偏移切片、§8.3 三版本戳、单代次词频 == 全量重算、代次贯穿 material/sidecar/counts 三处；②API 级导入幂等（同规范化全文 + 同 kind 重复导入返回既有素材，不以新文件翻译改写已存内容）；③EPUB ruby hints：幂等重建逐字节保留、词典升级新代次按 sentence_index 携带 hints、旧代次完整保留（闭合 P1-backend Review 建议用例）；④五种素材（fixture txt + 四格式）重分词字节级幂等（sidecar payload BLOB 与词频行指纹前后相等）；⑤重建期间并发 API 探针：事务进行中与「行已写、指针已切换但未提交」两个观察点读者都只见旧代次完整读数，提交后才见新代次（不只信 mock 的原子切换证明）；⑥快照导出 → 隔离副本恢复 → verify-snapshot：恢复库经 API 读数与源库一致、是可写活库（继续导入成立且不影响源库）、基线登记行原样携带；⑦导出后源库代次切换：旧快照恢复出的库仍服务导出时的旧代次（快照代次历史保留）；⑧tracked 契约产物与再生成字节一致（openapi.json + material-fixture.json）；⑨重建库经公开 API 还原 fixture 的 txt/srt 句子列表、sidecar payload 与词频（验收点「fixture 能端到端还原 txt/srt 句子列表」）。
- `frontend/src/lib/p1-integration.contract.test.ts`（新）— 五个跨边界用例：①生成 OpenAPI 的 P1 素材面（6 条必需路径子集、禁止标记缺席、五个操作的响应 $ref、MaterialOut/SentenceOut/SidecarOut/MaterialLexemeCountsOut/MaterialLexemeCountOut 必填集合与客户端解析器强制集合完全一致，`sidecar_generation_id` 在 sidecar 与词频两侧均为必填，source_sha256/current_sidecar_id 存在但可空）；②客户端四条读取函数对生成 fixture（含 lexeme-counts/txt|srt）逐字段解析一致，且全部请求无 headers/credentials、URL 仅 `^/materials`（BYOK-free 的请求面证明），可空字段以 null 被接受；③契约违约拒绝（缺 storage_mode / sidecar_generation_id / counts 的响应被客户端显式抛错）；④fixture 内部一致性：每个 token 的 code point 切片 == surface（经前端 `sliceByCodePoint`，含「𠮟られた。」BMP 外样例）、词频单代次/稀疏正向唯一/计数总和 == token 总数；⑤P1-frontend 发布给 P2 的 props fixture（material-fixtures.ts 声明「txt/srt 照抄生成 fixture」）与生成产物逐字段相等，本地构造的 epub 条目严格按 §8.2 锚点表键集合。`p0-integration.contract.test.ts` 零改动、原样通过。

Public contract:
- 本包不发布新契约。锁定的 P1 契约面（发布给 P2）：`GET|POST /materials`、`GET /materials/{id}/sentences`、`GET /materials/{id}/sidecar`、`GET /materials/{id}/lexeme-counts`（`MaterialLexemeCountsOut {material_id, sidecar_generation_id, counts[{lexeme_id, token_count}]}`，单代次）、`POST /materials/{id}/sidecar/rebuild`（幂等重分词）、`GET /healthz`；生成 fixture（txt/srt）与快照格式（`<name>.db` + manifest：type/created_at_utc/app_version/schema_id/contract_id/resources/sidecars）；开发基线身份 `learningj-development-schema-2026-09-11-p1` / `learningj-contract-2026-09-11-p1`。P2-frontend 的直接起点仍是 P1-frontend 的组件 props 与 `src/lib/material-fixtures.ts`（其与生成产物的一致性现已由测试锁定）。

Verified:
- `cd backend && uv run pytest -q` — pass：`89 passed, 23 xfailed in 8.02s`（基线 80 + 本包新增 9；23 条 strict xfail 为未点亮阶段的不变量台账，未动）。
- CLI 探针 `uv run python -m learningj.db.maintenance rebuild-development-db --db /tmp/learningj-p1-int-probe.db` — pass：`-p1` schema/契约身份、app 0.1.0；表集合恰为登记表 + 五张 P1 表；触发器恰为 `trg_sidecars_immutable_update`/`trg_sidecars_immutable_delete`；行数 materials=2/sentences=5/sidecars=2/lexemes=22/counts=24；`PRAGMA integrity_check` ok、`foreign_key_check` 空。
- CLI 探针 `export-snapshot` + `verify-snapshot` — pass：manifest 身份 `-p1`，`integrity_check: ok`，`foreign_key_check: ok`。
- 生成契约再生成比对 `uv run python -m learningj.api.export_openapi --out /tmp/.../openapi.json` 与 `uv run python -m learningj.fixtures.material_fixture --out /tmp/.../material-fixture.json` 后 `diff -q` tracked 版本 — pass：`REGENERATION MATCHES TRACKED`（6 条路径）；该比对同时固化为 `test_tracked_contract_artifacts_match_regeneration`。
- `cd frontend && pnpm test` — pass：`Test Files 12 passed (12)`、`Tests 88 passed (88)`（基线 83 + 本包新增 5；`p0-integration.contract.test.ts` 3 例原样通过）。
- `cd frontend && pnpm lint` — pass：exit 0（含 `learningj/no-bare-string-slice` 与 ADR-023 双栅栏）。
- `cd frontend && pnpm build` — pass：`tsc -b && vite build`，产物哈希 `index-BJa1EWRe.js 158.67 kB` 与 P1-frontend 报告一致（测试不进 bundle）。
- 边界 rg 扫描三组 — 全部零命中：①旧 AI 端点/标记（`AnalysisPanel|analysis\.ts|/analysis|/questions|/extract|/retention|/knowledge-points|session_closed|turn_count|extraction_status|extraction_trigger|/study|/review`，src 非测试文件）；②组件→shells/react-router import（`src/components`）；③裸 slice/substring/substr（text.ts 与测试除外）。
- `git status --short` — 仅两个新增测试文件（+ 既有未跟踪 demo/、experiments/ 原样）；`git diff --check` — 无空白错误。

Known limitations:
- 生成 fixture 仍仅覆盖 txt/srt（P0 起的已知缺口）：epub/vtt 的端到端验证以真实后端 API 完成（本包四格式用例）；fixture 增补 epub 条目需修改实现代码 `material_fixture.py`，不属集成包边界，维持 P1-frontend 的处理——props fixture 本地构造 epub 锚点并声明边界，其 txt/srt 值与生成产物的一致性已由本包测试锁定。
- 按代次读取 API 不存在：§8.3 未定义该端点（契约缺口，报告不实现）；旧代次在存储层保留（行 + payload + 代次词频），本包以并发探针与快照代次历史测试证明其可按代次取数，但公开读面保持指针作用域。
- 恢复后基线登记行不自动重建（§1.6/ADR-042 下不实现兼容）：实测恢复库的登记行随快照逐字节携带（`inspect_development_baseline` 与源库相等），没有恢复时重登记/对当前基线重盖章的机制；受支持基线的登记动作留待真实数据/对外发布前的工作。
- BYOK-free 浏览的验证面：后端无任何鉴权面（结构上成立）；客户端请求面无凭证/密钥材料（本包测试锁定）；UI 层「素材浏览不依赖 BYOK」文案与状态流由 P1-frontend 既有测试继续覆盖。
- 无 token 渲染/查词/词典/KP/StudySession/复习/导入 UI/播放（P2 及以后）；无任何性能声明（实验 11a 属 P2）。

Gate for next packet:
- Ready：P2-backend 可依赖的契约面已双端锁定——生成 OpenAPI/fixture 与 tracked 产物字节一致且与前端客户端消费面逐字段吻合（含 `MaterialLexemeCountsOut` 与 `sidecar_generation_id` 必填）；四格式、幂等（导入 + 字节级重分词）、原子代次（并发探针证明）、快照导出/隔离恢复/代次历史均有跨边界回归测试护航（`backend/tests/test_p1_integration.py` + `frontend/src/lib/p1-integration.contract.test.ts`）；P2-frontend 可直接使用 P1-frontend 的组件 props 与已验证与生成产物一致的 `material-fixtures.ts`。
- Not safe to assume：per-generation 读 API（不存在，§8.3 缺口待 lead/契约侧裁定）；快照恢复后的基线重登记机制（不存在）；token 渲染/查词等 P2 能力；任何性能结论；`pnpm approve-builds` 状态（lead 未决，当前无实际影响）。

CR focus:
- 并发探针测试的证明力：`test_old_generation_readable_during_rebuild_and_switch_is_atomic` 在真实重建库上于 `_publish_generation` 前后两次经独立 TestClient 读公开 API——第二个观察点时新 sidecar 行与词频已写入、指针已在未提交事务中切换，读者仍只见旧代次完整 payload 与词频；若 SQLite/SQLAlchemy 事务边界被破坏该测试会失败。评审可重点确认 monkeypatch 只制造观察窗口、断言全部来自真实读数。
- 字节级幂等的比较面：`_sidecar_fingerprint` 覆盖 sidecar 行（含 payload BLOB 原始字节、三版本戳）与 material_lexeme_counts 全部行；如幂等语义未来放宽（例如允许版本戳外字段变化），该指纹会正确失败——请确认这是期望的严格度。
- fixture 还原测试的比较面按字段白名单（句子七字段、sidecar 版本戳与 payload、词频 (lexeme_id, token_count) 有序对），不比较 UUID 形状的 id（fixture 归一为确定性占位 id 与真实 UUID 天然不同）；`sidecar_generation_id == current_sidecar_id` 单独断言。
- OpenAPI 必填集合断言为「完全相等」（非子集）：后端给 MaterialOut/SentenceOut 增加必填字段时会要求客户端同步，这是有意的契约锁；增加可选字段不触发。
- demo/ 与 experiments/ 依旧无任务包归属，历轮交接均为「保留未跟踪」；本轮未提交、未触碰，交 lead 决定（与 P1-backend Review 残余风险记录一致）。

Open issues:
- None（阻塞级）。提交哈希：集成测试与验证改动 = d658f3e（实现 P1-integration：四格式端到端、字节级幂等与并发代次探针、快照隔离恢复一致性与生成契约锁定，仅两个新增测试文件）；本报告入册提交紧随其后（见仓库 log「P1-integration 交接报告入册」）。
