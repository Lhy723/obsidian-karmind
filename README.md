# KarMind

[中文说明](README.zh-CN.md)

KarMind is an Obsidian plugin for building a personal knowledge wiki with an LLM. It follows a "collect, compile, ask, backfill, improve" workflow inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern.

For step-by-step guidance, see the [usage guide](docs/USAGE.md).

## What KarMind does

- Collect raw materials in a configurable `raw/` folder.
- Compile changed raw notes into a persistent interlinked `wiki/`.
- Ask questions with relevant wiki context.
- Backfill useful answers and analysis into the wiki.
- Run health checks for broken links, orphan pages, missing concepts, and consistency issues.
- Show long-running task progress and file operations in the chat panel.

## Workflow

1. Put source material into `raw/`. For web articles, Obsidian Web Clipper is recommended.
2. Run `/compile` to turn raw material into wiki pages. This can consume many LLM tokens.
3. Ask questions with `/qa your question`.
4. Save useful outputs with `/backfill content`.
5. Run `/health` to inspect wiki quality.

KarMind keeps source compilation state in `wiki/.karmind/source-manifest.json` using content hashes. Unchanged raw files are skipped unless you run `/compile --force`.

## Commands

| Command | Description |
| --- | --- |
| `/compile` | Compile changed raw notes into wiki pages. This can consume many tokens. |
| `/compile --force` | Recompile all raw notes. |
| `/qa your question` | Answer using relevant wiki pages. |
| `/backfill content` | Save analysis or generated content back into the wiki. |
| `/health` | Check links, orphan pages, gaps, and consistency. |
| `/skills` | List available skills. |
| `/skill <id> [args...]` | Run a skill. |
| `/help` | Show commands. |
| `/new` | Start a new conversation. |
| `/clear` | Clear the current conversation. |

KarMind can also suggest workflow actions in chat. Suggested actions require user confirmation before they run.

## Settings

- **Language**: Follow Obsidian, English, or Chinese UI text.
- **LLM API base URL**: OpenAI-compatible endpoint, for example `https://api.openai.com/v1`.
- **API key**: Stored through Obsidian SecretStorage. The default secret ID is `karmind-api-key`.
- **Model**: Model name passed to the OpenAI-compatible API.
- **Raw folder**: Folder for source material.
- **Wiki folder**: Folder for compiled wiki pages.
- **Default permission**: Basic Q&A or enhanced note operations.

## Privacy and network use

KarMind does not include telemetry, ads, or automatic updates.

KarMind only makes network requests when you run LLM-powered actions or test the LLM connection. Requests are sent to the API base URL you configure. Depending on the command, the request may include:

- Your chat message.
- Relevant wiki pages.
- Raw source note content during compilation.
- Backfill content.
- Health-check excerpts from wiki pages.

Your API provider may log or process that data according to its own policy. Do not use KarMind with sensitive notes unless you trust the configured provider.

API keys are stored locally via Obsidian SecretStorage. KarMind stores conversation history and plugin settings in the plugin data for this vault.

## Files KarMind writes

KarMind writes only inside your Obsidian vault:

- `raw/`: source material you collect.
- `wiki/`: generated wiki pages.
- `wiki/_index.md`: generated wiki index.
- `wiki/log.md`: append-only workflow log.
- `wiki/.karmind/source-manifest.json`: source hash cache.
- `wiki/_reports/health/`: health-check reports.

## Installation for development

```bash
npm install
npm run build
```

For local testing, copy or keep this repository at:

```text
<Vault>/.obsidian/plugins/obsidian-karmind/
```

Then enable **KarMind** in **Settings -> Community plugins**.

## Release assets

For a GitHub release, attach these files as release assets:

- `main.js`
- `manifest.json`
- `styles.css`

The release tag must match `manifest.json` exactly, for example `0.1.1`.

## Community plugin submission

Submit this entry to `obsidianmd/obsidian-releases`:

```json
{
  "id": "karmind",
  "name": "KarMind",
  "author": "Lhy723",
  "description": "Manage notes with LLM-powered wiki compilation, Q&A, backfill, and health checks.",
  "repo": "Lhy723/obsidian-karmind"
}
```

## Third-party code and dependencies

- The knowledge workflow is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) idea file.
- React and React DOM are used for the plugin interface.
- `motion` is used for UI animation.
- Animated UI patterns are adapted from React Bits examples for `AnimatedList`, `BlurText`, and `ShinyText`.

## License

MIT License. See [LICENSE](LICENSE).
