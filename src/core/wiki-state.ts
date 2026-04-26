import {App, TFile} from 'obsidian';
import {ensureFolder} from '../utils/ensure-folder';

export interface SourceManifestEntry {
	path: string;
	contentHash: string;
	size: number;
	mtime: number;
	compiledAt: number;
	wikiPagesTouched: string[];
	model: string;
	promptVersion: string;
}

export interface SourceManifest {
	version: 1;
	updatedAt: number;
	sources: Record<string, SourceManifestEntry>;
}

export interface WikiLogEntry {
	type: 'ingest' | 'query' | 'backfill' | 'health';
	title: string;
	summary?: string;
	sourcePath?: string;
	touchedPages?: string[];
	issueCount?: number;
}

const MANIFEST_VERSION = 1;

export class WikiStateStore {
	private app: App;
	private wikiFolder: string;

	constructor(app: App, wikiFolder: string) {
		this.app = app;
		this.wikiFolder = wikiFolder;
	}

	updateWikiFolder(wikiFolder: string): void {
		this.wikiFolder = wikiFolder;
	}

	async loadManifest(): Promise<SourceManifest> {
		const manifestPath = this.getManifestPath();
		const existing = this.app.vault.getAbstractFileByPath(manifestPath);
		if (!(existing instanceof TFile)) {
			return createEmptyManifest();
		}

		try {
			const content = await this.app.vault.cachedRead(existing);
			const parsed = JSON.parse(content) as Partial<SourceManifest>;
			if (parsed.version !== MANIFEST_VERSION || !parsed.sources || typeof parsed.sources !== 'object') {
				return createEmptyManifest();
			}
			return parsed as SourceManifest;
		} catch {
			return createEmptyManifest();
		}
	}

	async saveManifest(manifest: SourceManifest): Promise<'create' | 'update'> {
		manifest.updatedAt = Date.now();
		await ensureFolder(this.app, `${this.wikiFolder}/.karmind`);

		const manifestPath = this.getManifestPath();
		const content = JSON.stringify(manifest, null, 2);
		const existing = this.app.vault.getAbstractFileByPath(manifestPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return 'update';
		}

		await this.app.vault.create(manifestPath, content);
		return 'create';
	}

	isSourceCurrent(manifest: SourceManifest, file: TFile, content: string, promptVersion: string): boolean {
		const entry = manifest.sources[file.path];
		if (!entry) return false;
		return entry.contentHash === hashContent(content)
			&& entry.size === content.length
			&& entry.promptVersion === promptVersion;
	}

	recordSource(
		manifest: SourceManifest,
		file: TFile,
		content: string,
		wikiPagesTouched: string[],
		model: string,
		promptVersion: string,
	): void {
		manifest.sources[file.path] = {
			path: file.path,
			contentHash: hashContent(content),
			size: content.length,
			mtime: file.stat.mtime,
			compiledAt: Date.now(),
			wikiPagesTouched,
			model,
			promptVersion,
		};
	}

	async appendLog(entry: WikiLogEntry): Promise<'create' | 'update'> {
		await ensureFolder(this.app, this.wikiFolder);
		const logPath = `${this.wikiFolder}/log.md`;
		const existing = this.app.vault.getAbstractFileByPath(logPath);
		const block = formatLogEntry(entry);

		if (existing instanceof TFile) {
			await this.app.vault.process(existing, (data) => `${data.trimEnd()}\n\n${block}`);
			return 'update';
		}

		const content = `---\nkarmind:\n  type: log\n  updatedAt: ${Date.now()}\n---\n\n# Wiki Log\n\n${block}`;
		await this.app.vault.create(logPath, content);
		return 'create';
	}

	getManifestPath(): string {
		return `${this.wikiFolder}/.karmind/source-manifest.json`;
	}
}

export function hashContent(content: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function createEmptyManifest(): SourceManifest {
	return {
		version: MANIFEST_VERSION,
		updatedAt: Date.now(),
		sources: {},
	};
}

function formatLogEntry(entry: WikiLogEntry): string {
	const date = new Date().toISOString().slice(0, 10);
	const lines = [`## [${date}] ${entry.type} | ${entry.title}`];
	if (entry.summary) lines.push(`- summary: ${entry.summary}`);
	if (entry.sourcePath) lines.push(`- source: ${entry.sourcePath}`);
	if (entry.touchedPages && entry.touchedPages.length > 0) {
		lines.push(`- touched: ${entry.touchedPages.map(pathToWikiLink).join(', ')}`);
	}
	if (typeof entry.issueCount === 'number') lines.push(`- issues: ${entry.issueCount}`);
	return lines.join('\n');
}

function pathToWikiLink(path: string): string {
	const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	return `[[${name}]]`;
}
