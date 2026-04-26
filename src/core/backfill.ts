import {App, TFile} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {SYSTEM_PROMPT_BACKFILL} from '../constants';
import {ensureFolder} from '../utils/ensure-folder';
import {t} from '../i18n';
import {type FileOperationLog} from '../types';
import {WikiStateStore} from './wiki-state';

interface BackfillAction {
	action: 'update' | 'create';
	path: string;
	content: string;
	append?: boolean;
}

interface BackfillOptions {
	onFileOperation?: (operation: FileOperationLog) => void;
}

export class BackfillEngine {
	private app: App;
	private llmClient: LLMClient;
	private settings: KarMindSettings;
	private wikiState: WikiStateStore;

	constructor(app: App, llmClient: LLMClient, settings: KarMindSettings) {
		this.app = app;
		this.llmClient = llmClient;
		this.settings = settings;
		this.wikiState = new WikiStateStore(app, settings.wikiFolder);
	}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
		this.wikiState.updateWikiFolder(settings.wikiFolder);
	}

	async backfill(content: string, options: BackfillOptions = {}): Promise<string> {
		await ensureFolder(this.app, this.settings.wikiFolder);

		const wikiContext = await this.getWikiContext(options.onFileOperation);

		const result = await this.llmClient.chat([
			{role: 'system', content: SYSTEM_PROMPT_BACKFILL},
			{role: 'user', content: `Backfill the following content into the wiki.\n\nContent:\n${content}\n\n${wikiContext}\n\nRespond with a JSON array of actions. Each action must have: "action" ("update" or "create"), "path" (relative to wiki folder, e.g. "my-topic.md"), "content" (the content to add or append), and "append" (true to append to existing page, false to replace). Example:\n[{"action":"update","path":"machine-learning.md","content":"## New Section\\n...","append":true},{"action":"create","path":"new-topic.md","content":"# New Topic\\n...","append":false}]`},
		]);

		const actions = this.parseActions(result);
		if (actions.length === 0) {
			const logPath = await this.saveBackfillLog(result);
			options.onFileOperation?.({
				action: 'create',
				path: logPath,
				detail: t(this.settings.language, 'backfillOperationSaveLog'),
				preview: createPreview(result),
				timestamp: Date.now(),
			});
			const wikiLogAction = await this.wikiState.appendLog({
				type: 'backfill',
				title: 'Unstructured backfill analysis',
				summary: 'Saved LLM backfill output as a log because no structured actions were found.',
				touchedPages: [logPath],
			});
			options.onFileOperation?.({
				action: wikiLogAction,
				path: `${this.settings.wikiFolder}/log.md`,
				detail: t(this.settings.language, 'compilerOperationWriteLog'),
				timestamp: Date.now(),
			});
			return `Backfill analysis complete (no structured actions found, saved as log):\n\n${result}`;
		}

		const applied = await this.applyActions(actions, options.onFileOperation);
		const indexAction = await this.updateWikiIndex();
		options.onFileOperation?.({
			action: indexAction,
			path: `${this.settings.wikiFolder}/_index.md`,
			detail: t(this.settings.language, 'backfillOperationWriteIndex'),
			timestamp: Date.now(),
		});
		const wikiLogAction = await this.wikiState.appendLog({
			type: 'backfill',
			title: `Applied ${applied} action(s)`,
			summary: content.substring(0, 180).replace(/\s+/g, ' ').trim(),
			touchedPages: actions.map(action => `${this.settings.wikiFolder}/${action.path}`),
		});
		options.onFileOperation?.({
			action: wikiLogAction,
			path: `${this.settings.wikiFolder}/log.md`,
			detail: t(this.settings.language, 'compilerOperationWriteLog'),
			timestamp: Date.now(),
		});

		return `Backfill applied ${applied} action(s):\n\n${actions.map(a => `- [${a.action}] ${a.path}${a.append ? ' (appended)' : ''}`).join('\n')}`;
	}

	async backfillChatResult(question: string, answer: string): Promise<string> {
		const content = `## Q&A Result\n\n**Question:** ${question}\n\n**Answer:** ${answer}`;
		return await this.backfill(content);
	}

	private parseActions(llmOutput: string): BackfillAction[] {
		const jsonMatch = llmOutput.match(/\[[\s\S]*\]/);
		if (!jsonMatch) return [];

		try {
			const parsed = JSON.parse(jsonMatch[0]) as BackfillAction[];
			if (!Array.isArray(parsed)) return [];

			return parsed.filter(a =>
				a.action &&
				(a.action === 'update' || a.action === 'create') &&
				typeof a.path === 'string' &&
				a.path.length > 0 &&
				typeof a.content === 'string',
			);
		} catch {
			return [];
		}
	}

	private async applyActions(actions: BackfillAction[], onFileOperation?: (operation: FileOperationLog) => void): Promise<number> {
		let applied = 0;

		for (const action of actions) {
			try {
				const fullPath = `${this.settings.wikiFolder}/${action.path}`;

				if (action.action === 'create') {
					const existing = this.app.vault.getAbstractFileByPath(fullPath);
					if (existing instanceof TFile) {
						if (action.append) {
							await this.app.vault.process(existing, (data) => data + '\n\n' + action.content);
						} else {
							await this.app.vault.modify(existing, action.content);
						}
						onFileOperation?.({
							action: 'update',
							path: fullPath,
							detail: t(this.settings.language, 'backfillOperationUpdate'),
							preview: createPreview(action.content),
							timestamp: Date.now(),
						});
					} else {
						await ensureFolder(this.app, fullPath.substring(0, fullPath.lastIndexOf('/')));
						await this.app.vault.create(fullPath, action.content);
						onFileOperation?.({
							action: 'create',
							path: fullPath,
							detail: t(this.settings.language, 'backfillOperationCreate'),
							preview: createPreview(action.content),
							timestamp: Date.now(),
						});
					}
					applied++;
				} else if (action.action === 'update') {
					const existing = this.app.vault.getAbstractFileByPath(fullPath);
					if (existing instanceof TFile) {
						if (action.append) {
							await this.app.vault.process(existing, (data) => data + '\n\n' + action.content);
						} else {
							await this.app.vault.modify(existing, action.content);
						}
						onFileOperation?.({
							action: 'update',
							path: fullPath,
							detail: t(this.settings.language, 'backfillOperationUpdate'),
							preview: createPreview(action.content),
							timestamp: Date.now(),
						});
						applied++;
					}
				}
			} catch (error) {
				console.error(`[KarMind Backfill] Failed to apply action:`, action, error);
			}
		}

		return applied;
	}

	private async getWikiContext(onFileOperation?: (operation: FileOperationLog) => void): Promise<string> {
		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && f.basename !== '_index' && f.basename !== 'log' && !f.path.includes('/.karmind/'));
		onFileOperation?.({
			action: 'scan',
			path: this.settings.wikiFolder,
			detail: t(this.settings.language, 'backfillOperationScanWiki'),
			timestamp: Date.now(),
		});

		if (wikiFiles.length === 0) {
			return 'No existing wiki pages found.';
		}

		const indexList = wikiFiles
			.map(f => `- [[${f.basename}]]`)
			.join('\n');

		return `Existing wiki pages:\n${indexList}`;
	}

	private async saveBackfillLog(result: string): Promise<string> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const fileName = `backfill-${timestamp}.md`;
		const filePath = `${this.settings.wikiFolder}/${fileName}`;

		const frontmatter = `---\nkarmind:\n  type: backfill\n  createdAt: ${Date.now()}\n---\n\n`;

		await this.app.vault.create(filePath, frontmatter + result);
		return filePath;
	}

	private async updateWikiIndex(): Promise<'create' | 'update'> {
		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && f.basename !== '_index' && f.basename !== 'log' && !f.path.includes('/.karmind/'));

		const indexPath = `${this.settings.wikiFolder}/_index.md`;
		const concepts: Record<string, string[]> = {};

		for (const file of wikiFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const tags = cache?.tags?.map(t => t.tag.replace('#', '')) ?? [];

			for (const tag of tags) {
				if (!concepts[tag]) concepts[tag] = [];
				concepts[tag].push(file.basename);
			}
		}

		let indexContent = `---\nkarmind:\n  type: index\n  updatedAt: ${Date.now()}\n---\n\n# Wiki Index\n\n`;

		indexContent += `## All Pages\n\n`;
		for (const file of wikiFiles) {
			if (file.basename === '_index') continue;
			indexContent += `- [[${file.basename}]]\n`;
		}

		indexContent += `\n## Concepts\n\n`;
		for (const [concept, pages] of Object.entries(concepts)) {
			indexContent += `### ${concept}\n`;
			for (const page of pages) {
				indexContent += `- [[${page}]]\n`;
			}
			indexContent += '\n';
		}

		const existingIndex = this.app.vault.getAbstractFileByPath(indexPath);
		if (existingIndex instanceof TFile) {
			await this.app.vault.modify(existingIndex, indexContent);
			return 'update';
		} else {
			await this.app.vault.create(indexPath, indexContent);
			return 'create';
		}
	}
}

function createPreview(content: string): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	return normalized.length > 420 ? normalized.substring(0, 420) + '...' : normalized;
}
