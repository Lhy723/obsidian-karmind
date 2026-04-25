import {Notice, Plugin, TFile, WorkspaceLeaf} from 'obsidian';
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

export default class KarMindPlugin extends Plugin {
	private loadedAt = 0;
	private autoCompilePaths = new Set<string>();

	settings!: KarMindSettings;
	llmClient!: LLMClient;
	compiler!: Compiler;
	qaEngine!: QAEngine;
	backfillEngine!: BackfillEngine;
	healthChecker!: HealthChecker;
	collector!: Collector;
	sessionStore!: SessionStore;

	async onload(): Promise<void> {
		this.loadedAt = Date.now();
		await this.loadSettings();

		this.llmClient = new LLMClient(this.settings);
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

		this.addRibbonIcon('brain', 'Open KarMind', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-panel',
			name: 'Open panel',
			callback: () => { void this.activateView(); },
		});

		this.addCommand({
			id: 'collect-current-note',
			name: 'Collect: mark current note as raw material',
			callback: () => { void this.collector.collectCurrentNote(); },
		});

		this.addCommand({
			id: 'collect-clipboard',
			name: 'Collect: save clipboard to raw folder',
			callback: () => { void this.collector.collectFromClipboard(); },
		});

		this.addCommand({
			id: 'compile-raw',
			name: 'Compile: compile all raw notes',
			callback: () => {
				void (async () => {
					try {
						new Notice('Compiling raw notes...');
						await this.compiler.compileRaw();
						new Notice('Compilation complete!');
						await this.activateView();
					} catch (error) {
						new Notice(`Compilation failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				})();
			},
		});

		this.addCommand({
			id: 'health-check',
			name: 'Health: run wiki health check',
			callback: () => {
				void (async () => {
					try {
						new Notice('Running health check...');
						const report = await this.healthChecker.check();
						new Notice(`Health check complete: ${report.issues.length} issues found`);
						await this.activateView();
					} catch (error) {
						new Notice(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				})();
			},
		});

		this.addCommand({
			id: 'test-llm-connection',
			name: 'Test LLM connection',
			callback: () => {
				void (async () => {
					new Notice('Testing LLM connection...');
					const success = await this.llmClient.testConnection();
					new Notice(success ? 'LLM connection successful!' : 'LLM connection failed. Check your settings.');
				})();
			},
		});

		this.addSettingTab(new KarMindSettingTab(this.app, this));

		if (this.settings.autoCompile) {
			this.registerEvent(this.app.vault.on('create', (file) => {
				if (this.shouldAutoCompileCreatedFile(file)) {
					void this.compileCreatedRawFile(file);
				}
			}));
		}

		if (this.settings.healthCheckInterval > 0) {
			const intervalMs = this.settings.healthCheckInterval * 60 * 60 * 1000;
			this.registerInterval(window.setInterval(() => {
				void this.runScheduledHealthCheck();
			}, intervalMs));
		}
	}

	onunload(): void {
		this.sessionStore?.flush();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<KarMindSettings> | null);
	}

	async saveSettings(): Promise<void> {
		this.settings.disabledSkills = skillManager.getDisabledIds();
		const data = (await this.loadData() as Record<string, unknown> | null) ?? {};
		Object.assign(data, this.settings);
		await this.saveData(data);
		this.updateEngines();
	}

	private shouldAutoCompileCreatedFile(file: unknown): file is TFile {
		if (!(file instanceof TFile)) return false;
		if (file.extension !== 'md') return false;
		if (!file.path.startsWith(this.settings.rawFolder + '/')) return false;
		if (!this.settings.apiKey) return false;

		// Obsidian can emit create-like events while rebuilding the vault after reload.
		// Existing raw files should not trigger auto compile just because the plugin loaded.
		if (file.stat.ctime < this.loadedAt) return false;
		if (this.autoCompilePaths.has(file.path)) return false;

		return true;
	}

	private async compileCreatedRawFile(file: TFile): Promise<void> {
		this.autoCompilePaths.add(file.path);
		try {
			new Notice('New raw file detected. Auto-compiling...');
			await this.compiler.compileSingleFile(file);
			new Notice(`Auto-compiled ${file.basename}.`);
		} catch (error) {
			new Notice(`Auto-compile failed: ${formatError(error)}`);
		} finally {
			this.autoCompilePaths.delete(file.path);
		}
	}

	private async runScheduledHealthCheck(): Promise<void> {
		try {
			const report = await this.healthChecker.check();
			new Notice(`KarMind health check complete: ${report.issues.length} issues found`);
		} catch (error) {
			new Notice(`KarMind health check failed: ${formatError(error)}`);
		}
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

	private registerBuiltInSkills(): void {
		skillManager.registerSkill(summarizeSkill);
		skillManager.registerSkill(listRawSkill);
		skillManager.registerSkill(wikiStatsSkill);
		skillManager.registerSkill(findOrphansSkill);
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

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
