import {App} from 'obsidian';

export interface SecretStorageLike {
	getSecret(id: string): string | null;
	setSecret(id: string, secret: string): void;
}

export interface SecretComponentLike {
	setValue(value: string): SecretComponentLike;
	onChange(callback: (value: string) => unknown): SecretComponentLike;
}

export type SecretComponentConstructor = new (app: App, containerEl: HTMLElement) => SecretComponentLike;

export function getSecretStorage(app: App): SecretStorageLike | null {
	const candidate = (app as unknown as {secretStorage?: Partial<SecretStorageLike>}).secretStorage;
	if (!candidate || typeof candidate.getSecret !== 'function' || typeof candidate.setSecret !== 'function') {
		return null;
	}
	return candidate as SecretStorageLike;
}

export function getSecretValue(app: App, id: string): string {
	const storage = getSecretStorage(app);
	return storage?.getSecret(id)?.trim() ?? '';
}

export function setSecretValue(app: App, id: string, value: string): boolean {
	const storage = getSecretStorage(app);
	if (!storage) return false;
	storage.setSecret(id, value);
	return true;
}

export function getSecretComponentConstructor(obsidianModule: unknown): SecretComponentConstructor | null {
	const candidate = (obsidianModule as {SecretComponent?: SecretComponentConstructor}).SecretComponent;
	return typeof candidate === 'function' ? candidate : null;
}
