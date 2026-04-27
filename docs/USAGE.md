# KarMind Usage Guide

[中文指南](USAGE.zh-CN.md)

KarMind helps you turn scattered source notes into a maintained wiki. The core loop is:

```text
collect -> compile -> ask -> backfill -> health check -> collect more
```

## 1. Set up KarMind

1. Open **Settings -> KarMind**.
2. Set **LLM API base URL** to an OpenAI-compatible endpoint.
3. Select or create an **API key** secret.
4. Confirm these folders:
   - `raw/`: source material you collect.
   - `wiki/`: pages KarMind generates and maintains.
   - `skills/`: optional declarative skills, one folder per skill.
5. Keep **Default permission** as **Basic Q&A** unless you want new conversations to start with note-writing access.

KarMind only sends note content to your configured LLM API when you run model-powered actions.

## 2. Collect raw material

Put source notes into `raw/`. Good raw material includes:

- Web clippings.
- Paper notes.
- Reading notes.
- Meeting notes.
- Code or project notes.
- Personal research fragments.

Raw notes should be treated as source material. KarMind reads them, but the main compiled knowledge should live in `wiki/`.

For web articles, the recommended capture tool is the [Obsidian Web Clipper](https://obsidian.md/clipper) browser extension. Clip articles into Markdown, save them under `raw/`, then run `/compile` when you are ready to integrate them into the wiki.

## 3. Compile raw notes

Run:

```text
/compile
```

KarMind reads changed files in `raw/`, sends them to the configured LLM, and writes structured pages into `wiki/`.

Compilation can consume a large number of tokens, especially when raw files are long or many files changed at once. Start with a small batch when you are testing a new provider or prompt setup.

Use:

```text
/compile --force
```

only when you want to recompile all raw notes. Normal `/compile` uses `wiki/.karmind/source-manifest.json` to skip unchanged files and save tokens.

Use compile when:

- You added new source material.
- You edited existing raw notes.
- You want raw material converted into topic pages, summaries, and links.

Do not use compile for one-off questions. Use `/qa` instead.

## 4. Ask questions

Run:

```text
/qa your question
```

KarMind scans relevant `wiki/` pages, sends selected context to the LLM, and answers in chat.

Use QA when:

- You want to understand what your wiki already knows.
- You want a synthesis across multiple wiki pages.
- You are exploring an idea but are not sure it should be saved yet.

If the answer is valuable, use `/backfill` to save it.

## 5. Backfill useful results

Run:

```text
/backfill content to save
```

Backfill asks the LLM how to integrate the content into the wiki. It may create new pages or update existing pages, then updates `_index.md` and appends to `log.md`.

Use backfill when:

- A QA answer is worth keeping.
- You generated a useful comparison, summary, plan, or insight.
- You want to add a missing concept page found during a health check.
- You want to merge a refined conclusion into existing wiki pages.

Example:

```text
/backfill Save this insight: three-sum is usually solved by sorting, fixing one number, then using two pointers. Link it to [[Two pointers]], [[Deduplication]], and [[LeetCode]].
```

Avoid backfill when:

- The content is unreviewed source material. Put it in `raw/` and compile it instead.
- You are not comfortable letting KarMind edit wiki pages.
- You need a precise diff review. KarMind currently records file operations, but it does not yet provide a full pre-apply diff approval step.

## 6. Run health checks

Run:

```text
/health
```

KarMind checks for broken links, orphan pages, missing concepts, graph structure issues, and LLM-detected consistency gaps.

Reports are saved under:

```text
wiki/_reports/health/
```

Use health checks when:

- The wiki has grown and feels messy.
- You see many broken links.
- You want suggestions for missing concept pages.
- You want to decide what to backfill or compile next.

## 7. Use skills

Run:

```text
/skills
```

to list available skills.

Run:

```text
/skill <id> [args...]
```

to execute a skill manually.

Declarative vault skills live in:

```text
skills/<skill-name>/skill.md
```

KarMind also exposes enabled skills to the model so it can suggest relevant skill usage in conversation.

## 8. Permissions and safety

KarMind has two conversation permission levels:

- **Basic Q&A**: safer default for normal chat and `/qa`.
- **Enhanced Notes**: allows commands that read or write notes, including `/compile`, `/backfill`, `/health`, and `/skill`.

Sensitive operations show confirmation prompts. Compile may consume many tokens. Enhanced note operations can create or update files.

## 9. Suggested workflow

For a normal knowledge-building session:

1. Add source files to `raw/`.
2. Run `/compile`.
3. Browse the generated `wiki/` pages in Obsidian.
4. Ask focused questions with `/qa`.
5. Save valuable answers with `/backfill`.
6. Run `/health` after the wiki grows.
7. Fix or backfill the highest-value issues.

The goal is not to make every chat answer permanent. Only backfill results that improve the long-term wiki.

## 10. Troubleshooting

- If `/compile` does nothing, check whether raw files are unchanged. Use `/compile --force` if you intentionally want to reprocess everything.
- If a command needs more access, approve the enhanced permission prompt.
- If LLM requests fail, check API base URL, model name, API key secret, and provider network behavior.
- If wiki links are highlighted but do not open, reload the plugin after updating to the latest build.
- If generated markdown looks wrong, edit the wiki page manually or ask KarMind to backfill a corrected version.
