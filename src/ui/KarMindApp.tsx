import {useState, useCallback, useRef, useEffect} from 'react';
import {Component} from 'obsidian';
import {ChatMessage, ChatSession, PermissionLevel, isCommandAllowed, getPermissionLabel, requiresEnhancedPermission} from '../types';
import {LLMMessage} from '../llm/types';
import {SessionStore} from '../store/session-store';
import {LLMClient} from '../llm/client';
import {skillManager} from '../skills/manager';
import {SkillContext} from '../skills/types';
import {CompileProgress} from '../core/compiler';
import {SYSTEM_PROMPT_WORKFLOW_GUIDE} from '../constants';
import {usePlugin} from './hooks';
import {ChatArea} from './ChatArea';
import {Header} from './Header';
import {InputArea} from './InputArea';

const LOG_PREFIX = '[KarMind View]';
function log(...args: unknown[]): void { console.debug(LOG_PREFIX, ...args); }
function logError(...args: unknown[]): void { console.error(LOG_PREFIX, ...args); }
function formatErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	const text = String(error);
	return text.trim() ? text : 'Unknown error';
}

interface SlashCommand {
	name: string;
	description: string;
	execute: (args: string, session: ChatSession) => Promise<void>;
}

const API_COMMANDS = new Set(['/compile', '/qa', '/backfill', '/health']);
const SUGGESTION_DISMISSED = '[Suggestion dismissed]';

export function KarMindApp({sessionStore, llmClient, markdownComponent}: {sessionStore: SessionStore; llmClient: LLMClient; markdownComponent: Component}) {
	const plugin = usePlugin();

	const [sessions, setSessions] = useState<ChatSession[]>(() => {
		const loaded = sessionStore.getAll();
		if (loaded.length === 0) {
			const s = sessionStore.create(plugin.settings.defaultPermission ?? 'basic');
			return [s];
		}
		return loaded;
	});

	const [activeSessionId, setActiveSessionId] = useState<string>(() => {
		return sessions[0]?.id ?? '';
	});

	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState('');
	const [showStreamingOutput, setShowStreamingOutput] = useState(true);
	const abortRef = useRef<AbortController | null>(null);
	const streamBufferRef = useRef('');
	const streamRafRef = useRef<number>(0);

	const activeSession = sessions.find(s => s.id === activeSessionId);
	const chatMessages = activeSession?.messages ?? [];

	const pushMessage = useCallback((sessionId: string, msg: ChatMessage): number | null => {
		const index = sessionStore.pushMessage(sessionId, msg);
		setSessions([...sessionStore.getAll()]);
		return index;
	}, [sessionStore]);

	const updateMessage = useCallback((sessionId: string, index: number | null, patch: Partial<ChatMessage>) => {
		if (index === null) return;
		sessionStore.updateMessage(sessionId, index, patch);
		setSessions([...sessionStore.getAll()]);
	}, [sessionStore]);

	const runCommand = useCallback(async (input: string, session: ChatSession): Promise<boolean> => {
		const slashMatch = input.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
		if (!slashMatch) return false;

		const commandName = '/' + slashMatch[1];
		const args = slashMatch[2] ?? '';
		const command = slashCommands.current.get(commandName);
		if (!command) return false;

		if (requiresEnhancedPermission(commandName) && !isCommandAllowed(commandName, session.permission)) {
			const updatedSession = sessionStore.update(session.id, {permission: 'enhanced'});
			if (updatedSession) {
				session = updatedSession;
				setSessions([...sessionStore.getAll()]);
			}
			pushMessage(session.id, {
				role: 'assistant',
				content: `Permission request accepted: this conversation is now ${getPermissionLabel('enhanced')} because ${commandName} needs file operations.`,
				timestamp: Date.now(),
			});
		}

		if (API_COMMANDS.has(commandName) && !plugin.settings.apiKey) {
			pushMessage(session.id, {
				role: 'error',
				content: 'LLM API key not configured. Go to Settings > KarMind to set it up.',
				timestamp: Date.now(),
			});
			return true;
		}

		pushMessage(session.id, {role: 'user', content: input, timestamp: Date.now()});
		log('Executing slash command', commandName);
		await command.execute(args, sessionStore.get(session.id) ?? session);
		return true;
	}, [plugin.settings.apiKey, pushMessage, sessionStore]);

	const createNewSession = useCallback((permission: PermissionLevel = plugin.settings.defaultPermission ?? 'basic') => {
		const session = sessionStore.create(permission);
		setSessions([...sessionStore.getAll()]);
		setActiveSessionId(session.id);
		log('Created new session', session.id);
	}, [sessionStore, plugin.settings.defaultPermission]);

	const switchSession = useCallback((id: string) => {
		if (isStreaming) return;
		setActiveSessionId(id);
		log('Switched to session', id);
	}, [isStreaming]);

	const deleteSession = useCallback((id: string) => {
		if (sessions.length <= 1) return;
		sessionStore.delete(id);
		const newSessions = sessionStore.getAll();
		setSessions(newSessions);
		if (activeSessionId === id) {
			setActiveSessionId(newSessions[0]?.id ?? '');
		}
		log('Deleted session', id);
	}, [sessionStore, sessions.length, activeSessionId]);

	const changePermission = useCallback((sessionId: string, permission: PermissionLevel) => {
		sessionStore.update(sessionId, {permission});
		setSessions([...sessionStore.getAll()]);
	}, [sessionStore]);

	const getSkillContext = useCallback((): SkillContext => ({
		app: plugin.app,
		vault: plugin.app.vault,
		metadataCache: plugin.app.metadataCache,
	}), [plugin]);

	const slashCommands = useRef<Map<string, SlashCommand>>(new Map());

	useEffect(() => {
		const cmds = slashCommands.current;
		cmds.set('/compile', {
			name: '/compile',
			description: 'Compile raw notes into wiki pages',
			execute: async (args, session) => {
				const controller = new AbortController();
				abortRef.current = controller;
				setIsStreaming(true);
				setShowStreamingOutput(false);
				setStreamingContent('');
				const progressMessageIndex = pushMessage(session.id, {
					role: 'assistant',
					content: 'Compile progress: preparing...',
					timestamp: Date.now(),
				});
				try {
					log('Starting compilation');
					const {force, instruction} = parseCompileArgs(args);
					const result = await plugin.compiler.compileRaw({
						instruction,
						force,
						signal: controller.signal,
						onProgress: (progress) => {
							updateMessage(session.id, progressMessageIndex, {
								role: progress.phase === 'file-error' ? 'error' : 'assistant',
								content: formatCompileProgress(progress),
								timestamp: Date.now(),
							});
						},
					});
					updateMessage(session.id, progressMessageIndex, {role: 'assistant', content: result, timestamp: Date.now()});
				} catch (error) {
					if (isAbortError(error)) {
						updateMessage(session.id, progressMessageIndex, {
							role: 'assistant',
							content: 'Compilation stopped by user. Completed files remain in the wiki; the current unfinished file was not marked compiled.',
							timestamp: Date.now(),
						});
						return;
					}
					logError('Compilation failed', error);
					updateMessage(session.id, progressMessageIndex, {
						role: 'error',
						content: `Compilation failed: ${formatErrorMessage(error)}`,
						timestamp: Date.now(),
					});
				} finally {
					setIsStreaming(false);
					setShowStreamingOutput(true);
					setStreamingContent('');
					streamBufferRef.current = '';
					abortRef.current = null;
				}
			},
		});
		cmds.set('/qa', {
			name: '/qa',
			description: 'Ask a question about your knowledge base',
			execute: async (args, session) => {
				try {
					log('Getting wiki context for QA');
					const wikiContext = await plugin.qaEngine.getRelevantContext(args);
					log('Wiki context retrieved', {contextCount: wikiContext.length});
					await doStreamResponse(session, wikiContext);
				} catch (error) {
					logError('QA context retrieval failed', error);
					pushMessage(session.id, {role: 'error', content: `Failed to retrieve wiki context: ${formatErrorMessage(error)}`, timestamp: Date.now()});
				}
			},
		});
		cmds.set('/backfill', {
			name: '/backfill',
			description: 'Archive content back into the wiki',
			execute: async (args, session) => {
				try {
					log('Starting backfill');
					const result = await plugin.backfillEngine.backfill(args);
					pushMessage(session.id, {role: 'assistant', content: result, timestamp: Date.now()});
				} catch (error) {
					logError('Backfill failed', error);
					pushMessage(session.id, {role: 'error', content: `Backfill failed: ${formatErrorMessage(error)}`, timestamp: Date.now()});
				}
			},
		});
		cmds.set('/health', {
			name: '/health',
			description: 'Run a health check on your wiki',
			execute: async (_args, session) => {
				try {
					log('Starting health check');
					const report = await plugin.healthChecker.check();
					pushMessage(session.id, {role: 'assistant', content: report.summary, timestamp: Date.now()});
				} catch (error) {
					logError('Health check failed', error);
					pushMessage(session.id, {role: 'error', content: `Health check failed: ${formatErrorMessage(error)}`, timestamp: Date.now()});
				}
			},
		});
		cmds.set('/skills', {
			name: '/skills',
			description: 'List all skills and their status',
			execute: async (_args, session) => {
				const skills = skillManager.getAllSkills();
				const lines = skills.map(s => {
					const status = skillManager.isEnabled(s.id) ? 'enabled' : 'disabled';
					return `  ${s.name} (${s.id}) [${status}] -- ${s.description}`;
				});
				pushMessage(session.id, {role: 'assistant', content: `Available skills:\n\n${lines.join('\n')}`, timestamp: Date.now()});
			},
		});
		cmds.set('/skill', {
			name: '/skill',
			description: 'Execute a skill by ID',
			execute: async (args, session) => {
				const parts = args.split(/\s+/);
				const skillId = parts[0];
				const skillArgs = parts.slice(1);
				if (!skillId) {
					pushMessage(session.id, {role: 'error', content: 'Usage: /skill <id> [args...]', timestamp: Date.now()});
					return;
				}
				const result = await skillManager.executeSkill(skillId, getSkillContext(), ...skillArgs);
				pushMessage(session.id, {role: result.success ? 'assistant' : 'error', content: result.content, timestamp: Date.now()});
			},
		});
		cmds.set('/help', {
			name: '/help',
			description: 'List available slash commands',
			execute: async (_args, session) => {
				const lines: string[] = ['Available commands:', ''];
				for (const [, cmd] of cmds) {
					lines.push(`  ${cmd.name} -- ${cmd.description}`);
				}
				lines.push('', 'Or just type a message to chat with the LLM.');
				pushMessage(session.id, {role: 'assistant', content: lines.join('\n'), timestamp: Date.now()});
			},
		});
		cmds.set('/clear', {
			name: '/clear',
			description: 'Clear current conversation',
			execute: async (_args, session) => {
				sessionStore.update(session.id, {messages: []});
				setSessions([...sessionStore.getAll()]);
			},
		});
		cmds.set('/new', {
			name: '/new',
			description: 'Start a new conversation',
			execute: async (_args, session) => {
				createNewSession(session.permission);
			},
		});
	}, [plugin, sessionStore, pushMessage, updateMessage, getSkillContext, createNewSession]);

	const flushStreamBuffer = useCallback(() => {
		setStreamingContent(streamBufferRef.current);
		streamRafRef.current = 0;
	}, []);

	const doStreamResponse = useCallback(async (session: ChatSession, contextMessages: LLMMessage[]) => {
		setIsStreaming(true);
		setShowStreamingOutput(true);
		setStreamingContent('');
		streamBufferRef.current = '';
		log('Starting stream response', {contextCount: contextMessages.length});

		const controller = new AbortController();
		abortRef.current = controller;

		const systemMessages = session.messages
			.filter(m => m.role === 'system')
			.map(m => ({role: m.role as 'system', content: m.content}));

		const conversationMessages = session.messages
			.filter(m => m.role === 'user' || m.role === 'assistant')
			.map(m => ({role: m.role as 'user' | 'assistant', content: m.content}));

		const messages = [
			{role: 'system' as const, content: SYSTEM_PROMPT_WORKFLOW_GUIDE},
			...contextMessages,
			...systemMessages,
			...conversationMessages,
		];

		let fullContent = '';

		await llmClient.chatStream(
			messages,
			(chunk: string) => {
				fullContent += chunk;
				streamBufferRef.current = fullContent;
				if (!streamRafRef.current) {
					streamRafRef.current = requestAnimationFrame(flushStreamBuffer);
				}
			},
			() => {
				if (streamRafRef.current) {
					cancelAnimationFrame(streamRafRef.current);
					streamRafRef.current = 0;
				}
				setIsStreaming(false);
				setStreamingContent('');
				streamBufferRef.current = '';
				abortRef.current = null;
				pushMessage(session.id, {role: 'assistant', content: fullContent, timestamp: Date.now()});
				log('Stream completed', {contentLength: fullContent.length});
			},
			(error: Error) => {
				if (streamRafRef.current) {
					cancelAnimationFrame(streamRafRef.current);
					streamRafRef.current = 0;
				}
				setIsStreaming(false);
				setStreamingContent('');
				streamBufferRef.current = '';
				abortRef.current = null;
				pushMessage(session.id, {role: 'error', content: `LLM error: ${formatErrorMessage(error)}`, timestamp: Date.now()});
				logError('Stream error', error);
			},
			controller.signal,
		);
	}, [llmClient, pushMessage, flushStreamBuffer]);

	const suggestNextWorkflowStep = useCallback((sessionId: string, input: string) => {
		const suggestion = inferWorkflowSuggestion(input, sessionStore.get(sessionId));
		if (!suggestion) return;

		pushMessage(sessionId, {
			role: 'suggestion',
			content: `${suggestion.description}\n\nCommand: ${suggestion.command}`,
			timestamp: Date.now(),
			suggestion,
		});
	}, [pushMessage, sessionStore]);

	const handleSend = useCallback(async (input: string) => {
		if (!input.trim() || isStreaming) return;

		let session = activeSession;
		if (!session) {
			session = sessionStore.create(plugin.settings.defaultPermission ?? 'basic');
			setSessions([...sessionStore.getAll()]);
			setActiveSessionId(session.id);
		}

		if (await runCommand(input, session)) {
			return;
		}

		if (!plugin.settings.apiKey) {
			pushMessage(session.id, {
				role: 'error',
				content: 'LLM API key not configured. Go to Settings > KarMind to set it up.',
				timestamp: Date.now(),
			});
			return;
		}

		pushMessage(session.id, {role: 'user', content: input, timestamp: Date.now()});
		await doStreamResponse(sessionStore.get(session.id) ?? session, []);
		suggestNextWorkflowStep(session.id, input);
	}, [isStreaming, activeSession, plugin.settings.apiKey, pushMessage, doStreamResponse, sessionStore, runCommand, suggestNextWorkflowStep]);

	const handleAcceptSuggestion = useCallback((messageIndex: number) => {
		void (async () => {
			const session = activeSession;
			const message = session?.messages[messageIndex];
			const suggestion = message?.suggestion;
			if (!session || !suggestion || isStreaming) return;

			updateMessage(session.id, messageIndex, {
				role: 'assistant',
				content: `Approved workflow action: ${suggestion.command}`,
				suggestion: undefined,
				timestamp: Date.now(),
			});
			await runCommand(suggestion.command, sessionStore.get(session.id) ?? session);
		})();
	}, [activeSession, isStreaming, runCommand, sessionStore, updateMessage]);

	const handleDismissSuggestion = useCallback((messageIndex: number) => {
		const session = activeSession;
		const message = session?.messages[messageIndex];
		if (!session || !message?.suggestion) return;

		updateMessage(session.id, messageIndex, {
			role: 'assistant',
			content: SUGGESTION_DISMISSED,
			suggestion: undefined,
			timestamp: Date.now(),
		});
	}, [activeSession, updateMessage]);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
		if (streamRafRef.current) {
			cancelAnimationFrame(streamRafRef.current);
			streamRafRef.current = 0;
		}
		setIsStreaming(false);
		setStreamingContent('');
		streamBufferRef.current = '';
		log('Stream aborted by user');
	}, []);

	return (
		<div className="karmind-container">
			<Header
				sessions={sessions}
				activeSessionId={activeSessionId}
				isStreaming={isStreaming}
				apiKeyConfigured={!!plugin.settings.apiKey}
				onSwitchSession={switchSession}
				onNewSession={createNewSession}
				onDeleteSession={deleteSession}
				activePermission={activeSession?.permission ?? 'basic'}
				onChangePermission={(p) => activeSession && changePermission(activeSession.id, p)}
			/>
			<ChatArea
				messages={chatMessages}
				streamingContent={streamingContent}
				isStreaming={isStreaming}
				apiKeyConfigured={!!plugin.settings.apiKey}
				showStreamingOutput={showStreamingOutput}
				markdownComponent={markdownComponent}
				onAcceptSuggestion={handleAcceptSuggestion}
				onDismissSuggestion={handleDismissSuggestion}
			/>
			<InputArea
				onSend={(value) => { void handleSend(value); }}
				onStop={handleStop}
				isStreaming={isStreaming}
			/>
		</div>
	);
}

function formatCompileProgress(progress: CompileProgress): string {
	const lines = [
		`Compile progress: ${progress.completed}/${progress.total}`,
		`Status: ${progress.message ?? progress.phase}`,
	];

	if (progress.currentPath) {
		lines.push(`Current raw: ${progress.currentPath}`);
	}
	if (progress.wikiPath) {
		lines.push(`Target wiki: ${progress.wikiPath}`);
	}
	if (progress.error) {
		lines.push(`Error: ${progress.error}`);
	}

	return lines.join('\n');
}

function parseCompileArgs(args: string): {force: boolean; instruction?: string} {
	const force = /\B--force\b/.test(args);
	const instruction = args.replace(/\B--force\b/g, '').trim();
	return {force, instruction: instruction || undefined};
}

function inferWorkflowSuggestion(input: string, session: ChatSession | undefined) {
	const normalized = input.toLowerCase();
	if (!session) return null;
	const hasSuggestion = session.messages.some(message => message.role === 'suggestion' && message.suggestion);
	if (hasSuggestion) return null;

	if (/(刚|新|加入|收集|导入|clip|raw|素材|网页|文章|论文|资料)/i.test(input)) {
		return {
			command: '/compile',
			label: 'Compile raw notes',
			description: 'I found this looks like newly collected material. The next KarMind workflow step is to compile raw notes into wiki pages.',
			requiresConfirmation: true,
		};
	}

	if (/(检查|健康|断链|孤立|缺失|重复|health|orphan|broken)/i.test(normalized)) {
		return {
			command: '/health',
			label: 'Run health check',
			description: 'This looks like a knowledge-base maintenance request. I can run a wiki health check and report broken links, orphan pages, and missing areas.',
			requiresConfirmation: true,
		};
	}

	if (/(保存|归档|回填|写入 wiki|backfill|archive)/i.test(normalized)) {
		return {
			command: `/backfill ${input}`,
			label: 'Backfill to wiki',
			description: 'This looks like an insight worth preserving. I can backfill it into the wiki after you approve.',
			requiresConfirmation: true,
		};
	}

	if (/(问|解释|总结|为什么|如何|怎么|what|why|how)/i.test(normalized)) {
		return {
			command: `/qa ${input}`,
			label: 'Ask wiki',
			description: 'This looks like a question that may benefit from wiki context. I can answer it using the compiled knowledge base.',
			requiresConfirmation: true,
		};
	}

	return null;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
		|| error instanceof Error && error.name === 'AbortError';
}
