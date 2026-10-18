# Open Context Clipper 工作空间交接

更新日期：2026-10-18。本文用于从 Open Context Forge 工作空间切换到独立的 Open Context Clipper 仓库，记录已完成事实与未完成工作；不是新的功能需求清单。

## 当前项目与边界

- 仓库：`apframework-studio/open-context-clipper`，本地项目位于 `~/githome/github/apframework-studio/open-context-clipper`，主分支为 `main`。
- 当前仓库保持 **PRIVATE**。源码采用 MIT 协议；将仓库改为 PUBLIC 需要用户另行决定。
- 项目名为 **Open Context Clipper（文脉采集器）**。代码已从旧仓库 `open-context-forge/apps/chrome-extension/` 拆分到本仓库根目录；新仓库从首次提交开始，不保留旧 Git 提交历史。
- 插件仅在用户主动打开时采集当前页面已渲染的正文，确认后存入本地 IndexedDB 队列，可显式导出单篇 Markdown、所选 JSON 或批量 ZIP。导出开始后记录自动进入本地“已完成”历史。不默认上传、不自动写入 vault，也不要求 Companion 后台常驻。
- 详细能力、安装步骤、隐私边界和当前限制见根目录 [README.md](../README.md)。
- 2026-10-18 队列页已改为满屏布局，主视图为“收件箱/已完成”，支持所选与当前结果的 ZIP 导出。历史页提供相同的搜索、勾选、详情与备注能力，并显示完成时间；再次导出不修改历史状态。当前 13 个测试文件、84 个测试通过，类型检查与构建通过。构建后需要在 Chrome 扩展管理页重新加载；真实浏览器只核对了新版页面显示，下载及重开后的持久化由用户人工复验。

## 迁移时已完成的工作

- 复制了旧插件全部业务源码、测试、构建脚本及用户未提交的新图标；未复制 `node_modules/`、`dist/` 和 `.DS_Store`。
- 更新了扩展显示名、npm 包名与版本，添加 MIT `LICENSE`、仓库级 `AGENTS.md`、README 和 GitHub CI。
- 新仓库已推送到 GitHub；迁移时本地验证为 13 个测试文件、69 个测试通过，`npm run typecheck` 与 `npm run build` 通过，`npm audit` 为 0 项漏洞。首次推送的 GitHub CI 已成功。后续修改仍需重新验证。
- 旧仓库的插件源码已从 Git 跟踪中移除并在本地提交；旧仓库的清理提交**尚未推送**。旧仓库中的历史设计与实施文档仍保留。

## 旧版离线队列：切换前先确认

2026-10-18 更新：切换前在旧扩展队列界面看到 2 条待同步记录。用户确认旧内容无需同步或迁移，随后自行卸载旧扩展并安装新扩展，确认原有功能可用。旧记录没有迁入新队列；旧安装路径未由本次工作清理。以下步骤保留给仍需迁移旧数据的其他安装场景，不再是本机当前切换的待办。

从新绝对路径加载 unpacked 扩展可能生成不同的扩展 ID；如果 ID 变化，旧扩展的 IndexedDB 队列不会自动出现在新扩展中。当前版本没有 JSON 导入功能。

1. 如果旧扩展曾保存文章，先在 Chrome 中打开**旧扩展**队列，选择需要保留的记录并导出 JSON；需要独立 Markdown 时逐篇导出。重复候选如需批量导出，先提升为独立记录。
2. 确认导出文件可用，再考虑卸载旧扩展或清理旧路径。不要把“导出备份”误认为“已导入新队列”。
3. 为保留旧安装路径，本机旧仓库的 `apps/chrome-extension/dist/` 已恢复为忽略的构建产物，仅供导出旧数据；它不是新项目源码。临时备份也存在于本机 `/private/tmp/`，但系统可能清理，不应长期依赖。

是否需要实现跨扩展 ID 的队列导入，是后续独立需求，必须先确认用户的数据迁移预期与格式兼容策略。

## 切换工作空间后的优先检查

1. 阅读本仓库 `AGENTS.md` 与 `README.md`，确认当前代码和 Git 状态。
2. 在新仓库运行 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`；不要把旧验证记录当作本次验证。
3. 在真实 Chrome 中手工加载本仓库 `dist/`，检查文章预览、确认保存、队列持久化、重复处理及 Markdown/JSON 导出。自动化测试不代替这一步。
4. 如需继续处理旧仓库收尾，先查看其 `git status` 与本地未推送提交；不要未经确认推送旧仓库已有的其他提交。

## 历史资料

- [迁出前的设计文档](history/chrome-capture-extension-design.md)
- [迁出前的实施计划](history/chrome-capture-extension-plan.md)

这两份文档按旧 monorepo 目录编写，只用于理解设计来历；当前路径、名称和待办以本仓库代码、README 与本交接文档为准。
