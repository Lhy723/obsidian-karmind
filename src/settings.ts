import {App, PluginSettingTab, Setting} from "obsidian";
import KarMindPlugin from "./main";
import {skillManager} from "./skills/manager";
import {PermissionLevel} from "./types";
import {type KarMindLanguage, t} from "./i18n";

export interface KarMindSettings {
	language: KarMindLanguage;
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
	language: 'zh',
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
		const language = this.plugin.settings.language;

		new Setting(containerEl).setName('KarMind').setHeading();

		new Setting(containerEl)
			.setName(t(language, 'settingsLanguageName'))
			.setDesc(t(language, 'settingsLanguageDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('zh', t(language, 'languageChinese'))
				.addOption('en', t(language, 'languageEnglish'))
				.setValue(this.plugin.settings.language)
				.onChange(async (value) => {
					this.plugin.settings.language = value as KarMindLanguage;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsApiBaseName'))
			.setDesc(t(language, 'settingsApiBaseDesc'))
			.addText(text => text
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.apiBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsApiKeyName'))
			.setDesc(t(language, 'settingsApiKeyDesc'))
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
			.setName(t(language, 'settingsModelName'))
			.setDesc(t(language, 'settingsModelDesc'))
			.addText(text => text
				.setPlaceholder('gpt-4o-mini')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsRawFolderName'))
			.setDesc(t(language, 'settingsRawFolderDesc'))
			.addText(text => text
				.setPlaceholder('raw')
				.setValue(this.plugin.settings.rawFolder)
				.onChange(async (value) => {
					this.plugin.settings.rawFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsWikiFolderName'))
			.setDesc(t(language, 'settingsWikiFolderDesc'))
			.addText(text => text
				.setPlaceholder('wiki')
				.setValue(this.plugin.settings.wikiFolder)
				.onChange(async (value) => {
					this.plugin.settings.wikiFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsMaxTokensName'))
			.setDesc(t(language, 'settingsMaxTokensDesc'))
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
			.setName(t(language, 'settingsTemperatureName'))
			.setDesc(t(language, 'settingsTemperatureDesc'))
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
			.setName(t(language, 'settingsStreamingName'))
			.setDesc(t(language, 'settingsStreamingDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableStreaming)
				.onChange(async (value) => {
					this.plugin.settings.enableStreaming = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsAutoCompileName'))
			.setDesc(t(language, 'settingsAutoCompileDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCompile)
				.onChange(async (value) => {
					this.plugin.settings.autoCompile = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(language, 'settingsHealthIntervalName'))
			.setDesc(t(language, 'settingsHealthIntervalDesc'))
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
			.setName(t(language, 'settingsDefaultPermissionName'))
			.setDesc(t(language, 'settingsDefaultPermissionDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('basic', t(language, 'permissionBasic'))
				.addOption('enhanced', t(language, 'permissionEnhanced'))
				.setValue(this.plugin.settings.defaultPermission)
				.onChange(async (value) => {
					this.plugin.settings.defaultPermission = value as PermissionLevel;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName(t(language, 'settingsSkillsName')).setHeading();

		const skills = skillManager.getAllSkills();
		if (skills.length === 0) {
			containerEl.createEl('p', {text: t(language, 'settingsNoSkills'), cls: 'karmind-settings-empty'});
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
