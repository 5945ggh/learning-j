# P1-backend：素材导入、Sentence、Sidecar 与 Lexeme

## 读取范围

公共前言见 `_template.md`。另读 `docs/data-model.md` §2.1、§2.2、§8、§9，`docs/adr.md` 的 ADR-006、ADR-010、ADR-018，以及 `docs/LearningJ-plan-v5.md` §3–§5。

## 目标与边界

实现 txt、srt、vtt 的导入主链，并为 EPUB 留出符合 `data-model.md` §8.2 的适配边界。MVP 包含 EPUB；若本任务暂不实现 EPUB，必须在报告中明确标记为 P1 后续硬性交付，不得宣称 P1 全部完成。

## 必须完成

- `Material`、`Sentence`、`Sidecar`、`Lexeme` 的写入和读取。
- txt 按句末标点并处理引号、括号；字幕一 cue 一句，保存时间戳和双语译文。
- 所有偏移按 Unicode code point；BMP 外字符用例必须通过。
- SudachiPy A mode 分词，sidecar 带 `content_hash`、`segmenter_version`、`tokenizer_version`、`analyzer_dict_version`。
- `lexeme_id` 由 `normalized_form + pos + reading_form` 稳定派生，`first_seen_analyzer_dict_version` 非空。
- `POST /materials`、`GET /materials`、`GET /materials/{id}/sentences`。
- 同一内容重复导入幂等；同一文本以 txt 和字幕导入时，Sentence 文本序列一致，差异仅限锚点和时间戳。

## 不做

不引入 GiNZA、依存分析、AI 解析或词典查询。不得按素材类型把业务逻辑分叉到上层。

## 验收

点亮不变量 5，并运行 txt/srt/vtt、幂等性、code point 偏移和素材类型无关性测试。
