# P0-frontend · handoff

STATUS: done
PACKET: docs/task-packets/CURRENT-PACKETS.md → P0-frontend
BASELINE: HEAD=5484224；保留工作区中既有未追踪的 frontend/ 与 experiments/ 内容，仅修改 frontend 前端实现并新增本报告

Contract ledger:
- `docs/mvp-tech-and-phases.md` §1.2、§3/P0 — 前端组件由 shell 通过 props 和回调装配；P0 只保留素材浏览，不实现 Study、LLM、提取、复习或其他未来领域行为。
- `DESIGN.md` Components/Accessibility 与 ADR-023 — 组件不反向依赖 shell 或路由；选择句子必须是可键盘操作的本地 UI 行为，来源上下文保持可读且不暗示学习活动。
- `docs/task-packets/reports/P0-contract-handoff.md` — P0-contract 闸门已 clear；P0 后端实际公开的可用素材端点不包含旧 Analysis、追问、抽取或 retention 端点。
- `frontend/src/lib/text.ts` — 持久化文本区间使用 Unicode code point 半开区间；业务切片只能通过 `sliceByCodePoint()`，不放宽既有 ESLint 规则。

Changed:
- `frontend/src/shells/MaterialWorkspace.tsx` — 删除旧 Analysis 状态、请求和内嵌面板；shell 现在只负责素材/句子加载、选择、错误和取消请求，并通过 props 装配独立组件。
- `frontend/src/components/SentenceContext.tsx` — 新增只读的选中句子来源上下文组件，展示句子、序号、来源定位和可选译文，不创建任何学习或 AI 记录。
- `frontend/src/components/SentenceList.tsx` — 将旧“打开解析”动作改为“选择句子”，并为选择按钮补充 `aria-pressed` 状态。
- `frontend/src/lib/analysis.ts` — 删除旧的平行 Analysis/KnowledgePoint API 契约及不存在端点调用。

Public contract:
- P0 前端仅调用 `GET /materials` 与 `GET /materials/{material_id}/sentences`；选择句子不触发网络请求。
- `MaterialList`、`SentenceList`、`SentenceContext` 均通过 props 接收数据和回调；组件不 import shell 或路由。
- code-point 文本切片继续由 `sliceByCodePoint()` 提供，后续 reader/sidecar 组件可复用同一 helper。

Verified:
- `cd frontend && pnpm lint` — pass。
- `cd frontend && pnpm test` — pass，1 个测试文件、8 个测试通过（含代理对、负索引、边界和 ZWJ code-point 切片）。
- `cd frontend && pnpm build` — pass，`tsc -b` 与 Vite production build 均成功。
- `test ! -e src/lib/analysis.ts` + source marker scan — pass，旧 AnalysisPanel、旧路径及 retention/抽取请求均不存在。
- component import scan — pass，`src/components` 无 shell 或 react-router 依赖。

Known limitations:
- P0 不接入 fixture、sidecar/token lookup、StudySession、AnalysisRevision、AI、词典、提取、KnowledgePoint、ReviewItem 或排程；这些属于后续 packet。
- `SentenceContext` 只呈现当前来源上下文，不提供 reader/player 控件或领域写入。

Gate for next packet:
- Ready: P0-integration 可验证前端构建、组件 shell 边界、code-point helper，以及素材 fixture 对接前的无旧 AI 请求基线。
- Not safe to assume: P1 reader/fixture 或 P2 lookup 行为已经实现；不得把当前句子上下文当作 Study/Analysis 文档。

CR focus:
- 确认旧平行 Analysis 契约已完整移除且构建产物不再包含其请求字符串；确认 shell 仍只持有页面加载/选择状态，组件仍可由其他 shell 直接复用。
- 检查窄屏/键盘下句子选择的可达性与 `aria-pressed` 语义，以及未来引入 span 时继续使用 `sliceByCodePoint()`。

Open issues:
- 无阻塞项；P1 的 fixture/type library 与 reader 行为按 packet 顺序后续实现。
