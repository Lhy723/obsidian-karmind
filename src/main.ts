import {Notice, normalizePath, Plugin, TFile, WorkspaceLeaf} from 'obsidian';
import {KarMindSettings, DEFAULT_SETTINGS, KarMindSettingTab} from './settings';
import {VIEW_TYPE_KARMIND} from './constants';
import {KarMindView} from './views/karmind-view';
import {LLMClient} from './llm/client';
import {Compiler} from './core/compiler';
import {QAEngine} from './core/qa-engine';
import {BackfillEngine} from './core/backfill';
import {HealthChecker} from './core/health-checker';
import {Collector} from './core/collector';
import {skillManager} from './skills/manager';
import {summarizeSkill, listRawSkill, wikiStatsSkill, findOrphansSkill} from './skills/built-in';
import {SessionStore} from './store/session-store';
import {t} from './i18n';
import {getSecretValue, setSecretValue} from './utils/secrets';
import {confirmAction} from './ui/confirm';

export default class KarMindPlugin extends Plugin {
	settings!: KarMindSettings;
	llmClient!: LLMClient;
	compiler!: Compiler;
	qaEngine!: QAEngine;
	backfillEngine!: BackfillEngine;
	healthChecker!: HealthChecker;
	collector!: Collector;
	sessionStore!: SessionStore;
	private autoCompileRunning = false;
	private autoCompilePending = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.llmClient = new LLMClient(this.app, this.settings);
		this.compiler = new Compiler(this.app, this.llmClient, this.settings);
		this.qaEngine = new QAEngine(this.app, this.llmClient, this.settings);
		this.backfillEngine = new BackfillEngine(this.app, this.llmClient, this.settings);
		this.healthChecker = new HealthChecker(this.app, this.llmClient, this.settings);
		this.collector = new Collector(this.app, this.settings);

		this.sessionStore = new SessionStore(this);
		await this.sessionStore.load();

		this.registerBuiltInSkills();

		const savedDisabled = this.settings.disabledSkills ?? [];
		skillManager.setDisabledIds(savedDisabled);

		this.registerView(VIEW_TYPE_KARMIND, (leaf) => new KarMindView(leaf, this));

		this.addRibbonIcon('brain', t(this.settings.language, 'ribbonOpenKarMind'), () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-panel',
			name: t(this.settings.language, 'obsidianCommandOpenPanel'),
			callback: () => { void this.activateView(); },
		});

		this.addCommand({
			id: 'collect-current-note',
			name: t(this.settings.language, 'obsidianCommandCollectCurrentNote'),
			callback: () => { void this.collector.collectCurrentNote(); },
		});

		this.addCommand({
			id: 'collect-clipboard',
			name: t(this.settings.language, 'obsidianCommandCollectClipboard'),
			callback: () => { void this.collector.collectFromClipboard(); },
		});

		this.addCommand({
			id: 'compile-raw',
			name: t(this.settings.language, 'obsidianCommandCompileRaw'),
			callback: () => {
				void (async () => {
					try {
						if (!this.hasApiKey()) {
							new Notice(t(this.settings.language, 'apiKeyMissing'));
							return;
						}

						const confirmed = await confirmAction(this.app, {
							title: t(this.settings.language, 'compileConfirmTitle'),
							message: t(this.settings.language, 'compileConfirmMessage'),
							confirmLabel: t(this.settings.language, 'compileConfirmButton'),
							cancelLabel: t(this.settings.language, 'cancel'),
							danger: true,
						});
						if (!confirmed) {
							new Notice(t(this.settings.language, 'operationCancelled'));
							return;
						}

						new Notice(t(this.settings.language, 'noticeCompiling'));
						await this.compiler.compileRaw();
						new Notice(t(this.settings.language, 'noticeCompilationComplete'));
						await this.activateView();
					} catch (error) {
						new Notice(t(this.settings.language, 'noticeCompilationFailed', {error: error instanceof Error ? error.message : String(error)}));
					}
				})();
			},
		});

		this.addCommand({
			id: 'health-check',
			name: t(this.settings.language, 'obsidianCommandHealthCheck'),
			callback: () => {
				void (async () => {
					try {
						new Notice(t(this.settings.language, 'noticeHealthRunning'));
						const report = await this.healthChecker.check();
						new Notice(t(this.settings.language, 'noticeHealthComplete', {count: report.issues.length}));
						await this.activateView();
					} catch (error) {
						new Notice(t(this.settings.language, 'noticeHealthFailed', {error: error instanceof Error ? error.message : String(error)}));
					}
				})();
			},
		});

		this.addCommand({
			id: 'test-llm-connection',
			name: t(this.settings.language, 'obsidianCommandTestLlm'),
			callback: () => {
				void (async () => {
					new Notice(t(this.settings.language, 'noticeTestingLlm'));
					const success = await this.llmClient.testConnection();
					new Notice(success ? t(this.settings.language, 'noticeLlmSuccess') : t(this.settings.language, 'noticeLlmFailed'));
				})();
			},
		});

		this.addSettingTab(new KarMindSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('create', (file) => {
				void this.handleAutoCompile(file);
			}));
		});
	}

	onunload(): void {
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as (Partial<KarMindSettings> & {apiKey?: string}) | null;
		const saved = data ?? {};
		const legacyApiKey = typeof saved.apiKey === 'string' ? saved.apiKey.trim() : '';
		delete saved.apiKey;

		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		this.settings.rawFolder = normalizePath(this.settings.rawFolder || DEFAULT_SETTINGS.rawFolder);
		this.settings.wikiFolder = normalizePath(this.settings.wikiFolder || DEFAULT_SETTINGS.wikiFolder);

		if (legacyApiKey) {
			const migrated = setSecretValue(this.app, this.settings.apiKeySecretId, legacyApiKey);
			if (migrated) {
				await this.saveData({...saved, ...this.settings});
			}
		}
	}

	async saveSettings(): Promise<void> {
		this.settings.disabledSkills = skillManager.getDisabledIds();
		const existing = await this.loadData() as Record<string, unknown> | null;
		const next = {...(existing ?? {}), ...this.settings};
		delete (next as {apiKey?: unknown}).apiKey;
		await this.saveData(next);
		this.updateEngines();
	}

	private updateEngines(): void {
		this.llmClient.updateSettings(this.settings);
		this.compiler.updateSettings(this.settings);
		this.qaEngine.updateSettings(this.settings);
		this.backfillEngine.updateSettings(this.settings);
		this.healthChecker.updateSettings(this.settings);
		this.collector.updateSettings(this.settings);

		this.app.workspace.getLeavesOfType(VIEW_TYPE_KARMIND).forEach((leaf) => {
			if (leaf.view instanceof KarMindView) {
				leaf.view.updateLLMClient(this.settings);
			}
		});
	}

	hasApiKey(): boolean {
		return getSecretValue(this.app, this.settings.apiKeySecretId).length > 0;
	}

	private registerBuiltInSkills(): void {
		skillManager.registerSkill(summarizeSkill);
		skillManager.registerSkill(listRawSkill);
		skillManager.registerSkill(wikiStatsSkill);
		skillManager.registerSkill(findOrphansSkill);
	}

	private async handleAutoCompile(file: unknown): Promise<void> {
		if (!this.settings.autoCompile || !(file instanceof TFile)) return;
		if (!file.path.startsWith(this.settings.rawFolder + '/')) return;

		if (!this.hasApiKey()) {
			new Notice(t(this.settings.language, 'autoCompileSkippedNoApiKey'));
			return;
		}

		if (this.autoCompileRunning) {
			this.autoCompilePending = true;
			new Notice(t(this.settings.language, 'autoCompileQueued'));
			return;
		}

		this.autoCompileRunning = true;

		try {
			let firstPass = true;
			do {
				this.autoCompilePending = false;
				new Notice(firstPass
					? t(this.settings.language, 'autoCompileStarted', {path: file.path})
					: t(this.settings.language, 'autoCompileRestarted'));
				firstPass = false;
				await this.compiler.compileRaw();
				new Notice(t(this.settings.language, 'autoCompileComplete'));
			} while (this.autoCompilePending);
			await this.activateView();
		} catch (error) {
			new Notice(t(this.settings.language, 'autoCompileFailed', {error: error instanceof Error ? error.message : String(error)}));
		} finally {
			this.autoCompileRunning = false;
			this.autoCompilePending = false;
		}
	}

	async activateView(): Promise<void> {
		const {workspace} = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_KARMIND);

		if (leaves.length > 0) {
			leaf = leaves[0] ?? null;
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({type: VIEW_TYPE_KARMIND, active: true});
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}
}
