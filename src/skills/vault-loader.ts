import {App, normalizePath, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {skillManager} from './manager';
import {KarMindSkill, SkillResult} from './types';

interface VaultSkillDefinition {
	id: string;
	name: string;
	description: string;
	icon?: string;
	prompt: string;
	path: string;
}

export class VaultSkillLoader {
	private loadedIds = new Set<string>();

	constructor(
		private app: App,
		private llmClient: LLMClient,
		private settings: KarMindSettings,
	) {}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
	}

	async reload(): Promise<number> {
		const disabledLoadedIds = new Set(Array.from(this.loadedIds).filter(id => !skillManager.isEnabled(id)));
		this.unregisterLoadedSkills();

		const folderPath = normalizePath(this.settings.skillsFolder || 'skills');
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !(folder instanceof TFolder)) return 0;

		const files = this.getSkillFiles(folderPath);

		let loaded = 0;
		for (const file of files) {
			const definition = await this.readSkillDefinition(file);
			if (!definition) continue;
			if (skillManager.getSkill(definition.id)) continue;

			skillManager.registerSkill(this.createPromptSkill(definition));
			if (disabledLoadedIds.has(definition.id)) {
				skillManager.setEnabled(definition.id, false);
			}
			this.loadedIds.add(definition.id);
			loaded++;
		}

		return loaded;
	}

	isSkillPath(path: string): boolean {
		const folderPath = normalizePath(this.settings.skillsFolder || 'skills');
		return normalizePath(path).startsWith(folderPath + '/');
	}

	private unregisterLoadedSkills(): void {
		for (const id of this.loadedIds) {
			skillManager.unregisterSkill(id);
		}
		this.loadedIds.clear();
	}

	private async readSkillDefinition(file: TFile): Promise<VaultSkillDefinition | null> {
		const content = await this.app.vault.cachedRead(file);
		const {frontmatter, body} = splitFrontmatter(content);
		const metadata = parseSimpleFrontmatter(frontmatter);
		const prompt = (metadata.prompt ?? body).trim();
		if (!prompt) return null;

		const folderName = file.parent?.name ?? file.basename;
		const id = normalizeSkillId(metadata.id ?? folderName);
		if (!id) return null;

		return {
			id,
			name: metadata.name ?? folderName,
			description: metadata.description ?? createDescription(prompt),
			icon: metadata.icon,
			prompt,
			path: file.path,
		};
	}

	private getSkillFiles(folderPath: string): TFile[] {
		return this.app.vault.getMarkdownFiles()
			.filter(file => {
				const normalizedPath = normalizePath(file.path);
				if (!normalizedPath.startsWith(folderPath + '/')) return false;
				const relativePath = normalizedPath.slice(folderPath.length + 1);
				const segments = relativePath.split('/');
				return segments.length === 2 && segments[1]?.toLowerCase() === 'skill.md';
			});
	}

	private createPromptSkill(definition: VaultSkillDefinition): KarMindSkill {
		return {
			id: definition.id,
			name: definition.name,
			description: definition.description,
			icon: definition.icon,
			config: {
				source: 'vault',
				path: definition.path,
			},
			execute: async (_context, ...args): Promise<SkillResult> => {
				if (!this.llmClient.hasApiKey()) {
					return {
						success: false,
						content: 'LLM API key is not configured. Configure it in Settings > KarMind.',
					};
				}

				const argumentText = args.join(' ').trim();
				const result = await this.llmClient.chat([
					{
						role: 'system',
						content: 'You are executing a KarMind declarative skill. Follow the skill instructions exactly. Do not execute code or claim to modify files unless the instructions explicitly ask for text output that the user can review.',
					},
					{
						role: 'user',
						content: [
							`Skill: ${definition.name}`,
							`Description: ${definition.description}`,
							`Source: ${definition.path}`,
							'',
							'Instructions:',
							definition.prompt,
							'',
							'Arguments:',
							argumentText || '(none)',
						].join('\n'),
					},
				]);

				return {
					success: true,
					content: result,
					metadata: {
						source: 'vault',
						path: definition.path,
					},
				};
			},
		};
	}
}

function splitFrontmatter(content: string): {frontmatter: string; body: string} {
	if (!content.startsWith('---\n')) {
		return {frontmatter: '', body: content};
	}

	const end = content.indexOf('\n---', 4);
	if (end === -1) {
		return {frontmatter: '', body: content};
	}

	return {
		frontmatter: content.slice(4, end),
		body: content.slice(end + 4).replace(/^\s*\n/, ''),
	};
}

function parseSimpleFrontmatter(frontmatter: string): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const line of frontmatter.split('\n')) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!match) continue;
		const key = match[1];
		const value = stripQuotes(match[2] ?? '').trim();
		if (key) metadata[key] = value;
	}
	return metadata;
}

function stripQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

function normalizeSkillId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function createDescription(prompt: string): string {
	const firstLine = prompt.split('\n').find(line => line.trim())?.trim() ?? 'Vault skill';
	return firstLine.length > 96 ? firstLine.slice(0, 93) + '...' : firstLine;
}
