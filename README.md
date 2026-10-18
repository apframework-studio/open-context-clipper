# Open Context Clipper（文脉采集器）

Open Context Clipper 是 ApFramework Studio 的独立浏览器采集工具，也是 [Open Context Forge](https://github.com/shoukai/open-context-forge) 的上游采集入口。它在用户主动打开插件时，读取当前标签页已经渲染出来的正文，展示精简预览；只有按下保存后，才会将 Markdown 采集记录写入本机离线队列。

它可以独立运行，不负责把内容写入 vault，也不启动知识整理、AI 处理或 Companion 同步。

## 前置条件

- Node.js 与 npm；本项目使用锁定的 npm 依赖。
- 桌面版 Google Chrome。
- 要采集登录后页面（例如 Medium）时，请自行在 Chrome 中保持已有登录状态；插件不会读取、保存或请求登录凭据。

## 本地安装

在本目录运行：

```bash
npm ci
npm run build
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录生成的 `dist/`。

每次修改源代码后重新执行 `npm run build`，再在扩展管理页点击扩展卡片的“重新加载”。`dist/` 是生成物，不提交到仓库。

## 使用方式

### 采集一篇网页文章

1. 在 Chrome 打开需要保存的文章。Medium 等登录页只会采集当前登录会话中**已经渲染、可见**的内容。
2. 点击工具栏中的 “Open Context Clipper”。插件会开始识别正文。
3. 在弹窗中核对标题、来源、作者、发布日期、字数、远程图片数量，以及开头和结尾预览。中间内容会折叠显示。
4. 可选地添加不超过 280 个字符的备注。
5. 点击“保存到采集队列”。在此之前关闭弹窗不会保存文章。

相同页面且正文未变化时，插件不会创建第二条普通队列记录；弹窗会显示已有采集提示。打开来源后需要由用户在新标签页再次点击插件，才会重新采集，这一设计保留了最小权限边界。

### 管理与导出离线队列

在弹窗中点击“打开队列”，可执行以下操作：

- 按状态筛选采集记录，编辑并保存备注，或打开原始来源。
- 单条导出为 Markdown；导出内容保留来源元数据和远程图片 URL。
- 勾选记录后导出 JSON。重复候选默认不参与批量导出；需要保留其独立来源时，先点击“提升为独立记录”。
- 删除前需要在页面中再次确认。删除无法撤销。

队列不需要 Companion 后台进程。v0.1 只有本地 IndexedDB 队列和显式导出；未来 Companion 同步接口仅保留类型边界，当前没有同步入口、后台轮询或自动任务。

## 隐私与数据边界

- 仅在用户打开弹窗后读取当前活动标签页的已渲染 DOM。
- 不读取 cookies、历史记录或登录凭据，也不会绕过登录墙、付费墙或反爬机制。
- Markdown 中保留绝对图片链接；不下载、不缓存图片二进制，也不保存原始 HTML 快照。
- 默认不向云端或任何 Companion 服务传输文章内容。
- 确认保存后的记录存放在扩展 origin 下的 IndexedDB。卸载扩展会清除这些扩展本地数据；重要内容请先导出。

## 已知限制

- 只能采集页面实际渲染出的内容；短页面、登录提示或付费墙预览可能被标记为警告，或无法形成可保存的正文。
- v0.1 没有 Chrome Web Store 发布、云同步、后台自动同步、AI 分类或 vault/raw 写入功能。
- 只支持 Chrome 的本地“加载已解压的扩展程序”安装方式。

## 开发与验证

```bash
npm ci
npm test
npm run typecheck
npm run build
```

自动化检查覆盖采集、队列、导出、构建产物与图标，但不能代替在真实 Chrome 中加载 `dist/` 后的手工验证。

## 开源协议

本项目以 [MIT License](LICENSE) 授权，版权归 Shoukai Huang 所有。第三方依赖仍遵循各自的许可证。仓库当前是否公开由 GitHub 仓库可见性设置决定，MIT 文件本身不会改变可见性。

## 历史验证记录

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

自动化测试已覆盖以下代码路径，但均**不构成**上述真实 Chrome UI 验证：关闭弹窗不保存、同页重复候选、已同步记录变更后的 `supersedes`、远程图片 URL 的 Markdown 导出，以及默认排除未提升重复候选的 JSON 导出。
