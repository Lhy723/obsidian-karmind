# KarMind

[English README](README.md)

KarMind 是一个 Obsidian 插件，用 LLM 帮你把个人资料逐步编译成可持续维护的知识 wiki。它遵循“收集、编译、提问、回填、优化”的工作流。

## KarMind 能做什么

- 把原始素材收集到可配置的 `raw/` 文件夹。
- 把变化过的 raw 笔记编译成持久化、互相链接的 `wiki/`。
- 基于相关 wiki 页面进行问答。
- 把有价值的回答、分析和结论回填到 wiki。
- 检查断链、孤立页面、缺失概念和一致性问题。
- 在聊天面板中展示长任务进度和文件操作记录。

## 工作流

1. 把素材放入 `raw/`。
2. 运行 `/compile`，把 raw 素材编译成 wiki 页面。
3. 使用 `/qa 你的问题` 基于 wiki 提问。
4. 使用 `/backfill 内容` 保存有价值的输出。
5. 使用 `/health` 检查 wiki 质量。

KarMind 会用内容 hash 在 `wiki/.karmind/source-manifest.json` 中记录编译状态。未变化的 raw 文件会被跳过；如果需要强制重编译，可以运行 `/compile --force`。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/compile` | 把变化过的 raw 笔记编译成 wiki 页面。 |
| `/compile --force` | 强制重新编译所有 raw 笔记。 |
| `/qa 你的问题` | 基于相关 wiki 页面回答问题。 |
| `/backfill 内容` | 把分析或生成内容保存回 wiki。 |
| `/health` | 检查链接、孤立页面、缺口和一致性问题。 |
| `/skills` | 查看可用 skills。 |
| `/skill <id> [args...]` | 执行某个 skill。 |
| `/help` | 查看命令列表。 |
| `/new` | 开始新对话。 |
| `/clear` | 清空当前对话。 |

KarMind 也会在聊天中建议下一步工作流操作。建议操作需要用户确认后才会执行。

## 设置

- **语言**：英文或中文界面。
- **LLM API 地址**：兼容 OpenAI 的接口，例如 `https://api.openai.com/v1`。
- **API key**：通过 Obsidian SecretStorage 保存。默认 secret ID 是 `karmind-api-key`。
- **模型**：传给兼容 OpenAI API 的模型名称。
- **Raw 文件夹**：保存原始素材的文件夹。
- **Wiki 文件夹**：保存编译后 wiki 页面的文件夹。
- **流式响应**：使用浏览器 `fetch` 和 Server-Sent Events。如果服务商被 `app://obsidian.md` 的 CORS 拦截，请关闭。
- **默认权限**：基础问答或增强笔记操作。

## 隐私和网络请求

KarMind 不包含遥测、广告或自动更新机制。

KarMind 只会在你运行 LLM 相关操作或测试 LLM 连接时发起网络请求。请求会发送到你配置的 API 地址。根据命令不同，请求内容可能包括：

- 你的聊天消息。
- 相关 wiki 页面内容。
- 编译时的 raw 原始笔记内容。
- 回填内容。
- 健康检查时的 wiki 页面摘录。

你的 API 服务商可能会根据其政策记录或处理这些数据。除非你信任所配置的服务商，否则不要把 KarMind 用于敏感笔记。

API key 会通过 Obsidian SecretStorage 保存在本地。KarMind 会把对话历史和插件设置保存在当前 vault 的插件数据中。

## KarMind 会写入哪些文件

KarMind 只会写入你的 Obsidian vault 内部：

- `raw/`：你收集的原始素材。
- `wiki/`：生成的 wiki 页面。
- `wiki/_index.md`：生成的 wiki 索引。
- `wiki/log.md`：追加式工作流日志。
- `wiki/.karmind/source-manifest.json`：source hash 缓存。
- `wiki/_health-*.md`：健康检查报告。

## 开发安装

```bash
npm install
npm run build
```

本地测试时，将本仓库放在或复制到：

```text
<Vault>/.obsidian/plugins/obsidian-karmind/
```

然后在 **设置 -> 第三方插件** 中启用 **KarMind**。

## 发布资产

创建 GitHub release 时，上传以下文件作为 release assets：

- `main.js`
- `manifest.json`
- `styles.css`

release tag 必须与 `manifest.json` 中的版本号完全一致，例如 `0.1.0`。

## 社区插件提交信息

提交到 `obsidianmd/obsidian-releases` 的条目：

```json
{
  "id": "karmind",
  "name": "KarMind",
  "author": "Lhy723",
  "description": "Manage notes with LLM-powered wiki compilation, Q&A, backfill, and health checks.",
  "repo": "Lhy723/obsidian-karmind"
}
```

## 第三方代码和依赖

- React 和 React DOM 用于插件界面。
- `motion` 用于界面动画。
- 动效组件模式参考并改写自 React Bits 的 `AnimatedList`、`BlurText` 和 `ShinyText` 示例。

## 许可证

MIT License。详见 [LICENSE](LICENSE)。
