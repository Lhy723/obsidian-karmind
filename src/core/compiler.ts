import {App, parseYaml, stringifyYaml, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {KARMIND_COMPILED_KEY, KARMIND_FRONTMATTER_KEY, KARMIND_RAW_TAG, KARMIND_WIKI_TAG, SYSTEM_PROMPT_COMPILE} from '../constants';
import {ensureFolder} from '../utils/ensure-folder';

type KarMindFrontmatter = {
	type?: string;
	compiled?: boolean;
	contentHash?: string;
	compiledAt?: number;
	compiledPath?: string;
	sourceMtime?: number;
	[key: string]: unknown;
};

export interface CompileProgress {
	phase: 'preparing' | 'empty' | 'file-start' | 'file-complete' | 'file-skip' | 'file-error' | 'indexing' | 'done';
	total: number;
	completed: number;
	currentPath?: string;
	wikiPath?: string;
	error?: string;
	message?: string;
}

export interface CompileOptions {
	instruction?: string;
	force?: boolean;
	signal?: AbortSignal;
	onProgress?: (progress: CompileProgress) => void;
}

export class Compiler {
	private app: App;
	private llmClient: LLMClient;
	private settings: KarMindSettings;

	constructor(app: App, llmClient: LLMClient, settings: KarMindSettings) {
		this.app = app;
		this.llmClient = llmClient;
		this.settings = settings;
	}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
	}

	async compileRaw(options: CompileOptions | string = {}): Promise<string> {
		const compileOptions = typeof options === 'string' ? {instruction: options} : options;
		const {instruction, force = false, signal, onProgress} = compileOptions;

		throwIfAborted(signal);
		onProgress?.({
			phase: 'preparing',
			total: 0,
			completed: 0,
			message: `Scanning ${this.settings.rawFolder}/ for raw notes...`,
		});

		await ensureFolder(this.app, this.settings.rawFolder);

		const rawFolder = this.app.vault.getAbstractFileByPath(this.settings.rawFolder);
		if (!rawFolder || !(rawFolder instanceof TFolder)) {
			throw new Error(`Raw folder "${this.settings.rawFolder}" not found.`);
		}

		const rawFiles = this.getRawFiles(rawFolder);
		if (rawFiles.length === 0) {
			onProgress?.({
				phase: 'empty',
				total: 0,
				completed: 0,
				message: 'No uncompiled raw files found.',
			});
			return 'No uncompiled raw files found. Add notes to the raw folder and mark them as raw material first.';
		}

		await ensureFolder(this.app, this.settings.wikiFolder);

		const results: string[] = [];
		let compiledCount = 0;
		let skippedCount = 0;

		for (const file of rawFiles) {
			throwIfAborted(signal);
			const wikiPath = this.getWikiPath(file.name);
			const content = await this.app.vault.read(file);
			const contentHash = hashString(content);
			const cacheState = this.getCompileCacheState(file, contentHash, wikiPath);
			if (!force && cacheState.isFresh) {
				skippedCount++;
				results.push(`[SKIP] Cached: ${file.name} -> ${wikiPath}`);
				onProgress?.({
					phase: 'file-skip',
					total: rawFiles.length,
					completed: compiledCount,
					currentPath: file.path,
					wikiPath,
					message: `Skipped unchanged file ${file.path}`,
				});
				continue;
			}

			onProgress?.({
				phase: 'file-start',
				total: rawFiles.length,
				completed: compiledCount,
				currentPath: file.path,
				wikiPath,
				message: `Compiling ${file.path} -> ${wikiPath}`,
			});

			try {
				const compiled = await this.compileFile(file.name, content, instruction, signal);

				await this.writeWikiPage(wikiPath, compiled, file.path);

				await this.markAsCompiled(file, contentHash, wikiPath);

				results.push(`[OK] Compiled: ${file.name} -> ${wikiPath}`);
				compiledCount++;
				onProgress?.({
					phase: 'file-complete',
					total: rawFiles.length,
					completed: compiledCount,
					currentPath: file.path,
					wikiPath,
					message: `Compiled ${file.path}`,
				});
			} catch (error) {
				if (isAbortError(error)) {
					throw error;
				}
				results.push(`[FAIL] ${file.name} -- ${error instanceof Error ? error.message : String(error)}`);
				onProgress?.({
					phase: 'file-error',
					total: rawFiles.length,
					completed: compiledCount,
					currentPath: file.path,
					wikiPath,
					error: error instanceof Error ? error.message : String(error),
					message: `Failed ${file.path}`,
				});
			}
		}

		throwIfAborted(signal);
		onProgress?.({
			phase: 'indexing',
			total: rawFiles.length,
			completed: compiledCount,
			message: `Updating ${this.settings.wikiFolder}/_index.md`,
		});
		await this.updateWikiIndex();

		onProgress?.({
			phase: 'done',
			total: rawFiles.length,
			completed: compiledCount,
			message: `Compiled ${compiledCount}/${rawFiles.length} files. Skipped ${skippedCount} unchanged files.`,
		});

		return `Compiled ${compiledCount}/${rawFiles.length} files. Skipped ${skippedCount} unchanged files.\n\n${results.join('\n')}`;
	}

	async compileSingleFile(file: TFile, instruction?: string, signal?: AbortSignal, force = false): Promise<string> {
		const content = await this.app.vault.read(file);
		const contentHash = hashString(content);
		await ensureFolder(this.app, this.settings.wikiFolder);

		const wikiPath = this.getWikiPath(file.name);
		const cacheState = this.getCompileCacheState(file, contentHash, wikiPath);
		if (!force && cacheState.isFresh) {
			return `[SKIP] Cached: ${file.name} -> ${wikiPath}`;
		}

		const compiled = await this.compileFile(file.name, content, instruction, signal);
		await this.writeWikiPage(wikiPath, compiled, file.path);
		await this.markAsCompiled(file, contentHash, wikiPath);
		await this.updateWikiIndex();

		return `[OK] Compiled: ${file.name} -> ${wikiPath}`;
	}

	private async compileFile(fileName: string, content: string, instruction?: string, signal?: AbortSignal): Promise<string> {
		const existingWiki = await this.getExistingWikiContext();

		const userMessage = instruction
			? `Compile the following raw note into a wiki page.\n\nInstruction: ${instruction}\n\nFile: ${fileName}\n\nContent:\n${content}\n\n${existingWiki}`
			: `Compile the following raw note into a wiki page with proper structure, summaries, concept categorization, and cross-references using [[wiki-links]].\n\nFile: ${fileName}\n\nContent:\n${content}\n\n${existingWiki}`;

		return await this.llmClient.chat([
			{role: 'system', content: SYSTEM_PROMPT_COMPILE},
			{role: 'user', content: userMessage},
		], signal);
	}

	private getRawFiles(folder: TFolder): TFile[] {
		return this.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(folder.path + '/'));
	}

	private getWikiPath(rawFileName: string): string {
		const baseName = rawFileName.replace(/\.md$/, '');
		return `${this.settings.wikiFolder}/${baseName}.md`;
	}

	private async writeWikiPage(wikiPath: string, content: string, sourcePath: string): Promise<void> {
		const document = buildObsidianWikiDocument(content, sourcePath);

		const existingFile = this.app.vault.getAbstractFileByPath(wikiPath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, document);
		} else {
			await this.app.vault.create(wikiPath, document);
		}
	}

	private async markAsCompiled(file: TFile, contentHash: string, wikiPath: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			const current = frontmatter[KARMIND_FRONTMATTER_KEY];
			const karmind = isRecord(current) ? current as KarMindFrontmatter : {};
			frontmatter[KARMIND_FRONTMATTER_KEY] = {
				...karmind,
				type: karmind.type ?? KARMIND_RAW_TAG,
				[KARMIND_COMPILED_KEY]: true,
				contentHash,
				sourceMtime: file.stat.mtime,
				compiledAt: Date.now(),
				compiledPath: wikiPath,
			};
		});
	}

	private getCompileCacheState(file: TFile, contentHash: string, wikiPath: string): {isFresh: boolean} {
		const cache = this.app.metadataCache.getFileCache(file);
		const karmindMeta = cache?.frontmatter?.karmind as KarMindFrontmatter | undefined;
		const wikiFile = this.app.vault.getAbstractFileByPath(wikiPath);
		const hasWikiOutput = wikiFile instanceof TFile;
		const isFresh = Boolean(
			karmindMeta?.compiled
			&& karmindMeta.contentHash === contentHash
			&& karmindMeta.compiledPath === wikiPath
			&& hasWikiOutput,
		);

		return {isFresh};
	}

	private async getExistingWikiContext(): Promise<string> {
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiFolder);
		if (!wikiFolder || !(wikiFolder instanceof TFolder)) {
			return '';
		}

		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/'));

		if (wikiFiles.length === 0) {
			return '';
		}

		const indexList = wikiFiles
			.map(f => `- [[${f.basename}]]`)
			.join('\n');

		return `Existing wiki pages for cross-referencing:\n${indexList}`;
	}

	private async updateWikiIndex(): Promise<void> {
		const wikiFiles = this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/'));

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
		} else {
			await this.app.vault.create(indexPath, indexContent);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildObsidianWikiDocument(content: string, sourcePath: string): string {
	const parsed = splitYamlFrontmatter(content);
	const frontmatter = parsed.frontmatter;
	frontmatter[KARMIND_FRONTMATTER_KEY] = {
		type: KARMIND_WIKI_TAG,
		source: sourcePath,
		compiledAt: Date.now(),
	};

	const yaml = stringifyYaml(frontmatter).trimEnd();
	const body = parsed.body.trimStart();
	return `---\n${yaml}\n---\n\n${body}`;
}

function splitYamlFrontmatter(content: string): {frontmatter: Record<string, unknown>; body: string} {
	if (!content.startsWith('---')) {
		return {frontmatter: {}, body: content};
	}

	const endOfFrontmatter = content.indexOf('\n---', 3);
	if (endOfFrontmatter === -1) {
		return {frontmatter: {}, body: content};
	}

	const rawYaml = content.slice(3, endOfFrontmatter);
	const parsed = parseYaml(rawYaml) as unknown;
	const frontmatter = isRecord(parsed) ? parsed : {};
	const body = content.slice(endOfFrontmatter + 4);
	return {frontmatter, body};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException('Compilation stopped by user.', 'AbortError');
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
		|| error instanceof Error && error.name === 'AbortError';
}

function hashString(input: string): string {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
