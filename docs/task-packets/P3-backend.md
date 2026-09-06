# P3-backend：AI 解析、section、追问与记忆注入

## 读取范围

公共前言见 `_template.md`。另读 `docs/prompt-contracts.md` §1–§4、`docs/data-model.md` §4、§6、§9，`docs/adr.md` 的 ADR-017、ADR-024、ADR-029。

## 目标

实现第一段解析、后端 section 切分、一轮追问、记忆注入和 note_ops 写回闸门。

## 必须完成

- 内部 provider contract：`chat(messages, model, ...) -> (text, usage, raw)`；实现 OpenAI-compatible、Anthropic、Google adapters，业务层不泄漏 provider response 类型。
- 密钥经 keyring，降级到权限为 0600 的本地文件；密钥不得进日志或持久化记录。
- `analysis_v1.md` 按 prompt contract 组装，`output_language` 与 UI 语言分离，译文明确标为参考。
- 按 heading id → 段落边界 → `fallback_single` 切分，写入 section revision/origin metadata；fallback 是成功降级。
- 追问只执行 `section_ops.add`；revise/merge 保留 schema 但拒绝执行。
- `turn_count` 初值为 1，追问后为 2；抽取前 `session_closed` 为 false。
- 记忆注入不按 retention 过滤；写入 `context_kp_ids`、`context_note_ids`。
- note 槽位上限由后端写入路径强制，满槽时拒绝 add。
- `session_closed = true` 后拒绝新增 AnalysisMessage。

## 不做

不实现抽取、Span、KP、Occurrence、triage、批量解析或 section revise/merge。

## 验收

运行 provider fake、section 降级、turn_count、note 上限和 session gate 测试；未配置 BYOK 时 P1/P2 保持可用，P3 入口明确不可用。
