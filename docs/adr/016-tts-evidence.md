---
id: ADR-016
status: partially_superseded
superseded_by: [ADR-040]
---

# ADR-016 TTS 与原声使用不同证据来源
## 决策

TTS 可用于学习与未来听力自评；接入自评／识别任务证据时必须区分 TTS 与原声的任务条件。播放不代表识别成功，当前 KE 不预留 listening_tts／listening_native 枚举；来源落点由 ADR-040 更新。TTS 非必需，卡片与导出必须接受无音频。

## 理由与取舍

差异主要涉及朗读体与自然语流条件，不能把合成音等同原声听懂证据。撤销全面禁止 TTS 和独立校验每个音高重音的方案；具体声音质量需按选型验证。

## 当前落点

[数据模型 §2.2](../data-model.md#22-knownevidence-与用户裁定)、[ADR-040](040-evidence-and-query-projections.md)、[产品规划 §8](../LearningJ-plan-v5.md#8-复习与再遇)
