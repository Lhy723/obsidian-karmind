import {App, requestUrl} from 'obsidian';
import {LLMChatRequest, LLMChatResponse, LLMMessage, LLMStreamChunk} from './types';
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

function truncateForError(text: string): string {
	const trimmed = text.trim();
	return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

export class LLMClient {
	private app: App;
	private baseUrl: string;
	private apiKeySecretId: string;
	private model: string;
	private maxTokens: number;
	private temperature: number;
	private enableStreaming: boolean;

	constructor(app: App, settings: KarMindSettings) {
		this.app = app;
		this.baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
		this.apiKeySecretId = settings.apiKeySecretId;
		this.model = settings.model;
		this.maxTokens = settings.maxTokens;
		this.temperature = settings.temperature;
		this.enableStreaming = settings.enableStreaming;
		log('Client initialized', {baseUrl: this.baseUrl, model: this.model});
	}

	updateSettings(settings: KarMindSettings): void {
		this.baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
		this.apiKeySecretId = settings.apiKeySecretId;
		this.model = settings.model;
		this.maxTokens = settings.maxTokens;
		this.temperature = settings.temperature;
		this.enableStreaming = settings.enableStreaming;
		log('Settings updated', {baseUrl: this.baseUrl, model: this.model});
	}

	async chat(messages: LLMMessage[], signal?: AbortSignal): Promise<string> {
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

	private async chatWithFetch(request: LLMChatRequest, signal: AbortSignal): Promise<LLMChatResponse> {
		// requestUrl has no AbortSignal support; fetch is used only for cancellable foreground operations.
		// eslint-disable-next-line no-restricted-globals
		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.getApiKey()}`,
			},
			body: JSON.stringify(request),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LLM API error (${response.status}): ${errorText}`);
		}

		return await response.json() as LLMChatResponse;
	}

async chatStream(
	messages: LLMMessage[],
	onChunk: (chunk: string) => void,
	onDone: () => void,
	onError: (error: Error) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (!this.enableStreaming) {
		await this.chatStreamFallback(messages, onChunk, onDone, onError);
		return;
	}

	await this.chatStreamInternal(messages, onChunk, onDone, onError, signal, true);
}

private async chatStreamInternal(
	messages: LLMMessage[],
	onChunk: (chunk: string) => void,
	onDone: () => void,
	onError: (error: Error) => void,
	signal: AbortSignal | undefined,
	allowFallback: boolean,
): Promise<void> {
	const request: LLMChatRequest = {
		model: this.model,
		messages,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			stream: true,
		};

		log('Sending stream request', {
			url: `${this.baseUrl}/chat/completions`,
			model: this.model,
			messageCount: messages.length,
		});

		try {
			// Obsidian's requestUrl does not expose a streaming reader; SSE requires fetch here.
			// eslint-disable-next-line no-restricted-globals
			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.getApiKey()}`,
				},
				body: JSON.stringify(request),
				signal,
			});

			log('Stream response status', response.status, response.statusText);

			if (!response.ok) {
				const errorText = await response.text();
				logError('Stream API error', response.status, errorText);
				throw new Error(`LLM API error (${response.status}): ${errorText}`);
			}

			const contentType = response.headers.get('content-type') ?? '';
			if (!contentType.includes('text/event-stream')) {
				const text = await response.text();
				const fallbackContent = this.extractNonStreamContent(text);
				if (fallbackContent) {
					onChunk(fallbackContent);
					onDone();
					return;
				}
				throw new Error(`LLM API did not return a stream. Content-Type: ${contentType || 'unknown'}. Response: ${truncateForError(text)}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				logError('No response body reader available');
				throw new Error('No response body -- streaming may not be supported in this environment');
			}

			const decoder = new TextDecoder();
			let buffer = '';
			let chunkCount = 0;

			while (true) {
				const {done, value} = await reader.read();
				if (done) {
					log('Stream ended', {chunkCount});
					break;
				}

				buffer += decoder.decode(value, {stream: true});
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') continue;
					if (!trimmed.startsWith('data: ')) continue;

					try {
						const chunk = JSON.parse(trimmed.slice(6)) as LLMStreamChunk;
						const content = chunk.choices?.[0]?.delta?.content;
						if (content) {
							chunkCount++;
							onChunk(content);
						}
					} catch (parseErr) {
						log('Skipping malformed SSE line', trimmed.substring(0, 100), parseErr);
					}
				}
			}

			if (chunkCount === 0 && allowFallback && !signal?.aborted) {
				log('Stream returned no chunks; falling back to non-streaming chat');
				await this.chatStreamFallback(messages, onChunk, onDone, onError, signal);
				return;
			}

			onDone();
		} catch (error) {
			if (signal?.aborted) {
				log('Stream aborted by user');
				onError(new Error('Stream aborted by user'));
				return;
			}
			if (allowFallback) {
				logError('Stream failed; falling back to non-streaming chat', error);
				await this.chatStreamFallback(messages, onChunk, onDone, onError, signal);
				return;
			}
			logError('Stream failed', error);
			onError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private async chatStreamFallback(
		messages: LLMMessage[],
		onChunk: (chunk: string) => void,
		onDone: () => void,
		onError: (error: Error) => void,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			const content = await this.chat(messages);
			onChunk(content);
			onDone();
		} catch (fallbackError) {
			logError('Fallback chat failed', fallbackError);
			onError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
		}
	}

	private extractNonStreamContent(text: string): string | null {
		try {
			const parsed = JSON.parse(text) as LLMChatResponse;
			return parsed.choices?.[0]?.message?.content ?? null;
		} catch {
			return null;
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
