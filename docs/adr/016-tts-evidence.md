---
id: ADR-016
status: accepted
---

# ADR-016 TTS 与原声使用不同证据来源
## 决策

TTS 可用于学习与听力自评，记录 listening_tts，与原声 listening_native 分开；TTS 非必需，卡片与导出必须接受无音频。

## 理由与取舍

差异主要涉及朗读体与自然语流条件，不能把合成音等同原声听懂证据。撤销全面禁止 TTS 和独立校验每个音高重音的方案；具体声音质量需按选型验证。

## 当前落点

[数据模型 §2.2](../data-model.md#22-knownevidence)、[产品规划 §8](../LearningJ-plan-v5.md#8-复习与再遇)
