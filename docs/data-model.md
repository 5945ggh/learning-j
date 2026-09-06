# LearningJ 数据模型契约

> 面向实现（含委托给 coding agent 的场景）。本文规定**是什么**；**为什么**在 `adr.md`。二者冲突时及时报告。
> 标注 **[不可推迟]** 的字段与约束，若在第一版遗漏，后补的代价是全量数据迁移或历史数据重算。
> 本文不含未决项。凡本次不实现的内容均已明确标注。

---

## 0. 全局约定

- 所有实体带 `id`（UUIDv7 或等价的单调递增 ID）、`created_at`、`updated_at`。下文不再重复列出。
- 所有时间为 UTC 时间戳。
- **文本规范化**：进入 `Material` / `Sentence` 的文本统一采用 Unicode NFC；换行统一为 LF；不做全角／半角折叠、不删除原文空白。`Sentence.text` 是模型输入、`surface` 定位和前端展示共用的规范文本。`content_hash` 对规范化后的素材文本计算。
- **字符偏移**：所有持久化 `char_start` / `char_end` 均以 Unicode code point 计，使用半开区间 `[start, end)`。浏览器 DOM 的 UTF-16 偏移只能在渲染适配层转换，业务代码不得直接把持久化偏移交给 `String.slice` 或 `Range`。
- **永不原地改写**：合并、修订、状态变化一律以新记录或新版本表达，不覆盖旧值。MVP 唯一例外是 `ReviewItem.retired_at`：它只能从空值单向写入时间戳，用于退役标记，不得修改或清除。
- 版本戳（形态分析器版本、分析器词典版本、释义词典来源版本、prompt 版本、模型标识）在任何涉及外部资源的记录上都是必填项，不允许留空或用默认值。`analyzer_dict_version`（SudachiDict）与 `dictionary_source_version`（Yomitan 包等）属于不同命名空间，不得复用同一个 `dict_version` 含义。
- **MVP 作用域是单用户、本地数据集**：当前实体不要求 `user_id`；未来若支持本地多用户或托管后端，必须在作用域迁移设计中为用户学习意愿、KnownEvidence、ReviewItem、ReviewState 与笔记补充用户边界。

---

## 1. Span（值对象）

**[不可推迟]** Span 被四方共用：`Occurrence`、`Annotation`、`AnalysisSection`，以及将来的可疑句高亮（ADR-014）。它必须在第一天就定成一个独立、稳定的形状。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sentence_id` | FK | 所属句子 |
| `surface` | string | **定位输入**。原文子串，由模型给出（ADR-009） |
| `char_start` | int | 句内字符起始偏移，闭区间左端。**由后端定位得出** |
| `char_end` | int | 句内字符结束偏移，开区间右端。**由后端定位得出** |
| `token_start` | int? | sidecar 分词序列内的 token 索引，闭区间左端 |
| `token_end` | int? | 同上，开区间右端 |
| `alignment_status` | enum | `aligned` / `partial` / `ambiguous` / `unaligned` |

### 物理存储

Span 在逻辑上是值对象，在物理上使用独立的不可变 `spans` 表；每个 Span 有自己的 `span_id`。实体之间不使用多态 `owner_type / owner_id` 外键，而使用带真实外键的关联表：

- `occurrence_spans(occurrence_id, span_id)`：MVP 中每条 Occurrence 恰好一条；
- `analysis_section_spans(section_version_id, span_id, ordinal)`；
- `annotation_spans(annotation_id, span_id, ordinal)`。

关联表上的 `ordinal` 保证数组顺序，`span_id` 只能指向一个 `sentence_id`。这样既能复用同一套 Span 约束，也不会牺牲数据库的引用完整性。文档中的 `Occurrence.span`、`AnalysisSection.spans` 和 `Annotation.spans` 是上述物理关系的逻辑写法。

### 定位规则

模型**只给 `surface`，不给偏移**。后端在句子文本中执行 `find_all`：

| 命中数 | 处理 |
|---|---|
| 0 | 不产生 Span；将该 surface 记录到本次 `ExtractionRun.unresolved_surfaces`，供失败检测与重跑使用 |
| 1 | 产生一个 Span，按 token 边界对齐结果取 `aligned` 或 `partial` |
| >1 | 为**每一处命中各产生一个 Span**，全部标 `ambiguous` |

歧义不需要额外的消歧字段。理由：Span 的三个下游（复习卡例句高亮、回看视图下划线、`lexical_anchors` 推导）的歧义代价都是视觉性的，不污染身份、不污染别名表、不产生不可逆数据；而按形态规范，会当 anchor 的串在单句内重复出现的概率很低（重复的主要是助词类，而助词现象本就不该成为 KP）。

`ambiguous` 与 `partial` 是两回事：前者是「不知道指哪一处」，后者是「知道指哪里但边界不落在 token 上」。不得混用，否则统计读不出东西。

### 约束

1. 存储后，**字符区间是权威值**，下游一律使用它；token 区间是由 sidecar 对齐推导出的派生值。surface 已命中但 token 侧无法对齐时，保留字符区间，`alignment_status = unaligned`，**不得因 token 对齐失败而丢弃该 Span**。
2. **跨句 Span 不支持。**需要跨句时用有序的 Span 数组表达。
3. 对齐使用的 sidecar 必须与产生该 Span 时的 sidecar 是同一版本；重新分词后，token 区间需重算，字符区间不变。

---

## 2. Dictionary 与 Lexeme 层

### 2.0 Dictionary source and entries

词典释义与 Sudachi 形态身份分离。MVP 的用户导入格式是 Yomitan ZIP；Yomitan 只是交换格式，业务层使用下列 canonical 概念。未来的 JMdict XML、EPWING 或其他格式通过同一个 `DictionaryImporter` 适配器接入。

| 实体 | 最小职责 |
|---|---|
| `DictionarySource` | `source_id`、`format`、显示名、`source_version`、`schema_version`、archive hash、导入时间、许可元数据 |
| `DictionaryEntry` | source 外键、expression、reading、tags、score、sequence、definitions、source-local id |
| `DictionaryDefinition` | 纯文本投影 + 可选 structured content；保留原始 payload，不在导入时抹平富文本 |
| `DictionaryAsset` | source 外键、相对路径、mime、content hash、存储位置；资源缺失时定义仍可降级显示 |
| `DictionaryImportRun` | archive hash、开始/结束时间、状态、错误摘要、导入统计；重复导入同一 hash 必须幂等 |

一个 `Lexeme` 可命中多个 `DictionarySource`，查询结果必须带 source/version provenance。词典条目、词典义项、词频 metadata 与导入词表均不得自动创建 `KnowledgePoint`。

### 2.1 Lexeme

算法构成，全自动生成，数量级 \(10^4\)（单部作品）到 \(10^5\)（全库）。**它不是知识点。**

| 字段 | 类型 | 说明 |
|---|---|---|
| `lexeme_id` | string | **确定性派生**，非自签发。由 `normalized_form + pos + reading_form` 的规范化拼接或其哈希得到 |
| `normalized_form` | string | Sudachi 正規化形 |
| `pos` | string | 品詞（Sudachi POS tuple 的规范化串） |
| `reading_form` | string | 読み |
| `first_seen_analyzer_dict_version` | string | **[不可推迟]** 首次产生该记录时的 SudachiDict 版本 |

**约束**

1. **`analyzer_dict_version` 不参与 `lexeme_id` 的派生。**分析器词典版本记在 sidecar 与 KnownEvidence 上，而不是编进 id。理由：若编进 id，则每次 SudachiDict 升级会使全库 `lexeme_id` 变更，所有历史证据指向旧 id，词频与覆盖率查询从此永远要过映射层；而那张映射表实际只能靠「三元组相同即同一词」重建，等于自己造一道必须再拆掉的墙。三元组不变时 id 天然稳定，只有 `normalized_form` 真的漂移时才需要映射，映射表规模从全库降到实际漂移的那几百条。
2. **Lexeme 不参与 KnowledgePoint 的 ID 空间。**没有自签发主键，没有 `canonical_id`，不进别名表，不需要合并机制（ADR-005）。
3. 词典升级不是「合并」，而是**版本迁移映射**：仅对 `normalized_form` 发生漂移的条目维护新旧映射，查询时经映射层归并。
4. **[不可推迟]** 所有 Lexeme 相关记录与 sidecar 必须携带 `analyzer_dict_version`。`normalized_form` 会随 SudachiDict 更新漂移，不记版本则第一次升级词典就是全量脏数据。释义查询另外记录 `dictionary_source_id` 与 `dictionary_source_version`，二者不得混用。
5. **不得使用 Sudachi 内部 word id 作持久锚点**——它随词典构建变动。
6. 同形同音同词性的异义词无法由自然键区分。该碰撞只影响 Lexeme 层的统计口径，不影响 KnowledgePoint 的身份。

### 2.2 KnownEvidence

**[不可推迟]** 已知状态存为证据记录，不存可变字段（ADR-006）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `lexeme_id` | FK | **[不可推迟]** 证据目标是 Lexeme，不是 KnowledgePoint |
| `conjugated_form` | string? | **[不可推迟]** 本次遇到的活用形表层。空值表示证据不针对具体词形 |
| `source` | enum | `reading_inferred` / `analysis_marked` / `import_anki` / `import_jpdb` / `srs_matured` / `listening_native` / `listening_tts` |
| `confidence` | float | 0–1 |
| `observed_at` | timestamp | |
| `analyzer_dict_version` | string | **[不可推迟]** 产生该证据时的 SudachiDict 版本 |
| `material_id` | FK? | 证据产生的材料，可空 |

**约束**

1. 已知状态是证据之上的**派生视图**，合成规则可配置，不落库为字段。
2. `listening_native` 与 `listening_tts` 必须是不同的 source 值（ADR-016）。
3. 导出到 Anki 时默认只发站内产生的记录，或至少按来源可筛选。

---

## 3. KnowledgePoint 层

### 3.1 KnowledgePoint

**由一次显式指认构成**（ADR-005）。数量级 \(10^2\)–\(10^3\)。

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | uuid | **自签发** |
| `anchor` | string | 自然键。符合形态规范的锚点串。词汇类与语法类一视同仁 |
| `display_form` | string | 展示用形式，可与 anchor 不同 |
| `tags` | string[] | **多值标签**，可为空、可重叠、可后加（ADR-021）。MVP 只保证 `grammar` 可靠打上 |
| `retention` | enum | **[不可推迟]** `srs` / `reference`。**用户的决定**，见下 |
| `retention_set_by` | enum | **[不可推迟]** `default` / `user`。为 `user` 时，重跑抽取与批量重抽**不得覆盖** |
| `canonical_id` | uuid? | **[不可推迟]** 合并指向。空值表示自身即 canonical |
| `lexical_anchors` | lexeme_id[] | **可空、可多。仅作索引，不参与身份判定** |
| `origin` | enum | `extraction`（MVP 内唯一取值）/ 预留 `manual` |

#### retention 的语义

`retention` 是**唯一的学习意愿字段**，不再另设 `study_status` 之类。理由：Occurrence 无条件记录、KP 层无条件建立（ADR-019 前两层放行），因此 **KP 的存在从来就不是一个可选项**，用户唯一真正的决策就是「排不排程复习」。

| | 生成 ReviewItem | KP 存在 | 进聚合与检索 | 进记忆注入 |
|---|---|---|---|---|
| `srs` | 是 | 是 | 是 | 是 |
| `reference` | 无有效项 | 是 | 是 | 是 |

用户在 triage 页选择「不学」，即写入 `reference`。

**写入规则**：

1. 抽取段不判断候选是否「值得复习」：凡进入 `candidates` 的条目都已被判定为可形成 KnowledgePoint。未进入候选、仅停留在 Analysis 中的内容，不产生 KP。未经用户决定的路径统一以 `retention = srs`、`retention_set_by = default` 创建；`user` 路径在 triage 提交后才按用户决定创建 ReviewItem，`batch` / `background` 路径才由 `salience` 与每日配额控制自动创建。
2. 用户在 triage 页或收件箱中对候选作出决定时，无论选择维持 `srs` 还是改为 `reference`，均写 `retention_set_by = user`。此后重跑抽取与批量重抽一律不得覆盖——这是「永不原地改写」在本字段上的具体形式。
3. KP 首次创建时若未经用户 triage（批量路径、关窗后台补跑），默认取 `retention = srs`，`retention_set_by = default`。
4. 待确认收件箱的默认查询条件是 `retention_set_by = default`；用户作出任一排程决定后写为 `user`，该候选从默认收件箱消失。历史产物不依赖该查询，可从 `ExtractionRun`、`Analysis` 与 KP 聚合视图访问。
5. `retention` 之外，`display_form` 同规则；**`tags` 例外**——它是多值且 ADR-021 明写可后加，后续抽取给出的标签直接**并集累加**。

**约束**

1. `anchor` 是自然键，`kp_id` 是主键。同一 `anchor` 不重复建 KP。
2. **主键是形式级，不是义项级。**同一形式的不同含义共享同一 `kp_id`，义项差异保留在各条 Occurrence 里。
3. `reference` 只表达**用户不希望将该 KP 排程进复习**，不再承担「一次性文化梗、互文典故、元技能」等内容分类。若某内容不适合形成可复习的知识点，应留在 Analysis 中而不进入 `candidates`。
4. **合并永不原地改写**：合并即写入 `canonical_id`，Occurrence 保持指向它当初指向的 `kp_id`，查询时经 canonical 视图归并。合并可撤销。
5. **MVP 不做写入时的 alias 查重。**模型给出的新 anchor 恰好是某个已有 KP 别名的情况，交由 `prompt-contracts.md` §5.3 的 top-k 候选检索在抽取前解决。
6. `anchor` 必须有数据库唯一约束；并发抽取或重试通过幂等 upsert / 冲突重试收敛到同一 KP。该约束是并发安全与批量重跑的最低成本保障，不要求在写入时再做一套全量模糊查重。

### 3.2 Alias

| 字段 | 类型 | 说明 |
|---|---|---|
| `alias_string` | string | 变体写法 |
| `kp_id` | FK | 收敛到的 KP |
| `source` | enum | `seed`（JLPT 语法表种子）/ `extraction` / `merge` / `manual` |

**约束**：别名表只服务 KP 层，Lexeme 不进此表。

### 3.3 Occurrence

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | FK | |
| `sentence_id` | FK | |
| `material_id` | FK | |
| `span` | Span | **[不可推迟]** 该知识点在原句中的位置；物理上通过 `occurrence_spans` 关联 |
| `salience` | enum | **[不可推迟]** `primary` / `secondary`。批量与兜底路径下决定 ReviewItem 的创建优先级；不决定候选是否构成 KP（ADR-019） |
| `brief` | string | 该次讲解的要点摘要，由抽取段给出。MVP 的 `content_source = analysis_section` 时必填；未来 `user_gloss` 来源可按其契约为空 |
| `content_source` | enum | **[不可推迟]** `analysis_section`（MVP 内唯一取值）/ 预留 `user_gloss` |
| `section_id` | FK | **[不可推迟]** 指向 AnalysisSection 的逻辑小节，而非字符区间；MVP 必填 |
| `section_revision` | int | **[不可推迟]** 引用时的小节版本，配合上一字段；MVP 必填 |
| `source_analysis_id` | FK | |
| `extraction_run_id` | FK | 产生该 Occurrence 的具体 ExtractionRun |
| `extractor_model` | string | 模型标识 |
| `extractor_prompt_version` | string | |
| `user_marked_useful` | bool? | 三态：未评价 / 有用 / 无用 |

**约束**

1. **Occurrence 无条件记录、永不去重**（ADR-019 第一层闸门）。
2. 内容引用必须是 `section_id + section_revision`，**不得用字符区间指向解析原文**——解析文档可变，字符区间会碎。`content_source = analysis_section` 时二者均非空；未来其他来源必须另行定义引用约束。
3. 抽取段输出的是原文子串，**字符区间、token 区间、三元组与 `lexical_anchors` 全部由后端推导，不由模型给出**（ADR-009）。

---

## 4. 解析文档

### 4.1 Analysis

| 字段 | 类型 | 说明 |
|---|---|---|
| `sentence_id` | FK | |
| `material_id` | FK | |
| `model` | string | 生成模型标识 |
| `prompt_version` | string | |
| `style_modules` | string[] | 本次勾选的解析模块（见 `prompt-contracts.md` §1） |
| `style_free_text` | string? | 用户追加的自由要求 |
| `user_question` | string? | 请求解析时用户填写的困惑（如「我听成了よ」） |
| `context_kp_ids` | uuid[] | 本次注入了哪些已有 KP，用于复现与对照实验 |
| `context_note_ids` | uuid[] | 本次注入了哪些记忆条目 |
| `retrieval_enabled` | bool | 本次是否启用了联网检索。**MVP 内恒为 false**，字段留位以保证将来对照实验的历史数据可比 |
| `turn_count` | int | 会话轮数，绝大多数为 1 |
| `session_closed` | bool | 是否已触发抽取。**为 true 后不再接受追问**（ADR-017 决策五） |
| `status` | enum | `generating` / `ready` / `failed` |
| `extraction_status` | enum | `pending` / `running` / `done` / `failed` |
| `extraction_trigger` | enum | `user` / `batch` / `background`。三种触发路径，决定 triage 走向 |

**约束**

1. **[不可推迟]** Analysis 与 Occurrence 分开持久化。抽取失败只重跑抽取，不重新生成解析；抽取规范升级后可批量重抽历史解析。
2. 正文不存 markdown 原文字段，由 AnalysisSection 承载。
3. `extraction_trigger = user` 时，抽取产物进入 triage 页，由用户决定是否排程复习；`batch` 与 `background` 时直接进入待确认收件箱，所有候选默认 `retention = srs`，并由 `salience` 决定 ReviewItem 的创建优先级。

#### 状态转换

| 状态 | 合法转换 | 约束 |
|---|---|---|
| `status = generating` | `ready` / `failed` | 生成成功后才可进入 `ready`；失败保留失败记录 |
| `extraction_status = pending` | `running` | 解析生成完成、或 batch/background 任务排队后进入运行 |
| `extraction_status = running` | `done` / `failed` | 每次运行由 `ExtractionRun` 记录；失败可发起新的 run，不覆盖旧 run |
| `extraction_status = failed` | `running` | 仅抽取重跑允许回到 `running`，不得重新生成 Analysis |
| `session_closed = false` | `true` | 用户触发抽取后单向关闭；关闭后不得新增 AnalysisMessage |

`status = generating` 时 `extraction_status` 必须为 `pending`；`session_closed = true` 时不得再新增追问。抽取运行状态与产生 KP / Occurrence 的写入在同一提交边界内完成；失败运行不产生部分可见的 Occurrence。

### 4.2 ExtractionRun

每次抽取尝试都保留一条运行记录，包括没有产生任何候选的情况。

| 字段 | 类型 | 说明 |
|---|---|---|
| `analysis_id` | FK | |
| `execution_path` | enum | `continued_turn` / `standalone` |
| `model` | string | 抽取模型标识 |
| `prompt_version` | string | |
| `status` | enum | `running` / `done` / `failed` |
| `retry_of` | FK? | 指向被重跑的上一次 ExtractionRun |
| `failure_reason` | enum? | `invalid_json` / `empty_candidates` / `all_unresolved` / `provider_error` |
| `unresolved_surfaces` | string[] | 原句中找不到的 surface；可为空 |
| `candidate_count` | int | 运行产出的候选数量 |
| `started_at` / `finished_at` | timestamp | |

**约束**：Occurrence 必须关联产生它的 `extraction_run_id`；重跑保留旧 run、旧 Occurrence 和旧用户决定。重跑对 KP 使用幂等 upsert，对 Occurrence 继续追加记录、不得去重或覆盖；查询时再经 canonical 视图归并。

### 4.3 AnalysisSection

**[不可推迟]** 解析正文的可寻址单元。

| 字段 | 类型 | 说明 |
|---|---|---|
| `section_version_id` | uuid | 具体版本行的实体 id |
| `section_id` | uuid | 逻辑小节身份；同一逻辑小节的所有版本相同 |
| `analysis_id` | FK | |
| `heading_path` | string[] | 从根到叶的 heading id 路径；降级切分时为空数组 |
| `split_strategy` | enum | `heading` / `paragraph` / `fallback_single` |
| `kind` | enum? | 抽取完成前为空；完成后见下 |
| `spans` | Span[] | 覆盖原句中的哪些位置；物理上通过 `analysis_section_spans` 关联 |
| `body_md` | text | 正文 markdown，模型自由撰写 |
| `revision` | int | 从 1 起，每次被改写递增 |
| `origin_turn` | int | 由第几轮产生 |
| `superseded_by` | uuid? | 指向新的 `section_version_id`；旧版本不删除 |

**版本约束**：每个 revision 是一条独立、不可变的物理行；`(section_id, revision)` 唯一。`Occurrence.section_id + section_revision` 通过该唯一键形成可验证引用。改写产生同一 `section_id` 的新 revision；合并产生新逻辑小节或新 revision，并通过 `superseded_by` 保留历史。

#### kind 枚举

> **kind 集合 = 解析模块集合 + `takeaway` + `qa`。**这个包含关系必须成立，否则 `spike-checklist.md` 实验 5（关掉某模块时模型是真的不讲，还是塞进别的小节）就没有可测量的量。

用户可勾选的九项（与 `prompt-contracts.md` §1 严格一致）：

`overview` / `lexical` / `conjugation` / `grammar` / `particle` / `colloquial` / `register` / `culture` / `translation_note`

系统产生的两项，不进勾选列表：

- `takeaway`：强制的收尾小节（「本句最值得带走的东西」）；
- `qa`：由追问产生。

**约束**

1. 小节的 `body_md` **不受任何结构契约约束**——不要求标题层级，不要求固定顺序（ADR-017）。
2. 改写走新 `revision`，合并走 `superseded_by`，**旧内容永不删除**，否则已有 Occurrence 的引用会悬空。
3. `spans` 为空是合法且常见的。
4. KP 上的 `tags` 里也有 `grammar`，那是知识点标签，与 section kind 是两套东西。同名不冲突，但**不得复用同一个枚举定义**。

### 4.4 AnalysisMessage

| 字段 | 类型 | 说明 |
|---|---|---|
| `analysis_id` | FK | |
| `turn_index` | int | |
| `role` | enum | `user` / `assistant` |
| `content` | text | |

**约束**

1. 只持久化**用户可见的往返**。agent 内部轨迹（工具调用、重试、中间态）不持久化，debug 开关除外。
2. 重放会话所需的完整状态 = 当前小节集合 + 最近 N 轮消息。中间轮次可安全丢弃，因为其产出已沉淀进小节。

---

## 5. Annotation

**叶子实体。与 KnowledgePoint 之间没有边**（ADR-030）。它是阅读器的基础功能，不为解析链路让步。

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | |
| `spans` | Span[] | **有序数组**。单句划线为长度 1，跨句划线为长度 n |
| `note` | text? | 自由文本，无格式要求 |
| `color` | string? | |

**约束**

1. 不进 SRS、不进别名表、不需要合并、不需要锚点规范。
2. 能力边界：列表检索、按材料／时间／文本筛选、跳回原文。仅此。
3. 「划线到一个词」即为词汇标记，不需要专门设计。
4. **不提供从 Annotation 自动提升为 KP 或自动发起解析的入口。**用户想学它时，正确动作是跳回原文位置、在阅读器中手动触发一次解析。

---

## 6. 记忆

### 6.1 MaterialNote（作品笔记）

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | 作用域为单部作品 |
| `content` | text | 上限 `M` 字 |
| `source_sentence_id` | FK? | 产生该条笔记的句子 |
| `last_hit_at` | timestamp? | 最近一次被注入上下文的时间 |
| `updated_by` | enum | `agent` / `user` |

### 6.2 LearnerProfileNote（学情画像）

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | text | 上限 `M` 字 |
| `last_hit_at` | timestamp? | |
| `updated_by` | enum | `agent` / `user` |

**两者共同约束**

1. **条数上限 `N` 与单条字数上限 `M` 由后端强制**，不由 prompt 约束。写满后新增必须以「替换某条」或「合并某两条」提交，后端校验后拒绝越界写入（ADR-029）。
2. 长期未被命中的条目走 LRU 淘汰。
3. 对用户可见、可编辑、可删除。
4. **「某语法点是否已讲过」不由记忆承担**，它来自 KP 库检索这一确定性事实。记忆只承载风格与画像。

---

## 7. SRS

### 7.1 ReviewItem

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | FK | |
| `occurrence_id` | FK | 作为例句的那条 Occurrence，用户可更换 |
| `retired_at` | timestamp? | 用户将 KP 改为 `reference` 后写入；MVP 中唯一允许的单向状态标记 |
| `created_at` | timestamp | |

**约束**

1. **默认一个 KP 只有一条 ReviewItem**（ADR-019）。同一 KP 的后续 Occurrence 默认不生成新复习项，而是作为「再遇」进入聚合视图，并可选择性更新例句。
2. 用户可显式为某条 Occurrence 单独开卡。
3. `retention = reference` 的 KP 不存在 `retired_at IS NULL` 的有效 ReviewItem；已有 ReviewItem 只写入 `retired_at`，不删除、不清除 ReviewState。
4. ReviewItem 的创建受**每日配额**控制（ADR-019 第三层闸门）。`retention = srs` ≠ 立刻进入复习队列。
5. 配额排空后的待建队列按 `salience` 优先、同级按创建时间 FIFO。
6. `extraction_trigger = user` 时，ReviewItem 的创建推迟到 triage 提交之后；`batch` / `background` 才允许在抽取完成时按 `salience` 和配额创建。

### 7.2 ReviewState

标准 SRS 状态字段（间隔、易度、到期时间、复习历史）。选定算法后补。

---

## 8. 素材与句子

### 8.1 Material

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 导入时从文件名或 EPUB metadata 推导，用户可修改 |
| `content_hash` | string | **[不可推迟]** |
| `locator` | string | 文件句柄或路径，**不存媒体副本**（ADR-010） |
| `kind` | enum | `subtitle_video` / `subtitle_audio` / `text` / `epub` |
| `copy_stored` | bool | 是否复制了一份素材本体 |

### 8.2 Sentence

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | |
| `index` | int | 材料内序号 |
| `text` | string | |
| `time_start` | ms? | |
| `time_end` | ms? | |
| `translation` | string? | 随素材附带的译文。**作为参考而非标准**传入解析 |
| `anchor_type` | enum | **[不可推迟]** 位置锚点类型 |
| `anchor_payload` | json | **[不可推迟]** 类型特定的位置数据 |

#### 锚点取值（MVP 三种）

| `anchor_type` | `anchor_payload` |
|---|---|
| `subtitle` | `{cue_index: int}` |
| `plain_text` | `{char_start: int, char_end: int}`，偏移相对规范化后的整份文本 |
| `epub` | `{spine_index: int, char_start: int, char_end: int}`，偏移相对该 spine item 抽出的规范化纯文本 |

EPUB 不使用 CFI。理由：CFI 绑定 DOM 结构，而本产品对 EPUB 的处理本就是「抽成纯文本再分句」，spine index + 纯文本偏移与这条处理链路一致，且重新解析同一文件时可复现。代价是重排版后偏移失效，但 `content_hash` 已能检出这种情况。

PDF **不在 MVP 内**，走「转纯文本」降级，落 `plain_text`。

**约束**

统一抽象：**素材 = 有序 Sentence 序列 + 可选时间戳 + 可选 locator。**视频、音频、文本的差异全部落在「时间戳有没有」与「locator 指向什么」上。上层的解析、抽取、复习、聚合**不得感知素材类型**。这是「音视频为一等公民」的可验证形式，应写成测试。

### 8.3 Sidecar

| 字段 | 类型 | 说明 |
|---|---|---|
| `content_hash` | string | |
| `segmenter_version` | string | **[不可推迟]** |
| `tokenizer_version` | string | **[不可推迟]** |
| `analyzer_dict_version` | string | **[不可推迟]** SudachiDict 版本；不得与释义词典来源版本混用 |
| `payload` | messagepack | 分句／分词结果 |

---

## 9. 不变量清单

实现时应写成断言或测试，而非依靠自觉。

1. 任何 `Occurrence.kp_id` 指向的 KP 存在；KP 被合并后该指向**不改写**。
2. 任何 `Occurrence.section_id + section_revision` 指向的 AnalysisSection 版本存在且未被删除（可被 `superseded_by` 标记，但记录仍在）。
3. `retention = reference` 的 KP 不存在对应 `retired_at IS NULL` 的有效 ReviewItem。
4. 同一 `kp_id` 的有效 ReviewItem（`retired_at IS NULL`）默认至多一条，多于一条时必有用户显式操作记录。
5. 任何带三元组的记录必有非空 `analyzer_dict_version`。
6. 任何 Span 的 `char_start < char_end`，且落在其 `sentence_id` 的 code point 长度内；按规范化文本的 code point 切片后满足 `sentence.text[char_start:char_end] == span.surface`。
7. `MaterialNote` 与 `LearnerProfileNote` 的条数不超过配置上限——由**写入路径**保证，不由清理任务保证。
8. Lexeme 不出现在 Alias 表中；KnowledgePoint 不出现在 KnownEvidence 的 target 位。
9. `Analysis.session_closed = true` 的记录不再新增 AnalysisMessage。
10. 当 `Analysis.extraction_status = done` 时，其所有当前 AnalysisSection 的 `kind` 非空且属于「九个模块 + `takeaway` + `qa`」；抽取前允许为空。
11. `KnowledgePoint.anchor` 在本地库内具有唯一约束；并发抽取与重试必须通过幂等 upsert / 冲突重试收敛到同一 KP，不要求写入时执行全量模糊 alias 查重。

---

## 10. 两个数不能相加

**红线**：词汇量统计与知识点学习进度是两个数，分别显示，永不相加，永不互相校验。

- 前者是 Lexeme 层的覆盖率估计，来自证据模型，天然模糊，口径可配置；
- 后者是 KP 层的精确计数，来自显式指认，边界清晰。

聚合视图中同一知识点可能同时显示「被讲解过 3 次」与「在你读过的材料中出现过 5 次」。这不是不一致，是两个有不同标签的量。**UI 必须分别标注来源，不得合并为一个数字。**
