# P2-backend：算法解析与 Yomitan 词典

## 读取范围

公共前言见 `_template.md`。另读 `docs/mvp-tech-and-phases.md` P2、`docs/adr.md` 的 ADR-009、ADR-018、ADR-032、`docs/data-model.md` §2.0、§8.3、§9。

## 目标

实现算法 token、读音和词典候选释义 API。MVP 词典交换格式是 Yomitan ZIP；内部必须使用 canonical dictionary model，不把 `term_bank` 等格式泄漏到业务层。

## 必须完成

- Yomitan ZIP 导入、archive hash 幂等、路径穿越和压缩包/解压后大小与文件数限制。
- `DictionarySource`、entry、definition、asset、import run 的来源与版本追踪；定义保留纯文本投影和可选 structured content。
- `GET /sentences/{id}/algorithmic` 返回表层形、`normalized_form`、`pos`、reading、code point 区间和词典候选。
- 分词和读音与 SudachiPy A mode 逐 token 对拍。
- 未导入词典时仍可查看形态结果；词典结果带 source/version。

## 不做

不实现 JMdict-only importer、LLM、依存分析、KnowledgePoint 或 ReviewItem。

## 验收

运行 Yomitan 导入安全、重复 archive 幂等、无词典降级、token 对拍和 API 测试。
