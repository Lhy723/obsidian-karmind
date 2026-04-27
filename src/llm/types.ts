export interface LLMMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface LLMChatRequest {
	model: string;
	messages: LLMMessage[];
	max_tokens?: number;
	temperature?: number;
}

export interface LLMChatResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: {
		index: number;
		message: LLMMessage;
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
