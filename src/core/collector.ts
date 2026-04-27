import {App, Notice, TFile} from 'obsidian';
import {KarMindSettings} from '../settings';
import {ensureFolder} from '../utils/ensure-folder';
import {setKarMindFrontmatter} from './frontmatter';

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

		await setKarMindFrontmatter(this.app, file, {
			type: 'raw',
			compiled: false,
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
		await this.markAsRaw(file);
		new Notice(`Moved "${file.basename}" to raw folder.`);
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

		const file = await this.app.vault.create(filePath, clipboardText);
		await setKarMindFrontmatter(this.app, file, {
			type: 'raw',
			compiled: false,
			source: 'clipboard',
			collectedAt: new Date().toISOString(),
		});

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
