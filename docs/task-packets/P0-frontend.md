# P0-frontend：前端骨架与边界规则

## 读取范围

公共前言见 `_template.md`。另读 `docs/mvp-tech-and-phases.md` 的前端技术选型、`docs/adr.md` 的 ADR-023、`DESIGN.md` 的组件和可访问性约束。

## 目标

建立 Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui 的前端骨架，并把组件与 shell 的边界写成 ESLint 规则。

## 可写范围

`frontend/`。不得写后端、数据库、`docs/` 或 `references/`。

## 必须完成

- 建立 `src/components/`、`src/shells/`、`src/lib/` 以及最小可运行入口。
- 配置 `no-restricted-paths`：`src/components/**` 禁止引用 `src/shells/**`。
- 为句子文本提供 `sliceByCodePoint()`，并配置规则或静态检查，禁止对句子文本使用裸 `.slice()`。
- 配置 strict TypeScript、基础 lint、构建脚本和最小测试入口。
- 组件不得读取路由或 shell 内部状态作为隐含依赖。

## 不做

不实现阅读器、AI 解析、triage、ReviewCard 或真实 API 调用。

## 验收命令

- `pnpm lint`
- `pnpm build`
- 用临时反向 import 验证 ESLint 报错；验证后删除临时文件。
