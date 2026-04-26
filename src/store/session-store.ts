import {ChatSession} from '../types';

const STORAGE_KEY = 'karmind-sessions';
const LAST_ACTIVE_SESSION_KEY = 'karmind-last-active-session';
const MAX_SESSIONS = 50;

export class SessionStore {
	private plugin: {loadData: () => Promise<unknown>; saveData: (data: unknown) => Promise<void>};
	private sessions: ChatSession[] = [];
	private lastActiveSessionId = '';
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(plugin: {loadData: () => Promise<unknown>; saveData: (data: unknown) => Promise<void>}) {
		this.plugin = plugin;
	}

	async load(): Promise<ChatSession[]> {
		try {
			const data = await this.plugin.loadData() as Record<string, unknown> | null;
			const raw = data?.[STORAGE_KEY];
			if (Array.isArray(raw)) {
				this.sessions = raw as ChatSession[];
				for (const session of this.sessions) {
					for (const message of session.messages) {
						normalizeMessage(message);
					}
				}
			} else {
				this.sessions = [];
			}
			this.lastActiveSessionId = typeof data?.[LAST_ACTIVE_SESSION_KEY] === 'string'
				? data[LAST_ACTIVE_SESSION_KEY]
				: '';
			if (this.lastActiveSessionId && !this.get(this.lastActiveSessionId)) {
				this.lastActiveSessionId = '';
			}
		} catch {
			this.sessions = [];
			this.lastActiveSessionId = '';
		}
		return this.sessions;
	}

	getAll(): ChatSession[] {
		return this.sessions;
	}

	get(id: string): ChatSession | undefined {
		return this.sessions.find(s => s.id === id);
	}

	getLastActiveSessionId(): string {
		return this.lastActiveSessionId;
	}

	getInitialSessionId(): string {
		if (this.lastActiveSessionId && this.get(this.lastActiveSessionId)) {
			return this.lastActiveSessionId;
		}

		return this.sessions.reduce<ChatSession | null>((latest, session) => {
			if (!latest || session.updatedAt > latest.updatedAt) return session;
			return latest;
		}, null)?.id ?? '';
	}

	setLastActiveSession(id: string): void {
		if (!this.get(id)) return;
		this.lastActiveSessionId = id;
		this.debouncedSave();
	}

	create(permission: ChatSession['permission'] = 'basic'): ChatSession {
		const session: ChatSession = {
			id: 'session-' + Date.now(),
			title: 'New conversation',
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			permission,
		};
		this.sessions.push(session);
		this.lastActiveSessionId = session.id;
		this.debouncedSave();
		return session;
	}

	update(id: string, patch: Partial<ChatSession>): ChatSession | undefined {
		const session = this.sessions.find(s => s.id === id);
		if (!session) return undefined;
		Object.assign(session, patch, {updatedAt: Date.now()});
		this.debouncedSave();
		return session;
	}

	delete(id: string): boolean {
		if (this.sessions.length <= 1) return false;
		const idx = this.sessions.findIndex(s => s.id === id);
		if (idx === -1) return false;
		this.sessions.splice(idx, 1);
		if (this.lastActiveSessionId === id) {
			this.lastActiveSessionId = this.getInitialSessionId();
		}
		this.debouncedSave();
		return true;
	}

	pushMessage(id: string, msg: ChatSession['messages'][number]): number | null {
		const session = this.sessions.find(s => s.id === id);
		if (!session) return null;
		normalizeMessage(msg);
		session.messages.push(msg);
		session.updatedAt = Date.now();
		if (msg.role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
			session.title = msg.content.substring(0, 50) || 'New conversation';
		}
		this.debouncedSave();
		return session.messages.length - 1;
	}

	updateMessage(id: string, index: number, patch: Partial<ChatSession['messages'][number]>): boolean {
		const session = this.sessions.find(s => s.id === id);
		const message = session?.messages[index];
		if (!session || !message) return false;

		Object.assign(message, patch);
		normalizeMessage(message);
		session.updatedAt = Date.now();
		this.debouncedSave();
		return true;
	}

	pruneOldSessions(): void {
		if (this.sessions.length <= MAX_SESSIONS) return;
		this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		this.sessions = this.sessions.slice(0, MAX_SESSIONS);
		if (this.lastActiveSessionId && !this.get(this.lastActiveSessionId)) {
			this.lastActiveSessionId = this.getInitialSessionId();
		}
		this.debouncedSave();
	}

	flush(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.save();
		}
	}

	private debouncedSave(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			void this.save();
		}, 500);
	}

	private async save(): Promise<void> {
		try {
			const data = (await this.plugin.loadData() as Record<string, unknown>) ?? {};
			data[STORAGE_KEY] = this.sessions;
			data[LAST_ACTIVE_SESSION_KEY] = this.lastActiveSessionId;
			await this.plugin.saveData(data);
			this.saveTimer = null;
		} catch (err) {
			console.error('[KarMind SessionStore] Failed to save sessions', err);
		}
	}
}

function normalizeMessage(message: ChatSession['messages'][number]): void {
	if (typeof message.content !== 'string' || message.content.trim().length > 0) {
		return;
	}

	message.content = message.role === 'error'
		? 'An error occurred, but no error details were returned.'
		: '[Empty message]';
}
