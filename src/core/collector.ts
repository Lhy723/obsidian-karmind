import {App, Notice, TFile} from 'obsidian';
import {KarMindSettings} from '../settings';
import {KARMIND_FRONTMATTER_KEY, KARMIND_RAW_TAG} from '../constants';
import {ensureFolder} from '../utils/ensure-folder';

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

		const content = await this.app.vault.read(file);

		if (content.startsWith('---')) {
			const endOfFrontmatter = content.indexOf('---', 3);
			if (endOfFrontmatter !== -1) {
				const frontmatter = content.substring(0, endOfFrontmatter + 3);
				const body = content.substring(endOfFrontmatter + 3);

				if (frontmatter.includes(`${KARMIND_FRONTMATTER_KEY}:`)) {
					await this.app.vault.modify(file, frontmatter.replace(
						`${KARMIND_FRONTMATTER_KEY}:`,
						`${KARMIND_FRONTMATTER_KEY}:\n  type: ${KARMIND_RAW_TAG}\n  compiled: false`,
					) + body);
				} else {
					await this.app.vault.modify(file, frontmatter + `\n${KARMIND_FRONTMATTER_KEY}:\n  type: ${KARMIND_RAW_TAG}\n  compiled: false` + body);
				}
				new Notice(`Marked "${file.basename}" as raw material.`);
				return;
			}
		}

		const newContent = `---\n${KARMIND_FRONTMATTER_KEY}:\n  type: ${KARMIND_RAW_TAG}\n  compiled: false\n---\n\n${content}`;
		await this.app.vault.modify(file, newContent);
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
