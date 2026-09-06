# P1-frontend：素材与句子浏览基础界面

## 读取范围

公共前言见 `_template.md`。另读 `docs/mvp-tech-and-phases.md` P1、`DESIGN.md` 的信息架构与阅读器原则、`docs/data-model.md` §8。

## 目标

接入 P1 后端 API，提供素材列表、句子列表和加载/空态/错误态；为 P2 阅读器 shell 保留稳定 props 边界。

## 可写范围

`frontend/`。只使用后端已公开的 OpenAPI 类型或 fixture，不自行修改 API 契约。

## 必须完成

- 素材列表与素材选择状态。
- Sentence 列表；字幕素材显示时间戳，纯文本显示合理的句子定位信息。
- 长句和 Unicode 文本渲染不改变字符顺序或偏移语义。
- 加载、空结果和错误状态；无 BYOK 不影响浏览。
- 组件位于 `src/components/`，shell 只负责装配和选择当前素材。

## 不做

不实现算法 token、词典抽屉、AI 解析和 triage。

## 验收

使用 fixture 验证 txt/srt 两种素材的句子列表；运行 lint、类型检查和构建。
