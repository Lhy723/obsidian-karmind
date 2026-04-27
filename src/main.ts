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
import {VaultSkillLoader} from './skills/vault-loader';
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
	vaultSkillLoader!: VaultSkillLoader;
	sessionStore!: SessionStore;
	private autoCompileRunning = false;
	private autoCompilePending = false;
	private healthCheckIntervalId: number | null = null;
	private healthCheckRunning = false;
	private skillReloadTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.llmClient = new LLMClient(this.app, this.settings);
		this.compiler = new Compiler(this.app, this.llmClient, this.settings);
		this.qaEngine = new QAEngine(this.app, this.llmClient, this.settings);
		this.backfillEngine = new BackfillEngine(this.app, this.llmClient, this.settings);
		this.healthChecker = new HealthChecker(this.app, this.llmClient, this.settings);
		this.collector = new Collector(this.app, this.settings);
		this.vaultSkillLoader = new VaultSkillLoader(this.app, this.llmClient, this.settings);

		this.sessionStore = new SessionStore(this);
		await this.sessionStore.load();

		this.registerBuiltInSkills();
		await this.vaultSkillLoader.reload();

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
				void this.runHealthCheck();
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
		this.scheduleHealthChecks();

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('create', (file) => {
				this.scheduleSkillReload(file.path);
				void this.handleAutoCompile(file);
			}));
			this.registerEvent(this.app.vault.on('modify', (file) => {
				this.scheduleSkillReload(file.path);
			}));
			this.registerEvent(this.app.vault.on('delete', (file) => {
				this.scheduleSkillReload(file.path);
			}));
		});
	}

	onunload(): void {
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData() as (Partial<KarMindSettings> & {apiKey?: string; enableStreaming?: boolean}) | null;
		const saved = data ?? {};
		const legacyApiKey = typeof saved.apiKey === 'string' ? saved.apiKey.trim() : '';
		delete saved.apiKey;
		delete saved.enableStreaming;

		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		if (!isKarMindLanguage(this.settings.language)) {
			this.settings.language = DEFAULT_SETTINGS.language;
		}
		this.settings.rawFolder = normalizePath(this.settings.rawFolder || DEFAULT_SETTINGS.rawFolder);
		this.settings.wikiFolder = normalizePath(this.settings.wikiFolder || DEFAULT_SETTINGS.wikiFolder);
		this.settings.skillsFolder = normalizePath(this.settings.skillsFolder || DEFAULT_SETTINGS.skillsFolder);

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
		delete (next as {enableStreaming?: unknown}).enableStreaming;
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
		this.vaultSkillLoader.updateSettings(this.settings);
		this.scheduleHealthChecks();
		void this.vaultSkillLoader.reload();

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

	private scheduleSkillReload(path: string): void {
		if (!this.vaultSkillLoader.isSkillPath(path)) return;
		if (this.skillReloadTimer !== null) {
			window.clearTimeout(this.skillReloadTimer);
		}

		this.skillReloadTimer = window.setTimeout(() => {
			this.skillReloadTimer = null;
			void this.vaultSkillLoader.reload();
		}, 400);
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

	private scheduleHealthChecks(): void {
		if (this.healthCheckIntervalId !== null) {
			window.clearInterval(this.healthCheckIntervalId);
			this.healthCheckIntervalId = null;
		}

		const intervalHours = this.settings.healthCheckInterval;
		if (intervalHours <= 0) return;

		this.healthCheckIntervalId = window.setInterval(() => {
			void this.runHealthCheck(true);
		}, intervalHours * 60 * 60 * 1000);
		this.registerInterval(this.healthCheckIntervalId);
	}

	private async runHealthCheck(scheduled = false): Promise<void> {
		if (this.healthCheckRunning) {
			new Notice(t(this.settings.language, 'noticeHealthAlreadyRunning'));
			return;
		}

		if (scheduled && !this.hasApiKey()) {
			new Notice(t(this.settings.language, 'scheduledHealthSkippedNoApiKey'));
			return;
		}

		this.healthCheckRunning = true;

		try {
			new Notice(t(this.settings.language, scheduled ? 'scheduledHealthRunning' : 'noticeHealthRunning'));
			const report = await this.healthChecker.check();
			new Notice(t(this.settings.language, scheduled ? 'scheduledHealthComplete' : 'noticeHealthComplete', {count: report.issues.length}));
			await this.activateView();
		} catch (error) {
			new Notice(t(this.settings.language, scheduled ? 'scheduledHealthFailed' : 'noticeHealthFailed', {error: error instanceof Error ? error.message : String(error)}));
		} finally {
			this.healthCheckRunning = false;
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

function isKarMindLanguage(value: unknown): value is KarMindSettings['language'] {
	return value === 'system' || value === 'zh' || value === 'en';
}
