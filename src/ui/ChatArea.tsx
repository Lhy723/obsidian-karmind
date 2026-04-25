import {useEffect, useRef} from 'react';
import {Component, MarkdownRenderer} from 'obsidian';
import {ChatMessage} from '../types';
import {useApp} from './hooks';
import {AnimatedList} from './AnimatedList';
import {BlurText} from './BlurText';

interface ChatAreaProps {
	messages: ChatMessage[];
	streamingContent: string;
	isStreaming: boolean;
	apiKeyConfigured: boolean;
	showStreamingOutput: boolean;
	markdownComponent: Component;
	onAcceptSuggestion: (messageIndex: number) => void;
	onDismissSuggestion: (messageIndex: number) => void;
}

export function ChatArea({messages, streamingContent, isStreaming, apiKeyConfigured, showStreamingOutput, markdownComponent, onAcceptSuggestion, onDismissSuggestion}: ChatAreaProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, streamingContent]);

	if (messages.length === 0 && !isStreaming) {
		return (
			<div className="karmind-chat-area" ref={scrollRef}>
				<Welcome apiKeyConfigured={apiKeyConfigured} />
			</div>
		);
	}

	return (
		<AnimatedList
			items={buildMessageListItems(messages, showStreamingOutput, isStreaming, streamingContent)}
			className="karmind-chat-list-container"
			displayScrollbar={false}
			enableArrowNavigation={false}
			showGradients={false}
			getItemKey={(item) => item.key}
			renderItem={(item) => (
				item.kind === 'message'
					? (
						<MessageBubble
							msg={item.message}
							index={item.index}
							markdownComponent={markdownComponent}
							onAcceptSuggestion={onAcceptSuggestion}
							onDismissSuggestion={onDismissSuggestion}
						/>
					)
					: (
						<div className="karmind-message karmind-message-assistant karmind-message-streaming">
							<div className="karmind-message-role">KarMind</div>
							{item.content ? (
								<BlurText
									text={item.content}
									className="karmind-message-content karmind-stream-blur-text"
									animateBy="words"
									direction="top"
									delay={16}
									stepDuration={0.22}
								/>
							) : (
								<div className="karmind-message-content">...</div>
							)}
						</div>
					)
			)}
		/>
	);
}

type MessageListItem =
	| {kind: 'message'; key: string; message: ChatMessage; index: number}
	| {kind: 'streaming'; key: string; content: string};

function buildMessageListItems(messages: ChatMessage[], showStreamingOutput: boolean, isStreaming: boolean, streamingContent: string): MessageListItem[] {
	const items: MessageListItem[] = messages.map((message, index) => ({
		kind: 'message',
		key: `message-${index}-${message.timestamp ?? 0}-${message.role}`,
		message,
		index,
	}));

	if (showStreamingOutput && isStreaming) {
		items.push({kind: 'streaming', key: 'streaming-message', content: streamingContent});
	}

	return items;
}

function MessageBubble({
	msg,
	index,
	markdownComponent,
	onAcceptSuggestion,
	onDismissSuggestion,
}: {
	msg: ChatMessage;
	index: number;
	markdownComponent: Component;
	onAcceptSuggestion: (messageIndex: number) => void;
	onDismissSuggestion: (messageIndex: number) => void;
}) {
	const isError = msg.role === 'error';
	const isSuggestion = msg.role === 'suggestion';
	const cls = isSuggestion
		? 'karmind-message karmind-message-suggestion'
		: isError
		? 'karmind-message karmind-message-error'
		: `karmind-message karmind-message-${msg.role}`;
	const roleLabel = isSuggestion ? 'Suggestion' : isError ? 'Error' : msg.role === 'user' ? 'You' : 'KarMind';
	const content = getRenderableContent(msg);

	if (msg.suggestion) {
		return (
			<div className={cls}>
				<div className="karmind-suggestion-card-header">
					<div className="karmind-suggestion-icon">→</div>
					<div>
						<div className="karmind-suggestion-kicker">Suggested action</div>
						<div className="karmind-suggestion-title">{msg.suggestion.label}</div>
					</div>
				</div>
				<div className="karmind-suggestion-body">
					<MarkdownContent content={content} component={markdownComponent} />
				</div>
				<div className="karmind-suggestion-command">{msg.suggestion.command}</div>
				<div className="karmind-suggestion-actions">
					<button
						className="karmind-suggestion-btn karmind-suggestion-btn-primary"
						onClick={() => onAcceptSuggestion(index)}
					>Run action</button>
					<button
						className="karmind-suggestion-btn"
						onClick={() => onDismissSuggestion(index)}
					>Dismiss</button>
				</div>
				{msg.timestamp && (
					<div className="karmind-message-time">
						{new Date(msg.timestamp).toLocaleTimeString()}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className={cls}>
			<div className="karmind-message-role">{roleLabel}</div>
			{isError ? (
				<div className="karmind-message-content karmind-error-content">{content}</div>
			) : (
				<MarkdownContent content={content} component={markdownComponent} />
			)}
			{msg.timestamp && (
				<div className="karmind-message-time">
					{new Date(msg.timestamp).toLocaleTimeString()}
				</div>
			)}
		</div>
	);
}

function MarkdownContent({content, component}: {content: string; component: Component}) {
	const app = useApp();
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;

		el.empty();
		if (!content.trim()) {
			el.setText('[Empty message]');
			return;
		}

		void MarkdownRenderer.render(app, content, el, '', component)
			.catch((error) => {
				console.error('[KarMind] Markdown render failed', error);
				el.empty();
				el.setText(content);
			});
	}, [app, content, component]);

	return <div className="karmind-message-content markdown-rendered" ref={contentRef} />;
}

function getRenderableContent(message: ChatMessage): string {
	if (message.content.trim()) {
		return message.content;
	}

	return message.role === 'error'
		? 'An error occurred, but no error details were returned.'
		: '[Empty message]';
}

function Welcome({apiKeyConfigured}: {apiKeyConfigured: boolean}) {
	const commands = [
		{cmd: '/compile', desc: 'Build wiki pages from raw notes'},
		{cmd: '/qa', desc: 'Ask with wiki context'},
		{cmd: '/backfill', desc: 'Save useful output into wiki'},
		{cmd: '/health', desc: 'Find gaps and broken links'},
	];

	return (
		<div className="karmind-welcome">
			<div className="karmind-welcome-card">
				<div className="karmind-welcome-eyebrow">Karpathy workflow</div>
				<h3>Collect. Compile. Ask. Backfill. Improve.</h3>
				<p>Start with a natural question, or approve suggested actions when KarMind detects the next useful workflow step.</p>
			</div>
			<div className="karmind-command-grid">
				{commands.map(c => (
					<div key={c.cmd} className="karmind-welcome-step">
						<code className="karmind-cmd">{c.cmd}</code>
						<span className="karmind-cmd-desc">{c.desc}</span>
					</div>
				))}
			</div>
			<div className="karmind-welcome-tip">
				<div>
					<strong>Tip</strong>
					<p>Drop source notes into <code>raw/</code>, then run <code>/compile</code>. Unchanged files are skipped automatically.</p>
				</div>
			</div>
			{!apiKeyConfigured && (
				<p className="karmind-setup-hint">Configure your LLM API key in Settings &gt; KarMind before running model-powered actions.</p>
			)}
		</div>
	);
}
