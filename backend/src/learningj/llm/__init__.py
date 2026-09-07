"""provider contract + SDK/httpx adapters。

业务层只依赖内部 `ChatResult` 契约（provider / model / prompt_version /
usage / raw / request_id 审计字段），不依赖任一家 SDK 的 response 类型
（ADR-032 决策五、`docs/mvp-tech-and-phases.md` §1.1）。P3 实现。
"""
