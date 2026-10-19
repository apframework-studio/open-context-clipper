# 历史验证记录

本页保留过往实现时记录的验证结果，日期和待办反映当时的状态，不代表当前版本已经完成相同的真实 Chrome 检查。最新使用方式与限制以 [README](../README.md) 为准。

### 2026-10-19 列表选中区域

- 列表整行均可切换右侧详情，键盘焦点标示覆盖整行；复选框仍独立用于批量选择。尚待用户在真实 Chrome 重新加载扩展后确认视觉效果。

### 2026-10-19 Chrome 内部页面提示

- 在 `chrome://` 等不可采集页面，弹窗现在解释限制及队列用途，仍可点击“打开队列”进入管理页；普通网页的采集预览流程不变。`npm test` 为 13 个测试文件、100 个测试通过，`npm run typecheck` 和 `npm run build` 均通过。
- 尚待在真实 Chrome 重新加载扩展后核对弹窗显示和按钮跳转；自动化测试不能代替这一步。

### 2026-10-19 已完成保留设置

- 新增独立“设置”页和已完成记录保留期限，默认永久保留。启用 30/90 天时，仅打开队列才执行清理；重复导出刷新保留期限。执行 `npm ci` 成功，审计结果为 0 项漏洞；`npm test` 为 13 个测试文件、98 个测试通过，`npm run typecheck`、`npm run build` 均通过。
- 此版尚未在真实 Chrome 中手工验证。更新扩展后，需检查设置保存、重开队列后的保留策略、收件箱不受影响、已完成再次导出，以及原有 ZIP/JSON/Markdown 下载流程。使用到期测试数据前请先导出需要保留的记录。

### 2026-10-18 队列页面调整

- 新增满屏列表与详情布局、“已完成”本地历史，以及 ZIP 批量导出。执行 `npm ci` 成功，审计结果为 0 项漏洞；`npm test` 为 13 个测试文件、84 个测试通过，`npm run typecheck`、`npm run build` 均通过。
- 在真实 Google Chrome 中打开已安装扩展的 `queue.html`，看到新版布局及 1 条本地记录；已确认导航、列表、详情面板和 ZIP 按钮正常显示。为保留这条现有记录，未在该 Chrome 实例中执行导出。用户将自行复验交互：先在 `chrome://extensions` 重新加载扩展并刷新队列页，再检查收件箱 ZIP 下载与内容、自动进入“已完成”、历史页搜索与再次导出，以及重开 Chrome 后的队列持久化。

### 2026-10-18 独立仓库切换状态

- 本仓库执行 `npm ci` 成功，审计结果为 0 项漏洞；`npm test` 为 13 个测试文件、69 个测试通过，`npm run typecheck` 和 `npm run build` 均通过。
- 切换前在旧扩展队列界面看到 2 条待同步记录。用户确认旧内容无需迁移，已自行卸载旧扩展，并在日常 Chrome 中安装新扩展，确认原有功能可用。
- 本次未逐项留证新扩展的采集预览、重开 Chrome 后的队列持久化、Markdown/JSON 导出。因此下方 2026-09-19 的细项清单仍只代表当时的检查状态，不应据此推断本次细项均已验证。

### 初始验证清单（执行前写入）

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` emits `dist/`.
- [ ] Chrome loads `dist/` through `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序.
- [ ] A logged-in Medium article and a generic public technical article show a preview before saving.
- [ ] Captures remain present after restarting Chrome.

### 2026-09-19 实际结果

- [x] `npm test` 通过：11 个测试文件、50 个测试全部通过。
- [x] `npm run typecheck` 通过。
- [x] `npm run build` 通过，并生成 `dist/`。构建输出测试同时核验了 MV3 manifest、background/content/popup/queue 入口文件。
已尝试打开 `chrome://extensions`，但当前自动化环境的浏览器 URL 安全策略禁止访问该 Chrome 内部页面；没有采用绕过方式。因此下面的 **8 项真实 Chrome UI 检查均未执行**。第 1 项是加载扩展的前置条件；其余 7 项是后续的手工验证。它们不是自动化测试的替代项，也不应被上方的构建或测试结果视为已完成。

- [ ] 通过 `chrome://extensions` → 开发者模式 → “加载已解压的扩展程序”加载 `dist/`。
- [ ] 在已登录 Medium 文章中确认标题、作者、开头/结尾预览、远程图片 URL 和非空 Markdown；不登录、不绕过付费墙。
- [ ] 在公开通用技术文章中确认相对链接和 lazy image 会转为绝对 URL。
- [ ] 关闭弹窗而不保存时，不创建队列记录。
- [ ] 没有 Companion 进程时保存多条记录，并在重启 Chrome 后确认队列仍保留。
- [ ] 在同一页面正文未变时确认 exact duplicate 不创建第二条普通记录。
- [ ] 确认已同步记录的正文变更后创建带 `supersedes` 的新记录（当前仅有仓储测试覆盖，仍待真实 UI/同步流程可用后复验）。
- [ ] 在真实 Chrome UI 中确认 JSON/Markdown 导出、重复候选“提升为独立记录”，以及“打开来源后重新采集”的流程。

上述初始自动化测试覆盖了关闭弹窗不保存、同页重复候选、已同步记录变更后的 `supersedes`、远程图片 URL 的 Markdown 导出，以及当时默认排除未提升重复候选的 JSON 导出。当前队列已允许直接导出重复候选；自动化测试仍不构成真实 Chrome UI 验证。
