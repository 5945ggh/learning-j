# P5-backend：ReviewItem、FSRS、配额与聚合查询

## 读取范围

公共前言见 `_template.md`。另读 `docs/data-model.md` §3、§7、§9、§10，`docs/adr.md` 的 ADR-013、ADR-016、ADR-019、ADR-023，以及 `docs/LearningJ-plan-v5.md` §3、§8。

## 目标

实现 triage 后的 ReviewItem、ReviewState、FSRS 排程、每日配额和聚合查询。

## 必须完成

- `retention=srs` 的 KP 默认每个建立一条 ReviewItem；配额排空后按 salience 优先、同级 FIFO。
- KP 改为 reference 时 retire ReviewItem，不删除 ReviewState。
- 接入 `py-fsrs`，保存可恢复的 ReviewState。
- ReviewCard 背面按 `section_id + section_revision` 取 AnalysisSection；音频缺失是正常状态。
- Aggregate 查询同时返回“被讲解次数”和“材料中出现次数”，两个量独立计算、独立字段。
- 不存在把两个计数相加、相减或互相校验的后端路径。

## 不做

不实现推荐分发队列、未读计数、红点、卡片流 shell 或改变已有组件。

## 验收

点亮不变量 3、4；测试配额、FIFO、retired_at、ReviewState 保留、音频缺失、section revision 引用和双计数独立性。
