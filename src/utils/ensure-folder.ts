import {App, normalizePath, TFolder} from 'obsidian';

export async function ensureFolder(app: App, path: string): Promise<void> {
	const segments = normalizePath(path).split('/').filter(Boolean);
	let current = '';

	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const entry = app.vault.getAbstractFileByPath(current);
		if (!entry) {
			await app.vault.createFolder(current);
		} else if (!(entry instanceof TFolder)) {
			throw new Error(`Path "${current}" exists but is not a folder`);
		}
	}
}
