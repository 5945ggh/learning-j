---
id: ADR-032
status: accepted
---

# ADR-032 词典交换格式与 Provider 隔离
## 决策

Yomitan ZIP 作为第一等导入格式，内部 canonical dictionary model 保留定义文本与富文本、资源及来源版本。Provider 采用薄内部契约，官方 SDK 隔离在 adapters，特殊端点可走 HTTP 适配。

## 理由与取舍

不让交换格式或厂商 response 类型侵入业务。查词采用点击／键盘，不竞争 Option/Alt + hover；Agent 的工具能力兼容由同一适配边界验证。

ZIP 导入需阻止路径穿越，限制文件数与压缩/解压大小；损坏、未知 schema、重复资源给出定位信息；同 archive hash 幂等。MVP 不并行实现 JMdict XML、EPWING、MDX parser，不分发版权词典。

## 当前落点

[数据模型 §2](../data-model.md#2-dictionary-与-lexeme-层)、[DESIGN](../../DESIGN.md#查词流程)
