# Review: “引用此文档”反向链接面板

- **Reviewer**: 独立子代理（fresh context，只读）+ 主代理对修复项复核
- **Date**: 2026-10-15
- **Artifacts**: spec.md / tasks.md 同目录；实现见 tasks.md 各任务 Completion Evidence

## Checkpoints

| CP | 覆盖 | 结论 | 证据 |
|---|---|---|---|
| CP-1 访问门槛（AC-5） | rule | pass | 匿名 401（DRF NotAuthenticated）、已登录无能力 403（与既有 retrieve 一致，不引入存在性侧信道）、不存在 404、直接/继承成员 200；test_api_documents_backlinks.py 12+2 用例 |
| CP-2 可见性与防泄露（AC-6/7/11） | rule | pass | 仅 DocumentAccess（user/team）直接或经祖先物化路径（steplen=7）授权的来源可见；link-reach+LinkTrace 不可见；deleted_at 与 ancestors_deleted_at 双过滤；count 只计可见组、无全局 total；100 组上限。测试对原始响应体断言不含隐藏源 id/标题/excerpt |
| CP-3 提取正确性（AC-1） | rule | pass | pycrdt 0.14.6 真实 XML 验证：docId UUID、disabled="true"、最近 blockContainer、blockGroup 排除使摘要不含父块、表格单元格、同块去重、自引用/缺失目标排除、摘要截断 200 |
| CP-4 触发与一致性（AC-2/3/4/9） | rule | pass | content-updated 无条件调度且不依赖 SEARCH_INDEXER_CLASS（默认 Test 无 indexer 实测）；duplicate 复用 update 同步重建，失败补偿时 FK 级联清除；文件/children/create-for-owner 原子块内重建；onboarding 经 send_task 且 on_commit；回填命令幂等、--id、逐篇容错（含意外异常）；YHubError 保留旧行 |
| CP-5 动态一致性（AC-7） | rule | pass | 改名即时（join 实时取标题）、撤祖先权限消失、软删消失、恢复未编辑即重现、硬删级联，均有测试 |
| CP-6 前端跳转与正向链接（AC-8） | rule | pass | 点击 router.push `/docs/{src}/#block`；cmd/ctrl/shift/中键新标签；Enter 可达；Interlinking 正向代码零改动，其既有 36 测试通过 |
| CP-7 前端数据层（AC-3/9） | rule | pass | hook enabled 门控、30s 轮询仅面板 observer；按钮 observer 关闭 refetchInterval/refetchOnWindowFocus 且删除态禁用；错误态 APIError；5 hook 测试 |
| CP-8 UX 质量（AC-10） | rubric | pass（4/5→复核） | 与右侧栏 TOC/评论面板同构；三态、aria-expanded/aria-label/aria-labelledby/role=list、关闭回焦；按来源分组（标题一次、条目列于其下）；emoji/无标题回落 |
| CP-9 工程质量 | rule | pass | 无导入环（任务惰性 import、models 仅按名 send_task）；查询 2 条无 N+1；target 复用 FK 隐式索引；broad-except 均有注释与日志；迁移与模型一致（makemigrations --check 无变更） |
| CP-10 测试真实性 | rule | pass | 全部为行集合/原始 JSON/状态码/调用参数断言，无恒真断言 |

## Findings 与修复

首轮独立评审：**pass**（无 blocker/major，4 minor + 6 nit）。全部已修复并复核：

| # | 级别 | 处理 |
|---|---|---|
| F-1 403 与规格字面 404 | minor | 采用平台既有约定（retrieve 即 403），更新 spec AC-5 措辞；测试覆盖 401/403/404 |
| F-2 onboarding send_task 在事务提交前/仅捕 YHubError | minor | 改为 `transaction.on_commit` 包裹且 broad 捕获发送异常；测试改用 django_capture_on_commit_callbacks |
| F-3 回填命令对意外异常不容错 | minor | 循环体 try/except 计 skipped；新增命令测试 |
| F-4 组排序无标题/id 兜底 | minor | Python 显式排序（最近引用→标题 casefold→id）；新增同时间戳排序测试 |
| F-5 team 继承/排序/命令容错测试缺口 | minor | 新增 team 来源可见性（monkeypatch User.teams）、稳定排序、命令意外异常测试 |
| F-6 target 显式索引与 FK 隐式索引重复 | nit | 模型与 0036 迁移中移除 AddIndex（未发布迁移，就地修改） |
| F-7 t('Loading') 无翻译键 | nit | 去除该键，role="status" + 面板标题作 aria-label |
| F-8 按钮 observer focus 刷新/删除态仍请求 | nit | refetchOnWindowFocus:false、enabled 含删除态门控；新增删除态按钮不渲染测试 |
| F-9 同来源多块标题逐行重复 | nit | 重构为 BacklinkGroup（来源标题一次 + 条目列表）；新增多块分组测试 |
| F-10 yarn.lock 安装期无关 churn | nit | git checkout 还原 |

## Verification（修复后最终一轮）

- 后端：`bin/pytest core/ -n auto` → **2438 passed, 10 skipped, 0 failed**；`ruff check .` All checks passed；`ruff format` 已应用；`bin/pylint` 变更文件 **10.00/10**；`makemigrations --check --dry-run` No changes detected。
- 前端：vitest 全量 **509 passed (64 files)**（doc-backlinks 20）；`tsc --noEmit` 0 error；`eslint .` 0 error；prettier --check 干净。
- OpenAPI 动态 schema 测试通过，无需快照更新。

## Gaps / 未验证

- 未做真实浏览器视觉走查（以与既有面板同构 + RTL 组件测试替代）。
- broker 故障注入为代码推理（onboarding 已用 on_commit+try/except 隔离，失败不影响注册，回填命令兜底）。
- 本地 dev 镜像原本缺 MJML 生成的邮件模板与 .mo（既有环境基线问题，与本变更无关），构建后全绿。

## 最终结论

**pass**。11 条 AC 全部有规则测试或 rubric 证据；评审发现的 4 minor/6 nit 均已修复并回归通过。
