# “引用此文档”反向链接面板 - 产品需求文档

## Overview
- **Summary**: 在文档编辑页增加“引用此文档”（backlinks）面板：登录且可阅读当前文档的用户，可以看到哪些文档的哪些块通过编辑器文档链接（`interlinkingLinkInline` 互链）引用了当前文档，展示来源文档标题与引用块摘要，点击可跳转到来源文档中的具体来源块。
- **Purpose**: 目前一篇被多处引用的文档无法从文档内部反查引用来源；修改被引用文档时，作者无法评估影响范围、无法回到引用上下文。
- **Target Users**: La Suite Docs 的登录用户（文档阅读者即可见，不需要编辑权限）。

## Goals
- 从文档内一键查看所有引用当前文档的来源块。
- 引用索引覆盖编辑器内的文档链接（含指向具体块的链接），包括嵌套块、表格等任意层级；同一来源块重复引用只出现一次。
- 存量文档无需重新编辑即可被收录（提供回填手段）。
- 来源可见性严格遵循成员权限与回收站状态，不泄露标题、摘要与数量。
- 列表随引用的增删、来源改名、来源删除/权限变更/恢复保持一致。
- 不依赖全文搜索服务（`SEARCH_INDEXER_CLASS` 未配置时完全可用）。
- 保留现有的正向链接跳转体验（互链 chip 跳转到目标文档/块）。

## Non-Goals
- 不做实时推送（服务端无浏览器推送通道），面板打开期间用定时轮询 + 聚焦/打开时刷新获得最终一致性。
- 不收录评论文本（thread/comment）中的引用，不收录 `@` 提及用户的邮件通知体系（Mention），仅指编辑器正文的互链节点。
- 不把“凭公开/登录链接可达（link reach）”作为来源可见性依据；仅承认直接或继承的成员权限（DocumentAccess）。
- 不修改 yhub-server（TypeScript 协作服务器）：后端通过其既有的 `GET ydoc` REST 路由读取内容，与现有搜索索引读取内容的方式一致。
- 不改动互链的正向跳转、导出（PDF/DOCX/ODT/HTML）行为。
- 不做来源侧的“我引用了哪些文档”正向出链列表面板。

## Background & Context

### 编辑器互链的数据形态
- 互链是 BlockNote 自定义 inline content：类型名 `interlinkingLinkInline`，props 为 `docId`（目标文档 UUID）、`blockId`（目标块 id，可空）、`disabled`、`trigger`（`/` 或 `@`）。定义见
  [InterlinkingLinkInlineContent.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/docs/doc-editor/components/custom-inline-content/Interlinking/InterlinkingLinkInlineContent.tsx)。
- 文档正文是 Yjs 文档，根为 `document-store` XmlFragment，BlockNote 0.54 经 y-prosemirror 序列化：`blockGroup > blockContainer[id,type] > (paragraph|heading|bulletListItem|table…)`，正文富文本为 XmlText，**非文本的内联原子节点（互链）是内容元素下与 XmlText 并列的 `Y.XmlElement`，标签名即 ProseMirror 节点名 `interlinkingLinkInline`，属性即 props**。因此普通网址链接（文本上的 link mark）不会产生该标签，天然被排除。嵌套块、表格单元格中的块都是递归嵌套的 `blockContainer`，一次递归遍历即可覆盖。
- 后端已有同款解析路径：[yjs.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/utils/yjs.py) 用 pycrdt 取出 XML，BeautifulSoup(`lxml-xml`) 提取文本；搜索索引器 [search_indexers.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/services/search_indexers.py) 通过 `YHubService().get_ydoc(document)` 读取内容。

### 内容更新链路
- yhub worker 每次压缩发现新内容后回调后端 `POST /api/v1.0/documents/{id}/content-updated/`（协作服务器 JWT 鉴权），见 [viewsets.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/api/viewsets.py#L915-L953)。该回调当前仅刷新 `updated_at` 并（在配置了索引器时）触发搜索索引任务；这是“已保存引用增删”最自然的索引触发点，且与搜索配置解耦。
- 复制文档（`duplicate`）、从文件创建、带子文件创建、create-for-owner 直接调用 `YHubService.create_ydoc` 写入内容，不经过 worker 的 content-updated，需要显式触发一次索引。
- 存量文档通过管理命令回填（与 `manage.py index` 相互独立）。

### 权限与删除
- 成员权限事实源是后端：`DocumentAccess`（user 或 team）挂在文档或祖先文档上（物化路径 `Document.path`，`get_self_and_ancestors_paths()`）。
- 软删除：`deleted_at` / `ancestors_deleted_at`；恢复走回收站恢复。硬删除时 Django 行被删除，FK 级联。
- 软删除期间 yhub 房间保留；恢复后内容与历史都在。索引行在软删除期间保留、读取时过滤，恢复即重新出现，无需重新编辑。

### 前端
- 右侧面板已有视图机制：[useRightPanelStore.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/right-panel/stores/useRightPanelStore.tsx)（`RightPanelView = 'tableContent' | 'comments'`）与 [RightPanel.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/right-panel/components/RightPanel.tsx)，按钮聚合在浮动栏的 `RightPanelCollapseButton`。新增一个 `backlinks` 视图即可。
- 跳转：正向互链使用 `/docs/{docId}/#{blockId}`，[useScrollToBlockAnchor.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/docs/doc-editor/hook/useScrollToBlockAnchor.tsx) 已负责按 hash 滚动到块；面板点击复用同样的 URL 形态。
- 服务端状态用 TanStack React Query（如 useDoc），UI 用 Mantine/Cunningham，文案在 src/i18n/translations.json（英文 key 即英文文案）。

## Functional Requirements

- **FR-1 引用提取**：后端能从一篇文档的 Yjs 当前状态中提取全部互链引用：每条为（来源文档、来源块 id=最近祖先 blockContainer 的 id、目标文档 id=docId、目标块 id=blockId、引用块纯文本摘要）。
  - 仅收录 `docId` 为合法 UUID、非空且 `disabled != true` 的 `interlinkingLinkInline` 节点。
  - 排除来源文档指向自身的链接（docId == 来源 id），即使带 blockId。
  - 普通网址超链接（link mark）、空 docId 的搜索态节点、非法 docId、disabled 节点不收录。
  - 任意深度嵌套块、表格单元格、多栏等位置均收录。
  - 同一（来源块，目标文档）只保留一条（blockId 取其一，摘要取该块文本）。
  - 目标文档在 Document 表中不存在时不建索引行。
- **FR-2 索引存储**：新表 `impress_document_link` 保存出向引用，含唯一约束（source, target, source_block_id）与 target 索引；摘要为截断后的块纯文本（≤200 字符）。
- **FR-3 全量重建语义**：对某来源文档重建索引 = 用当前 Yjs 内容计算出的集合整体替换其全部出向行（事务内删除后重建），从而正确反映引用的增与删。
  - 读取 yhub 失败（YHubError）时保留旧行、只记录日志，不把失败写成“空集合”。
- **FR-4 触发时机**：
  - content-updated 回调无条件调度重建任务（与 `SEARCH_INDEXER_CLASS` 是否配置无关），随 yhub 压缩节奏（默认 10s 防抖）反映已保存增删。
  - duplicate / 从文件创建 / 带子文件创建 / create-for-owner / 入职沙箱复制等“直接 create_ydoc”路径在提交后调度一次重建。
  - 提供管理命令对全部（或指定）文档回填，存量文档无需编辑即可被找到。
- **FR-5 查询 API**：`GET /api/v1.0/documents/{id}/backlinks/`，登录且对当前文档有 retrieve 能力可用；返回按来源文档分组的可见来源（id、当前标题、该来源下可见条目列表：source_block_id、target_block_id、excerpt），排序稳定（最近被引用的来源在前，其次标题/id），结果组数量设上限（100 组）。
- **FR-6 来源可见性**：来源行仅当满足全部条件时返回：
  1. 来源文档 `deleted_at` 与 `ancestors_deleted_at` 均为空（未进回收站，含祖先被删）；
  2. 请求用户在来源文档本身或其任一祖先文档上存在 DocumentAccess（user=本人或 team∈user.teams）——即直接或继承的成员权限；
  仅凭 public/authenticated link reach、LinkTrace 访问过的文档不算可见。
- **FR-7 防泄露**：响应中不出现任何不可见来源的标题、摘要、id、数量；`count`/徽标数字仅统计可见来源组；接口对无权读取当前文档者与不存在文档统一表现（沿用 get_object 的 404 行为），不提供可区分“存在但无权”的侧信道。
- **FR-8 动态一致性**：标题在查询时关联 Document 实时获取（改名立即生效）；成员权限、回收站状态查询时判定（失去权限/进回收站立即消失，恢复后无需编辑重新出现）；来源或目标被硬删除时行级联清除。
- **FR-9 前端面板**：
  - 右侧栏新增“引用此文档”视图与入口按钮（非删除态文档可见），按钮带可见来源数量徽标。
  - 面板按来源文档分组展示标题与引用块摘要；有加载态、空态、错误态。
  - 点击条目在当前标签导航到 `/docs/{sourceId}/#{sourceBlockId}` 并滚动到来源块；Ctrl/Cmd/Shift/中键新标签打开（与互链 chip 行为一致）。
  - 打开面板时拉取，窗口聚焦时刷新，面板打开期间每 30 秒轮询一次；只在登录与非删除文档下启用查询。
  - 文案走 i18n（至少提供英文）。
- **FR-10 不回归**：互链 chip 的正向跳转、复制链接、粘贴转互链、导出均不改动。

## Non-Functional Requirements
- **NFR-1 安全**：所有跨来源数据都在后端按当前用户逐请求过滤；索引任务使用管理员 JWT 读取 yhub，仅在服务端使用，不把出向索引暴露给无权用户。
- **NFR-2 性能**：target 查询走索引；单文档重建是一次 yhub GET + 一次事务替换；API 响应有组数上限；content-updated 路径只做调度，不内联执行重建。
- **NFR-3 可靠性**：任务/命令对单篇失败容错（跳过并记录），不影响其他文档与 content-updated 主流程。
- **NFR-4 可运维**：回填命令幂等、可重复执行、可按文档 id 执行；无需新增基础设施、Helm 配置或环境变量。
- **NFR-5 代码质量**：后端遵循 Ruff/Pylint 与既有测试风格（pytest + factory，yhub 以 mock/fake 测试，CELERY_TASK_ALWAYS_EAGER 下任务内联），前端遵循 Prettier/ESLint，提供 Vitest/RTL 组件与 hook 测试。

## Constraints
- **Technical**: Python 3.14 / Django + DRF、pycrdt + BeautifulSoup(lxml-xml)、Celery；TypeScript / Next.js 15 / React Query / Zustand / BlockNote 0.54；协作内容只存在于 yhub，后端不得另存正文快照。
- **Business**: 不引入新的第三方服务；全文搜索服务可能未配置，功能必须独立可用。
- **Dependencies**: 复用 `YHubService.get_ydoc`、既有 Document 权限/树模型、右侧面板视图框架。

## Assumptions
- “直接或继承成员权限”解释为 DocumentAccess（用户本人或其团队）位于来源文档或其祖先；link reach（公开/登录链接）明确不算。
- 互链节点标签名稳定为 `interlinkingLinkInline`、块容器标签稳定为 `blockContainer`（由 BlockNote 0.54 + y-prosemirror 1.3.7 的序列化实现与现有 TEST_BASE64 夹具证实）。
- 摘要的可接受形态为来源块（最近 blockContainer）的纯文本截断；表格内引用的摘要是其所在单元格内块的文本。
- 30 秒轮询的最终一致性满足“列表随已保存引用的增删更新”。
- 目标块 id 不做存在性校验（块可能已被删除；链接仍指向该文档）。

## Acceptance Criteria

### AC-1: 引用提取范围与去重正确
- **Type**: `rule`
- **Given**: 来源文档的 Yjs 内容中同时包含：有效互链（文档级与块级）、指向自身的互链、普通网址超链接、空 docId 的搜索态节点、disabled 互链、嵌套列表中的互链、表格单元格中的互链、同一块内两次引用同一目标文档
- **When**: 对该来源执行链接重建
- **Then**: 索引行只包含有效且目标存在的（来源块,目标文档）唯一组合；自引用/普通网址/空/非法/disabled 均不出现；嵌套与表格中的引用被收录；同块重复引用只有一行
- **Pass Condition**: 对按上述构造的 ydoc（pycrdt 构造真实 XML 结构）执行提取服务，断言行集合与逐案例预期完全一致
- **Evidence**: 新增 `test_services_document_links.py`（或同等位置）中的单元测试

### AC-2: 存量文档无需重新编辑即可被找到
- **Type**: `rule`
- **Given**: 迁移上线前已存在、内容只在 yhub 中的文档 S 含有对 T 的互链，数据库无任何 DocumentLink 行
- **When**: 运行回填管理命令后，以有权阅读 S 与 T 的用户请求 T 的 backlinks API
- **Then**: 响应包含 S 分组及其引用块摘要，期间没有任何人编辑过 S
- **Pass Condition**: 命令成功且 API 返回 S；再次运行命令结果幂等
- **Evidence**: 管理命令测试（fake YHubService.get_ydoc）

### AC-3: 已保存引用的增删驱动更新，且不依赖全文搜索
- **Type**: `rule`
- **Given**: `SEARCH_INDEXER_CLASS` 为空，用户在 S 中新增对 T 的互链并保存，yhub 回调 content-updated；随后删除该链接并再次回调
- **When**: 重建任务随回调执行（测试 eager 模式下内联）
- **Then**: 第一次后 T 的 backlinks 出现 S 分组，第二次后消失
- **Pass Condition**: content-updated 测试断言两种最终状态；且不实例化/调用任何搜索 indexer
- **Evidence**: `test_api_documents_content_updated.py` 与任务测试

### AC-4: 复制/导入路径携带的引用立即被索引
- **Type**: `rule`
- **Given**: 用户复制（含后代）含互链的文档，或从文件/带子文件/create-for-owner 创建含互链的文档
- **When**: 创建流程完成（create_ydoc 成功、事务提交）
- **Then**: 新文档的出向链接被调度重建，目标文档 backlinks 无需再等编辑即可包含新来源；创建失败时不留下调度副作用
- **Pass Condition**: 相关既有测试文件中新增断言：提交后重建任务被调度一次（mock get_ydoc 返回复制所用 update 时行正确落库）
- **Evidence**: duplicate / create_with_file / children_create / create_for_owner 测试

### AC-5: 面板接口的访问门槛
- **Type**: `rule`
- **Given**: 匿名用户、对文档无阅读能力的登录用户、有阅读能力的登录用户、仅有链接访问痕迹（LinkTrace）的登录用户
- **When**: 请求 `GET /documents/{id}/backlinks/`
- **Then**: 匿名 401；已登录但无阅读能力 403（与既有 retrieve 端点一致，不引入新的存在性侧信道）；文档不存在 404；有 retrieve 能力的成员 200；能力来自祖先继承同样 200
- **Pass Condition**: 权限矩阵测试全部符合
- **Evidence**: 新增 `test_api_documents_backlinks.py`

### AC-6: 仅返回有直接/继承成员权限且未删除的来源，且无数量泄露
- **Type**: `rule`
- **Given**: T 被 4 个来源引用：S1（用户直接成员）、S2（成员权限仅在 S2 的祖先上）、S3（仅 public link reach + LinkTrace）、S4（直接成员但在回收站中，含祖先被删情形）
- **When**: 该用户请求 T 的 backlinks
- **Then**: 只返回 S1、S2；S3、S4 的标题、摘要、id 不出现在任何响应字段中；count 等于 2
- **Pass Condition**: 响应 JSON 全量断言（键、count、分组 id 集合），不存在 S3/S4 任何子串
- **Evidence**: `test_api_documents_backlinks.py`

### AC-7: 改名/权限变更/删除/恢复的实时一致性
- **Type**: `rule`
- **Given**: S 引用 T 且用户可见
- **When**: 分别：S 改名；移除用户在 S（或其祖先）上的 DocumentAccess；S 软删除进回收站；从回收站恢复 S；S 被硬删除
- **Then**: 改名后下次请求显示新标题；失去权限后 S 立即消失且数量减少；软删除后消失；恢复后无需编辑重新出现；硬删除后索引行级联删除
- **Pass Condition**: 五个分支各有 API/模型断言
- **Evidence**: `test_api_documents_backlinks.py` + 模型级联测试

### AC-8: 可从面板跳转到来源块，且正向链接不回归
- **Type**: `rule`
- **Given**: 面板列出 S 的来源块 B
- **When**: 用户点击该条目
- **Then**: 路由变为 `/docs/{S}/#B`，页面加载后滚动定位到 B（既有 hash 机制）；Cmd/Ctrl/Shift/中键在新标签打开；编辑器内互链 chip 的正向跳转行为保持不变
- **Pass Condition**: 组件测试断言 router.push 的 URL 与修饰键分支；既有 Interlinking 测试保持通过
- **Evidence**: 新增 BacklinksSideBar 测试 + 既有 Interlinking 测试不改动通过

### AC-9: 未配置全文搜索服务时端到端可用
- **Type**: `rule`
- **Given**: `SEARCH_INDEXER_CLASS` 未配置
- **When**: 执行回填、content-updated 触发、打开面板
- **Then**: 三条路径均正常工作，过程中无任何对 indexer 的导入/调用导致失败
- **Pass Condition**: 对应测试在默认 Test 配置（无 indexer）下通过
- **Evidence**: AC-2/AC-3 测试即证据；代码审查确认无 indexer 依赖

### AC-10: 面板用户体验质量
- **Type**: `rubric`
- **Dimension**: 信息架构清晰度、设计系统一致性、加载/空/错误三态、可访问性（键盘可达、aria-label/aria-expanded、焦点回到触发按钮）、移动端布局
- **Scale**: 1-5
- **Anchors**: 1 = 面板样式游离于产品之外、无状态处理、键盘不可用；3 = 功能完整但视觉或 a11y 有明显瑕疵；5 = 与目录/评论面板体验完全一致、三态完备、键盘与读屏自然
- **Pass Threshold**: >= 4
- **Evidence**: 组件测试 + 人工代码审查对照 TableContentSideBar/CommentSideBar 模式

### AC-11: 安全、性能与失败隔离
- **Type**: `rubric`
- **Dimension**: 越权/泄露防护、查询索引与上限、外部依赖失败隔离、代码与既有模式的一致性
- **Scale**: 1-5
- **Anchors**: 1 = 存在越权或泄露、无界查询、yhub 故障会清空索引；3 = 功能正确但存在缺索引/无上限/异常吞没不当之一；5 = 全部命中：逐请求过滤、target 索引与 100 组上限、YHubError 保留旧行、content-updated 只调度不阻塞
- **Pass Threshold**: >= 4
- **Evidence**: 迁移与查询审查、任务失败路径测试、独立审查

## Open Questions
- 无（关键歧义“成员权限不含 link reach”“30s 轮询最终一致”“摘要为来源块纯文本 200 字符截断”按 Assumptions 落地；审批时如有不同意见再回到本阶段）。
