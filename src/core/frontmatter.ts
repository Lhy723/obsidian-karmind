import {App, TFile} from 'obsidian';

type FrontmatterValue = string | number | boolean;

export function getKarMindValue(frontmatter: Record<string, unknown> | undefined, key: string): unknown {
	if (!frontmatter) return undefined;
	const flatValue = frontmatter[`karmind_${toSnakeCase(key)}`];
	if (flatValue !== undefined) return flatValue;
	const nested = frontmatter.karmind;
	if (nested && typeof nested === 'object') {
		return (nested as Record<string, unknown>)[key];
	}
	return undefined;
}

export async function setKarMindFrontmatter(app: App, file: TFile, fields: Record<string, FrontmatterValue>): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		assignKarMindFrontmatter(frontmatter as Record<string, unknown>, fields);
	});
}

export async function writeKarMindDocument(app: App, filePath: string, content: string, fields: Record<string, FrontmatterValue>): Promise<'create' | 'update'> {
	const existing = app.vault.getAbstractFileByPath(filePath);
	const body = stripLeadingFrontmatter(content);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => body);
		await setKarMindFrontmatter(app, existing, fields);
		return 'update';
	}

	const file = await app.vault.create(filePath, body);
	await setKarMindFrontmatter(app, file, fields);
	return 'create';
}

function assignKarMindFrontmatter(frontmatter: Record<string, unknown>, fields: Record<string, FrontmatterValue>): void {
	delete frontmatter.karmind;
	for (const key of Object.keys(frontmatter)) {
		if (key.startsWith('karmind_')) {
			delete frontmatter[key];
		}
	}

	for (const [key, value] of Object.entries(fields)) {
		frontmatter[`karmind_${toSnakeCase(key)}`] = value;
	}
}

function stripLeadingFrontmatter(content: string): string {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith('---')) return content;

	const startOffset = content.length - trimmed.length;
	const frontmatterEnd = content.indexOf('---', startOffset + 3);
	if (frontmatterEnd === -1) return content;

	return content.slice(frontmatterEnd + 3).replace(/^\r?\n/, '');
}

function toSnakeCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.toLowerCase();
}
