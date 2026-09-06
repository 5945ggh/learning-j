# P3-integration：解析工作区集成验收

## 验收

- 后端 section schema 与前端渲染一致，fallback_single 不被当成错误。
- 首轮和追问的 turn_count、session_closed 行为端到端一致。
- note 槽位拒绝由后端返回，前端只展示结果，不承担限制逻辑。
- 模型输出与算法输出有稳定来源区分。
- fake provider 测试通过；真实 BYOK 缺失时降级路径通过。
- 输出 P4 可依赖的 Analysis、AnalysisSection、AnalysisMessage fixture。
