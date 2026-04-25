import {App} from 'obsidian';

export interface SkillContext {
	app: App;
	vault: App['vault'];
	metadataCache: App['metadataCache'];
	[key: string]: unknown;
}

export interface SkillResult {
	success: boolean;
	content: string;
	metadata?: Record<string, unknown>;
}

export interface KarMindSkill {
	id: string;
	name: string;
	description: string;
	icon?: string;
	config?: Record<string, unknown>;
	execute(context: SkillContext, ...args: string[]): Promise<SkillResult>;
}

export interface SkillDefinition {
	id: string;
	name: string;
	description: string;
	icon?: string;
	parameters?: {
		name: string;
		type: 'string' | 'number' | 'boolean';
		description: string;
		required?: boolean;
	}[];
}
