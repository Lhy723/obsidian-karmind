import {ItemView, WorkspaceLeaf} from 'obsidian';
import {Root, createRoot} from 'react-dom/client';
import {StrictMode} from 'react';
import {VIEW_TYPE_KARMIND} from '../constants';
import {KarMindSettings} from '../settings';
import {PluginContext} from '../ui/context';
import {KarMindApp} from '../ui/KarMindApp';
import KarMindPlugin from '../main';

export class KarMindView extends ItemView {
	private plugin: KarMindPlugin;
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: KarMindPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_KARMIND; }
	getDisplayText(): string { return 'KarMind'; }
	getIcon(): string { return 'brain'; }

	updateLLMClient(_settings: KarMindSettings): void {
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		this.root = createRoot(container);
		this.root.render(
			<StrictMode>
				<PluginContext.Provider value={{app: this.app, plugin: this.plugin}}>
					<KarMindApp
						sessionStore={this.plugin.sessionStore}
						llmClient={this.plugin.llmClient}
						markdownComponent={this}
					/>
				</PluginContext.Provider>
			</StrictMode>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
