# P2-frontend：阅读器与算法解析面板

## 目标

建立最小阅读器 shell：左侧句子列表，右侧算法解析；算法结果与未来模型结果在视觉上明确区分。

## 必须完成

- 点击句子后展开右侧算法解析。
- token 可选择，为后续 DictionaryPopover/Drawer 保留事件边界，但本任务不要求完成完整词典交互。
- 字幕显示时间戳；纯文本不显示伪造时间戳。
- 算法来源标签或稳定的来源视觉语言。
- 组件位于 `src/components/`，不引用 `src/shells/`；shell 通过 props 装配组件。
- BYOK 缺失不影响 reader 和算法区。

## 不做

不实现 AI 解析、追问、抽取、ReviewCard 或业务状态写回。

## 验收

使用真实 API fixture 验证句子选择、token 渲染、无词典降级、错误态、响应式布局；运行 lint、类型检查、构建。
