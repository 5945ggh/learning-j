# RF-01：打开真实 EPUB 的首个阅读切片 — 远端只读行动建议

状态：2026-09-14，只读咨询产物；不是主线实现完成声明，也不修改远端仓库或本地工作树。

## 结论先行

建议把 RF-01 实施为一条很窄的 reader-first 纵向路径：

> 素材库导入一个受支持的无 DRM、文字为主、可重排 EPUB → 后端保存/引用不可变原始资源并生成受控 publication view → `/reader/:materialId` 打开真实章节正文 → 显示图片和 ruby → 按 spine 顺序切换章节 → 作者脚本和自动外网加载不可执行/不可发起 → 导入或打开失败有明确反馈。

这条路径应复用现有 `Material`、`Sentence` 规范文本投影、reader route/chrome、素材库入口和现有测试资产；但**不能继续把 Sentence/token UI 当作 EPUB 正文**。

实施前先做一次独立、很小的契约对齐。原因不是要重写模型，而是远端当前契约仍明确写着：

- `Sentence.text` 同时承担模型输入、surface 定位和“前端展示共用的规范文本”；
- EPUB 是“抽成纯文本再分句”；
- 上层统一抽象写成“素材 = 有序 Sentence 序列 + locator”。

这些文字与 RF-01 已接受的“受控 XHTML 阅读内容 + 独立规范文本投影 + 显式映射”存在直接冲突。按远端 `AGENTS.md` 的 authority/conflict 规则，不应在实现中静默绕过。

本切片**不需要引入 epub.js / foliate / Readium 或新的前端包**。如果实现过程中发现必须增加 sanitizer/parser 依赖，再单独请求授权；默认路线可以先用后端“解析后重建 allowlist XHTML”的方式，而不是在浏览器执行/净化原始 publication XHTML。

---

## 1. 调查基线

### 仓库与 ref

- 仓库：`https://github.com/5945ggh/learning-j`
- 调查 ref：`develop`
- 读取日期：2026-09-14
- GitHub 页面在本次环境中显示 `develop`、44 commits，并可读取该分支的源码与核心文档。

### commit SHA：本次未能可靠取得

RF-01 要求记录实际读取的完整 SHA。本次环境能读取 `develop` 的 GitHub/raw 内容，但 GitHub 的 commit/branch API、commit history 与 tree 页面在该会话中反复返回 cache miss / robots 限制，仓库页本身也没有把 Latest commit SHA 渲染到可读取文本中。因此：

- **不能把附件中的规划 SHA `817a73da60676e1631229eebdb867f070b4ed043` 冒充为本次已验证 SHA。**
- 本报告所有代码事实都以“2026-09-14 实际读取的 `develop` 内容”为基线，但不是固定提交链接。
- 本地 agent 开始实施前应补一条基线记录，例如：
  - `git rev-parse origin/develop`
  - 或 `git ls-remote <remote> refs/heads/develop`
  然后把本报告中的 branch links 固定为该 SHA。
- 如果本地 SHA 与本报告读取内容已经发生变化，应重新核对本文点名的少量符号，而不是重做全库调查。

这是一项**基线记录缺口**，不是建议结论通过的伪装。

### 当前附件

主任务依据：`RF-01-readable-epub.md`。

附件已经确定：
- reader-first 纵向交付；
- 第一项只做到真实 EPUB 可打开、正文/图片/ruby/章节顺序和受控资源加载；
- 第一轮不保存真实批注；
- Annotation 精确输入、完整查词、返回位置、重启恢复、分页和全 EPUB2/3 兼容延后；
- 新增依赖需要明确授权。

### 远端可读 / 不可读项

已读取：
- `AGENTS.md`
- `docs/LearningJ-plan-v5.md` §§0–5、14、15
- `docs/data-model.md` §§0、8
- `DESIGN.md` reader / selection / accessibility 相关段落
- `backend/src/learningj/ingest/service.py`
- `backend/tests/test_ingest.py`
- `frontend/src/screens/ReaderScreen.tsx`
- `frontend/src/shells/MaterialWorkspace.tsx`
- `frontend/src/app/AppRouter.tsx`
- `frontend/package.json`

本次远端读取未能取得：
- `docs/reader-foundation/README.md`
- `docs/reader-foundation/testing-standard.md` / `docs/testing-standard.md`
- `epub_research_result/learningj-epub-research-report.md`

RF-01 已说明这些内容可能只在本地未跟踪工作树中存在，所以本报告不根据摘要虚构其中细节。

另一个本地必须核对的差异：RF-01 候选契约写入提到 `LearningJ-plan-v5.md §15.24`，但本次远端读取的 `develop` §15 只到 23。不要把远端文档直接覆盖本地可能已经新增的 §15.24。

---

## 2. 当前实现证据

以下先列**实际读取事实**，再列由它们推导出的实施含义。

### 2.1 后端 EPUB 现在只是语言投影，不是 publication reader

文件：`backend/src/learningj/ingest/service.py`

实际事实：

- `_epub_sentences(blob)` 打开 ZIP、读取 `META-INF/container.xml` 和 OPF，建立 `manifest id -> href`，按 spine 顺序读取 XHTML。
- XHTML 进入 `_TextExtractor` 后转为文本：
  - `rt/rp/script/style/nav/head` 被跳过；
  - block 元素变成换行；
  - `img/image/br` 在现有语言投影里只贡献换行；
  - ruby 的 base text 保留，reading 作为 `ruby_hints`。
- 每个 Sentence 的 EPUB anchor 已是：
  `spine_index + canonical spine text 的 code-point [char_start, char_end)`。
- 规范化是在整段 raw spine text 拼接后做 NFC，而不是对每个 DOM text node 各自 NFC。

这说明当前管线已经有一项很有价值的资产：**稳定的 canonical spine text 坐标系**。应该保留它作为语言处理坐标，而不是把它继续当作唯一阅读呈现。

同时，远端实现没有提供本切片需要的 publication 结构：
- manifest 没有保留 media type / nav / properties；
- 没有图片资源服务；
- 没有受控 XHTML 输出；
- 没有章节 manifest API；
- 没有浏览器侧真实 publication surface。

### 2.2 当前导入被整书 Sudachi 分词串行阻塞

同文件 `import_material()` 当前顺序是：

1. `parse_source`
2. 建 `Material`
3. 建全部 `Sentence`
4. `_tokenize(sentence_rows)`
5. 建 `Sidecar`
6. 建/校验 `MaterialLexemeCount`
7. `_publish_generation`
8. commit

因此 EPUB 导入成功返回前，整书所有 Sentence 都已走 Sudachi。

`data-model §8.1` 同时明确：`current_sidecar_id` “准备前可空”。前端 `MaterialWorkspace` 也已经把 `current_sidecar_id === null` 当作 content index `absent`，而不是材料不可打开。

**推导：** reader-ready 和 sidecar-ready 可以合法分开，不需要为了 RF-01 先设计完整后台任务系统。

### 2.3 Sidecar 的原子发布边界值得原样保留

`_publish_generation()` 的现有保护很好：新 Sidecar、MaterialLexemeCount 与 `current_sidecar_id` 切换在完整生成和校验后再发布。RF-01 不应削弱这一点。

要改变的是“Material 必须和第一个 Sidecar 同一导入事务才算可读”的隐含行为，不是 Sidecar 自身的代次原子性。

### 2.4 前端已有 reader route/chrome，但正文仍是旧 P2 Sentence reader

实际事实：

- `AppRouter.tsx` 已有独立全屏路由 `/reader/:materialId`。
- `ReaderScreen.tsx` 已有 reader chrome / sidebar；目录处明确写着“章节接口待接入”，并说明当前 API 只有有序 Sentence。
- `ReaderScreen` 正文仍复用 `MaterialWorkspace`。
- `MaterialWorkspace` 的 reader area 显示一条 `TokenizedSentence` + `SentenceContext`，不是 EPUB publication。
- `MaterialWorkspace` 已具备素材列表、Sentence 加载、token 查词、内容索引状态等旧资产；这些不必删除，但不应继续承担 EPUB 正文身份。

**推导：** 最小前端改动是“在现有 ReaderScreen 中换正文 adapter”，不是重做路由、shell 或整个 materials UI。

### 2.5 远端契约与 RF-01 的确存在必须先对齐的冲突

`docs/data-model.md §0` 当前说：
- `Sentence.text` 是模型输入、surface 定位和前端展示共用规范文本；
- persisted offsets 是 Unicode code points；DOM UTF-16 只能在渲染 adapter 转换。

`§8.2` 当前说：
- EPUB anchor 是 `spine_index + 从 spine 抽出的规范化纯文本 offset`；
- 不使用 CFI，因为“本产品对 EPUB 的处理本就是抽成纯文本再分句”；
- “素材 = 有序 Sentence 序列 + locator”。

前半部分的 code-point 坐标可以继续保留；后半部分“纯文本就是阅读内容”的含义必须收窄到**语言处理投影**。

`DESIGN.md` 反而已经给新路线留出了位置：
- reader chrome 独立，正文是视觉主体；
- controlled reading surface 可以拥有 selection/context menu；
- DOM 与 persisted offset 之间应经过 reader adapter；
- 本地阅读应离线可用。

---

## 3. 推荐的最小实现边界

### 3.1 先做一个很小的契约对齐 pass

只改 RF-01 已授权候选范围，不扩展 Annotation / AI / SRS。

#### `docs/data-model.md §0`

建议文本方向：

- 把“`Sentence.text` 是前端展示共用规范文本”改为：
  - `Sentence.text` 是语言处理、surface 校验与持久位置的 canonical text projection；
  - 对具有结构化阅读内容的材料，reader 可以显示独立的受控 publication representation；
  - publication DOM 不是领域坐标；
  - DOM UTF-16 boundary 到 canonical code-point boundary 的转换只属于 reader adapter。

不要改变现有：
- NFC；
- LF；
- Unicode code-point 半开区间；
- 不做全/半角折叠；
- backend 派生 numeric offsets。

#### `docs/data-model.md §8.1 Material`

建议明确：

- 原始 EPUB、受控 reader representation、canonical text projection、Sidecar 是不同层；
- managed copy 的原始资源不可变；
- `current_sidecar_id == null` 只表示当前语言索引尚未发布，**不表示 publication 不可阅读**；
- reader-ready 与 sidecar-ready 可以分两个提交点；
- Sidecar 自身仍按现有“完整生成后原子发布”规则。

如果本地实现确实需要新增“publication/projection version”持久字段，先由主代理根据本地 schema 决定最小字段；本咨询不把示例字段名冒充已经批准的 schema。

#### `docs/data-model.md §8.2 Sentence / EPUB anchor`

保留：
`{spine_index, char_start, char_end}`。

但把含义改为：
- offset 相对**该 spine 的 canonical text projection**；
- 这不是说 reader 只渲染纯文本；
- CFI 不作为 LearningJ 持久领域身份；
- controlled XHTML/DOM 通过可版本化、可测试的 mapping adapter 映射到这套坐标。

把“素材统一抽象 = 有序 Sentence 序列”收窄为：
- 语言处理 / 学习上层统一消费有序 Sentence；
- 具体阅读呈现可以有 source-specific representation；
- 上层 AI/SRS 仍不得依赖 DOM。

#### `DESIGN.md`

建议只补一个 reader-body 落点：

- EPUB 的正文 surface 是受控 publication surface；
- Sentence/token 组件是语言工具层，不再等同于正文；
- reader chrome、rail、panel slots 保持现有设计；
- 本切片暂不承诺 selection persistence，但实现不得把 publication DOM offset 持久化为用户身份。

#### `LearningJ-plan-v5.md §15.24`

远端没有该条。只在本地确认它确实存在后按 RF-01 的已接受 reader-first 决策落点更新；不要凭远端 §15.23 后自行发明新编号再覆盖本地内容。

---

### 3.2 后端：新增“publication compiler”，不要让浏览器读原始 EPUB XHTML

建议把现有 `_epub_sentences` 中“解析 container/OPF/spine”的职责抽成共享的 EPUB package parser，然后让两个消费者复用同一 package：

1. canonical text projection
2. controlled reader representation

第一版不需要通用 EPUB engine。

#### parser 必须产出的最小信息

- package metadata：至少 title；
- spine 顺序；
- 每个 spine 的源 XHTML member；
- manifest-declared image resources；
- 可选 nav label（如果简单可得）；没有 nav label 时按 spine 顺序显示“章节 N”即可；
- normalized internal href resolution；
- source/package identity，用于错误诊断和 projection version。

首切片不必支持：
- 固定版式；
- media overlays；
- 作者脚本；
- publication JS；
- 作者字体；
- 全 EPUB2/3 corner cases；
- 复杂 CSS fidelity。

### 3.3 受控 XHTML：解析原文后重新生成 allowlist，而不是“清理后原样透传”

默认建议：

- 允许语义：
  - `p`, `div`, headings, `br`
  - `span`, `em`, `strong`
  - `ruby`, `rb`, `rt`, `rp`
  - 基本 list / blockquote
  - `img`
  - 内部 `a`/fragment
- 所有 `script`、事件属性、form、iframe、object/embed、外部资源、作者脚本全部丢弃或显式拒绝。
- 第一切片**不加载作者 CSS 和字体**；LearningJ 注入自己的 reader stylesheet。
- SVG 暂不作为直接浏览器资源放行；若目标书依赖 SVG，明确报 unsupported/placeholder，后续再单独设计 SVG sanitization。
- 外部链接不自动导航；可以显示为受控的不可自动加载链接或在后续提供“在系统浏览器打开”用户动作。
- publication 内部链接只映射到已解析的 spine/fragment，不接受任意 URL。

这样做牺牲一部分出版物样式 fidelity，但非常符合 RF-01 的目标：先让文字型 reflowable EPUB 安全地读起来，并保留 ruby/图片。

### 3.4 资源服务：不要把 ZIP member path 直接暴露成文件服务器参数

建议 API 形状（名字是实现提案，不是正式字段契约）：

```text
GET /materials/{material_id}/publication
  -> title, publication_version, projection_version,
     ordered spine items, optional labels

GET /materials/{material_id}/publication/spine/{spine_index}
  -> text/html; charset=utf-8
     controlled XHTML + response CSP

GET /materials/{material_id}/publication/resources/{opaque_resource_id}
  -> manifest-declared local image only
```

`opaque_resource_id` 在后端映射到经过校验的 manifest member；客户端不传任意 ZIP path。

必须在首轮真实 HTTP 加载前建立：

- ZIP member 统一 POSIX normalize；
- 拒绝绝对路径、`..` 越界、NUL、异常分隔符和非 manifest 资源；
- 只允许资源解析停留在 publication 根；
- 限制 entry count、单 entry inflated size 和总 inflated size，防止 zip bomb；
- 不解析外部 XML entity / DOCTYPE；
- 对损坏 container/OPF/spine 给可诊断 4xx；
- 不把 arbitrary local filesystem path 拼到 HTTP route；
- 对加密/DRM content document 给明确 unsupported，而不是乱码降级；
- browser 只拿已允许的 media type。

### 3.5 浏览器隔离：真实 HTTP + same-origin reader surface + 双重 fail-closed

W3C EPUB 3 / Reading Systems 的安全章节明确指出 sideloaded publication、脚本、remote resources、XML/ZIP 都必须当作不可信输入处理。

推荐 iframe：

```html
<iframe sandbox="allow-same-origin" ... />
```

**不要**给 `allow-scripts`、forms、popups、top-navigation 或 downloads。

为什么保留 `allow-same-origin`：
- 后续 selection → canonical mapping 需要父 reader adapter 能读 iframe DOM；
- `allow-scripts` 不启用时，publication 自身仍不能执行脚本；
- MDN 明确说明 same-origin parent 可在没有 `allow-scripts` 时访问 iframe DOM。

但要满足一个前提：publication chapter 在浏览器看来必须与 reader app **同源**。如果本地 dev 现在是 Vite 和 FastAPI 两个不同 origin，应走现有反向代理/同源 API mount；不要用 CORS 假装解决未来 DOM mapping。

建议 chapter response 同时带 fail-closed CSP，例如：

```text
Content-Security-Policy:
  default-src 'none';
  img-src 'self';
  style-src 'unsafe-inline';
  script-src 'none';
  connect-src 'none';
  font-src 'none';
  media-src 'none';
  object-src 'none';
  frame-src 'none';
  form-action 'none';
  base-uri 'none';
  sandbox allow-same-origin
```

若实际部署拓扑不能做到同源，**这是本地核对项**；不要在 RF-01 为了赶 UI 而把未来 mapping 绑定到 cross-origin iframe。

### 3.6 canonical projection：本轮必须固定关系，但不必开放 Annotation API

不要在 renderer 和 `_epub_sentences` 各写一套文本规则。

建议一个共享编译结果：

```text
compile_spine(source_xhtml)
  -> controlled_xhtml
  -> canonical_text
  -> ephemeral run mapping
```

核心规则至少固定为：

- canonical text 先按源顺序构造，再对**整个 spine**做 NFC；
- ruby：base text 进入 canonical text；`rt/rp` 不进入；
- 隐藏/脚本/样式内容不进入；
- block / `<br>` / 当前图片换行规则与现有 canonical projection 保持兼容，除非契约明确批准变化；
- persisted coordinate 仍是 Unicode code point；
- browser DOM boundary 是 UTF-16，只在 adapter 转；
- 同样 surface 多次出现时身份来自 canonical offset，不来自 `surface.find()`；
- 跨节点 NFC 组合不能通过“每个 text node 各自 NFC”实现。

本轮不保存真实 Annotation，所以：
- 不需要现在定 Annotation request schema；
- 不需要把 run mapping 存进 Annotation；
- 但测试必须证明 controlled DOM 可以重建同一 canonical spine text，且未来 mapping 不需要推翻 reader representation。

建议给编译算法一个明确 `projection_version` 常量。真实 Annotation 开始前，再决定它落哪一个正式持久字段/版本边界。

---

## 4. 整书分词：建议本轮做“最小解耦”，不做完整异步化

### 为什么现在就解耦

如果保留现状，用户导入一本大 EPUB 时必须等待：
- 全书纯文本抽取；
- 全书 Sentence；
- 全书 Sudachi；
- Sidecar；
- 全书 MaterialLexemeCount；
- commit

之后前端才收到成功。

这直接把 RF-01 的第一体验“导入 → 打开书”绑定到本轮并不使用的完整 token index。

### 最小方案

把现有逻辑拆成两个明确步骤：

#### A. reader-ready import

同一条用户导入动作内：

1. 验证 EPUB/安全边界；
2. 保存 immutable managed copy 或本地已经存在的等价受控资源；
3. 生成 publication manifest；
4. 生成 canonical Sentence projection；
5. commit `Material + Sentence + reader publication identity`；
6. `current_sidecar_id = null` 合法；
7. API 返回 material 可打开。

#### B. sidecar prepare

保留现有：
- `_tokenize`
- Sidecar immutable generation
- `_publish_generation`
- MaterialLexemeCount 原子校验与 pointer switch

RF-01 可以**不自动触发 B**。完整查词本来就在下一切片；下一切片可以决定：
- 显式 prepare endpoint；
- 按章准备；
- 进程内 background task；
- 或其他本地任务机制。

不要为了这一步先引入 Celery/Redis/通用 job framework。

### 兼容现有非 EPUB 导入

不要强迫 TXT/subtitle 同时迁移。

可把后端内部函数重构成：
- `persist_material_projection(...)`
- `prepare_sidecar(...)`

然后：
- 现有老入口暂时仍可同步调用两者；
- 新 EPUB reader-first path 只调用 reader-ready 部分；
- 等后续查词切片再统一导入体验。

### 需要在契约中点名的事务变化

现行 §8.3 的“Sidecar 完整后原子发布”保持不变。

新增/澄清的是：
- Material/Sentence publication 可以先提交；
- `current_sidecar_id` 可空是正常 reader-ready 状态；
- sidecar failure 不回滚已经验证并保存的 reader publication；
- 不能把“无 Sidecar”显示成“书导入失败”。

---

## 5. 前端实施建议

### 复用

继续用：
- `/reader/:materialId`
- `ReaderScreen` chrome / toolbar / rail
- library/material navigation
-现有错误状态和通用 UI primitive

### 新增很小的 reader adapter

建议在本地既有目录组织上新增类似：

```text
features/reader/
  EpubPublication.tsx
  EpubChapterFrame.tsx
  publication-repository.ts
```

不要为了 RF-01 先移动整个 frontend。

职责：

- load publication manifest；
- 当前 `spine_index`；
- chapter prev/next；
- iframe `src` 指向真实本地受控 HTTP endpoint；
- loading / unsupported / corrupt 状态；
- iframe load error；
- 后续 selection adapter 的挂载位置。

### ReaderScreen 的正文切换

当 `material.kind === epub`：
- 不再让 `MaterialWorkspace` 的 TokenizedSentence 作为正文；
- render `EpubPublication`；
- 旧 token/lookup UI 暂时可以隐藏或显示明确“本切片未接入”的 disabled 状态。

非 EPUB 旧路径不要顺手重构。

### 第一版章节 UI

只要求：
- spine 顺序 previous / next；
- 显示当前章节 label；
- nav 文档能安全解析时可提供简单目录；
- nav 不可解析时仍能按 spine 顺序阅读。

不要让“完整 EPUB TOC 兼容”阻塞 RF-01。

---

## 6. 明确不做

RF-01 达到用户动作后停止。不要顺手加入：

- Annotation write / migration；
- surface 重复匹配的新请求契约；
- 批注重启恢复；
- return position；
- display settings persistence；
- 分页；
- vertical writing 完整产品支持；
- EPUB2 全覆盖；
- publication JS；
- 作者 CSS/font fidelity；
- 完整查词适配；
- AI/SRS；
- 整仓 feature 重构；
- 第三方 EPUB engine；
- 通用 async job infrastructure；
- 数据库自动清空或旧用户数据迁移。

---

## 7. 验收建议

### 7.1 本次咨询实际运行了什么

**没有运行主项目测试、没有启动主项目、没有使用真实 EPUB 做本轮验收。**

本次是远端只读代码/契约调查；GitHub 源码和规范页面可读，但没有可写 checkout。不要把之前 synthetic spike 的 PASS 当成 RF-01 主项目 PASS。

### 7.2 后端目标测试

保留现有 `backend/tests/test_ingest.py::test_epub_spine_is_adapted_to_epub_anchors`，因为它保护 canonical projection、non-BMP code-point 和 ruby hints。

新增少量 RF-01 tests：

1. **package / spine**
   - 两章 EPUB；
   - spine 顺序正确；
   - title；
   - ruby；
   - image manifest；
   - corrupt OPF/缺 spine 明确失败。

2. **projection compatibility**
   - controlled XHTML 重新投影出的 canonical text == canonical spine projection；
   - `𠮟` 等非 BMP code point；
   - 跨 inline node 的组合字符；
   - ruby reading 不进入 canonical base text；
   - 重复 surface 有不同 absolute canonical offset。

3. **resource confinement**
   - `../`、absolute member、异常路径拒绝；
   - 非 manifest resource 拒绝；
   - remote `http/https` img/font/CSS 不被浏览器 endpoint 暴露；
   - script/event handler/form/iframe 不出现在 controlled XHTML；
   - SVG 暂不放行；
   - zip bomb/oversized entry 按阈值拒绝；
   - XML external entity/DOCTYPE 拒绝；
   - encrypted content document 清楚报 unsupported。

4. **reader-ready without sidecar**
   - EPUB reader-ready import 后 Material/Sentence 可读；
   - `current_sidecar_id is null`；
   - chapter endpoints 可读；
   - 后续执行 sidecar prepare 后，仍走现有 immutable/atomic publish；
   - prepare failure 不损坏已存在 reader publication。

建议命令（**未运行**，本地按实际 test 文件名调整）：

```bash
cd backend
pytest tests/test_ingest.py -q
pytest tests/test_epub_publication.py -q
```

如果本地项目有统一 runner/uv 命令，以本地 `pyproject` / testing-standard 为准，不要因为本文示例改工具链。

### 7.3 前端目标测试

建议覆盖：

- `/reader/:materialId` 对 epub 进入 publication reader；
- loading/error/unsupported；
- previous/next spine；
- iframe URL 来自 repository adapter；
- sandbox 不含 `allow-scripts`；
- sidecar absent 不把 publication 标成失败；
- non-EPUB 旧 reader 路径不被无关破坏。

远端 `frontend/package.json` 已确认：

```bash
cd frontend
pnpm test
pnpm build
```

RF-01 按影响选择少量文件即可，不要求每次跑全部 demo/无关 future screens。若 OpenAPI/generated types 改动，`pnpm test` 的 pretest 已会先跑 `types:check`。

### 7.4 必须做一次真实浏览器动作验收

这才是 RF-01 的停止门槛：

1. 从素材库入口选择一个授权的真实、无 DRM、文字型 reflowable EPUB；
2. 导入成功后直接打开 reader；
3. 至少前后切换 3 个 spine item；
4. 确认正文、ruby、1 张以上内嵌图片；
5. 浏览器 DevTools Network 确认没有 publication 自动外网请求；
6. 用含 `<script>` / remote image / event handler 的受控恶意样本，确认：
   - script 没执行；
   - remote request 没发出；
   - reader/app DOM 未被导航或覆盖；
7. corrupt EPUB 得到明确 UI 错误，不出现半导入“成功”；
8. 截 2–3 张代表截图：
   - library → book open
   -正文 + ruby + image
   -第二章节/错误状态
9. 记录启动命令和实际浏览器/OS；
10. 明确写下“Annotation / return-position / restart recovery 尚未验收”。

### 7.5 HTTP/iframe 专项验收

因为此前 research 只验证过 synthetic/srcdoc，本切片必须新增：

- iframe 使用真实 local HTTP `src`；
- response CSP 实际在浏览器 Network/Headers 可见；
- `sandbox` 实际生效；
- publication image 从受控 endpoint 加载；
- remote URL 不发请求；
- parent reader adapter 在计划的 same-origin topology 下能读取 iframe DOM；
- 如果 same-origin 不成立，RF-01 在此处停止并修 topology，不继续堆 selection 逻辑。

---

## 8. 本地开始前必须核对的项目

这些不是用户重新决策，而是 local agent 应先查工作树：

1. **实际 HEAD / origin develop SHA**
   - 补齐本报告未能取得的固定基线。

2. **当前未提交修改归属**
   - 素材导入 UI；
   - materials client 及测试；
   - `AGENTS.md`；
   - `demo/`、`experiments/`、reader-foundation。
   不回滚、不覆盖、不代提交。

3. **本地 reader-foundation 文档**
   - `README.md`
   - `testing-standard.md`
   - EPUB research result
   若存在，以其中真实内容补充验收，不从本文反推。

4. **真实素材存储实现**
   - 远端 `ingest/service.py` 只看到 `storage_mode/copy_stored/locator` 的 DB 语义，没有在该文件里看到 managed-copy bytes 落盘。
   - 本地若已有资源 storage/service，优先复用；不要另建第二套。
   - 若没有，RF-01 必须补一个最小 immutable managed-copy store，因为浏览器上传的 EPUB 不能靠未来仍然存在的用户本地路径读取。

5. **Vite/FastAPI 实际 origin topology**
   - 确认是否已有 `/api` proxy / 同源 mount。
   - publication iframe 必须为未来 DOM mapping 留出 same-origin 路径。

6. **本地 §15.24**
   - 远端当前 plan 没有 §15.24；避免覆盖本地新内容。

7. **当前 import API 语义**
   - 如果本地导入 UI 已假定“POST 成功 == Sidecar ready”，需同步改成 reader-ready 状态，而不是前端继续等 token index。

---

## 9. 真正需要用户决定的问题

**本切片目前没有新的产品决策需要交给用户。**

下面都属于普通实施取舍，local agent 应按现有范围处理：
- API endpoint 名称；
- publication manifest 的内部类型名；
- safe element allowlist 的代码组织；
- storage 目录名；
- reader component 文件拆分；
- test file 名称。

新增第三方依赖时才需要回到用户授权。

### 非阻塞但很有价值的用户输入

要把 RF-01 从“技术路径正确”推进到“真实书已验证”，最有价值的是一本文字为主、无 DRM、允许本地测试的代表 EPUB，最好包含：
- ruby；
- 至少一张图片；
- 多章；
- 一个内部链接或脚注更好。

它**不是本咨询建议的前置条件**。没有这本书也可以先实现并用自建样本做技术测试，但交付时必须写“目标书体验未验证”。

---

## 10. 建议的实际实施顺序

1. **local preflight**
   - 保存 worktree 状态；
   -补实际 SHA；
   -识别本地未提交 UI / docs / experiments；
   -确认 managed-copy 与 dev proxy。

2. **独立契约对齐**
   - `data-model §0, §8`
   - `DESIGN reader body`
   - 本地已有的 plan §15.24（仅存在时）
   - 不改 Annotation schema。

3. **backend package/compiler**
   - 安全解析 EPUB；
   - publication manifest；
   - controlled XHTML；
   - resource confinement；
   - shared canonical projection；
   - projection version。

4. **reader-ready import**
   - managed immutable source；
   - Material + Sentence；
   - `current_sidecar_id = null` 可读；
   - 不同步整书 Sudachi。

5. **real HTTP reader endpoints**
   - chapter XHTML；
   - image resources；
   - CSP；
   - sandbox/same-origin topology。

6. **frontend vertical path**
   - library import/open；
   - `ReaderScreen` publication body；
   - prev/next；
   - loading/error；
   -截图。

7. **targeted tests + real book**
   - unit/security；
   -前端；
   -真实浏览器；
   -一本文字型 EPUB。

8. **停止**
   - 用户能导入、打开、阅读正文/图片/ruby、按顺序换章；
   -安全边界实测成立；
   -失败明确；
   -交付启动方式和截图。
   - 不继续批注/查词/返回位置。

---

## 11. 关键远端来源

以下链接均是本次读取的 `develop` branch 链接；因为本环境未能取得 HEAD SHA，它们**不是 immutable permalink**。本地补 SHA 后建议固定。

- `AGENTS.md`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/AGENTS.md
- `docs/LearningJ-plan-v5.md`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/docs/LearningJ-plan-v5.md
- `docs/data-model.md`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/docs/data-model.md
- `DESIGN.md`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/DESIGN.md
- `backend/src/learningj/ingest/service.py`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/backend/src/learningj/ingest/service.py
- `backend/tests/test_ingest.py`
  - https://github.com/5945ggh/learning-j/blob/develop/backend/tests/test_ingest.py
- `frontend/src/screens/ReaderScreen.tsx`
  - https://github.com/5945ggh/learning-j/blob/develop/frontend/src/screens/ReaderScreen.tsx
- `frontend/src/shells/MaterialWorkspace.tsx`
  - https://github.com/5945ggh/learning-j/blob/develop/frontend/src/shells/MaterialWorkspace.tsx
- `frontend/src/app/AppRouter.tsx`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/frontend/src/app/AppRouter.tsx
- `frontend/package.json`
  - https://raw.githubusercontent.com/5945ggh/learning-j/develop/frontend/package.json

外部安全依据：
- W3C EPUB 3.3:
  - https://www.w3.org/TR/epub-33/
- W3C EPUB Reading Systems 3.3:
  - https://www.w3.org/TR/epub-rs-33/
- MDN `<iframe>` sandbox:
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- MDN CSP `sandbox`:
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
