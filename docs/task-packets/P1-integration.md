# P1-integration：素材链路集成验收

## 验收

- API 响应与前端生成类型一致。
- txt、srt、vtt 导入后 Sentence 文本序列和定位符合 `data-model.md`。
- 重复导入不产生重复 Lexeme 或不一致 id。
- `𠮟られた` 等 BMP 外字符的 code point 偏移通过端到端检查。
- 前端未使用裸文本 `.slice()`。
- 未配置 BYOK 时素材和句子浏览可用。
- 输出 P2 可以依赖的 API fixture 和启动命令。
