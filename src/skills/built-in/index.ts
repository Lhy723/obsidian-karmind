import {KarMindSkill, SkillContext, SkillResult} from '../types';
import {TFile, TFolder} from 'obsidian';
import {isSpecialWikiFile} from '../../core/wiki-paths';
import {getKarMindValue} from '../../core/frontmatter';

function hasIncomingLinks(context: SkillContext, file: TFile): boolean {
	const resolvedLinks = context.app.metadataCache.resolvedLinks;
	for (const [, targets] of Object.entries(resolvedLinks)) {
		if (targets[file.path] !== undefined) {
			return true;
		}
	}
	return false;
}

export const summarizeSkill: KarMindSkill = {
	id: 'summarize',
	name: 'Summarize',
	description: 'Generate a summary of a note or folder',
	icon: 'file-text',
	async execute(context: SkillContext, targetPath?: string): Promise<SkillResult> {
		if (!targetPath) {
			return {success: false, content: 'Please provide a file path to summarize.'};
		}

		const file = context.app.vault.getAbstractFileByPath(targetPath);
		if (!file) {
			return {success: false, content: `File not found: ${targetPath}`};
		}

		if (file instanceof TFile) {
			const content = await context.app.vault.read(file);
			const lines = content.split('\n').filter(l => l.trim());
			const headings = lines.filter(l => l.startsWith('#'));

			return {
				success: true,
				content: `Summary of ${file.basename}:\n- Total lines: ${lines.length}\n- Headings: ${headings.length}\n- Size: ${content.length} characters`,
				metadata: {path: file.path, size: content.length},
			};
		}

		return {success: false, content: `Target is not a file: ${targetPath}`};
	},
};

export const listRawSkill: KarMindSkill = {
	id: 'list-raw',
	name: 'List raw notes',
	description: 'List all raw notes that have not been compiled yet',
	icon: 'list',
	async execute(context: SkillContext, rawFolder?: string): Promise<SkillResult> {
		const folder = rawFolder ?? 'raw';
		const folderFile = context.app.vault.getAbstractFileByPath(folder);

		if (!folderFile || !(folderFile instanceof TFolder)) {
			return {success: false, content: `Raw folder "${folder}" not found.`};
		}

		const rawFiles = context.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(folder + '/'));

		const uncompiled = rawFiles.filter(f => {
			const cache = context.app.metadataCache.getFileCache(f);
			return getKarMindValue(cache?.frontmatter, 'compiled') !== true;
		});

		if (uncompiled.length === 0) {
			return {success: true, content: `All ${rawFiles.length} raw notes have been compiled.`};
		}

		const list = uncompiled.map(f => `- ${f.path}`).join('\n');
		return {
			success: true,
			content: `${uncompiled.length} uncompiled raw notes (out of ${rawFiles.length} total):\n${list}`,
		};
	},
};

export const wikiStatsSkill: KarMindSkill = {
	id: 'wiki-stats',
	name: 'Wiki statistics',
	description: 'Get statistics about the compiled wiki',
	icon: 'bar-chart',
	async execute(context: SkillContext, wikiFolder?: string): Promise<SkillResult> {
		const folder = wikiFolder ?? 'wiki';
		const wikiFiles = context.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(folder + '/') && !isSpecialWikiFile(f));

		if (wikiFiles.length === 0) {
			return {success: true, content: 'No wiki pages found.'};
		}

		let totalLinks = 0;
		let totalTags = 0;
		let totalSize = 0;

		for (const file of wikiFiles) {
			const cache = context.app.metadataCache.getFileCache(file);
			totalLinks += cache?.links?.length ?? 0;
			totalTags += cache?.tags?.length ?? 0;
			const content = await context.app.vault.read(file);
			totalSize += content.length;
		}

		return {
			success: true,
			content: `Wiki Statistics:\n- Total pages: ${wikiFiles.length}\n- Total links: ${totalLinks}\n- Total tags: ${totalTags}\n- Total size: ${(totalSize / 1024).toFixed(1)} KB\n- Avg page size: ${(totalSize / wikiFiles.length / 1024).toFixed(1)} KB`,
		};
	},
};

export const findOrphansSkill: KarMindSkill = {
	id: 'find-orphans',
	name: 'Find orphan pages',
	description: 'Find wiki pages with no incoming or outgoing links',
	icon: 'link',
	async execute(context: SkillContext, wikiFolder?: string): Promise<SkillResult> {
		const folder = wikiFolder ?? 'wiki';
		const wikiFiles = context.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(folder + '/') && !isSpecialWikiFile(f));

		const orphans: string[] = [];

		for (const file of wikiFiles) {
			const cache = context.app.metadataCache.getFileCache(file);
			const hasOutgoing = (cache?.links?.length ?? 0) > 0;
			const hasIncoming = hasIncomingLinks(context, file);

			if (!hasOutgoing && !hasIncoming) {
				orphans.push(file.path);
			}
		}

		if (orphans.length === 0) {
			return {success: true, content: 'No orphan pages found. All pages are connected.'};
		}

		return {
			success: true,
			content: `Found ${orphans.length} orphan pages:\n${orphans.map(p => `- ${p}`).join('\n')}`,
		};
	},
};
