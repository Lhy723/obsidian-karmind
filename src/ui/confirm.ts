import {App, Modal} from 'obsidian';

interface ConfirmActionOptions {
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	danger?: boolean;
}

export function confirmAction(app: App, options: ConfirmActionOptions): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmActionModal(app, options, resolve).open();
	});
}

class ConfirmActionModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private options: ConfirmActionOptions,
		private resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('karmind-confirm-modal');

		contentEl.createEl('h2', {text: this.options.title});
		contentEl.createEl('p', {text: this.options.message, cls: 'karmind-confirm-message'});

		const actions = contentEl.createDiv({cls: 'karmind-confirm-actions'});
		const cancelButton = actions.createEl('button', {text: this.options.cancelLabel});
		cancelButton.addEventListener('click', () => {
			this.finish(false);
		});

		const confirmButton = actions.createEl('button', {text: this.options.confirmLabel});
		confirmButton.addClass(this.options.danger ? 'mod-warning' : 'mod-cta');
		confirmButton.addEventListener('click', () => {
			this.finish(true);
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(false);
	}

	private finish(confirmed: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve(confirmed);
		this.close();
	}
}
