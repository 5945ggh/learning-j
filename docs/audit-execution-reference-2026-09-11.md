# 2026-09-11 文档审计实行参考

本文件记录本轮修订的执行决定、范围与验收，不建立第二份长期契约。完成后，字段和协议以 data-model / prompt-contracts 为准，产品边界以产品规划为准，阶段归属以阶段计划为准，界面以 DESIGN 为准。后续契约变化不要求反向更新这份日期化执行记录。

## 1. 授权与范围

- 用户确认项目仍处开发早期、尚无实际业务使用，要求优先消除未来问题，不为可丢弃开发数据维护过重的历史迁移机制。
- 本轮由主代理制定参考，手动委派 `gpt-5.6-luna` 修改现行文档，主代理复核。允许修订文档中的既有决定；这不是受“实现不得改规格”限制的代码实现任务。
- 只修改核心文档、必要 ADR 与项目 AGENTS.md；不读取或修改 task-packets、archived、实际 prompt 版本文件、业务代码、迁移脚本和数据库。保留工作区已有修改，不提交 Git。
- 文档目标改变不表示代码已同步，不删除数据库、不压平迁移、不伪称阶段验收完成。

## 2. 本轮执行决定

### A. 开发基线与正式数据保护

1. 当前可丢弃开发库允许显式重建、重新灌入可复现 fixture，并允许后续实现任务将未发布迁移压平为新的初始化基线；不再要求每次契约试验都维护旧开发 schema 的完整前滚链、legacy 回填和旧库兼容。
2. 适用对象必须是明确指定的开发／测试数据集。普通启动、打开数据库或版本不匹配不能自动删除数据。开发重建不得删除源素材、秘密、导出文件或其他目录。此处定义能力与条件，不执行删除。
3. 首次保留真实学习数据或首次对外发布持久化版本之前，建立明确 schema 基线和支持版本范围；从该时点起，受支持数据库升级需版本化迁移、升级前备份与恢复检查。不得在已有用户数据后再以“开发期”规避保护。
4. 运行时仍验证不可变引用、事实追加、事务与幂等；开发库可整体重置不允许普通编辑覆盖历史。全库快照导出与恢复仍属 MVP 产品能力。
5. 新 ADR 记录此项替代原来无条件前滚的理由。阶段计划和 AGENTS 同步；既有迁移/审查仅作为历史实现事实，不作为未来继续增加兼容分支的义务。task-packets 未在本轮复核，不声称已同步。

### B. 早期命名清理与默认策略来源

本轮采纳目标字段改名，避免以后依赖模糊名称；代码和旧迁移暂不修改，后续基线实现按新契约同步。

| 领域 | 目标字段 | 取值／含义 |
|---|---|---|
| KnowledgePoint | `default_retention` | `srs` / `reference`；全局默认策略，不是逐 Occurrence 建卡授权 |
| Occurrence | `retention_override` | `inherit` / `srs` / `reference`；局部策略，inherit 动态跟随原 kp_id |
| SessionConfirmation | `effective_retention_at_confirmation` | 当时有效策略快照 |
| SessionConfirmation | `retention_override_at_confirmation` | 当时局部策略快照 |

- 移除目标模型中的 `retention_set_by`：是否已有用户决定由该 KP 的最新 `KnowledgePointRetentionDecision` 判定；使用 `(kp_id, decision_seq)` 有序索引，不扫描全库。
- KP 无决定记录时使用初始化默认 srs；有记录时 `default_retention` 必须等于最新决定值，并与新决定和 KP 版本同事务更新。没有独立的“恢复未确认”写路径。
- 用户首次明确接受 KP 默认值，即使仍为 srs，也追加决定；已有决定且值相同的重复设置才不追加。只确认某个 Occurrence 不隐式确认整个 KP 的默认策略。
- KP 决定字段使用 `previous_default_retention` / `default_retention`；OccurrenceRetentionDecision 使用 `previous_retention_override` / `retention_override`。保留决定实体名，不为命名引入新实体。
- 泛指策略的自然语言可以保留 retention，但现行字段引用必须带正确实体名，不能对文档机械全局替换。授权事实的 `effective_retention` 保留。
- 改名不能替代意愿、确认、授权、排程四者的必要解释。

### C. 确认与建卡授权

- 合法确认组合只有 `(user, srs, NULL)`、`(user, reference, NULL)`、`(inherited, inherit, current_kp_decision_id)`，分别对应来源、局部快照和 decision_id。
- inherited 引用同一原 KP 的当前有效决定，检查其值与有效快照一致，并执行 KP/Occurrence 版本检查。默认值无决定记录时不提供直接“沿用”；用户可局部选择，或通过独立明确操作先确认 KP 策略再沿用。
- 每条新建 ReviewItem 恰好一条 ReviewItemAdmissionDecision，`target_review_item_id` 唯一且与 occurrence 一致，和卡一起提交；会话来源另关联 SessionConfirmation。复用既有卡不新建授权记录，不重置状态为 queued。
- knowledge_base 首次加入与 explicit_readd 退役后再次加入区分；后者引用同一 Occurrence 已退役旧项。若会话内也执行重建，仍按 explicit_readd 表达并明确关联规则，不能让来源枚举产生两种解释。
- 普通同值设置不会建卡，但独立明确的加入／再次加入操作可在局部值不变时产生新卡及授权。首次准入配额与首次评分仍分离。

### D. 作用域与提取提交身份

- 定义 `scope_form_key` 为确定性非空作用域键：Lexeme 级为 `lexeme:`，具体词形为 `form:` 加 NFC 后的原词形；不做 trim、大小写或宽窄折叠，拒绝空具体词形。前缀保证两种作用域不碰撞。原始输入继续保存。
- KE 与 LexemeKnowledgeDecision 使用同一派生规则；需要索引和唯一性保障，可由生成列或等价表达式实现，不强制复制两份可独立编辑的事实。
- 导入唯一范围为 import_run_id + lexeme_id + scope_form_key；决定序号在 lexeme_id + scope_form_key 内单调且唯一。
- 提取采用 run 级原子提交闸门：在同一短事务内验证 running/预期版本、提交全部成功产物并标 done；done 的重放返回原结果，不再插入。并发同 run 至多一方提交；提交前崩溃全回滚，提交后响应丢失可读取原结果。
- 不新增 `(run,kp,start,end)` 内容唯一约束；它会忽略小节来源等学习事实。不同成功 run 仍可追加。同一模型响应内重复候选的业务去重与请求重试不同，不能用粗粒度唯一键误删合法来源。
- 模型输出字段采用 `slot_surfaces`；持久化仍为 `Occurrence.slot_bindings`，显式描述候选槽位到既有模式槽位的映射，实际已有 prompt 文件不原地改写。

### E. UI、阶段与实验闭环

- 提取失败区分自动重试耗尽与用户手动重试；保留同 revision，提供搁置与创建关联新会话出口，不开放同会话退回 discussion 或忽略失败强制成功。
- 清除旧命名同步提醒；产品入口表区分顶级导航、工作区与学习记录子视图。主页当前未决且需当前占位行为，登记在唯一未决索引，稳定旧编号。
- 将产品未决项的编辑 TODO 改成真实引用；保留 GiNZA 采用与结果持久化两项并标依赖，不因整理而改产品边界。
- 阶段计划增加 1–25 不变量责任映射；标明首次验证阶段及后续生产者补测，不伪造已通过状态，不把整个不变量仅分给最后阶段。
- spike §11 标明 11a（P2 结构/合成事实）、已知词表独立切片（真实导入）、11b（P5 实际 SRS/规模）对应子场景。崩溃恢复、原子发布与版本一致性跟随各生产者，不能全部延后；不强按旧条目编号二分。
- 不新增 YAML 契约生成平台；先复用现有枚举模块与测试机制。散文保留产品理由，只在权威文件定义字段/矩阵，其他文档链接并描述自己的验收。

## 3. 文档验收

1. 对比本轮开始时的文档快照，确认保留用户已有改动；task-packets、代码、迁移、数据库未动。
2. 搜索旧字段：除明确标注的旧代码映射/历史说明，核心契约不存在 KP.retention、Occurrence.retention、retention_set_by 或旧确认快照字段；模型侧不再把 slot_bindings 与持久化形状混用。
3. 人工走读：首次接受默认策略、三种合法确认、已有卡复用、知识库同值明确加入、退役后重建、同 run 并发/响应丢失、scope 空值与具体词形隔离。
4. 核查新建授权的一对一、FK 同目标、状态恢复与配额条件在数据/协议/阶段/ADR/设计中一致。
5. 核查开发库重建与真实数据保护边界；任何阶段验收不能仍无条件要求保留全部旧开发迁移。
6. 检查修改文档本地链接、Markdown 表格和差异空白；文档检查不声称代码测试或产品实现通过。

## 4. 委派范围

- 数据／协议编写者（gpt-5.6-luna）：data-model、prompt-contracts、ADR-040/041。
- 产品／交付编写者（gpt-5.6-luna）：产品规划、阶段计划、DESIGN、spike-checklist、AGENTS、ADR-039、ADR 索引及新增开发基线 ADR。
- 主代理：本实行参考、整合与最终一致性核查；发现跨文件边界问题直接反馈对应编写者。
