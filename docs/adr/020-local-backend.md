---
id: ADR-020
status: accepted
---

# ADR-020 Python 后端与本地密钥边界
## 决策

算法、模型调用和状态提交在 Python + FastAPI 后端，sidecar 用 msgpack。Provider profile 普通配置与秘密分离：稳定 provider_id、name/base_url/model_list/credential_ref 可导出；秘密优先 keyring，不可用时显式降级到独立 POSIX 0600 secrets 文件。

## 理由与取舍

同侧处理使审计与工具写入只有一个提交点；本地路线方便原始媒体访问。B 类可运行裸后端，A 类需要独立发行工程。托管选择不能直接复用本地秘密文件方案。

允许尝试拉取模型列表，也须支持手工维护。日志、解析、运行记录及诊断导出不得包含密钥；普通配置同步排除秘密文件。

## 当前落点

[产品规划 §15](../LearningJ-plan-v5.md#15-未决事项)、[ADR-032](032-dictionary-provider.md)
