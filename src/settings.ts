import {App, PluginSettingTab, Setting} from "obsidian";
import KarMindPlugin from "./main";
import {skillManager} from "./skills/manager";
import {PermissionLevel} from "./types";

export interface KarMindSettings {
	apiBaseUrl: string;
	apiKey: string;
	model: string;
	rawFolder: string;
	wikiFolder: string;
	maxTokens: number;
	temperature: number;
	enableStreaming: boolean;
	autoCompile: boolean;
	healthCheckInterval: number;
	defaultPermission: PermissionLevel;
	disabledSkills: string[];
}

export const DEFAULT_SETTINGS: KarMindSettings = {
	apiBaseUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4o-mini',
	rawFolder: 'raw',
	wikiFolder: 'wiki',
	maxTokens: 4096,
	temperature: 0.3,
	enableStreaming: false,
	autoCompile: false,
	healthCheckInterval: 0,
	defaultPermission: 'enhanced',
	disabledSkills: [],
};

export class KarMindSettingTab extends PluginSettingTab {
	plugin: KarMindPlugin;

	constructor(app: App, plugin: KarMindPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl).setName('KarMind').setHeading();

		new Setting(containerEl)
			.setName('LLM API base URL')
			.setDesc('OpenAI-compatible API endpoint (e.g. https://api.openai.com/v1)')
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.apiBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your LLM API key. Stored locally in your vault.')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model name (e.g. gpt-4o-mini, gpt-4o, deepseek-chat, llama3)')
			.addText(text => text
				.setPlaceholder('gpt-4o-mini')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Raw folder')
			.setDesc('Folder path for collecting raw materials')
			.addText(text => text
				.setPlaceholder('raw')
				.setValue(this.plugin.settings.rawFolder)
				.onChange(async (value) => {
					this.plugin.settings.rawFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Wiki folder')
			.setDesc('Folder path for compiled wiki pages')
			.addText(text => text
				.setPlaceholder('wiki')
				.setValue(this.plugin.settings.wikiFolder)
				.onChange(async (value) => {
					this.plugin.settings.wikiFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max tokens')
			.setDesc('Maximum tokens for LLM responses (256–16384)')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '256';
				text.inputEl.max = '16384';
				text.inputEl.step = '256';
				text.setPlaceholder('4096')
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 256 && num <= 16384) {
							this.plugin.settings.maxTokens = num;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('LLM sampling temperature, 0–2 (lower = more deterministic)')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.max = '2';
				text.inputEl.step = '0.1';
				text.setPlaceholder('0.3')
					.setValue(String(this.plugin.settings.temperature))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0 && num <= 2) {
							this.plugin.settings.temperature = num;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName('Enable streaming responses')
			.setDesc('Use browser fetch with SSE. Disable this if your API blocks app://obsidian.md by CORS.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableStreaming)
				.onChange(async (value) => {
					this.plugin.settings.enableStreaming = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto compile')
			.setDesc('Automatically compile raw notes when they are added')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCompile)
				.onChange(async (value) => {
					this.plugin.settings.autoCompile = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Health check interval')
			.setDesc('Automatic health check interval in hours (0 = disabled, max 168)')
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text.inputEl.max = '168';
				text.inputEl.step = '1';
				text.setPlaceholder('0')
					.setValue(String(this.plugin.settings.healthCheckInterval))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 0 && num <= 168) {
							this.plugin.settings.healthCheckInterval = num;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName('Default permission')
			.setDesc('Default permission level for new conversations. Basic: Q&A only. Enhanced: Q&A + file operations.')
			.addDropdown(dropdown => dropdown
				.addOption('basic', 'Basic Q&A')
				.addOption('enhanced', 'Enhanced Notes')
				.setValue(this.plugin.settings.defaultPermission)
				.onChange(async (value) => {
					this.plugin.settings.defaultPermission = value as PermissionLevel;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Skills').setHeading();

		const skills = skillManager.getAllSkills();
		if (skills.length === 0) {
			containerEl.createEl('p', {text: 'No skills registered.', cls: 'karmind-settings-empty'});
		} else {
			for (const skill of skills) {
				new Setting(containerEl)
					.setName(skill.name)
					.setDesc(skill.description)
					.addToggle(toggle => toggle
						.setValue(skillManager.isEnabled(skill.id))
						.onChange(async (value) => {
							skillManager.setEnabled(skill.id, value);
							await this.plugin.saveSettings();
						}));
			}
		}
	}
}
