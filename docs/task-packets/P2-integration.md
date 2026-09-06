# P2-integration：算法解析与阅读器集成验收

## 验收

- 前端只消费算法 API 的公开类型，不依赖 Sudachi 或 Yomitan 内部对象。
- token 的 code point 区间与后端文本切片一致。
- 未导入词典和未配置 BYOK 时 reader 仍可用。
- 算法结果与模型结果没有混用同一来源标签。
- shell 依赖组件，组件不反向依赖 shell；ESLint 规则未 disable。
- 输出 P3 可复用的 sentence、algorithmic response 和 loading/error fixture。
