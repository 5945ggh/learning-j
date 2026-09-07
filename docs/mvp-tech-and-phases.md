# LearningJ MVP 第一阶段：技术选型与阶段划分

> 对应第一阶段链路：
> 纯文本/字幕导入 → Sentence + sidecar → 单句算法解析 → 单句 AI 解析文档 → 一次追问 → 用户反馈/可选 note_ops → 用户触发抽取 → Span 定位 + AnalysisSection → KnowledgePoint + Occurrence → triage → 一个 ReviewItem → 复习视图回看

---

## 一、技术选型

### 1.1 后端

| 层 | 选型 | 理由 |
|---|---|---|
| 语言/框架 | Python 3.11 + FastAPI | 本地后端路线已定；最终分发形态仍见 ADR-020 未决项。SudachiPy 生态在此，LLM 调用同侧使元数据只有一个记录点 |
| 包管理 | uv | 沿用 |
| 数据库 | SQLite（WAL 模式） | 单用户本地数据集（`data-model.md` §0）。KP 层 \(10^2\)–\(10^3\)、Lexeme 层 \(10^4\)–\(10^5\)，SQLite 绰绰有余；且与 ADR-020「本地后端」路线自洽 |
| ORM / 迁移 | SQLAlchemy 2.0 + Alembic | **Alembic 第一天就要在**。不可推迟项集中在数据层，没有迁移工具则每次补字段都是手工重建 |
| 契约建模 | Pydantic v2 | 抽取 schema、note_ops、section_ops 全部建成 Pydantic 模型，直接复用为 JSON Schema 校验器 |
| 分词 | SudachiPy + SudachiDict-core，**A mode** | ADR-018 已定 |
| 词典释义 | **Yomitan ZIP 第一等导入格式**；内部使用 canonical dictionary model + 本地检索索引 | 用户自行导入、多词典并存、富文本定义与版权边界都与 Yomitan 生态一致。MVP 不实现原始 JMdict XML parser；未来通过 `DictionaryImporter` adapter 增加 |
| Sidecar 序列化 | msgpack（`msgpack` 包） | plan §4 已定 |
| LLM 调用 | **自有薄 provider 层 + 官方 SDK adapters**；OpenAI-compatible 使用 `openai`，Anthropic / Google 为可选 adapter，特殊端点保留 `httpx` fallback | 业务层只依赖内部 `ChatResult` 契约，保留 `provider` / `model` / `prompt_version` / usage / raw / request_id 审计字段；不引入 LangChain / LlamaIndex，不把任一家 SDK 的 response 类型泄漏到业务层 |
| 结构化输出 | prompt 要求纯 JSON → `json-repair` 兜一层 → Pydantic 校验 → 失败按 §5.5 重跑（上限 2 次） | ADR-017 决策四：不依赖 tool calling / provider 的 structured output，弱模型也要能跑 |
| 模糊检索（top-k 候选） | `rapidfuzz` 内存匹配 anchor + alias 全表 | KP 规模 \(10^3\) 级，全表加载做模糊匹配是毫秒级。不需要向量库、不需要额外基础设施 |
| SRS 算法 | `py-fsrs`（FSRS-5） | 现成、优于 SM-2、`ReviewState` 字段可直接对齐 FSRS 的 Card 形状 |
| Provider 配置与密钥 | 普通配置按 provider profile 保存；密钥优先进入 `keyring`，降级到同一应用配置目录下独立的 0600 secrets 文件并明示 | `name` / `base_url` / `model_list` 可持久化、导出和同步；主配置只保存稳定 `provider_id` 与 `credential_ref`，不得保存明文 `api_key`。keyring 不可用时才启用 secrets 文件，且日志、Analysis、ExtractionRun、诊断导出均不得包含密钥 |
| 测试 | pytest + `hypothesis` | 不变量清单第 9 节要写成断言，property-based 测试是天然载体 |

**明确不引入**：LangChain、LlamaIndex、Celery（第一阶段无批量，`asyncio` + 一张 `jobs` 表足够）、Redis、Postgres、向量数据库、GiNZA（ADR-025 建议改暂缓）。官方 provider SDK 只作为隔离在 `llm/` 内的 adapter；不作为业务抽象。

### 1.2 前端

| 层 | 选型 | 理由 |
|---|---|---|
| 形态 | **纯 Web SPA，配裸 FastAPI** | ADR-020 分发方式未决，但 B 类可直接跑裸后端。Tauri 打包是独立发行工程，不阻塞第一阶段 |
| 构建 | Vite + React 18 + TypeScript（strict） | |
| 包管理 | pnpm | |
| 服务端状态 | TanStack Query | Analysis 有 `generating` / `ready` 双状态机 + 抽取异步，轮询与缓存失效交给它 |
| 本地 UI 状态 | Zustand（少量） | 不上 Redux |
| 路由 | React Router | 第一阶段只有两个 shell 入口，够用 |
| 样式 | Tailwind + shadcn/ui | 组件源码进仓库、可控、无重型运行时依赖，符合 ADR-023「组件独立实现」的要求 |
| Markdown 渲染 | react-markdown + remark-gfm | **后端已切分好 section，前端只渲染各 `body_md`**，不需要在前端解析 heading id |
| 类型同步 | `openapi-typescript` 从 FastAPI 的 OpenAPI 生成 TS 类型 | 契约单一来源在后端 Pydantic |

**前端的两条硬约束（写进 ESLint）**：

1. **组件不得 import shell**（ADR-023）。目录分为 `src/components/`（AnalysisDocView、TriagePanel、AggregateCard、ReviewCard、DictionaryPopover、DictionaryDrawer 等独立组件）与 `src/shells/`（reader、review）。用 `eslint-plugin-import` 的 `no-restricted-paths` 禁止 `components/**` 反向依赖 `shells/**`。这条规则本身就是 ADR-023 试金石的自动化形式。
2. **禁止裸 `String.prototype.slice` 用于句子文本**（审查 A5）。统一走 `sliceByCodePoint(text, start, end)`，内部 `Array.from`。

### 1.3 仓库结构建议

```
backend/
  src/learningj/
    domain/          # Pydantic 契约 + 纯函数（Span 定位、切分、对齐）
    db/              # SQLAlchemy models + Alembic
    ingest/          # 素材导入、分句、分词、sidecar
    analysis/        # 第一段生成、追问、section 切分
    extraction/      # 第二段抽取、Span 定位、KP/Occurrence 建立
    memory/          # KP 检索注入、两类笔记与槽位校验
    srs/             # ReviewItem、配额、FSRS
    llm/             # provider contract + SDK/httpx adapters
    dictionary/      # Yomitan importer + canonical dictionary model + lookup index
    api/             # FastAPI routers
  prompts/           # 版本化的 prompt 模板，文件名即 prompt_version
  tests/
    invariants/      # 不变量清单 §9 的九条 + 新增条目
frontend/
  src/components/    # 独立组件，不得依赖 shells
  src/shells/
  src/lib/
docs/                # 现有四份 spec，P0 打补丁
```

**`prompts/` 目录的一条纪律**：prompt 文本以文件形式版本化，文件名（如 `analysis_v1.md`、`extraction_v1.md`）即写入 `Analysis.prompt_version` / `ExtractionRun.prompt_version` 的值。改 prompt 必须新建文件、不得原地改写——这是「永不原地改写」在 prompt 侧的形式，也是将来批量重抽能对照的前提。

---

## 二、阶段划分

六个阶段，每个都以**可运行 + 可验收**为边界。P1–P5 各自对应你链路上的一段。

### P0　契约冻结与骨架（0.5–1 天）

**做什么**

1. 把审查文档 A1–A5 的补丁写回 `data-model.md` 与 `prompt-contracts.md`；
2. 决定并写下：SQLite、Span 独立表形状、code point 约定、BYOK 密钥存储、ExtractionRun 实体（B2）、词典来源模型与 `analyzer_dict_version` / `dictionary_source_version` 的命名空间；
3. 建后端骨架：uv 项目、FastAPI app、SQLAlchemy base、Alembic 初始 migration（**包含全部实体，即使 P1 只用到一部分**），包括 DictionarySource / DictionaryEntry / Definition / Asset / ImportRun；
4. 建前端骨架：Vite + React + TS + Tailwind + ESLint 两条硬规则；
5. `tests/invariants/` 建立，把不变量清单十六条写成空壳测试（`pytest.mark.xfail`），后续阶段逐条点亮。

**验收**：

1. `alembic upgrade head` 建出全部表；
2. 不变量测试全部以 xfail 状态存在；
3. 前端 `pnpm dev` 起得来且 ESLint 规则能拦住一次故意的反向 import；
4. Occurrence 的 `occurrence_spans` 关联表支持有序数组：写入一条带两个 Span 的测试 Occurrence（`ordinal` 分别为 0 和 1），能正确读回且顺序保持；
5. 不变量测试骨架包含 §9 全部 16 条（含修订后的 12-16），全部标记为 `pytest.mark.xfail`；
6. KnowledgePoint 表包含 `anchor_shape` / `anchor_payload` / `pattern_grammar_version` / `opaque_reason` / `zero_slot_lexeme_check` 字段；
7. ExtractionRun 表包含 `invalid_patterns` / `unresolved_patterns` / `opaque_count` 字段。

**为什么迁移一次建全表**：不可推迟项的定义就是「后补代价是全量数据迁移」。第一天把字段全建出来（哪怕暂时不写入）比分五次加字段便宜得多。

---

### P1　素材导入 → Sentence + Sidecar

**链路对应**：纯文本/字幕导入 → Sentence + sidecar

**做什么**

- 导入 `.txt` 与 `.srt`/`.vtt`，产出 Material（含 `title`、`content_hash`、`locator`、`kind`、`copy_stored`）；EPUB 仍属 MVP 范围，但其导入与 locator 适配需在 P1 的独立验收项中明确，不得默认为纯文本导入已经覆盖；
- 分句：字幕按 cue 边界（一条 cue 一个 Sentence，`anchor_type = subtitle`）；纯文本按句末标点 + 引号/括号配对（`anchor_type = plain_text`）；
- SudachiPy A mode 分词 → Sidecar（msgpack，带三个版本戳）；
- Lexeme 表写入：`lexeme_id` 由三元组确定性派生，`first_seen_analyzer_dict_version` 必填；释义来源版本独立记录在 DictionarySource / lookup 结果中。

**验收**

1. 不变量 5 点亮（任何带三元组的记录必有非空 `analyzer_dict_version`）；
2. **素材类型无关性测试**（plan §3 明确要求写成测试）：同一段文本分别以 `.txt` 与构造的 `.srt` 导入，除 `time_start/time_end` 与 `anchor_*` 外，下游可见的 Sentence 序列完全一致；
3. `lexeme_id` 的确定性：同一句导入两次产生同一组 `lexeme_id`；
4. 含 BMP 外字符（`𠮟られた`）的文本导入后，偏移与切片正确。

---

### P2　单句算法解析 + 阅读器最小壳

**链路对应**：单句算法解析

**做什么**

- 后端接口：`GET /sentences/{id}/analysis/algorithmic` → 分词序列、注音（读み）、每个 token 的词典候选释义（带 source/version provenance）；
- Yomitan ZIP 导入脚本 + canonical dictionary model + 精确查找与 FTS5 索引；定义同时保留纯文本投影与 structured content；
- 前端阅读器 shell 最小形态：左半屏句子列表、点击句子展开算法解析、右半屏解析视图（此阶段为空壳）；
- **UI 区分来源**（ADR-009）：算法结果与将来的模型结果必须有视觉区分，此阶段先把「算法区」的样式语言定下来。

**验收**：无 BYOK 配置时本阶段全部功能可用（未决 10 的降级路径）；注音与分词结果与 SudachiPy 直接输出逐 token 一致；未导入词典时仍能浏览和查看形态结果，导入词典后定义显示来源与版本。

**Yomitan 导入安全边界**：ZIP 路径不得穿越目标目录；限制压缩包与解压后大小、文件数量；未知 schema、重复文件和损坏资源必须给出可定位错误或警告；同一 archive hash 重复导入必须幂等；版权词典只允许用户自行导入，程序不随包分发具体词典内容。

---

### P3　单句 AI 解析文档 + 一次追问 + note_ops

**链路对应**：单句 AI 解析文档 → 一次追问 → 用户反馈/可选 note_ops

**做什么**

- LLM provider 层 + 密钥管理；
- `prompts/analysis_v1.md`：按 `prompt-contracts.md` §2.1 组装输入（含 `output_language`、九个模块开关、`style_free_text`、前后文、译文标注为参考、`user_question`）；
- 记忆注入（§4.1/§4.2）：当前句 lexeme 序列 → 匹配已有 KP 的 `lexical_anchors` → 注入 anchor + `Occurrence.brief` + SRS 状态。**不按 `retention` 过滤**；两类笔记全量注入；
- 后端 section 切分（§3.5 三级降级）→ AnalysisSection（`kind` 此时为 null，`heading_path` 与 `split_strategy` 写入）；
- 追问一轮：`section_ops` 只实现 `add`（`revise` / `merge` 排除，schema 保留）；`note_ops` 由后端按槽位上限校验后落库；
- 前端 AnalysisDocView 组件：小节化渲染 + 一次追问输入框 + note 写回的可见反馈。

**验收**

1. `turn_count` 默认为 1；追问后为 2；
2. 槽位写满后 `add` 被后端拒绝，模型必须改用 `replace`/`merge`——**写一条测试把槽位填满再触发写回**（不变量 7 点亮，且必须由写入路径保证，不由清理任务）；
3. 切分失败时降级为单一小节（`split_strategy = fallback_single`）是**通过**而非失败；
4. 未配置 BYOK 时本阶段入口置灰，P1/P2 功能不受影响。

**风险点**：section 切分是这一阶段唯一有不确定性的部分。建议先用三五个真实模型输出（`references/` 里的实录）离线跑切分器，把三级降级的触发率记下来，再接前端。

---

### P4　用户触发抽取 → Span 定位 → KP + Occurrence → triage

**链路对应**：用户触发抽取 → Span 定位 + AnalysisSection → KnowledgePoint + Occurrence → triage

**做什么**

- `prompts/extraction_v1.md`：**必须自足**（ADR-017 决策六），续轮只是快路径。输入含解析全文 + 形态规范 §7.1 + top-k 候选（k=10）；
- 抽取执行两条路径都实现：续轮与独立调用，用同一个 prompt 文件；
- `section_hint` → `heading_path` 匹配，回填 AnalysisSection 的 `kind` 与 `spans`；
- Span 定位：`find_all` → 0/1/>1 三分支（A2 修订后的语义）；
- KP upsert：`anchor` 唯一约束 + 冲突重试收敛（不变量 11）；Occurrence 无条件写入、永不去重；
- 失败检测 §5.5 三条硬条件 → 自动重跑抽取（不重新生成解析），上限 2 次；三条弱信号 → 记入 ExtractionRun，UI 提示；
- triage 页：逐条决定 `srs` / `reference`，**提交时一律写 `retention_set_by = user`**（审查 A4）。

**验收**

1. 不变量 1、2、6、8、9、10、11 点亮；
2. **Analysis 与 Occurrence 分离验收**：删掉全部 Occurrence 后重跑抽取，能重建且不触碰 Analysis 正文；
3. **独立调用路径验收**：清空会话历史、只喂「解析全文 + 规范 + 候选 KP」，抽取结果与续轮路径在 anchor 层面可比（这条是批量重抽的免费路径，必须现在就验）；
4. 构造一个 surface 在句中出现两次的用例，确认产生两个 `ambiguous` Span 且不变量 6 仍成立；
5. 构造一个 surface 找不到的用例，确认**不产生 Span**、进 `unresolved_surfaces`、且不触发全量重跑（因为不是「全部」找不到）。

**这一阶段是整个 MVP 风险最集中的地方**——ADR-017 代价 1 明写「抽取成为解析到知识点的唯一通道，规范层的质量直接决定沉淀质量」。建议在此之前完成实验 2（审查 B6）。

---

### P5　ReviewItem + 复习视图 + 聚合视图浮层

**链路对应**：一个 ReviewItem → 复习视图回看

**做什么**

- ReviewItem 创建：triage 提交后按 `retention = srs` 建立，每 KP 一条，受每日配额控制，待建队列按 `salience` 优先 + 同级 FIFO；
- FSRS 接入 ReviewState；
- ReviewCard 组件：正面 = anchor + 例句（Span 高亮）+ 音频（第一阶段纯文本/字幕，音频缺失是常态，**必须能处理缺失**，ADR-016）；背面 = 该 Occurrence 引用的 AnalysisSection（按 `section_id + section_revision` 取）；
- 复习视图 shell：队列 + ReviewCard；
- AggregateCard 组件：历次 Occurrence 并置，同时显示两个计数并**分别标注来源**（红线 §10）。

**验收（这是 ADR-023 的试金石，必须当作正式验收项）**

1. **复习视图 shell 在不修改任何 `components/**` 文件的前提下装配出来**。用 git diff 验证：P5 中 `src/components/` 下的改动应当只有新增 ReviewCard 与 AggregateCard 本身，不含对 AnalysisDocView / TriagePanel 的修改；
2. ESLint 的反向依赖规则全程未被 disable；
3. 聚合视图中「被讲解过 n 次」与「在材料中出现过 m 次」两个数分开显示、各带来源标签、UI 上不存在任何把二者相加或校验的路径；
4. 不变量 3、4 点亮（含 `retired_at` 修订后的形式）。

---

## 三、阶段间的三条贯穿纪律

**其一，不变量测试逐阶段点亮，不允许跳过。** `tests/invariants/` 里的 xfail 转 pass 是每个阶段的硬性交付物之一。文档 §9 已经说了「应写成断言或测试，而非依靠自觉」——把它做成 CI 门禁，而不是一份读过就忘的清单。

**其二，任何阶段发现 spec 与实现冲突，一律上报、不自行决定。** `data-model.md` 卷首明写「二者冲突时及时报告」，plan 卷首明写「本文与 spec 冲突时以 spec 为准，并回写本文」。这条要写进每个 subagent 的提示词。

**其三，`prompts/` 与 `docs/` 的改动不进 subagent 的可写范围。** subagent 可以读、可以提出补丁建议，但 spec 的修改由你本人执行。理由很直接：spec 是这个项目当前最有价值的资产，而 subagent 在实现受阻时最省力的路径永远是改契约。
