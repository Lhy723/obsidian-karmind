import {App, Notice, TFile} from 'obsidian';
import {KarMindSettings} from '../settings';
import {KARMIND_FRONTMATTER_KEY, KARMIND_RAW_TAG} from '../constants';
import {ensureFolder} from '../utils/ensure-folder';

type KarMindFrontmatter = {
	type?: string;
	compiled?: boolean;
	[key: string]: unknown;
};

export class Collector {
	private app: App;
	private settings: KarMindSettings;

	constructor(app: App, settings: KarMindSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
	}

	async markAsRaw(file: TFile): Promise<void> {
		await ensureFolder(this.app, this.settings.rawFolder);

		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			const current = frontmatter[KARMIND_FRONTMATTER_KEY];
			const karmind = isRecord(current) ? current as KarMindFrontmatter : {};
			frontmatter[KARMIND_FRONTMATTER_KEY] = {
				...karmind,
				type: KARMIND_RAW_TAG,
				compiled: false,
			};
		});
		new Notice(`Marked "${file.basename}" as raw material.`);
	}

	async moveToRawFolder(file: TFile): Promise<void> {
		await ensureFolder(this.app, this.settings.rawFolder);

		const targetPath = `${this.settings.rawFolder}/${file.name}`;
		const existingFile = this.app.vault.getAbstractFileByPath(targetPath);

		if (existingFile) {
			new Notice(`File already exists in raw folder: ${targetPath}`);
			return;
		}

		await this.app.vault.rename(file, targetPath);
		const movedFile = this.app.vault.getAbstractFileByPath(targetPath);
		if (movedFile instanceof TFile) {
			await this.markAsRaw(movedFile);
		}
		new Notice(`Moved "${targetPath}" to raw folder.`);
	}

	async collectFromClipboard(): Promise<void> {
		await ensureFolder(this.app, this.settings.rawFolder);

		const clipboardText = await navigator.clipboard.readText();
		if (!clipboardText.trim()) {
			new Notice('Clipboard is empty.');
			return;
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const fileName = `clip-${timestamp}.md`;
		const filePath = `${this.settings.rawFolder}/${fileName}`;

		const content = `---\n${KARMIND_FRONTMATTER_KEY}:\n  type: ${KARMIND_RAW_TAG}\n  compiled: false\n  source: clipboard\n  collectedAt: ${Date.now()}\n---\n\n${clipboardText}`;

		await this.app.vault.create(filePath, content);
		new Notice(`Collected clipboard content to ${filePath}`);
	}

	async collectCurrentNote(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file.');
			return;
		}

		await this.markAsRaw(activeFile);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
