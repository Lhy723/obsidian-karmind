import {useState, useCallback, useRef, useEffect} from 'react';
import {App, Component} from 'obsidian';
import {ChatMessage, ChatSession, type FileOperationLog, PermissionLevel, type TaskProgress, isCommandAllowed, requiresEnhancedPermission} from '../types';
import {LLMMessage} from '../llm/types';
import {SessionStore} from '../store/session-store';
import {LLMClient} from '../llm/client';
import {skillManager} from '../skills/manager';
import {SkillContext} from '../skills/types';
import {type CompileProgress} from '../core/compiler';
import {type HealthCheckProgress} from '../core/health-checker';
import {SYSTEM_PROMPT_WORKFLOW_GUIDE} from '../constants';
import {type KarMindLanguage, t} from '../i18n';
import {usePlugin} from './hooks';
import {ChatArea} from './ChatArea';
import {Header} from './Header';
import {InputArea, type CommandSuggestionItem} from './InputArea';
import {confirmAction} from './confirm';

const LOG_PREFIX = '[KarMind View]';
const DEBUG_LOGS = false;
function log(...args: unknown[]): void {
	if (!DEBUG_LOGS) return;
	void args;
}
function logError(...args: unknown[]): void { console.error(LOG_PREFIX, ...args); }
function formatErrorMessage(error: unknown, language: KarMindLanguage): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	const text = String(error);
	return text.trim() ? text : t(language, 'unknownError');
}

interface SlashCommand {
	name: string;
	description: string;
	execute: (args: string, session: ChatSession) => Promise<void>;
}

const API_COMMANDS = new Set(['/compile', '/qa', '/backfill', '/health']);

export function KarMindApp({sessionStore, llmClient, markdownComponent}: {sessionStore: SessionStore; llmClient: LLMClient; markdownComponent: Component}) {
	const plugin = usePlugin();
	const language = plugin.settings.language;

	const [sessions, setSessions] = useState<ChatSession[]>(() => {
		const loaded = sessionStore.getAll();
		if (loaded.length === 0) {
			const s = sessionStore.create(plugin.settings.defaultPermission ?? 'basic');
			sessionStore.update(s.id, {title: t(plugin.settings.language, 'newConversationTitle')});
			return [s];
		}
		return loaded;
	});

	const [activeSessionId, setActiveSessionId] = useState<string>(() => {
		return sessionStore.getInitialSessionId() || sessions[0]?.id || '';
	});

	const [isStreaming, setIsStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState('');
	const [showStreamingOutput, setShowStreamingOutput] = useState(true);
	const abortRef = useRef<AbortController | null>(null);
	const streamBufferRef = useRef('');
	const streamRafRef = useRef<number>(0);

	const activeSession = sessions.find(s => s.id === activeSessionId);
	const chatMessages = activeSession?.messages ?? [];
	const apiKeyConfigured = plugin.hasApiKey();
	const commandSuggestions: CommandSuggestionItem[] = [
		{name: '/compile', description: t(language, 'commandDescCompile'), insertText: '/compile'},
		{name: '/qa', description: t(language, 'commandDescQa'), insertText: '/qa '},
		{name: '/backfill', description: t(language, 'commandDescBackfill'), insertText: '/backfill '},
		{name: '/health', description: t(language, 'commandDescHealth'), insertText: '/health'},
		{name: '/skills', description: t(language, 'commandDescSkills'), insertText: '/skills'},
		{name: '/skill', description: t(language, 'commandDescSkill'), insertText: '/skill '},
		{name: '/new', description: t(language, 'commandDescNew'), insertText: '/new'},
		{name: '/clear', description: t(language, 'commandDescClear'), insertText: '/clear'},
		{name: '/help', description: t(language, 'commandDescHelp'), insertText: '/help'},
	];

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

		if (API_COMMANDS.has(commandName) && !plugin.hasApiKey()) {
			pushMessage(session.id, {
				role: 'error',
				content: t(language, 'apiKeyMissing'),
				timestamp: Date.now(),
			});
			return true;
		}

		pushMessage(session.id, {role: 'user', content: input, timestamp: Date.now()});

		if (requiresEnhancedPermission(commandName) && !isCommandAllowed(commandName, session.permission)) {
			const confirmed = await confirmEnhancedPermission(plugin.app, language);
			if (!confirmed) {
				pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'operationCancelled'),
					timestamp: Date.now(),
				});
				return true;
			}

			const updatedSession = sessionStore.update(session.id, {permission: 'enhanced'});
			if (updatedSession) {
				session = updatedSession;
				setSessions([...sessionStore.getAll()]);
			}
			pushMessage(session.id, {
				role: 'assistant',
				content: t(language, 'permissionAccepted', {command: commandName}),
				timestamp: Date.now(),
			});
		}

		if (commandName === '/compile') {
			const confirmed = await confirmCompile(plugin.app, language);
			if (!confirmed) {
				pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'operationCancelled'),
					timestamp: Date.now(),
				});
				return true;
			}
		}

		log('Executing slash command', commandName);
		await command.execute(args, sessionStore.get(session.id) ?? session);
		return true;
	}, [language, plugin, pushMessage, sessionStore]);

	const createNewSession = useCallback((permission: PermissionLevel = plugin.settings.defaultPermission ?? 'basic') => {
		const session = sessionStore.create(permission);
		sessionStore.update(session.id, {title: t(language, 'newConversationTitle')});
		setSessions([...sessionStore.getAll()]);
		setActiveSessionId(session.id);
		log('Created new session', session.id);
	}, [language, sessionStore, plugin.settings.defaultPermission]);

	const switchSession = useCallback((id: string) => {
		if (isStreaming) return;
		sessionStore.setLastActiveSession(id);
		setActiveSessionId(id);
		log('Switched to session', id);
	}, [isStreaming, sessionStore]);

	const deleteSession = useCallback((id: string) => {
		if (sessions.length <= 1) return;
		sessionStore.delete(id);
		const newSessions = sessionStore.getAll();
		setSessions(newSessions);
		if (activeSessionId === id) {
			const nextSessionId = sessionStore.getInitialSessionId() || newSessions[0]?.id || '';
			if (nextSessionId) {
				sessionStore.setLastActiveSession(nextSessionId);
			}
			setActiveSessionId(nextSessionId);
		}
		log('Deleted session', id);
	}, [sessionStore, sessions.length, activeSessionId]);

	const changePermission = useCallback(async (sessionId: string, permission: PermissionLevel) => {
		const current = sessionStore.get(sessionId)?.permission;
		if (current === permission) return;
		if (permission === 'enhanced') {
			const confirmed = await confirmEnhancedPermission(plugin.app, language);
			if (!confirmed) return;
		}

		sessionStore.update(sessionId, {permission});
		setSessions([...sessionStore.getAll()]);
	}, [language, plugin.app, sessionStore]);

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
			description: t(language, 'commandDescCompile'),
			execute: async (args, session) => {
				const controller = new AbortController();
				abortRef.current = controller;
				setIsStreaming(true);
				setShowStreamingOutput(false);
				setStreamingContent('');
				const fileOperations: FileOperationLog[] = [];
				let currentTaskProgress: TaskProgress = {
					kind: 'compile',
					title: t(language, 'taskCompileTitle'),
					status: 'running',
					message: t(language, 'compilePreparing'),
					completed: 0,
					total: 0,
					startedAt: Date.now(),
					updatedAt: Date.now(),
					fileOperations,
				};
				const progressMessageIndex = pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'compilePreparing'),
					timestamp: Date.now(),
					taskProgress: currentTaskProgress,
				});
				const recordFileOperation = (operation: FileOperationLog) => {
					appendFileOperation(fileOperations, operation);
					currentTaskProgress = {
						...currentTaskProgress,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						taskProgress: currentTaskProgress,
						timestamp: Date.now(),
					});
				};
				try {
					log('Starting compilation');
					const {force, instruction} = parseCompileArgs(args);
					const result = await plugin.compiler.compileRaw({
						instruction,
						force,
						signal: controller.signal,
						onFileOperation: recordFileOperation,
						onProgress: (progress) => {
							currentTaskProgress = {
								...formatCompileTaskProgress(progress, language),
								fileOperations: [...fileOperations],
							};
							updateMessage(session.id, progressMessageIndex, {
								role: progress.phase === 'file-error' ? 'error' : 'assistant',
								content: formatCompileProgress(progress, language),
								timestamp: Date.now(),
								taskProgress: currentTaskProgress,
							});
						},
					});
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'success',
						message: t(language, 'compilerCompilationComplete'),
						completed: 1,
						total: 1,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'assistant',
						content: result,
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				} catch (error) {
					if (isAbortError(error)) {
						currentTaskProgress = {
							...currentTaskProgress,
							status: 'stopped',
							message: t(language, 'compileStopped'),
							fileOperations: [...fileOperations],
							updatedAt: Date.now(),
						};
						updateMessage(session.id, progressMessageIndex, {
							role: 'assistant',
							content: t(language, 'compileStopped'),
							timestamp: Date.now(),
							taskProgress: currentTaskProgress,
						});
						return;
					}
					logError('Compilation failed', error);
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'error',
						message: t(language, 'compileFailed', {error: formatErrorMessage(error, language)}),
						error: formatErrorMessage(error, language),
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'error',
						content: t(language, 'compileFailed', {error: formatErrorMessage(error, language)}),
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
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
			description: t(language, 'commandDescQa'),
			execute: async (args, session) => {
				if (!args.trim()) {
					pushMessage(session.id, {role: 'error', content: t(language, 'usageQa'), timestamp: Date.now()});
					return;
				}

				const fileOperations: FileOperationLog[] = [];
				let currentTaskProgress: TaskProgress = {
					kind: 'qa',
					title: t(language, 'taskQaTitle'),
					status: 'running',
					message: t(language, 'qaProgressRetrieving'),
					startedAt: Date.now(),
					updatedAt: Date.now(),
					fileOperations,
				};
				const progressMessageIndex = pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'qaProgressRetrieving'),
					timestamp: Date.now(),
					taskProgress: currentTaskProgress,
				});
				const recordFileOperation = (operation: FileOperationLog) => {
					appendFileOperation(fileOperations, operation);
					currentTaskProgress = {
						...currentTaskProgress,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						taskProgress: currentTaskProgress,
						timestamp: Date.now(),
					});
				};
				try {
					log('Getting wiki context for QA');
					const wikiContext = await plugin.qaEngine.getRelevantContext(args, {
						onFileOperation: recordFileOperation,
					});
					log('Wiki context retrieved', {contextCount: wikiContext.length});
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'success',
						message: t(language, 'qaProgressComplete'),
						completed: 1,
						total: 1,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'assistant',
						content: t(language, 'qaProgressComplete'),
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
					await doStreamResponse(session, wikiContext);
				} catch (error) {
					logError('QA context retrieval failed', error);
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'error',
						message: t(language, 'qaContextFailed', {error: formatErrorMessage(error, language)}),
						error: formatErrorMessage(error, language),
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'error',
						content: t(language, 'qaContextFailed', {error: formatErrorMessage(error, language)}),
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				}
			},
		});
		cmds.set('/backfill', {
			name: '/backfill',
			description: t(language, 'commandDescBackfill'),
			execute: async (args, session) => {
				if (!args.trim()) {
					pushMessage(session.id, {role: 'error', content: t(language, 'usageBackfill'), timestamp: Date.now()});
					return;
				}

				const fileOperations: FileOperationLog[] = [];
				let currentTaskProgress: TaskProgress = {
					kind: 'backfill',
					title: t(language, 'taskBackfillTitle'),
					status: 'running',
					message: t(language, 'backfillProgressAnalyzing'),
					startedAt: Date.now(),
					updatedAt: Date.now(),
					fileOperations,
				};
				const progressMessageIndex = pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'backfillProgressAnalyzing'),
					timestamp: Date.now(),
					taskProgress: currentTaskProgress,
				});
				const recordFileOperation = (operation: FileOperationLog) => {
					appendFileOperation(fileOperations, operation);
					currentTaskProgress = {
						...currentTaskProgress,
						message: t(language, 'backfillProgressApplying'),
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						content: t(language, 'backfillProgressApplying'),
						taskProgress: currentTaskProgress,
						timestamp: Date.now(),
					});
				};
				try {
					log('Starting backfill');
					const result = await plugin.backfillEngine.backfill(args, {
						onFileOperation: recordFileOperation,
					});
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'success',
						message: t(language, 'backfillProgressComplete'),
						completed: 1,
						total: 1,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'assistant',
						content: result,
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				} catch (error) {
					logError('Backfill failed', error);
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'error',
						message: t(language, 'backfillFailed', {error: formatErrorMessage(error, language)}),
						error: formatErrorMessage(error, language),
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'error',
						content: t(language, 'backfillFailed', {error: formatErrorMessage(error, language)}),
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				}
			},
		});
		cmds.set('/health', {
			name: '/health',
			description: t(language, 'commandDescHealth'),
			execute: async (_args, session) => {
				const fileOperations: FileOperationLog[] = [];
				let currentTaskProgress: TaskProgress = {
					kind: 'health',
					title: t(language, 'taskHealthTitle'),
					status: 'running',
					message: t(language, 'healthProgressScanning'),
					completed: 0,
					total: 5,
					startedAt: Date.now(),
					updatedAt: Date.now(),
					fileOperations,
				};
				const progressMessageIndex = pushMessage(session.id, {
					role: 'assistant',
					content: t(language, 'healthProgressScanning'),
					timestamp: Date.now(),
					taskProgress: currentTaskProgress,
				});
				const recordFileOperation = (operation: FileOperationLog) => {
					appendFileOperation(fileOperations, operation);
					currentTaskProgress = {
						...currentTaskProgress,
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						taskProgress: currentTaskProgress,
						timestamp: Date.now(),
					});
				};
				try {
					log('Starting health check');
					const report = await plugin.healthChecker.check({
						onFileOperation: recordFileOperation,
						onProgress: (progress) => {
							currentTaskProgress = {
								...formatHealthTaskProgress(progress, language),
								fileOperations: [...fileOperations],
							};
							updateMessage(session.id, progressMessageIndex, {
								role: 'assistant',
								content: formatHealthProgress(progress, language),
								timestamp: Date.now(),
								taskProgress: currentTaskProgress,
							});
						},
					});
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'success',
						message: t(language, 'healthProgressComplete'),
						completed: 5,
						total: 5,
						fileOperations: [...fileOperations],
						healthReport: {
							timestamp: report.timestamp,
							totalPages: report.totalPages,
							issues: report.issues,
						},
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'assistant',
						content: report.summary,
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				} catch (error) {
					logError('Health check failed', error);
					currentTaskProgress = {
						...currentTaskProgress,
						status: 'error',
						message: t(language, 'healthFailed', {error: formatErrorMessage(error, language)}),
						error: formatErrorMessage(error, language),
						fileOperations: [...fileOperations],
						updatedAt: Date.now(),
					};
					updateMessage(session.id, progressMessageIndex, {
						role: 'error',
						content: t(language, 'healthFailed', {error: formatErrorMessage(error, language)}),
						timestamp: Date.now(),
						taskProgress: currentTaskProgress,
					});
				}
			},
		});
		cmds.set('/skills', {
			name: '/skills',
			description: t(language, 'commandDescSkills'),
			execute: async (_args, session) => {
				const skills = skillManager.getAllSkills();
				const lines = skills.map(s => {
					const status = skillManager.isEnabled(s.id) ? t(language, 'skillEnabled') : t(language, 'skillDisabled');
					return `  ${s.name} (${s.id}) [${status}] -- ${s.description}`;
				});
				pushMessage(session.id, {role: 'assistant', content: `${t(language, 'availableSkills')}\n\n${lines.join('\n')}`, timestamp: Date.now()});
			},
		});
		cmds.set('/skill', {
			name: '/skill',
			description: t(language, 'commandDescSkill'),
			execute: async (args, session) => {
				const parts = args.trim().split(/\s+/);
				const skillId = parts[0];
				const skillArgs = parts.slice(1);
				if (!skillId) {
					pushMessage(session.id, {role: 'error', content: t(language, 'usageSkill'), timestamp: Date.now()});
					return;
				}
				const result = await skillManager.executeSkill(skillId, getSkillContext(), ...skillArgs);
				pushMessage(session.id, {role: result.success ? 'assistant' : 'error', content: result.content, timestamp: Date.now()});
			},
		});
		cmds.set('/help', {
			name: '/help',
			description: t(language, 'commandDescHelp'),
			execute: async (_args, session) => {
				const lines: string[] = [t(language, 'availableCommands'), ''];
				for (const [, cmd] of cmds) {
					lines.push(`  ${cmd.name} -- ${cmd.description}`);
				}
				lines.push('', t(language, 'orChat'));
				pushMessage(session.id, {role: 'assistant', content: lines.join('\n'), timestamp: Date.now()});
			},
		});
		cmds.set('/clear', {
			name: '/clear',
			description: t(language, 'commandDescClear'),
			execute: async (_args, session) => {
				sessionStore.update(session.id, {messages: []});
				setSessions([...sessionStore.getAll()]);
			},
		});
		cmds.set('/new', {
			name: '/new',
			description: t(language, 'commandDescNew'),
			execute: async (_args, session) => {
				createNewSession(session.permission);
			},
		});
	}, [plugin, sessionStore, pushMessage, updateMessage, getSkillContext, createNewSession, language]);

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
			{role: 'system' as const, content: `${SYSTEM_PROMPT_WORKFLOW_GUIDE}\n\n${formatSkillGuide()}\n\n${t(language, 'workflowLanguageInstruction')}`},
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
				pushMessage(session.id, {role: 'assistant', content: normalizeAssistantWorkflowCommands(fullContent, language), timestamp: Date.now()});
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
				pushMessage(session.id, {role: 'error', content: t(language, 'llmError', {error: formatErrorMessage(error, language)}), timestamp: Date.now()});
				logError('Stream error', error);
			},
			controller.signal,
		);
	}, [language, llmClient, pushMessage, flushStreamBuffer]);

	const suggestNextWorkflowStep = useCallback((sessionId: string, input: string) => {
		const suggestion = inferWorkflowSuggestion(input, sessionStore.get(sessionId), language, getSkillSuggestions(input));
		if (!suggestion) return;

		pushMessage(sessionId, {
			role: 'suggestion',
			content: `${suggestion.description}\n\n${t(language, 'commandLabel')}: ${suggestion.command}`,
			timestamp: Date.now(),
			suggestion,
		});
	}, [language, pushMessage, sessionStore]);

	const handleSend = useCallback(async (input: string) => {
		if (!input.trim() || isStreaming) return;

		let session = activeSession;
		if (!session) {
			session = sessionStore.create(plugin.settings.defaultPermission ?? 'basic');
			sessionStore.update(session.id, {title: t(language, 'newConversationTitle')});
			setSessions([...sessionStore.getAll()]);
			setActiveSessionId(session.id);
		}

		if (await runCommand(input, session)) {
			return;
		}

		if (!plugin.hasApiKey()) {
			pushMessage(session.id, {
				role: 'error',
				content: t(language, 'apiKeyMissing'),
				timestamp: Date.now(),
			});
			return;
		}

		pushMessage(session.id, {role: 'user', content: input, timestamp: Date.now()});
		await doStreamResponse(sessionStore.get(session.id) ?? session, []);
		suggestNextWorkflowStep(session.id, input);
	}, [isStreaming, activeSession, plugin, pushMessage, doStreamResponse, sessionStore, runCommand, suggestNextWorkflowStep, language]);

	const handleAcceptSuggestion = useCallback((messageIndex: number) => {
		void (async () => {
			const session = activeSession;
			const message = session?.messages[messageIndex];
			const suggestion = message?.suggestion;
			if (!session || !suggestion || isStreaming) return;

			updateMessage(session.id, messageIndex, {
				role: 'assistant',
				content: t(language, 'approvedAction', {command: suggestion.command}),
				suggestion: undefined,
				timestamp: Date.now(),
			});
			await runCommand(suggestion.command, sessionStore.get(session.id) ?? session);
		})();
	}, [activeSession, isStreaming, runCommand, sessionStore, updateMessage, language]);

	const handleDismissSuggestion = useCallback((messageIndex: number) => {
		const session = activeSession;
		const message = session?.messages[messageIndex];
		if (!session || !message?.suggestion) return;

		updateMessage(session.id, messageIndex, {
			role: 'assistant',
			content: t(language, 'suggestionDismissed'),
			suggestion: undefined,
			timestamp: Date.now(),
		});
	}, [activeSession, updateMessage, language]);

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
				apiKeyConfigured={apiKeyConfigured}
				onSwitchSession={switchSession}
				onNewSession={createNewSession}
				onDeleteSession={deleteSession}
				defaultPermission={activeSession?.permission ?? plugin.settings.defaultPermission ?? 'basic'}
				language={language}
			/>
			<ChatArea
				messages={chatMessages}
				streamingContent={streamingContent}
				isStreaming={isStreaming}
				apiKeyConfigured={apiKeyConfigured}
				showStreamingOutput={showStreamingOutput}
				markdownComponent={markdownComponent}
				onAcceptSuggestion={handleAcceptSuggestion}
				onDismissSuggestion={handleDismissSuggestion}
				language={language}
			/>
			<InputArea
				onSend={(value) => { void handleSend(value); }}
				onStop={handleStop}
				isStreaming={isStreaming}
				activePermission={activeSession?.permission ?? 'basic'}
				onChangePermission={(p) => {
					if (activeSession) void changePermission(activeSession.id, p);
				}}
				commandSuggestions={commandSuggestions}
				language={language}
			/>
		</div>
	);
}

function formatCompileProgress(progress: CompileProgress, language: KarMindLanguage): string {
	const lines = [
		t(language, 'compileProgress', {completed: progress.completed, total: progress.total}),
		t(language, 'status', {status: progress.message ?? progress.phase}),
	];

	if (progress.currentPath) {
		lines.push(t(language, 'currentRaw', {path: progress.currentPath}));
	}
	if (progress.wikiPath) {
		lines.push(t(language, 'targetWiki', {path: progress.wikiPath}));
	}
	if (progress.error) {
		lines.push(t(language, 'error', {error: progress.error}));
	}

	return lines.join('\n');
}

function formatCompileTaskProgress(progress: CompileProgress, language: KarMindLanguage): TaskProgress {
	const status = progress.phase === 'file-error' ? 'error' : progress.phase === 'complete' ? 'success' : 'running';
	return {
		kind: 'compile',
		title: t(language, 'taskCompileTitle'),
		status,
		message: progress.message ?? progress.phase,
		completed: progress.completed,
		total: progress.total,
		currentPath: progress.currentPath,
		targetPath: progress.wikiPath,
		error: progress.error,
		updatedAt: Date.now(),
	};
}

function formatHealthProgress(progress: HealthCheckProgress, language: KarMindLanguage): string {
	return [
		t(language, 'taskHealthTitle'),
		t(language, 'status', {status: progress.message}),
		t(language, 'taskProgressSteps', {completed: progress.completed, total: progress.total}),
	].join('\n');
}

function formatHealthTaskProgress(progress: HealthCheckProgress, language: KarMindLanguage): TaskProgress {
	return {
		kind: 'health',
		title: t(language, 'taskHealthTitle'),
		status: progress.phase === 'complete' ? 'success' : 'running',
		message: progress.message,
		completed: progress.completed,
		total: progress.total,
		updatedAt: Date.now(),
	};
}

function appendFileOperation(fileOperations: FileOperationLog[], operation: FileOperationLog): void {
	fileOperations.push(operation);
	if (fileOperations.length > 80) {
		fileOperations.splice(0, fileOperations.length - 80);
	}
}

function confirmCompile(app: App, language: KarMindLanguage): Promise<boolean> {
	return confirmAction(app, {
		title: t(language, 'compileConfirmTitle'),
		message: t(language, 'compileConfirmMessage'),
		confirmLabel: t(language, 'compileConfirmButton'),
		cancelLabel: t(language, 'cancel'),
		danger: true,
	});
}

function confirmEnhancedPermission(app: App, language: KarMindLanguage): Promise<boolean> {
	return confirmAction(app, {
		title: t(language, 'enhancedPermissionConfirmTitle'),
		message: t(language, 'enhancedPermissionConfirmMessage'),
		confirmLabel: t(language, 'enhancedPermissionConfirmButton'),
		cancelLabel: t(language, 'cancel'),
		danger: true,
	});
}

function parseCompileArgs(args: string): {force: boolean; instruction?: string} {
	const force = /\B--force\b/.test(args);
	const instruction = args.replace(/\B--force\b/g, '').trim();
	return {force, instruction: instruction || undefined};
}

function inferWorkflowSuggestion(input: string, session: ChatSession | undefined, language: KarMindLanguage, skillSuggestion?: {id: string; name: string}) {
	const normalized = input.toLowerCase();
	if (!session) return null;
	const hasSuggestion = session.messages.some(message => message.role === 'suggestion' && message.suggestion);
	if (hasSuggestion) return null;

	if (skillSuggestion) {
		return {
			command: `/skill ${skillSuggestion.id} ${input}`,
			label: t(language, 'suggestSkillLabel', {name: skillSuggestion.name}),
			description: t(language, 'suggestSkillDesc', {name: skillSuggestion.name}),
			requiresConfirmation: true,
		};
	}

	if (/(刚|新|加入|收集|导入|clip|raw|素材|网页|文章|论文|资料)/i.test(input)) {
		return {
			command: '/compile',
			label: t(language, 'suggestCompileLabel'),
			description: t(language, 'suggestCompileDesc'),
			requiresConfirmation: true,
		};
	}

	if (/(检查|健康|断链|孤立|缺失|重复|health|orphan|broken)/i.test(normalized)) {
		return {
			command: '/health',
			label: t(language, 'suggestHealthLabel'),
			description: t(language, 'suggestHealthDesc'),
			requiresConfirmation: true,
		};
	}

	if (/(保存|归档|回填|写入 wiki|backfill|archive)/i.test(normalized)) {
		return {
			command: `/backfill ${input}`,
			label: t(language, 'suggestBackfillLabel'),
			description: t(language, 'suggestBackfillDesc'),
			requiresConfirmation: true,
		};
	}

	if (/(问|解释|总结|为什么|如何|怎么|what|why|how)/i.test(normalized)) {
		return {
			command: `/qa ${input}`,
			label: t(language, 'suggestQaLabel'),
			description: t(language, 'suggestQaDesc'),
			requiresConfirmation: true,
		};
	}

	return null;
}

function formatSkillGuide(): string {
	const skills = skillManager.getAllSkills().filter(skill => skillManager.isEnabled(skill.id));
	if (skills.length === 0) {
		return 'Available skills: none.';
	}

	return [
		'Available skills:',
		...skills.map(skill => `- ${skill.id} (${skill.name}): ${skill.description}`),
		'When a user request clearly matches a skill, mention the matching skill and suggest `/skill <id> <args>` for user approval instead of assuming the user knows the command.',
	].join('\n');
}

function getSkillSuggestions(input: string): {id: string; name: string} | undefined {
	const normalizedInput = normalizeSuggestionText(input);
	if (!normalizedInput) return undefined;

	let best: {id: string; name: string; score: number} | undefined;
	for (const skill of skillManager.getAllSkills()) {
		if (!skillManager.isEnabled(skill.id)) continue;
		const haystack = normalizeSuggestionText(`${skill.id} ${skill.name} ${skill.description}`);
		const tokens = haystack.split(/\s+/).filter(token => token.length >= 3);
		let score = 0;
		for (const token of tokens) {
			if (normalizedInput.includes(token)) score++;
		}
		if (score > 0 && (!best || score > best.score)) {
			best = {id: skill.id, name: skill.name, score};
		}
	}

	return best ? {id: best.id, name: best.name} : undefined;
}

function normalizeSuggestionText(text: string): string {
	return text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim();
}

function normalizeAssistantWorkflowCommands(content: string, language: KarMindLanguage): string {
	let normalized = content
		.replace(/\bkarmind\s+compile\b/gi, '/compile')
		.replace(/\bkarmind\s+health-check\b/gi, '/health')
		.replace(/\bkarmind\s+health\b/gi, '/health')
		.replace(/\bkarmind\s+qa\b/gi, '/qa')
		.replace(/\bkarmind\s+backfill\b/gi, '/backfill')
		.replace(/\bkarmind\s+skills\b/gi, '/skills');

	if (/\bkarmind\s+fix-links\b|\bfix-links\b/i.test(normalized)) {
		normalized += `\n\n> ${t(language, 'unsupportedFixLinksNote')}`;
	}

	return normalized;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
		|| error instanceof Error && error.name === 'AbortError';
}
