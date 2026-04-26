import {KarMindSkill, SkillContext, SkillResult} from './types';

class SkillManager {
	private skills: Map<string, KarMindSkill> = new Map();
	private disabledIds: Set<string> = new Set();

	registerSkill(skill: KarMindSkill): void {
		this.skills.set(skill.id, skill);
	}

	unregisterSkill(id: string): void {
		this.skills.delete(id);
		this.disabledIds.delete(id);
	}

	getSkill(id: string): KarMindSkill | undefined {
		return this.skills.get(id);
	}

	getAllSkills(): KarMindSkill[] {
		return Array.from(this.skills.values());
	}

	isEnabled(id: string): boolean {
		return !this.disabledIds.has(id);
	}

	setEnabled(id: string, enabled: boolean): void {
		if (enabled) {
			this.disabledIds.delete(id);
		} else {
			this.disabledIds.add(id);
		}
	}

	getDisabledIds(): string[] {
		return Array.from(this.disabledIds);
	}

	setDisabledIds(ids: string[]): void {
		this.disabledIds = new Set(ids);
	}

	async executeSkill(id: string, context: SkillContext, ...args: string[]): Promise<SkillResult> {
		const skill = this.skills.get(id);
		if (!skill) {
			return {
				success: false,
				content: `Skill "${id}" not found. Available skills: ${this.getSkillList()}`,
			};
		}

		if (this.disabledIds.has(id)) {
			return {
				success: false,
				content: `Skill "${id}" is disabled. Enable it in Settings > KarMind > Skills.`,
			};
		}

		try {
			return await skill.execute(context, ...args);
		} catch (error) {
			return {
				success: false,
				content: `Skill "${id}" execution failed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	getSkillList(): string {
		return this.getAllSkills()
			.map(s => `${s.name} (${s.id}): ${s.description}`)
			.join('\n');
	}

	getSkillDescriptions(): string {
		return this.getAllSkills()
			.map(s => `- ${s.id}: ${s.description}`)
			.join('\n');
	}
}

export const skillManager = new SkillManager();
