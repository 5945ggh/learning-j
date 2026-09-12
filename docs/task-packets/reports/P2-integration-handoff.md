STATUS: blocked
PACKET: docs/task-packets/CURRENT-PACKETS.md -> P2-integration
BASELINE: HEAD=2b3f209（保留工作树既有未跟踪 demo/、experiments/；未修改 backend/frontend 实现与既有测试）

Contract ledger:
- `mvp-tech-and-phases.md` P2 验收与 §4 — 集成层只验证跨边界 token、词典、证据与 reader fixture；不实现任何业务面。
- `data-model.md` §§9、11.1 — 只读路径不得创建 KE/KP/ReviewItem；摘要与稀疏词频按目标集合读取，查询计划必须命中复合索引且不全扫；generation 必须贯穿单次响应。
- `spike-checklist.md` 实验 11a/11a — 本轮只作结构结论：目标集、稀疏索引、代次可见性、API 发布/回放边界与 fixture 重建一致性；不作性能预算或 P5 SRS 生产结论。
- P2-backend/P2-frontend handoff（两份 Review）— `expected_decision_seq` 必填、缺 FTS 表返回 503、前端第 2 轮 approve；前端已发布 `reader-fixtures.ts` 与 P2 客户端消费面。
- 拒绝假设 — P2 没有 SRS/播放生产者、KnownImportRun 或词形级 UI；测试不把这些未实现能力伪装成已存在，仅用合成 `import_anki` 事实验证 API 上的 unknown/clear 优先级。

Changed:
- `backend/tests/test_p2_integration.py` — 真实 TestClient 跨边界测试：Sudachi A mode 逐 token 对拍与 code-point 切片、ZIP API 安全/幂等（路径/绝对路径/反斜杠/盘符/重复成员/缺 index/缺 term bank/未知 format/非法行/损坏 ZIP）、查词/阅读/Annotation 零 KE/KP/ReviewItem 副作用、unknown/clear 语义（含同 input_revision 的全量重算）、真实 `known-views/batch` SQL trace 与 EXPLAIN。
- `frontend/src/lib/p2-integration.contract.test.ts` — P3 reader contract：生成 `reader-fixture.json` 的 token/词典/Annotation/evidence 面完整可消费、与 `reader-fixtures.ts` 逐字段一致、请求面 BYOK-free 且只读。
- `docs/task-packets/reports/P2-integration-handoff.md` — 本报告（唯一 docs 改动，保留 CR Review 段）。

Public contract:
- P3 reader fixture sections: `tokens/txt`, `tokens/srt`, `dictionary/source`, `dictionary/lookup`, `dictionary/search`, `annotations/txt`, `evidence/decision`, `evidence/summary`, `evidence/known-views`。
- API surfaces verified: `GET /sentences/{id}/tokens`, `POST /dictionaries/import`, `GET /dictionaries(+/lookup|/search)`, `GET /materials/{id}/sentences|sidecar|lexeme-counts`, `POST /materials/{id}/annotations`, `POST /lexemes/known-views/batch`, `POST /lexemes/{id}/decisions`。
- 11a partial evidence: 独立目标谓词 EXPLAIN 均命中索引，sidecar/counts/material 指针使用同一 generation，且重算在同一 `input_revision` 下逐字段一致；但真实 batch SQL trace 显示每个目标各发一条摘要查询，P1 N+1 闸门失败，不能发布“目标集合批量读取已通过”。

Verified:
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q` — **fail（预期暴露 blocker）**：`140 passed, 2 failed, 21 xfailed`；失败为真实 `/lexemes/known-views/batch` 三目标摘要 SQL trace 期望 1 条、实测 3 条，以及 target-scoped `rebuild_summaries` 实测无 WHERE 全扫。
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q tests/test_p2_integration.py` — **fail（同一 blocker）**：5 passed, 2 failed；ZIP 表驱动与其他集成断言均通过。
- `cd frontend && pnpm test` — pass: **21 test files, 172 tests**。
- `cd frontend && pnpm lint` — pass: exit 0。
- `cd frontend && pnpm build` — pass: `tsc -b && vite build`，产物 `index-DZLiNqgo.js 185.06 kB`。
- reader fixture regeneration — `uv run python -m learningj.fixtures.reader_fixture --out <tmp>/reader-fixture.json` + `diff -q` — pass（与 tracked artifact 字节一致；集成测试再次通过真实 API `build_fixture()` 比对）。

Known limitations:
- P2 当前没有 SRS/ReviewEvent/播放生产者，也没有 `ReviewItem` 表写路径；因此“unknown 压过 SRS”只能在当前 API 可见范围内证明不会被导入支持覆盖，完整 SRS 信号资格留给 P5。
- 11a 的真实 batch 目标集读取未通过：当前 backend 逐目标调用 `compose_known_view`，同一请求对 3 个目标产生 3 条摘要查询；`rebuild_summaries(..., lexeme_ids=...)` 的全表 scope 扫描也未被修改。11a 未测 10⁴–10⁶ 规模、p50/p95、事务/内存/WAL 预算或并发压力；这些是 P5 实验 11b 的范围。
- 真实 409 并发写、词典来源撤回 UI、词形级裁定 UI 与逐 token 像素 popover 锚定仍按前任报告列为非阻塞残余。

Gate for next packet:
- Ready: P3 reader fixture/API 字段、token/Sudachi parity、ZIP 拒绝类别与 archive-hash 幂等、查词/阅读零副作用、unknown/clear（含 input_revision 保持）均有真实命令证据。
- Not safe to assume: P2-integration 尚未通过；P3 不得派遣，直到 backend 属主修复真实 batch 目标集批量读取与带目标谓词的重建全扫问题并重新运行本测试。P3 仍不能假设 SRS/ReviewItem/播放端点或 KnownImportRun 已存在。

CR focus:
- 已按 Review 要求改为捕获真实 endpoint SQL；当前证据是 3 条摘要 SELECT（目标数 3），并新增 target-scoped rebuild SQL trace 捕获两条无 WHERE 的 DISTINCT 全扫，因此 blocker 可稳定复现。
- 已保留并比较 `input_revision`：全量重算在同一 revision 下逐字段相等；projection revision 不被错误当作语义字段。
- ZIP 拒绝类别已通过 `/dictionaries/import` 表驱动上传，并逐类断言 422、定位 marker 与 sources/entries/runs/assets 零增长。
- backend 修复后需重跑该测试，确认单次目标集摘要读取、无全扫重建，再恢复 `STATUS: done`。

Open issues:
- Blocked by owned-scope conflict: backend `known-views/batch` 与 `rebuild_summaries` 需要实现层修复，但本包明确不得修改 `backend/**` 实现。所有改动保留在工作树，未提交；demo/、experiments/ 未跟踪文件原样保留。

## Review

VERDICT: changes-requested
Findings:
- [P1] `backend/src/learningj/api/app.py:558-560`、`backend/src/learningj/evidence/service.py:449-450,474` — `/lexemes/known-views/batch` 对每个输入逐个调用 `compose_known_view`，每个目标至少执行一次摘要查询，无法满足 `data-model.md` §11.1／实验 11a 的目标集合批量读取和不随 token 重复 SQL；`rebuild_summaries(..., lexeme_ids=...)` 还先对全部 KE/decision scope 做 `DISTINCT` 再在 Python 过滤（`backend/src/learningj/evidence/service.py:405-416`），增量重建仍可全扫。现有 `backend/tests/test_p2_integration.py:267-296` 只对一条独立手写的 `WHERE lexeme_id IN (...)` 语句做 EXPLAIN，未证明 API 实际查询计划，因此会在该 N+1/全扫实现下照样通过。最小修复：为 batch API 和带目标集的重建先批量预取/按目标谓词查询（保留输入顺序与去重语义），并用 SQL trace/查询计数及实际语句的 EXPLAIN 锁定一次目标集读取、无全扫描。
- [P2] `backend/tests/test_p2_integration.py:236-255` — 11a 增量/全量摘要等价断言主动删除了 `input_revision` 后再比较；§11.1/§11.2 要求相同输入修订号、规则/映射与代次下重建一致，因此当前测试即使重建改变 `input_revision` 仍会通过，也没有断言该关键一致性。最小修复：只忽略允许变化的投影序号，保留并比较 `input_revision`、规则/解析版本及目标代次，并明确走增量路径与全量重建路径后逐字段比较。
- [P2] `backend/tests/test_p2_integration.py:97-128` — 真实 API 边界只覆盖路径穿越、绝对路径和损坏 ZIP；反斜杠/盘符/重复成员、缺 index/term bank、未知 format、非法行结构及尺寸上限主要仍由解析器直测（虽有一个独立 API 尺寸失败用例），因此本包的“ZIP 安全”闸门没有逐类证明发布事务在 endpoint 上对所有拒绝都保持零行/零资源。最小修复：将关键拒绝类别表驱动地通过 `/dictionaries/import` 上传，并对每类断言 422、定位信息以及 sources/entries/runs/assets 均不增加。
Evidence checked:
- 指定文档：`docs/task-packets/protocols/code-review.md`、`CURRENT-PACKETS.md` P2-integration 行、`protocols/implementation.md`、P2-backend/P2-frontend/P2-integration handoff（含既有 Review）、`mvp-tech-and-phases.md` P2 与 §4、`data-model.md` §9/§11、`spike-checklist.md` 实验 11a。
- `backend/tests/test_p2_integration.py`、`frontend/src/lib/p2-integration.contract.test.ts`、`frontend/src/lib/reader-fixtures.ts`、`backend/src/learningj/fixtures/reader_fixture.py` 与真实 API 实现；P2-backend 报告中 f3d22c1 已修复的两项 P1 未重新打开。
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q`：`141 passed, 21 xfailed`。
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q tests/test_p2_integration.py`：`6 passed`。
- `cd frontend && pnpm test`：`21 test files passed, 172 tests passed`；`pnpm lint`：exit 0；`pnpm build`：成功（`index-DZLiNqgo.js`）。
- `git diff --check`：通过；`git status --short`：仅既有 `CURRENT-PACKETS.md` 修改、P2-integration 测试/报告与 frontend 测试未跟踪项，以及原样未跟踪的 `demo/`、`experiments/`；未修改实现、既有测试、prompts 或 DESIGN.md。
Gate assessment:
- P2-integration：不通过，暂不安全派遣 P3。P1 的真实目标集批量/无全扫闸门尚未满足；修复后需重新运行 11a 结构验证。P2 token parity、fixture 三方字段/无凭证面、查词/阅读/Annotation 的 KE/decision 零写入、import unknown/clear 以及 archive-hash 重放均有通过证据；SRS、ReviewEvent、播放生产者和 ReviewItem 仍未实现，未将其误判为已存在。
Residual risks:
- 本轮未测 10⁴–10⁶ 规模、p50/p95、并发/WAL/内存预算，仍属于 P5 实验 11b；真实 409 并发写和来源撤回 UI 也不在本包。
- Sudachi A-mode 与 code-point 切片、reader fixture 重建、前端 172 例/lint/build 均在本轮命令中实际通过；这些通过不能抵消上述批量查询闸门缺口。

### 2026-09-12 blocker 修复复审（CR，reviewer）

VERDICT: approve
Findings: none
Evidence checked:
- `backend/src/learningj/api/app.py:558-560` 已改用 `compose_known_views_batch`；`backend/src/learningj/evidence/service.py` 已将摘要读取与 user_asserted evidence 校验改为目标集合批量查询，并将 `lexeme_ids` 谓词下推到 `rebuild_summaries` 的两条事实查询；输入顺序、重复目标、词形优先级和 unknown/clear/import 语义由现有测试覆盖。
- 新增真实 SQL trace/EXPLAIN 闸门：3 个目标只产生 1 条摘要集合查询；target-scoped rebuild 不再产生无 `WHERE` 的事实扫描；增量/重建逐字段比较保留 `input_revision`。
- ZIP 安全表驱动 API 测试覆盖路径穿越、绝对路径、反斜杠、盘符、重复成员、缺文件、未知 format、非法行、损坏 ZIP，并验证 422 与零落库。
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q`：`142 passed, 21 xfailed, 1 warning`。
- `cd backend && UV_CACHE_DIR=/tmp/learningj-uv-cache uv run pytest -q tests/test_p2_integration.py`：`7 passed, 1 warning`。
- `cd frontend && pnpm test`：`21 test files passed, 172 tests passed`；`pnpm lint`：exit 0；`pnpm build`：成功；`git diff --check`：通过。
- 复核范围外无变更：frontend、prompts、DESIGN.md、demo/、experiments/ 未触碰；未提交 commit。P2-backend 报告中 f3d22c1 已修复的两项 P1 未重新打开。
Gate assessment:
- P2-integration：通过，可安全派遣 P3。token/Sudachi parity、ZIP 安全与 archive-hash 幂等、查词/阅读/Annotation 零副作用、unknown/clear、reader fixture 三方契约、BYOK-free 请求面及 11a 目标集/无全扫/`input_revision`/generation 结构证据均已通过。SRS、ReviewEvent、播放生产者、ReviewItem 与 KnownImportRun 仍未实现，不作为本包已交付能力。
Residual risks:
- 未测 10⁴–10⁶ 规模、p50/p95、并发/WAL/内存预算，仍属于 P5 实验 11b；真实 409 并发写、来源撤回 UI 与逐 token 像素 popover 锚定仍为后续风险。
