import {App, requestUrl} from 'obsidian';
import {LLMChatRequest, LLMChatResponse, LLMMessage} from './types';
import {KarMindSettings} from '../settings';
import {getSecretValue} from '../utils/secrets';

const LOG_PREFIX = '[KarMind LLM]';
const DEBUG_LOGS = false;

function log(...args: unknown[]): void {
	if (!DEBUG_LOGS) return;
	void args;
}

function logError(...args: unknown[]): void {
	console.error(LOG_PREFIX, ...args);
}

export class LLMClient {
	private app: App;
	private baseUrl: string;
	private apiKeySecretId: string;
	private model: string;
	private maxTokens: number;
	private temperature: number;

	constructor(app: App, settings: KarMindSettings) {
		this.app = app;
		this.baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
		this.apiKeySecretId = settings.apiKeySecretId;
		this.model = settings.model;
		this.maxTokens = settings.maxTokens;
		this.temperature = settings.temperature;
		log('Client initialized', {baseUrl: this.baseUrl, model: this.model});
	}

	updateSettings(settings: KarMindSettings): void {
		this.baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
		this.apiKeySecretId = settings.apiKeySecretId;
		this.model = settings.model;
		this.maxTokens = settings.maxTokens;
		this.temperature = settings.temperature;
		log('Settings updated', {baseUrl: this.baseUrl, model: this.model});
	}

	async chat(messages: LLMMessage[], signal?: AbortSignal): Promise<string> {
		throwIfAborted(signal);
		const request: LLMChatRequest = {
			model: this.model,
			messages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
		};

		log('Sending chat request', {
			url: `${this.baseUrl}/chat/completions`,
			model: this.model,
			messageCount: messages.length,
		});

		try {
			const data = await this.chatWithRequestUrl(request);
			throwIfAborted(signal);

			if (!data.choices || data.choices.length === 0) {
				logError('No choices in response', data);
				throw new Error('LLM API returned no choices');
			}

			const content = data.choices[0]?.message?.content ?? '';
			log('Chat response received', {
				contentLength: content.length,
				usage: data.usage,
			});
			return content;
		} catch (error) {
			logError('Chat request failed', error);
			throw error;
		}
	}

	private async chatWithRequestUrl(request: LLMChatRequest): Promise<LLMChatResponse> {
		const response = await requestUrl({
			url: `${this.baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`,
			},
			body: JSON.stringify(request),
		});

		return response.json as LLMChatResponse;
	}

	async chatStream(
		messages: LLMMessage[],
		onChunk: (chunk: string) => void,
		onDone: () => void,
		onError: (error: Error) => void,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			const content = await this.chat(messages, signal);
			onChunk(content);
			onDone();
		} catch (fallbackError) {
			if (signal?.aborted) return;
			logError('Fallback chat failed', fallbackError);
			onError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
		}
	}

	hasApiKey(): boolean {
		return this.getApiKey().length > 0;
	}

	private getApiKey(): string {
		return getSecretValue(this.app, this.apiKeySecretId);
	}

	async testConnection(): Promise<boolean> {
		log('Testing connection...');
		try {
			await this.chat([
				{role: 'user', content: 'Hello, respond with "OK".'},
			]);
			log('Connection test passed');
			return true;
		} catch (error) {
			logError('Connection test failed', error);
			return false;
		}
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw new DOMException('Request aborted', 'AbortError');
}
