# AGENTS.md

本仓库是 Open Context Clipper 的独立源码仓库，属于 ApFramework Studio 的知识工具体系。

## 产品边界

- 插件只在用户主动操作时读取当前标签页已渲染的内容。
- 采集记录先保存在浏览器本地队列；不默认上传、后台轮询或写入 Open Context Forge 的 vault。
- 不读取或保存 cookies、登录凭据与浏览历史，不绕过登录墙或付费墙。
- 修改权限、采集时机或数据传输行为时，必须同步更新 README 的隐私说明及相应测试。

## 开发约定

- 源码位于 `src/`，测试位于 `tests/`，构建脚本位于 `scripts/`。
- `dist/` 和 `node_modules/` 是生成物，不提交到 Git。
- 修改后运行 `npm test`、`npm run typecheck` 和 `npm run build`。
- 只有真实 Chrome 手工验证才能确认扩展加载与页面交互；自动化测试不能替代这一步。
