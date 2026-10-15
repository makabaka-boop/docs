# “引用此文档”反向链接面板 - 实施计划

> 顺序：T1 数据层 → T2 提取与重建 → T3/4/5 触发 → T6 读接口 → T7/8 前端 → T9 收尾。
> 后端测试统一遵循现有约定：pytest + factories，YHubService 以 mock/fake 注入，Test 配置下 Celery 任务内联执行。

## Task 1: DocumentLink 模型与迁移
- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Completion Evidence**:
  - `DocumentLink` 模型位于 models.py（impress_document_link，唯一约束 + target 索引）；迁移 0036_documentlink.py；DocumentLinkFactory。
  - `bin/pytest core/tests/test_services_document_links.py` 9 passed；`bin/pytest core/tests/test_utils.py` 34 passed（含级联测试）；`makemigrations --check --dry-run` = No changes detected。
- **Description**:
  - 在 [models.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/models.py) 新增 `DocumentLink(BaseModel)`：`source` FK→Document（related_name=`outgoing_links`，CASCADE）、`target` FK→Document（related_name=`incoming_links`，CASCADE）、`source_block_id` CharField(max_length=255)、`target_block_id` CharField(max_length=255, blank=True, default="")、`excerpt` CharField(max_length=200, blank=True, default="")。
  - Meta：`db_table="impress_document_link"`，UniqueConstraint(source, target, source_block_id)，Index(fields=["target"])，ordering=["-created_at"]；Pylint/命名遵循同文件风格。
  - 新增迁移 `0036_documentlink.py`（依赖 0035_mention）。
  - 在 factories.py 增加 `DocumentLinkFactory`（source/target SubFactory 或可传入）。
- **Acceptance Criteria Addressed**: AC-1, AC-7, AC-11
- **Test Requirements**:
  - `rule` TR-1.1: `makemigrations --check`（或 bin/pytest 中迁移状态）无缺失迁移；迁移可正向应用
  - `rule` TR-1.2: 同一 (source,target,source_block_id) 重复建对象触发唯一约束；删除 source/target 时行级联删除（工厂级测试）
- **Notes**: 不挂信号、不加缓存。

## Task 2: Yjs 互链提取与单文档重建服务
- **Status**: `completed`
- **Priority**: high
- **Depends On**: T1
- **Completion Evidence**:
  - `core/utils/yjs.py::extract_interlinking_links`（真实 pycrdt 0.14.6 验证了 XmlElement/布尔属性/嵌套/表格序列化假设）；`core/services/document_links.py::reindex_document_links`（整体替换、YHubError 保留旧行、自引用/缺失目标排除）。
  - `bin/pytest core/tests/test_utils.py core/tests/test_services_document_links.py` 全部通过（43 tests）。
- **Description**:
  - 在 [yjs.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/utils/yjs.py) 新增 `extract_interlinking_links(update) -> list[dict]`：pycrdt 应用 update 取 `document-store` XML → BeautifulSoup(lxml-xml)；遍历所有 `interlinkingLinkInline` 标签：
    - 要求 `docId` 非空且为合法 UUID（uuid.UUID 校验），`disabled` 不为 `"true"`；
    - 沿 parents 找最近 `blockContainer` 的 `id`，无 id 则跳过；
    - 摘要 = 该 blockContainer 直接内容（排除嵌套 blockGroup 文本，避免把子块全文计入；表格单元格内块天然是直接内容）get_text(separator=" ", strip=True)，截断 200 字符；
    - 按 (block_id, docId) 去重（target_block_id 保留首个非空值）。
  - 新增 `core/services/document_links.py`：
    - `reindex_document_links(document_id)`：加载 Document（不存在直接返回）；`YHubService().get_ydoc(document)`，None/空 → 视为空集合；提取后过滤目标存在且 target_id != source_id（一次 Document.objects.filter(id__in=...) 取合法目标集合）；`transaction.atomic()` 内删除 source 全部 outgoing_links 并 bulk_create 新行。
    - 捕获 `YHubError`：记录日志并保留旧行，返回/标记 skipped（不抛出）。
- **Acceptance Criteria Addressed**: AC-1, AC-3, AC-11
- **Test Requirements**:
  - `rule` TR-2.1: 用 pycrdt 在测试中构造真实结构（blockGroup/blockContainer/heading/paragraph/table，内含 interlinkingLinkInline XmlElement，属性 docId/blockId/disabled/trigger），提取结果覆盖：文档级链接、块级链接、嵌套列表、表格内链接、同块重复去重、自引用在服务层被排除、目标不存在被排除
  - `rule` TR-2.2: 普通网址（XmlText 上的 link 属性/mark）与 disabled/空 docId/非法 UUID 节点均不产生行
  - `rule` TR-2.3: 重建=整体替换：先有链接 A/B，新内容只剩 A，重建后 B 行删除
  - `rule` TR-2.4: get_ydoc 抛 YHubError 时旧行保留且函数不抛出
  - Evidence: `core/tests/test_utils.py` 新增提取用例（或新测试文件）+ 新 `test_services_document_links.py`

## Task 3: Celery 任务与 content-updated 接线（不依赖搜索索引器）
- **Status**: `completed`
- **Priority**: high
- **Depends On**: T2
- **Completion Evidence**:
  - `core/tasks/document_links.py::index_document_links_task`；content_updated 无条件 `.delay()`；4 个新 content-updated 测试（增/删/失败保留旧行/未知文档不调度）20 passed。
  - 不读取 SEARCH_INDEXER_CLASS（默认 Test 配置无 indexer）。
- **Description**:
  - 在 `core/tasks/documents.py` 新增 `index_document_links_task(document_id)`（@app.task，包装 reindex 服务，异常只记录日志）。
  - 在 [viewsets.py](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/backend/core/api/viewsets.py) 的 `content_updated` action 中，更新 updated_at 之后**无条件** `.delay()` 调度该任务（独立于 `trigger_batch_document_indexer` 的 indexer 开关）；保持该端点轻量、不因任务失败而失败。
- **Acceptance Criteria Addressed**: AC-3, AC-9, AC-11
- **Test Requirements**:
  - `rule` TR-3.1: 以协作服务器 JWT 调 content-updated（SEARCH_INDEXER_CLASS 为空）后，DocumentLink 随 fake ydoc 内容正确增/删（同一文档先加链接回调一次、删链接再回调一次）
  - `rule` TR-3.2: 任务内部异常不改变端点 200 响应与 updated_at 更新
  - Evidence: 扩展 `test_api_documents_content_updated.py` 与 `test_tasks_documents.py`

## Task 4: create_ydoc 直写路径的索引触发
- **Status**: `completed`
- **Priority**: medium
- **Depends On**: T3
- **Completion Evidence**:
  - duplicate（含后代）复用已读取 update 同步 reindex 并在补偿失败时级联清除；文件创建/children/create-for-owner 在原子块内带 update 同步 reindex（异常隔离不破坏创建）；入职沙箱以 send_task 按任务名调度（models 不产生导入环）。
  - duplicate 新增 3 测试（含后代链接、失败无残留）；create_with_file/children/create_for_owner 各 1 触发测试 + 失败不触发。相关 4 文件 128 passed（7 个既有失败为环境缺失邮件模板基线，构建模板后全绿）。
- **Description**:
  - 在以下流程 create_ydoc 成功并提交后，用 `transaction.on_commit(lambda: index_document_links_task.delay(id))` 触发一次重建：duplicate（含后代，对每个新文档）、serializers.py 的从文件创建（~L508）、viewsets children create（~L762）、create-for-owner、User._duplicate_onboarding_sandbox_document。
  - 创建失败回滚时不得调度（on_commit 语义保证）。
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `rule` TR-4.1: duplicate（with/without descendants）成功后每个新文档调度一次；fake get_ydoc 返回带互链的 update 时目标 backlinks 数据落库
  - `rule` TR-4.2: create_ydoc 失败/请求失败时无任务调度
  - `rule` TR-4.3: 从文件创建、children 创建、create-for-owner 成功路径均调度（各至少一条断言）
  - Evidence: 扩展 `test_api_documents_duplicate.py`、`test_api_documents_create_with_file.py`、`test_api_documents_children_create.py`、`test_api_documents_create_for_owner.py`

## Task 5: 回填管理命令
- **Status**: `completed`
- **Priority**: medium
- **Depends On**: T2
- **Completion Evidence**:
  - `manage.py reindex_document_links [--id]`：幂等、逐篇容错、支持 --id、不读搜索配置。3 passed（回填幂等、单篇、失败跳过且保留旧行）。
- **Description**:
  - 新增 `core/management/commands/reindex_document_links.py`：遍历全部 Document（按 id 分批，含回收站文档以保证恢复后立即可见），逐篇调用重建服务；单篇失败记录并继续；结尾输出处理/跳过计数。支持 `--id <uuid>` 只处理一篇。不读取任何搜索配置。
- **Acceptance Criteria Addressed**: AC-2, AC-9
- **Test Requirements**:
  - `rule` TR-5.1: 命令对存量文档（无现有行）回填后 backlinks 数据正确，重复运行幂等（行数不翻倍）
  - `rule` TR-5.2: `--id` 只重建指定文档；某篇 yhub 失败不影响其他文档，退出码为 0
  - Evidence: 新 `core/tests/commands/test_reindex_document_links.py`

## Task 6: backlinks 只读 API（能力、接口、序列化、可见性过滤）
- **Status**: `completed`
- **Priority**: high
- **Depends On**: T1
- **Completion Evidence**:
  - ability `backlinks`；`GET /documents/{id}/backlinks/`；`get_document_backlinks` 按物化路径成员权限+回收站状态过滤，100 组上限，响应仅含可见组 count，无全局总数。
  - 新测试文件 12 passed：匿名 401/无权限 403/不存在 404/直接+继承成员 200/link-reach+LinkTrace 不出现/软删含祖先删除隐藏/恢复重现/改名即时/撤权即时/硬删级联/分组字段/上限。
  - 同步更新 abilities 快照（test_models_documents 11 处）、retrieve（5 处）、trashbin（2 处）。
- **Description**:
  - 在 `Document.get_abilities` 增加 `"backlinks": can_get and user.is_authenticated`。
  - serializers.py 新增 `BacklinkBlockSerializer`（source_block_id、target_block_id、excerpt）与 `BacklinkSourceSerializer`（id、title=source.title or None、links 列表）。
  - DocumentViewSet 新增 `@action(detail=True, methods=["get"], url_path="backlinks")`：`get_object()` 完成权限门槛；查询：
    - member 可读来源 = DocumentAccess.objects.filter(Q(user=u)|Q(team__in=u.teams), document__path=前缀匹配 source.path) 所覆盖的文档（用 source.path startswith 访问所在路径 的物化路径查询，参考 annotate_user_roles 的 Left/Length 或先取访问路径列表再 `path__in` 推导，注意实现走索引）；
    - 过滤 incoming_links 的 source：`deleted_at__isnull=True, ancestors_deleted_at__isnull=True`；
    - 按来源分组（每组链接按 created_at/source_block_id 排序），组排序按组内最大 created_at desc、source.path/id 兜底；上限 100 组；
    - 返回 `{"count": <可见组数>, "results": [...]}`，count 仅计可见组。
  - 在 DocumentViewSet docstring 的端点列表补充说明。
- **Acceptance Criteria Addressed**: AC-5, AC-6, AC-7, AC-11
- **Test Requirements**:
  - `rule` TR-6.1: 权限矩阵：匿名 401；无 retrieve 能力 404；不存在文档 404；直接成员 200；仅祖先成员 200；link reach+LinkTrace 但无成员权限的来源不出现
  - `rule` TR-6.2: 软删除（自身 deleted_at 与祖先 ancestors_deleted_at 两场景）来源不出现；恢复后重新出现；硬删除后行消失
  - `rule` TR-6.3: 来源改名后响应显示新标题（无需重新索引）；撤销成员权限后立即消失
  - `rule` TR-6.4: 防泄露：含不可见来源时响应 JSON 不含其 id/标题/摘要子串，count 等于可见组数；100 组上限生效
  - `rule` TR-6.5: 同一块多次引用只列一条；target_block_id/excerpt 字段内容与索引一致
  - Evidence: 新 `core/tests/documents/test_api_documents_backlinks.py`

## Task 7: 前端 API 层（类型 + React Query hook）
- **Status**: `completed`
- **Priority**: high
- **Depends On**: T6
- **Completion Evidence**:
  - `features/docs/doc-backlinks/{types.ts,api/useBacklinks.ts}`：KEY_BACKLINKS、30s 轮询、focus 刷新、enabled 门控、无 id 不发请求。
  - hook 测试 5 passed（映射/未登录不请求/禁用不请求/错误态 APIError/轮询常量）。
- **Description**:
  - 新增 feature 目录 `features/docs/doc-backlinks/`：`api/useBacklinks.ts`（getBacklinks 走 fetchAPI(`documents/${id}/backlinks/`)）、`types.ts`（BacklinkSource/BacklinkBlock 响应）、`index.ts` 桶导出。
  - useQuery：key 含 doc id；`enabled` = 已登录 && 有 id；`refetchOnWindowFocus`、面板打开时 `refetchInterval: 30000`（以 enabled 开关控制）；403/404 不重试。
- **Acceptance Criteria Addressed**: AC-3, AC-6, AC-10
- **Test Requirements**:
  - `rule` TR-7.1: hook 单测（mock fetchAPI）：成功映射、未登录不发请求、30s 轮询开关行为、错误进入 error 态
  - Evidence: `api/__tests__/useBacklinks.test.tsx`（RTL + query client 既有模式）

## Task 8: “引用此文档”面板（右侧栏视图、入口按钮、跳转、i18n）
- **Status**: `completed`
- **Priority**: high
- **Depends On**: T7
- **Completion Evidence**:
  - RightPanelView 增 backlinks；RightPanel 渲染/标签；BacklinksSideBar（三态、emoji 标题、Untitled 回落、来源块摘要、点击 router.push、修饰键/中键新标签、Enter 可达、关闭按钮焦点）；BacklinksSideBarButton（aria-expanded/label、可见数量徽标、删除态隐藏、按钮不轮询）；RightPanelCollapseButton 始终渲染入口；fr 翻译 7 条。
  - 组件测试 13 passed；前端全量 507 passed；tsc 0 error；eslint/prettier 干净。
- **Description**:
  - `RightPanelView` 增加 `'backlinks'`；[RightPanel.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/right-panel/components/RightPanel.tsx) 增加标签与渲染分支。
  - 新建 `doc-backlinks/components/BacklinksSideBar.tsx`：头部（标题+关闭按钮，复用 ButtonCloseModal/样式同 TableContentSideBar）、按来源分组列表（来源标题，无标题用 Untitled Document；每条显示摘要与来源文档图标）、loading/empty/error 三态；点击 navigate `/docs/{sourceId}/#{sourceBlockId}`（router.push；metaKey/ctrlKey/shiftKey/中键 window.open，参照 LinkSelected 处理与 isDeletedDoc 禁用）。
  - 导出 `BacklinksSideBarButton`（icon 用 assets/icons/ui-kit/link.svg，aria-expanded/aria-label 与 TOC 按钮同构，带可见数量徽标——数量只来自过滤后的接口 count）；接入 [RightPanelCollapseButton.tsx](file:///Users/zhangxinyu/SWE/tasks/SWE-0012-docs-rerun4/src/frontend/apps/impress/src/features/right-panel/components/RightPanelCollapseButton.tsx)：该按钮始终渲染（调整现有“无标题/无线程则返回 null”逻辑，使 backlinks 按钮不被吞掉），删除态文档不显示。
  - i18n：translations.json 的 en 段（及 fr 段可一并补法文）增加：面板标题、显示/隐藏 aria label、空态文案、错误/加载文案。
- **Acceptance Criteria Addressed**: AC-8, AC-10
- **Test Requirements**:
  - `rule` TR-8.1: 组件测试：分组渲染标题与摘要；空态/加载/错误态；点击调用 router.push 且 URL 为 `/docs/{id}/#{block}`；修饰键与中键走 window.open
  - `rule` TR-8.2: 按钮开关面板（aria-expanded 变化）、徽标数字等于接口 count；无数据时显示 0 或不显示徽标（实现二选一并在测试固定）
  - `rubric` TR-8.3: UX 质量；scale 1-5；anchors 1=样式游离/无状态/键盘不可用，3=功能完整但视觉或 a11y 有瑕疵，5=与目录面板完全同构、三态完备、键盘与读屏自然；threshold >= 4；evidence=代码对照审查 + 组件测试
- **Notes**: 不改动 Interlinking/正向链接任何代码。

## Task 9: 收尾验证（CHANGELOG、lint、测试、迁移核对）
- **Status**: `completed`
- **Priority**: medium
- **Depends On**: T8
- **Completion Evidence**:
  - CHANGELOG Added 两条；迁移 makemigrations --check 无缺失。
  - 后端全量 `bin/pytest core/ -n auto`：2435 passed, 10 skipped（基线 skip），0 failed；ruff check/format 干净；pylint 变更文件 10.00/10。
  - 前端：507 passed（64 files）、tsc --noEmit 0 error、eslint . 0 error、prettier 干净。
  - 环境补充：本地 dev 镜像缺少生成的 mail 模板（MJML）与 .mo，已 `yarn build` 生成模板 + compilemessages，属既有环境基线，与本变更无关。
- **Description**:
  - CHANGELOG.md `[Unreleased]` 增加 `- ✨(backend) add document backlinks indexing and API` 与 `- ✨(frontend) add "referenced by" panel in the document right sidebar`（行宽 ≤80）。
  - 运行：后端 `bin/pytest -n auto core/tests/test_utils.py core/tests/test_services_document_links.py core/tests/documents/test_api_documents_backlinks.py core/tests/documents/test_api_documents_content_updated.py core/tests/commands/test_reindex_document_links.py` 及受影响的 duplicate/create 测试；`make lint-ruff-check`（可用时）。
  - 前端 `yarn lint`、`yarn test`（doc-backlinks 相关）；如环境无法安装依赖/构建镜像，记录为 blocked 证据并说明。
  - 核对 OpenAPI schema 测试（test_openapi_schema.py）是否需要快照更新（新 action 会进入 schema）。
- **Acceptance Criteria Addressed**: AC-1..AC-11（总收口）
- **Test Requirements**:
  - `rule` TR-9.1: 上述后端/前端测试命令实际通过（或记录可复核的环境阻塞证据）
  - `rule` TR-9.2: 无 lint/format 新增告警；OpenAPI schema 测试通过
