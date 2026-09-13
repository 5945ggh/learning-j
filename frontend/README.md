# LearningJ Frontend

Vite + React 18 + TypeScript（strict）+ Tailwind v4 + shadcn/ui 约定。P0 骨架：最小可运行入口 + 两条硬约束的 ESLint 强制。

## 命令

```bash
pnpm install        # 安装依赖（Node ≥ 20，pnpm 10）
pnpm dev            # 开发服务器 http://localhost:5173
pnpm lint           # ESLint（flat config，type-aware）
pnpm test           # vitest 单次运行
pnpm build          # tsc -b && vite build
pnpm types:sync     # 从后端 OpenAPI artifact 重新生成 src/lib/api-types.d.ts
pnpm types:check    # 检查已提交的生成类型是否与 artifact 漂移
```

## 目录边界（ADR-023，ESLint 强制）

- `src/components/` — 独立组件（AnalysisDocView、TriagePanel、ReviewCard 等将在后续阶段落地）。**禁止 import `src/shells/**`**（`import/no-restricted-paths`），**禁止依赖路由**（`no-restricted-imports`）。组件所需数据一律通过 props 传入；复习视图必须能在不修改任何组件的前提下装配出来（P5 验收）。
- `src/shells/` — reader / review shell。shell 装配组件、持有路由与页面状态。
- `src/lib/` — 与 React 无关的纯函数与工具。
- `src/components/ui/` — shadcn/ui 生成物（`pnpm dlx shadcn@latest add <component>`，配置在 `components.json`）。

## 句子文本切片：code point 偏移

项目硬约束：字符偏移一律使用 Unicode code point，不是 UTF-16 code unit。`String.prototype.slice / substring / substr` 会把 BMP 外字符（「𠮟」「𩸽」）切成孤立代理对。

- 字符串切片一律用 `src/lib/text.ts` 的 `sliceByCodePoint()`（内部 `Array.from`，参数语义与 `slice` 对齐：负值从末尾倒数、越界收敛）。
- ESLint 自定义规则 `learningj/no-bare-string-slice`（`eslint-rules/no-bare-string-slice.js`，type-aware）对字符串上的裸 slice 族报 error；数组切片不受影响。规则不设豁免，配置不得 disable。
- 后端 Sentence 偏移（sidecar、Span）同为 code point 下标，可直接换算。

## 设计令牌

`src/index.css` 定义了 DESIGN.md 的语义色（study=朱、lexical=青、syntax=琥珀）、日文衬线 `font-serif-jp`、圆角 ≤ 6px、`prefers-reduced-motion` 降级。颜色具体值是占位，落地组件时按 WCAG 2.2 AA 校准。

## 尚未接入（按阶段计划引入）

TanStack Query、Zustand、react-markdown。P2.5 已接入 React Router、repository 边界与 P1/P2 真实 API；P3+ Study／知识库／复习 API 仍按 handoff 报告中的 fixture/unstable 边界等待后续阶段。

## Backend contract index (P2.6)

- OpenAPI artifact: `../backend/fixtures/openapi.json` (read-only source of truth).
- Generated declarations: `src/lib/api-types.d.ts`; stable client/repository/component aliases are re-exported from `src/lib/api-contracts.ts`.
- Regenerate with `pnpm types:sync`; verify drift with `pnpm types:check` (run from `frontend/`).
- Vite proxies the current P1/P2 paths: `/materials`, `/sentences`, `/dictionaries`, `/lexemes`, and `/healthz` to `http://127.0.0.1:8000`.
- P3+ endpoints are intentionally absent from the artifact and adapters: Study sessions/analysis, extraction/confirmation, Knowledge/Review/SRS, and Anki export/send. Their fixture-only boundaries are explicit in the P2.5 handoff.
- Fixture composition and identity provenance are recorded in [P2.5-frontend-baseline-handoff.md](../docs/task-packets/reports/P2.5-frontend-baseline-handoff.md), especially its `## Review` fixture-composition findings and approval.
