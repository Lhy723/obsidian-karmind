import {App, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {SYSTEM_PROMPT_COMPILE, SYSTEM_PROMPT_COMPILE_VERSION} from '../constants';
import {ensureFolder} from '../utils/ensure-folder';
import {t} from '../i18n';
import {type FileOperationLog} from '../types';
import {SourceManifest, WikiStateStore} from './wiki-state';

export interface CompileProgress {
	phase: 'preparing' | 'scanning' | 'file-start' | 'file-complete' | 'file-error' | 'complete';
	completed: number;
	total: number;
	currentPath?: string;
	wikiPath?: string;
	message?: string;
	error?: string;
}

interface CompileOptions {
	instruction?: string;
	force?: boolean;
	signal?: AbortSignal;
	onProgress?: (progress: CompileProgress) => void;
	onFileOperation?: (operation: FileOperationLog) => void;
}

interface RawCompileCandidate {
	file: TFile;
	content: string;
}

interface CompilationAction {
	action: 'create_page' | 'update_page' | 'append_section';
	path: string;
	content: string;
}

export class Compiler {
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

	async compileRaw(input?: string | CompileOptions): Promise<string> {
		const options = typeof input === 'string' ? {instruction: input} : input ?? {};
		const {instruction, force = false, signal, onProgress, onFileOperation} = options;

		throwIfAborted(signal);
		onProgress?.({
			phase: 'preparing',
			completed: 0,
			total: 0,
			message: t(this.settings.language, 'compilerPreparingRawFolder'),
		});

		await ensureFolder(this.app, this.settings.rawFolder);

		const rawFolder = this.app.vault.getAbstractFileByPath(this.settings.rawFolder);
		if (!rawFolder || !(rawFolder instanceof TFolder)) {
			throw new Error(`Raw folder "${this.settings.rawFolder}" not found.`);
		}

		onProgress?.({
			phase: 'scanning',
			completed: 0,
			total: 0,
			message: force ? t(this.settings.language, 'compilerScanningAllRawFiles') : t(this.settings.language, 'compilerScanningUncompiledRawFiles'),
		});

		await ensureFolder(this.app, this.settings.wikiFolder);
		const manifest = await this.wikiState.loadManifest();
		const rawFiles = await this.getRawFiles(rawFolder, force, manifest);
		onFileOperation?.({
			action: 'scan',
			path: rawFolder.path,
			detail: t(this.settings.language, 'compilerOperationScanRaw'),
			timestamp: Date.now(),
		});
		if (rawFiles.length === 0) {
			return t(this.settings.language, 'compilerNoUncompiledRawFiles');
		}

		const results: string[] = [];
		let compiledCount = 0;

		for (const candidate of rawFiles) {
			const {file, content} = candidate;
			const wikiPath = this.getWikiPath(file.name);
			try {
				throwIfAborted(signal);
				onProgress?.({
					phase: 'file-start',
					completed: compiledCount,
					total: rawFiles.length,
					currentPath: file.path,
					wikiPath,
					message: t(this.settings.language, 'compilerCompilingPath', {path: file.path}),
				});

				onFileOperation?.({
					action: 'read',
					path: file.path,
					detail: t(this.settings.language, 'compilerOperationReadRaw'),
					preview: createPreview(content),
					timestamp: Date.now(),
				});
				const compiled = await this.compileFile(file.name, content, instruction);

				throwIfAborted(signal);
				const touchedPages = await this.applyCompilationOutput(compiled, wikiPath, file.path, onFileOperation);
				this.wikiState.recordSource(
					manifest,
					file,
					content,
					touchedPages,
					this.settings.model,
					SYSTEM_PROMPT_COMPILE_VERSION,
				);
				const manifestAction = await this.wikiState.saveManifest(manifest);
				onFileOperation?.({
					action: manifestAction,
					path: this.wikiState.getManifestPath(),
					detail: t(this.settings.language, 'compilerOperationWriteManifest'),
					timestamp: Date.now(),
				});
				const logAction = await this.wikiState.appendLog({
					type: 'ingest',
					title: file.basename,
					summary: t(this.settings.language, 'compilerCompiledLine', {name: file.name, path: touchedPages.join(', ')}),
					sourcePath: file.path,
					touchedPages,
				});
				onFileOperation?.({
					action: logAction,
					path: `${this.settings.wikiFolder}/log.md`,
					detail: t(this.settings.language, 'compilerOperationWriteLog'),
					timestamp: Date.now(),
				});

				results.push(t(this.settings.language, 'compilerCompiledLine', {name: file.name, path: touchedPages.join(', ')}));
				compiledCount++;
				onProgress?.({
					phase: 'file-complete',
					completed: compiledCount,
					total: rawFiles.length,
					currentPath: file.path,
					wikiPath,
					message: t(this.settings.language, 'compilerCompiledPath', {path: file.path}),
				});
			} catch (error) {
				if (isAbortError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				results.push(t(this.settings.language, 'compilerFailedLine', {name: file.name, error: message}));
				onProgress?.({
					phase: 'file-error',
					completed: compiledCount,
					total: rawFiles.length,
					currentPath: file.path,
					wikiPath,
					message: t(this.settings.language, 'compilerFailedPath', {path: file.path}),
					error: message,
				});
			}
		}

		const indexAction = await this.updateWikiIndex();
		onFileOperation?.({
			action: indexAction,
			path: `${this.settings.wikiFolder}/_index.md`,
			detail: t(this.settings.language, 'compilerOperationWriteIndex'),
			timestamp: Date.now(),
		});
		onProgress?.({
			phase: 'complete',
			completed: compiledCount,
			total: rawFiles.length,
			message: t(this.settings.language, 'compilerCompilationComplete'),
		});

		return `${t(this.settings.language, 'compilerCompiledResult', {compiled: compiledCount, total: rawFiles.length})}\n\n${results.join('\n')}`;
	}

	async compileSingleFile(file: TFile, instruction?: string): Promise<string> {
		const content = await this.app.vault.read(file);
		const compiled = await this.compileFile(file.name, content, instruction);

		await ensureFolder(this.app, this.settings.wikiFolder);

		const wikiPath = this.getWikiPath(file.name);
		const touchedPages = await this.applyCompilationOutput(compiled, wikiPath, file.path);
		const manifest = await this.wikiState.loadManifest();
		this.wikiState.recordSource(manifest, file, content, touchedPages, this.settings.model, SYSTEM_PROMPT_COMPILE_VERSION);
		await this.wikiState.saveManifest(manifest);
		await this.wikiState.appendLog({
			type: 'ingest',
			title: file.basename,
			summary: t(this.settings.language, 'compilerCompiledLine', {name: file.name, path: touchedPages.join(', ')}),
			sourcePath: file.path,
			touchedPages,
		});
		await this.updateWikiIndex();

		return t(this.settings.language, 'compilerCompiledLine', {name: file.name, path: touchedPages.join(', ')});
	}

	private async compileFile(fileName: string, content: string, instruction?: string): Promise<string> {
		const existingWiki = await this.getExistingWikiContext();

		const userMessage = instruction
			? `Compile the following raw note into the persistent wiki. Prefer structured JSON actions that create, update, or append to multiple wiki pages when useful.\n\nInstruction: ${instruction}\n\nFile: ${fileName}\n\nContent:\n${content}\n\n${existingWiki}`
			: `Compile the following raw note into the persistent wiki. Prefer structured JSON actions that create, update, or append to multiple wiki pages when useful. Use proper structure, summaries, concept categorization, and cross-references using [[wiki-links]].\n\nFile: ${fileName}\n\nContent:\n${content}\n\n${existingWiki}`;

		return await this.llmClient.chat([
			{role: 'system', content: SYSTEM_PROMPT_COMPILE},
			{role: 'user', content: userMessage},
		]);
	}

	private async getRawFiles(folder: TFolder, force: boolean, manifest: SourceManifest): Promise<RawCompileCandidate[]> {
		const files: RawCompileCandidate[] = [];
		const markdownFiles = this.app.vault.getMarkdownFiles();
		let manifestChanged = false;

		for (const file of markdownFiles) {
			if (file.path.startsWith(folder.path + '/')) {
				const content = await this.app.vault.cachedRead(file);
				const cache = this.app.metadataCache.getFileCache(file);
				const karmindMeta = cache?.frontmatter?.karmind as Record<string, unknown> | undefined;
				const legacyCompiled = karmindMeta?.compiled === true;
				const legacyWikiPath = this.getWikiPath(file.name);
				const legacyWiki = this.app.vault.getAbstractFileByPath(legacyWikiPath);
				if (!force && legacyCompiled && !manifest.sources[file.path] && legacyWiki instanceof TFile) {
					this.wikiState.recordSource(manifest, file, content, [legacyWikiPath], this.settings.model, SYSTEM_PROMPT_COMPILE_VERSION);
					manifestChanged = true;
					continue;
				}
				if (force || !this.wikiState.isSourceCurrent(manifest, file, content, SYSTEM_PROMPT_COMPILE_VERSION)) {
					files.push({file, content});
				}
			}
		}

		if (manifestChanged) {
			await this.wikiState.saveManifest(manifest);
		}

		return files;
	}

	private getWikiPath(rawFileName: string): string {
		const baseName = rawFileName.replace(/\.md$/, '');
		return `${this.settings.wikiFolder}/${baseName}.md`;
	}

	private async writeWikiPage(wikiPath: string, content: string, sourcePath: string): Promise<'create' | 'update'> {
		const pageContent = withWikiFrontmatter(content, sourcePath);

		const existingFile = this.app.vault.getAbstractFileByPath(wikiPath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, pageContent);
			return 'update';
		} else {
			await ensureFolder(this.app, wikiPath.substring(0, wikiPath.lastIndexOf('/')));
			await this.app.vault.create(wikiPath, pageContent);
			return 'create';
		}
	}

	private async applyCompilationOutput(
		output: string,
		fallbackWikiPath: string,
		sourcePath: string,
		onFileOperation?: (operation: FileOperationLog) => void,
	): Promise<string[]> {
		const actions = parseCompilationActions(output);
		if (actions.length === 0) {
			const writeAction = await this.writeWikiPage(fallbackWikiPath, output, sourcePath);
			onFileOperation?.({
				action: writeAction,
				path: fallbackWikiPath,
				detail: t(this.settings.language, 'compilerOperationWriteWiki'),
				preview: createPreview(output),
				timestamp: Date.now(),
			});
			return [fallbackWikiPath];
		}

		const touchedPages: string[] = [];
		for (const action of actions) {
			const path = `${this.settings.wikiFolder}/${sanitizeWikiActionPath(action.path)}`;
			const existing = this.app.vault.getAbstractFileByPath(path);

			if (action.action === 'append_section' && existing instanceof TFile) {
				await this.app.vault.process(existing, (data) => `${data.trimEnd()}\n\n${action.content.trim()}\n`);
				onFileOperation?.({
					action: 'update',
					path,
					detail: t(this.settings.language, 'compilerOperationApplyAction'),
					preview: createPreview(action.content),
					timestamp: Date.now(),
				});
			} else {
				const writeAction = await this.writeWikiPage(path, action.content, sourcePath);
				onFileOperation?.({
					action: writeAction,
					path,
					detail: t(this.settings.language, 'compilerOperationApplyAction'),
					preview: createPreview(action.content),
					timestamp: Date.now(),
				});
			}

			touchedPages.push(path);
		}

		return Array.from(new Set(touchedPages));
	}

	private async getExistingWikiContext(): Promise<string> {
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiFolder);
		if (!wikiFolder || !(wikiFolder instanceof TFolder)) {
			return '';
		}

		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && !isSpecialWikiFile(f));

		if (wikiFiles.length === 0) {
			return '';
		}

		const indexList = wikiFiles
			.map(f => `- [[${f.basename}]]`)
			.join('\n');

		return `Existing wiki pages for cross-referencing:\n${indexList}`;
	}

	private async updateWikiIndex(): Promise<'create' | 'update'> {
		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && !isSpecialWikiFile(f));

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

function parseCompilationActions(output: string): CompilationAction[] {
	const jsonMatch = output.match(/\[[\s\S]*\]/);
	if (!jsonMatch) return [];

	try {
		const parsed = JSON.parse(jsonMatch[0]) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isCompilationAction);
	} catch {
		return [];
	}
}

function isCompilationAction(value: unknown): value is CompilationAction {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<CompilationAction>;
	return (candidate.action === 'create_page' || candidate.action === 'update_page' || candidate.action === 'append_section')
		&& typeof candidate.path === 'string'
		&& candidate.path.trim().length > 0
		&& typeof candidate.content === 'string'
		&& candidate.content.trim().length > 0;
}

function sanitizeWikiActionPath(path: string): string {
	const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').trim();
	if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
		throw new Error(`Unsafe wiki action path: ${path}`);
	}
	if (normalized === '_index.md' || normalized === 'log.md' || normalized.startsWith('.karmind/')) {
		throw new Error(`Wiki action path is reserved: ${path}`);
	}
	return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
}

function withWikiFrontmatter(content: string, sourcePath: string): string {
	const trimmed = content.trimStart();
	if (trimmed.startsWith('---')) return content;
	return `---\nkarmind:\n  type: wiki\n  source: "${sourcePath}"\n  compiledAt: ${Date.now()}\n---\n\n${content}`;
}

function isSpecialWikiFile(file: TFile): boolean {
	return file.basename === '_index' || file.basename === 'log' || file.path.includes('/.karmind/');
}

function createPreview(content: string): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	return normalized.length > 420 ? normalized.substring(0, 420) + '...' : normalized;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw new DOMException('Compilation aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
		|| error instanceof Error && error.name === 'AbortError';
}
