# LearningJ 数据模型契约

> 面向实现（含委托给 coding agent 的场景）。本文规定**是什么**；**为什么**在 `adr.md`。二者冲突时及时报告。
> 标注 **[不可推迟]** 的字段与约束，若在第一版遗漏，后补的代价是全量数据迁移或历史数据重算。
> 本文规定当前目标契约，不表示对应实现或阶段验收已完成。2026-09-08 变更与阶段迁移边界见 [变更指引](changes/2026-09-08-study-session-agent-history.md)。
> 未决事项只在 [产品规划 §15](LearningJ-plan-v5.md#15-未决事项) 维护。

---

## 0. 全局约定

- 所有实体带 `id`（UUIDv7 或等价的单调递增 ID）、`created_at`、`updated_at`。下文不再重复列出。
- 所有时间为 UTC 时间戳。
- **文本规范化**：进入 `Material` / `Sentence` 的文本统一采用 Unicode NFC；换行统一为 LF；不做全角／半角折叠、不删除原文空白。`Sentence.text` 是模型输入、`surface` 定位和前端展示共用的规范文本。`content_hash` 对规范化后的素材文本计算。
- **字符偏移**：所有持久化 `char_start` / `char_end` 均以 Unicode code point 计，使用半开区间 `[start, end)`。浏览器 DOM 的 UTF-16 偏移只能在渲染适配层转换，业务代码不得直接把持久化偏移交给 `String.slice` 或 `Range`。
- **分级历史保护**：已被提取、Occurrence 或复习引用的解析版本与来源不得覆盖；KnownEvidence、Occurrence、完成的抽取结果与复习事件追加保存。工作流状态、当前文档指针、KP 当前意愿、笔记、批注与 SRS 当前状态允许更新。自动处理不得覆盖用户决定；这不限制用户主动修改自己的决定。详见 §0.1。
- **修改的提交边界**：文档编辑、提取结果提交、知识点确认分别具有原子提交边界。客户端和工具修改携带预期版本；过期写入必须报告冲突，不得覆盖并发修改。参与并发更新的会话、KP、笔记、批注和排程投影使用单调 version 或等价的原子比较机制；文档使用 current_revision_id。
- 版本戳（形态分析器版本、分析器词典版本、释义词典来源版本、prompt 版本、模型标识）在任何涉及外部资源的记录上都是必填项，不允许留空或用默认值。`analyzer_dict_version`（SudachiDict）与 `dictionary_source_version`（Yomitan 包等）属于不同命名空间，不得复用同一个 `dict_version` 含义。
- **anchor_key 序列化规范**：采用 Unicode NFC 归一化，连续空格折叠为单个空格，去除前后空白。序列化只取 `category + form + literal 文本 + 顺序`，不取槽位 id。当前模式版本为 `0.1`；序列化规则随 `pattern_grammar_version` 的大版本管理，枚举集合随小版本管理。
- **MVP 作用域是单用户、本地数据集**：当前实体不要求 `user_id`；未来若支持本地多用户或托管后端，必须在作用域迁移设计中为用户学习意愿、KnownEvidence、ReviewItem、ReviewState 与笔记补充用户边界。

### 0.1 历史与当前状态

| 数据 | 写入与保留策略 |
|---|---|
| 应用管理的原始资源 | 不修改原文件；派生文本和索引另存。外部资源发生变化时检测并提示 |
| 解析工作文档 | 流式未提交草稿可更新；一次有效编辑提交新的文档 revision，只新增变化的小节版本 |
| 被引用的文档／小节版本 | 内容和顺序不可覆盖、不可清理；提取固定引用整个文档版本，Occurrence 固定引用小节版本 |
| 无外部引用的草稿版本 | 可按撤销保留策略清理；不按流式 token 建历史版本 |
| KnownEvidence、Occurrence、已提交提取结果、ReviewEvent | 追加保存；纠错或重跑记录新的事实，不重写来源 |
| 会话阶段、任务状态、当前指针、访问时间 | 直接更新；无需为每次进度变化创建实体版本 |
| KP retention／canonical_id | 更新当前值，同时追加用户意愿／合并决策事件；抽取不可覆盖用户意愿 |
| 笔记、画像、批注 | 可编辑和删除；Agent 修改记录操作结果，允许有限撤销历史，不要求永久保留每次正文 |
| ReviewState | 更新当前排程投影；复习事实保存在独立 ReviewEvent 中 |

“保留历史”约束正常编辑、合并、重跑和清理，不禁止用户明确删除个人数据。删除必须处理引用和影响范围，不能伪装成普通编辑。本次不设计通用事件溯源框架。

对话上下文裁切不等于删除学习记录；运行日志、provider 续接数据和调试输出按用途保留，不永久重复保存每轮注入的全文或原始响应。应用不要求访问或持久化模型隐藏推理。

---

## 1. Span（值对象）

**[不可推迟]** Span 被四方共用：`Occurrence`、`Annotation`、小节的 `ExtractionSection` 映射，以及将来的可疑句高亮（ADR-014）。它必须在第一天就定成一个独立、稳定的形状。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sentence_id` | FK | 所属句子 |
| `surface` | string | **定位输入**。提取时由模型给出原文子串；Annotation 来自用户选区。二者使用同一规范文本 |
| `char_start` | int | 句内字符起始偏移，闭区间左端。**由后端定位得出** |
| `char_end` | int | 句内字符结束偏移，开区间右端。**由后端定位得出** |
| `token_start` | int? | sidecar 分词序列内的 token 索引，闭区间左端 |
| `token_end` | int? | 同上，开区间右端 |
| `alignment_status` | enum | `aligned` / `partial` / `ambiguous` / `unaligned` |

### 物理存储

Span 在逻辑上是值对象，在物理上使用独立的不可变 `spans` 表；每个 Span 有自己的 `span_id`。实体之间不使用多态 `owner_type / owner_id` 外键，而使用带真实外键的关联表：

- `occurrence_spans(occurrence_id, span_id, ordinal)`：有序数组，包含该次出现的完整匹配 Span 及需要的槽位 Span；`ordinal` 保证顺序，同一 `span_id` 不重复关联；
- `extraction_section_spans(extraction_section_id, span_id, ordinal)`：由特定抽取运行产生的小节映射，不修改小节正文版本；
- `annotation_spans(annotation_id, span_id, ordinal)`。

关联表上的 `ordinal` 保证数组顺序，`span_id` 只能指向一个 `sentence_id`。这样既能复用同一套 Span 约束，也不会牺牲数据库的引用完整性。文档中的 `Occurrence.spans`、`ExtractionSection.spans` 和 `Annotation.spans` 是上述物理关系的逻辑写法。

### 定位规则

模型**只给 `surface`，不给偏移**。后端在句子文本中执行 `find_all`：

| 命中数 | 处理 |
|---|---|
| 0 | 不产生 Span；将该 surface 记录到本次 `ExtractionRun.unresolved_surfaces`，供失败检测与重跑使用 |
| 1 | 产生一个 Span，按 token 边界对齐结果取 `aligned` 或 `partial` |
| >1 | 为**每一处命中各产生一个 Span**，全部标 `ambiguous` |

完整 surface 的重复命中保留为 ambiguous，不让模型猜偏移。模式槽位还需在各完整命中内部验证，无法唯一确定时拒绝该次模式出现；详见 prompt 契约 §5.2。
`ambiguous` 与 `partial` 是两回事：前者是「不知道指哪一处」，后者是「知道指哪里但边界不落在 token 上」。不得混用，否则统计读不出东西。

### 约束

1. 存储后，**字符区间是权威值**，下游一律使用它；token 区间是由 sidecar 对齐推导出的派生值。surface 已命中但 token 侧无法对齐时，保留字符区间，`alignment_status = unaligned`，**不得因 token 对齐失败而丢弃该 Span**。
2. **跨句 Span 不支持。**需要跨句时用有序的 Span 数组表达。
3. 对齐使用的 sidecar 必须与产生该 Span 时的 sidecar 是同一版本；重新分词后以新 Span／对齐版本记录重算结果，字符范围保持一致；不得原地覆盖已引用 Span 的旧 token 对齐来源。

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

1. **`analyzer_dict_version` 不参与 `lexeme_id` 的派生。**分析器词典版本记在 sidecar 与 KnownEvidence 上，而不是编进 id。理由：若编进 id，则每次 SudachiDict 升级会使全库 `lexeme_id` 变更，所有历史证据指向旧 id，词频与覆盖率查询从此永远要过映射层；而那张映射表实际只能靠「三元组相同即同一词」重建，等于自己造一道必须再拆掉的墙。三元组不变时 id 天然稳定，只有三元组实际漂移时才需要迁移映射，规模由实际变化决定。
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
| `anchor_shape` | enum | **[不可推迟]** `pattern` / `lexical` / `entity` / `opaque` |
| `anchor_payload` | json | **[不可推迟]** 类型特定的结构化内容，形状由 `anchor_shape` 决定 |
| `anchor` | string | **由 `anchor_payload` 确定性派生**，模型不书写。保留唯一约束与并发 upsert |
| `pattern_grammar_version` | string? | `shape = pattern` 时必填。记录创建时的枚举集合版本（小版本）与序列化算法版本（大版本），格式 `major.minor` 如 `0.1` |
| `opaque_reason` | enum? | `shape = opaque` 时必填。`model_chosen` / `validation_failed` |
| `zero_slot_lexeme_check` | json? | 0 槽位 pattern 写入时的 lint 结果：`{"passed": bool, "analyzer_dict_version": str}` |
| `display_form` | string? | **可选的人工覆写**。默认由渲染器从 payload 生成 |
| `tags` | string[] | **多值标签**，可为空、可重叠、可后加（ADR-021）。MVP 只保证 `grammar` 可靠打上 |
| `retention` | enum | **[不可推迟]** `srs` / `reference`。**用户的决定**，见下 |
| `retention_set_by` | enum | **[不可推迟]** `default` / `user`。为 `user` 时，重跑抽取与批量重抽**不得覆盖** |
| `canonical_id` | uuid? | **[不可推迟]** 合并指向。空值表示自身即 canonical |
| `lexical_anchors` | lexeme_id[] | **可空、可多。仅作索引，不参与身份判定** |
| `origin` | enum | `extraction`（MVP 内唯一取值）/ 预留 `manual` |

**完整示例**：

```json
// pattern shape 示例
{
  "anchor_shape": "pattern",
  "pattern_grammar_version": "0.1",
  "anchor_payload": {
    "elements": [
      {"type": "slot", "id": "N1", "category": "N", "form": "none"},
      {"type": "literal", "text": "の"},
      {"type": "literal", "text": "ない"},
      {"type": "slot", "id": "N2", "category": "N", "form": "none"}
    ]
  },
  "anchor": "N[none].の.ない.N[none]",
  "display_form": null
}

// lexical shape 示例
{
  "anchor_shape": "lexical",
  "anchor_payload": {
    "surface": "向上心"
  },
  "anchor": "向上心",
  "display_form": null
}

// entity shape 示例
{
  "anchor_shape": "entity",
  "anchor_payload": {
    "entity_type": "literary_work",
    "entity_label": "夏目漱石《こころ》"
  },
  "anchor": "entity:literary_work:夏目漱石《こころ》",
  "display_form": null
}

// opaque shape 示例
{
  "anchor_shape": "opaque",
  "anchor_payload": {
    "freeform": "〜ことができる"
  },
  "anchor": "hash:a3f8c9...",
  "opaque_reason": "model_chosen",
  "display_form": "〜ことができる"
}
```

#### retention 与用户决定

`retention` 只表达复习意愿：`srs` 允许排程，`reference` 暂停复习。两者都保留 KP、Occurrence、检索、聚合与记忆注入；知识点的存在不等于“已学会”。`srs` 也不等于已经获得复习配额。

1. 新 KP 创建时可使用 `retention = srs`、`retention_set_by = default` 作为尚未确认的初值，**该初值不授权建立 ReviewItem**。任何生成模式都须获得用户明确选择才能新建复习项。
2. 用户选择“安排复习”或“仅作参考”时更新当前值，并一律设置 `retention_set_by = user`，即使选择与默认值相同；追加 `KnowledgePointDecision(kp_id, previous_retention, retention, source, session_id?, created_at)`。`source` 为 `session_confirmation` / `knowledge_library`。
3. 已有用户决定由后续抽取继承，不覆盖。标签可以并集补充；自动处理不覆盖人工 `display_form`。
4. 会话中的候选按本次成功 ExtractionRun 的 KP 折叠。是否完成本次确认由 §4.2 的 SessionConfirmation 决定，**不再用 `retention_set_by = default` 作为学习队列或会话退出条件**。
5. 知识库可随时改变意愿；它不改写以前的确认记录，也不重新打开完成的会话。`reference → srs` 恢复已有复习进度；尚无卡片时按配额等待创建，详见 §7。

#### 身份与合并

- `anchor` 是形式级自然键，数据库唯一；`kp_id` 是自签发主键。同一形式的不同义项共享 KP，差异保留在 Occurrence；归一锚点不归一内容。
- 并发抽取以幂等 upsert / 冲突重试收敛；MVP 不做全库写入时 alias 模糊查重，候选召回与条件身份消解见 prompt 契约 §5。
- `canonical_id` 是可更新、可撤销的当前合并指针。追加 `KnowledgePointMergeEvent(source_kp_id, previous_canonical_id?, canonical_id?, created_at)`，Occurrence 的原 `kp_id` 不改写。合并禁止自环和环；目标当前用户意愿须明确，不能由抽取借合并覆盖。
- `shape = pattern` 必有 `pattern_grammar_version` 和 `elements`；`opaque` 必有 `opaque_reason`；`lexical` / `entity` 的模式版本与 opaque 原因为空。
- `anchor` 必须由 payload 按记录的版本确定性派生；槽位 id 不参与身份。
- 展示优先使用人工 `display_form`，否则从 payload 渲染。被保存的导出产物记录渲染版本；当前 UI 渲染器可正常维护，不要求每次视觉修复新增永久函数。

### 3.2 Alias

| 字段 | 类型 | 说明 |
|---|---|---|
| `alias_string` | string | 变体写法 |
| `kp_id` | FK | 收敛到的 KP |
| `source` | enum | `seed`（JLPT 语法表种子）/ `extraction` / `merge` / `manual` |

**约束**：别名表只服务 KP 层，Lexeme 不进此表。

**用途**（ADR-034）：结构化 payload 减少自由串漂移后，Alias 主要承载「JLPT 种子串 / 教材写法 → 模式」映射与外部导入；实际规模与身份稳定性由实验测量。

### 3.3 Occurrence

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | FK | |
| `sentence_id` | FK | |
| `material_id` | FK | |
| `spans` | Span[] | **[不可推迟]** 该知识点在原句中的位置。有序包含完整匹配与槽位 Span，物理上通过 `occurrence_spans(occurrence_id, span_id, ordinal)` 关联；不得限制为长度 1 |
| `slot_bindings` | json | 槽位实例绑定，键为槽位 id（如 "N1"），值为 `span_id`（引用 `spans` 表）。`shape` 为 `pattern` 时按模式槽位填充，其他 shape 时为空对象 `{}` |
| `salience` | enum | **[不可推迟]** `primary` / `secondary`。用于候选排序与用户决定后的新卡待建优先级；不决定 KP 的存在或复习意愿（ADR-019） |
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

1. **每个成功提取运行的有效出现均记录**，不因 retention 或配额丢弃。新的成功 run 追加 Occurrence；同一 run 的重复提交必须幂等，不复制产物（ADR-019）。
2. 内容引用必须是 `section_id + section_revision`，**不得用字符区间指向解析原文**——解析文档可变，字符区间会碎。`content_source = analysis_section` 时二者均非空；未来其他来源必须另行定义引用约束。
3. 抽取段输出的是原文子串，**字符区间、token 区间、三元组与 `lexical_anchors` 全部由后端推导，不由模型给出**（ADR-009）。
4. **槽位绑定完整性**：`shape = pattern` 的 KP 所产生的 Occurrence，其 `slot_bindings` 必须包含该模式全部槽位的成功绑定；任一槽位定位失败则该次出现不产生 Occurrence，在 `ExtractionRun.unresolved_patterns` 中定位 candidate 与失败范围；同一候选其他完整命中的有效出现可保留。
5. `slot_bindings` 的值为 `span_id`（surface 可从 Span 取，不冗余存储）。

---

## 4. 学习会话、工作文档与提取

### 4.1 StudySession（学习会话）

学习队列是未完成会话的查询视图，不是执行任务队列，也不新增 Inbox 实体。一次会话拥有一份解析工作文档、用户对话、执行记录与提取产物。

| 字段 | 类型 | 说明 |
|---|---|---|
| `material_id` | FK | 原材料与返回位置的作用域 |
| `source_sentence_ids` | ordered FK[] | 物理使用 `study_session_sentences(session_id, sentence_id, ordinal)`；首版恰好一句，预留多句不意味着已经支持联合分析 |
| `mode` | enum | `interactive` / `automatic`；后者必须显式选择，不因多选而推断 |
| `status` | enum | `active` / `completed` / `parked`；可更新的会话生命周期 |
| `phase` | enum | `preparation` / `discussion` / `extraction` / `confirmation`；搁置时保留阶段 |
| `current_extraction_run_id` | FK? | 当前正在处理或待确认的提取运行；重试明确切换，不覆盖旧 run |
| `completed_at` | timestamp? | 本次会话完成时间 |
| `return_position` | json? | 阅读／播放位置，不表达阅读或掌握状态 |

**流程与操作**

- 创建即进入 `active + preparation`，可立即打开会话。排队、运行、失败由执行记录呈现，不另造 KP。首次生成失败仍停留 preparation，可创建新的 generation AgentRun 重试；只有成功提交首稿才进入后续阶段。
- 首次生成成功：interactive 进入 `discussion`（可讨论）；automatic 固定成功版本后直接进入 `extraction`。普通多选创建多个 interactive 会话，各自仍可讨论；首版不把多句塞入同一生成请求。
- discussion 中允许多轮对话和文档编辑。离页、切换材料、关闭浏览器均不结束讨论、不自动提取。
- 用户“结束讨论并提取”时，等待当前文档写操作结束，原子选定 AnalysisRevision 并转入 extraction。提取期间不接受新的讨论写入；失败只重试该版本的提取。
- 成功提取后进入 confirmation；两种模式均在此由用户确认复习意愿，不自动为默认候选建卡。
- 当前 run 的所有不同 KP 完成本次确认后进入 completed，退出学习队列。零候选的合法结果显示原因，由用户明确“完成学习”，不伪造候选。
- 已完成会话保留文档、对话和来源，可从学习记录访问。继续研究时创建新的关联会话，不修改已确认提取的输入。
- 搁置移出默认队列但保留所有数据，恢复时回到保存阶段。运行中的操作必须先完成或确认取消再搁置，不允许搁置后隐藏后台写入。

**查询投影**

| 入口 | 数据依据 |
|---|---|
| 阅读器／播放器、素材卡片“学习队列” | `status = active` 且 `material_id` 匹配；可按阶段筛选 |
| 全局“学习队列” | 相同查询，不限定材料 |
| 学习记录 | 全部会话，支持 completed / parked / 材料筛选 |
| 知识库／材料知识视图 | KP 经 Occurrence 关联来源；独立显示用户意愿、实际排程、讲解次数与材料出现次数 |

同一句的多次会话保持独立 ID。访问页面不创建 `read/unread/learned` 状态；状态数量与运行进度可显示，不制造未读债务。会话完成与 KP 当前全局意愿是两个维度。

### 4.2 SessionConfirmation（本次结果确认）

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | FK | 本次会话 |
| `extraction_run_id` | FK | 必须是本次当前、成功的提取结果 |
| `kp_id` | FK | 必须出现在该 run 的已提交 Occurrence 中 |
| `retention_at_confirmation` | enum | 本次确认时的 `srs` / `reference` 快照 |
| `decision_source` | enum | `user`（本次选择）/ `inherited`（用户确认沿用既有选择） |
| `decision_id` | FK? | 对应的 KnowledgePointDecision；继承时关联所沿用的决定 |
| `confirmed_at` | timestamp | |

`inherited` 只允许继承 `retention_set_by = user` 且具有非空 KnowledgePointDecision 的既有选择；default 初值不能继承，没有可引用用户决定时必须本次明确选择并记为 user。

记录追加保存；同一会话、run、KP 的最后一次明确确认是当前确认结果。继承全局意愿不自动完成会话；可提供“一并沿用并完成”。确认一个新选择时，当前 KP 更新、决策事件与 SessionConfirmation 同一事务提交。会话结束后知识库修改不回写这些快照。

最后一项确认与会话完成在同一提交边界；等待配额不阻止会话完成。若确认期间全局意愿已被别处更新，按版本检查提示刷新，不静默覆盖。KP 合并影响正在确认的结果时同样刷新，不复制意愿。

### 4.3 Analysis 与 AnalysisRevision

Analysis 承载当前工作文档；会话阶段、消息和确认不再挂在同一实体上。

| Analysis 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | FK unique | 一次会话一份工作文档 |
| `current_revision_id` | FK? | 当前已提交文档版本；生成前可为空 |
| `style_modules` / `style_free_text` | string[] / string? | 本次初始解析要求 |
| `user_question` | string? | 初始困惑 |
| `output_language` | string | 解析语言 |
| `retrieval_enabled` | bool | MVP 恒为 false；本地词典／KP 工具不属于联网检索 |

| AnalysisRevision 字段 | 类型 | 说明 |
|---|---|---|
| `analysis_id` | FK | |
| `revision` | int | 文档级递增版本号，与 analysis_id 唯一 |
| `section_refs` | ordered FK[] | `analysis_revision_sections(analysis_revision_id, section_version_id, ordinal)` 保存完整顺序 |
| `source_agent_run_id` | FK? | 产生这次提交的生成／讨论运行 |

一个 manifest 中同一逻辑 section_id 只能出现一次，所有小节必须属于该 Analysis；运行与确认引用必须属于同一 session/analysis 作用域。一次有效编辑原子提交新 revision、新增变化的小节版本并切换当前指针。未变化小节复用，不复制全篇正文；删除／移动通过新版本的引用集合与顺序表达。流式未完成内容是草稿，不成为提取输入。

提取必须引用一个已提交的 AnalysisRevision。该 manifest 和它引用的小节正文因此受保护；清理只能处理无历史引用且已超出撤销保留范围的草稿版本。不能通过修改当前指针改变旧 ExtractionRun 的输入。

### 4.4 AnalysisSection

| 字段 | 类型 | 说明 |
|---|---|---|
| `section_version_id` | uuid | 具体内容版本 |
| `section_id` | uuid | 逻辑小节身份 |
| `analysis_id` | FK | |
| `heading_path` | string[] | 后端切分的寻址辅助信息；降级为空 |
| `split_strategy` | enum | `heading` / `paragraph` / `fallback_single` |
| `body_md` | text | 自由讲解正文，无固定语义组织要求 |
| `revision` | int | 小节级版本，与 section_id 唯一 |
| `origin_agent_run_id` | FK | 产生该内容版本的运行 |

Occurrence 的 `(section_id, section_revision)` 引用保持有效。当前小节集合由 AnalysisRevision 决定，不再依赖可变 `superseded_by` 判定文档内容；合并产生新小节版本／逻辑小节并记录工具操作，旧被引用内容不删除。

`kind` 与 `spans` 是特定提取运行对小节的解释，存 §4.6 ExtractionSection，不回填不可变正文版本。API 可组合展示，但必须带 extraction_run_id，不把旧版本映射套到新正文。

### 4.5 AgentRun、AnalysisMessage 与工具记录

- `AgentRun`：关联 session_id，记录 `purpose = generation | discussion`、`status = queued | running | done | failed | cancelled`、provider/model/prompt_version、请求标识、usage、输入／输出文档 revision、注入的 KP/note ID 与必要版本或摘要。初始 generation 是一次运行；每次用户发送消息产生 discussion 运行，运行内部可多次调用工具。
- `AnalysisMessage`：`session_id`、单调 `message_index`、`role = user | assistant`、`content`、`agent_run_id?`。保存用户原始输入与可见回复，不拼入自动注入的全文；不再限制一个业务回合只有一个 assistant 消息。
- `AgentToolCall`：`agent_run_id`、`call_id`、`tool_name`、输入摘要／必要参数、状态、结果摘要、目标实体与前后版本。唯一键为 `(agent_run_id, call_id)`，保存规范化输入 hash；同键同 hash 重试返回原结果，同键不同 hash 拒绝为协议冲突。持久修改的操作记录与修改同一提交边界，不重复编辑或增加笔记。
- provider 所需的调用／结果关联与续接数据由适配层保存足够的协议记录，和用户可见消息分开；不得把任意截断后的工具半轮作为可重放上下文。失败／取消保留已成功提交的编辑，并清楚标出部分完成，不声称整轮成功。
- 画像与作品笔记写操作仍受作用域、槽位与长度检查；持久副作用须可审计。隐藏推理不是领域实体，不要求获取或永久保存。

旧 Analysis 上的 `status/extraction_status/extraction_trigger/session_closed/turn_count` 由会话与运行记录替代，不继续维护第二份状态机。如何迁移旧字段由后续实现任务处理，见变更指引。

### 4.6 ExtractionRun 与 ExtractionSection

每次提取尝试独立记录，固定输入版本。生成／讨论历史仅是可选执行优化，不能成为提取自足性的前提。

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` / `analysis_id` | FK | |
| `analysis_revision_id` | FK | **[不可推迟]** 本次唯一、确定的输入文档版本 |
| `execution_path` | enum | `continued_turn` / `standalone` |
| `provider` / `model` / `prompt_version` | string | 审计来源 |
| `status` | enum | `running` / `done` / `failed`；运行中可更新，结束结果保留 |
| `retry_of` | FK? | 重试沿用原文档版本，保留旧尝试 |
| `failure_reason` | enum? | `invalid_json` / `empty_candidates` / `all_unresolved` / `provider_error` |
| `unresolved_surfaces` | string[] | 原文找不到的 surface |
| `invalid_patterns` | json[] | `{candidate_index, failed_rules}` |
| `unresolved_patterns` | json[] | `{candidate_index, anchor, missing_slots}` |
| `opaque_count` / `candidate_count` | int | 已提交产物统计；原始输出数量可在诊断中单列 |
| `started_at` / `finished_at` | timestamp | |

`ExtractionSection(extraction_run_id, section_version_id, kind)` 加有序 Span 关联表，为本次输入的每个小节提供分类与原句定位。kind 集合 = 九个解析模块 + `takeaway` + `qa`，与 KP tags 使用不同枚举。

成功的 KP upsert、Occurrence、ExtractionSection 与 run 完成状态一起提交；失败尝试不能产生部分可见学习产物。可定位的部分候选允许成功提交，同时记录被拒绝候选；整体失败规则见 prompt 契约 §5.5。

重试请求的传输幂等不等于跨运行去重：同一运行不得因重复提交复制产物；新的成功重抽运行追加新的 Occurrence，不覆盖旧 run、旧引用或用户决定。历史维护式重抽不自动重新打开已完成会话、不自动建卡；如用户要重新确认，创建新的会话。

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
3. 对用户可见、可编辑、可删除；允许更新当前正文。Agent 工具写入记录目标、操作结果与版本，有限撤销历史按 §0.1 保留。
4. **「某语法点是否已讲过」不由记忆承担**，它来自 KP 库检索这一确定性事实。记忆只承载风格与画像。

---

## 7. SRS

### 7.1 ReviewItem

| 字段 | 类型 | 说明 |
|---|---|---|
| `kp_id` | FK | |
| `occurrence_id` | FK | 当前选用的例句；用户可更换，历史复习事件保留当时引用 |
| `status` | enum | `active` / `paused` / `retired` |
| `retired_at` | timestamp? | 真正退役时单向设置；**reference 使用 paused，不使用退役标记** |

- `status = retired` 当且仅当 retired_at 非空；active/paused 的 retired_at 必须为空。退役同次提交状态与时间戳且不可恢复；active ↔ paused 仅作用于未退役卡片。
- 默认每 KP 一条非 retired ReviewItem，paused 也占此唯一位置；索引与查询统一用 `retired_at IS NULL` 判断非退役。额外卡片必须有用户显式操作记录。
- `retention = reference` 时对应非退役卡片均 paused，不进入到期队列；保留 ReviewState 与 ReviewEvent。
- 改回 `srs` 时恢复原卡片与学习进度；恢复不消耗新卡配额，不伪造一次复习，不清零稳定性或重置学习历史。原 due 保留，到期项按正常队列呈现。
- 无卡片时，只有明确的用户 srs 决定才进入待建队列。所有会话模式均适用；默认 `srs/default` 不授权创建。
- 新建仍受每日配额控制；待建按 `salience` 优先、同级 FIFO。建立前再次检查最新用户意愿，reference 不得因旧队列条目而建卡。
- 知识库直接选择 srs 与会话候选确认使用同一排程服务。会话确认完成不要求配额已分配。
- 真正 retired 的卡片不恢复；用户另建卡须明确，不把 srs/reference 切换解释为退役重建。

### 7.2 ReviewState 与 ReviewEvent

ReviewState 是每 ReviewItem 的当前 FSRS 排程投影，允许原地更新。具体算法字段沿用实现所选算法，不要求给每次状态更新保存整行版本。

ReviewEvent 追加保存：`review_item_id`、当时的 `occurrence_id`、`reviewed_at`、评分、算法版本及重放所需的排程参数／结果。同一次复习提交有幂等键；事件写入与当前状态更新同一事务。换例句、暂停和恢复不删除既有复习事件，也不伪造评分。

---

## 8. 素材与句子

### 8.1 Material

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 导入时从文件名或 EPUB metadata 推导，用户可修改 |
| `content_hash` | string | **[不可推迟]** |
| `locator` | string | 原始资源的路径或句柄；存储策略见下 |
| `kind` | enum | `subtitle_video` / `subtitle_audio` / `text` / `epub` |
| `copy_stored` | bool | 真实复制状态，不固定写 false |
| `storage_mode` | enum | `external_reference` / `managed_copy` |
| `source_sha256` | string? | 原始文件校验，与规范化文本 content_hash 分离 |

视频默认 external_reference；导入可明确选择 external_reference 或 managed_copy（音频、文本、EPUB 同样适用）。managed_copy 原始资源不可变；external_reference 源失效不删除已有 Sentence/sidecar。导入需说明文件大小与可用性影响。

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

懒生成的算法／翻译缓存 key 必须包含输入文本或 sidecar 身份及相关分析器、分析器词典版本；依赖释义词典时另带来源及版本。模型生成的翻译还须区分模型、prompt 版本与输出语言，不以缓存复用绕过来源变化。缓存可清理，不作为历史讲解引用。

---

## 9. 不变量清单

编号保留以便迁移；以下是目标契约，不代表已有测试已点亮。后续阶段验收应按变更指引重新映射。

1. Occurrence 指向存在的 KP；合并不改写其原 kp_id，canonical 指针无环。
2. Occurrence 引用存在的小节版本，且该版本属于其 ExtractionRun 固定输入的 AnalysisRevision；被引用内容不得覆盖或清理。
3. reference 的 KP 没有 active ReviewItem；paused 的卡片及复习历史保留。
4. 同一 KP 默认至多一条非 retired ReviewItem，额外卡片必须有显式操作记录；status=retired 与 retired_at 非空等价，暂停恢复不改变退役标记。
5. 带三元组的记录有非空分析器词典版本来源；Lexeme 使用 first_seen_analyzer_dict_version，其余相关记录使用 analyzer_dict_version。
6. Span 的 code point 半开区间非空、在原句内，切片等于 surface。
7. 作品笔记／画像的条数与单条长度由写入路径强制限制。
8. Lexeme 不进入 Alias，KP 不成为 KnownEvidence 的 target。
9. 只有 active + discussion 会话接受新的讨论运行；切换阶段须先结束或确认取消在途文档写操作，提取输入不会随当前文档变化。
10. 成功 ExtractionRun 对其输入版本的全部小节都有合法 ExtractionSection.kind；提取前无映射合法，提取不修改小节正文。
11. KP.anchor 唯一，并发 upsert 收敛；同一运行的重复提交不复制产物。
12. pattern KP 的 anchor 等于按其 pattern_grammar_version 序列化的 payload。
13. pattern Occurrence 的 slot_bindings 键集合等于模式槽位集合；其他 shape 为空对象。
14. pattern 有模式版本；opaque 有 opaque_reason。
15. 槽位顺序与模式一致，跨槽位 Span 不相交；完整匹配 Span 可以包含槽位 Span。
16. 每个 slot_bindings 值均在该 Occurrence.spans 中；spans 是有序数组，不限长度 1。
17. 会话完成只依据当前成功 run 的本次确认（零候选须明确完成），不依据 KP 当前全局 retention；后续意愿修改不复活旧会话。
18. 任意模式的新建复习项均有用户 srs 决定并满足配额；default 不构成授权。暂停恢复不清除进度、不消耗新卡配额。
19. 提取、确认、Agent 工具副作用与复习提交各自原子且幂等；失败不得留下宣称成功的部分产物。
20. 当前状态可更新；历史引用、用户决定保护和关联完整性不因更新而失效。

---

## 10. 两个数不能相加

**红线**：词汇量统计与知识点学习进度是两个数，分别显示，永不相加，永不互相校验。

- 前者是 Lexeme 层的覆盖率估计，来自证据模型，天然模糊，口径可配置；
- 后者是 KP 层的精确计数，来自显式指认，边界清晰。

聚合视图中同一知识点可能同时显示「被讲解过 3 次」与「在你读过的材料中出现过 5 次」。这不是不一致，是两个有不同标签的量。**UI 必须分别标注来源，不得合并为一个数字。**
