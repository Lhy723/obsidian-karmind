import {useEffect, useMemo, useRef} from 'react';
import {Component, MarkdownRenderer} from 'obsidian';
import {ChatMessage, type HealthCheckIssue, type TaskHealthReport, type TaskProgress} from '../types';
import {useApp, usePlugin} from './hooks';
import {AnimatedList} from './AnimatedList';
import {BlurText} from './BlurText';
import {ShinyText} from './ShinyText';
import {type KarMindLanguage, t} from '../i18n';

interface ChatAreaProps {
	messages: ChatMessage[];
	streamingContent: string;
	isStreaming: boolean;
	apiKeyConfigured: boolean;
	showStreamingOutput: boolean;
	markdownComponent: Component;
	onAcceptSuggestion: (messageIndex: number) => void;
	onDismissSuggestion: (messageIndex: number) => void;
	language: KarMindLanguage;
}

export function ChatArea({messages, streamingContent, isStreaming, apiKeyConfigured, showStreamingOutput, markdownComponent, onAcceptSuggestion, onDismissSuggestion, language}: ChatAreaProps) {
	const scrollAnchorKey = useMemo(() => {
		const lastMessage = messages[messages.length - 1];
		return [
			messages.length,
			lastMessage?.timestamp ?? 0,
			lastMessage?.content.length ?? 0,
			isStreaming ? 'streaming' : 'idle',
			streamingContent.length,
		].join(':');
	}, [isStreaming, messages, streamingContent.length]);

	if (messages.length === 0 && !isStreaming) {
		return (
			<div className="karmind-chat-area">
				<Welcome apiKeyConfigured={apiKeyConfigured} language={language} />
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
			autoScrollToBottom={true}
			scrollAnchorKey={scrollAnchorKey}
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
							language={language}
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
								<div className="karmind-message-content karmind-thinking-line">
									<ShinyText
										text={t(language, 'thinking')}
										speed={1.7}
										delay={0.15}
										color="var(--text-muted)"
										shineColor="var(--text-normal)"
										spread={110}
										direction="left"
									/>
								</div>
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
	language,
}: {
	msg: ChatMessage;
	index: number;
	markdownComponent: Component;
	onAcceptSuggestion: (messageIndex: number) => void;
	onDismissSuggestion: (messageIndex: number) => void;
	language: KarMindLanguage;
}) {
	const isError = msg.role === 'error';
	const isSuggestion = msg.role === 'suggestion';
	const cls = isSuggestion
		? 'karmind-message karmind-message-suggestion'
		: isError
		? 'karmind-message karmind-message-error'
		: `karmind-message karmind-message-${msg.role}`;
	const roleLabel = isSuggestion ? t(language, 'roleSuggestion') : isError ? t(language, 'roleError') : msg.role === 'user' ? t(language, 'roleUser') : t(language, 'roleAssistant');
	const content = getRenderableContent(msg, language);

	if (msg.taskProgress) {
		return (
			<TaskProgressCard
				msg={msg}
				progress={msg.taskProgress}
				content={content}
				markdownComponent={markdownComponent}
				language={language}
			/>
		);
	}

	if (msg.suggestion) {
		return (
			<div className={cls}>
				<div className="karmind-suggestion-card-header">
					<div className="karmind-suggestion-icon">→</div>
					<div>
						<div className="karmind-suggestion-kicker">{t(language, 'suggestedAction')}</div>
						<div className="karmind-suggestion-title">{msg.suggestion.label}</div>
					</div>
				</div>
				<div className="karmind-suggestion-body">
					<MarkdownContent content={content} component={markdownComponent} language={language} />
				</div>
				<div className="karmind-suggestion-command">{msg.suggestion.command}</div>
				<div className="karmind-suggestion-actions">
					<button
						className="karmind-suggestion-btn karmind-suggestion-btn-primary"
						onClick={() => onAcceptSuggestion(index)}
					>{t(language, 'runAction')}</button>
					<button
						className="karmind-suggestion-btn"
						onClick={() => onDismissSuggestion(index)}
					>{t(language, 'dismiss')}</button>
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
				<MarkdownContent content={content} component={markdownComponent} language={language} />
			)}
			{msg.timestamp && (
				<div className="karmind-message-time">
					{new Date(msg.timestamp).toLocaleTimeString()}
				</div>
			)}
		</div>
	);
}

function TaskProgressCard({
	msg,
	progress,
	content,
	markdownComponent,
	language,
}: {
	msg: ChatMessage;
	progress: TaskProgress;
	content: string;
	markdownComponent: Component;
	language: KarMindLanguage;
}) {
	const percent = getProgressPercent(progress);
	const isRunning = progress.status === 'running';
	const statusLabel = getTaskStatusLabel(progress.status, language);
	const details = [
		progress.currentPath ? {label: t(language, 'currentRaw', {path: progress.currentPath})} : null,
		progress.targetPath ? {label: t(language, 'targetWiki', {path: progress.targetPath})} : null,
		progress.error ? {label: t(language, 'error', {error: progress.error})} : null,
	].filter(Boolean) as {label: string}[];

	return (
		<div className={`karmind-message karmind-message-task karmind-task-${progress.kind} karmind-task-${progress.status}`}>
			<div className="karmind-task-card-header">
				<div className="karmind-task-orb" aria-hidden="true" />
				<div className="karmind-task-title-group">
					<div className="karmind-task-kicker">{statusLabel}</div>
					<div className="karmind-task-title">{progress.title}</div>
				</div>
				{typeof percent === 'number' && (
					<div className="karmind-task-percent">{t(language, 'taskProgressPercent', {percent})}</div>
				)}
			</div>
			<div className="karmind-task-message">{progress.message}</div>
			<div className={`karmind-task-progress ${typeof percent !== 'number' ? 'karmind-task-progress-indeterminate' : ''}`}>
				<div
					className="karmind-task-progress-fill"
					style={typeof percent === 'number' ? {width: `${percent}%`} : undefined}
				/>
			</div>
			{progress.completed !== undefined && progress.total !== undefined && progress.total > 0 && (
				<div className="karmind-task-steps">
					{t(language, 'taskProgressSteps', {completed: progress.completed, total: progress.total})}
				</div>
			)}
			{details.length > 0 && (
				<div className="karmind-task-details">
					{details.map((detail, index) => (
						<div key={index} className="karmind-task-detail">{detail.label}</div>
					))}
				</div>
			)}
			<FileOperationsDetails operations={progress.fileOperations ?? []} language={language} />
			{!isRunning && progress.kind === 'health' && progress.healthReport && (
				<HealthReportPanel report={progress.healthReport} language={language} />
			)}
			{!isRunning && !(progress.kind === 'health' && progress.healthReport) && content.trim() && (
				<div className="karmind-task-result">
					<MarkdownContent content={content} component={markdownComponent} language={language} />
				</div>
			)}
			{msg.timestamp && (
				<div className="karmind-message-time">
					{new Date(msg.timestamp).toLocaleTimeString()}
				</div>
			)}
		</div>
	);
}

function HealthReportPanel({report, language}: {report: TaskHealthReport; language: KarMindLanguage}) {
	const high = report.issues.filter(issue => issue.severity === 'high').length;
	const medium = report.issues.filter(issue => issue.severity === 'medium').length;
	const low = report.issues.filter(issue => issue.severity === 'low').length;

	return (
		<div className="karmind-health-report">
			<div className="karmind-health-metrics">
				<HealthMetric label={t(language, 'healthReportPages')} value={report.totalPages} tone="neutral" />
				<HealthMetric label={t(language, 'healthReportIssues')} value={report.issues.length} tone={report.issues.length > 0 ? 'warning' : 'success'} />
				<HealthMetric label={t(language, 'healthReportHigh')} value={high} tone={high > 0 ? 'danger' : 'neutral'} />
				<HealthMetric label={t(language, 'healthReportMedium')} value={medium} tone={medium > 0 ? 'warning' : 'neutral'} />
				<HealthMetric label={t(language, 'healthReportLow')} value={low} tone="neutral" />
			</div>
			{report.issues.length === 0 ? (
				<div className="karmind-health-empty">
					<strong>{t(language, 'healthReportNoIssuesTitle')}</strong>
					<span>{t(language, 'healthReportNoIssuesBody')}</span>
				</div>
			) : (
				<div className="karmind-health-issues">
					<div className="karmind-health-issues-title">{t(language, 'healthIssuesHeading')}</div>
					{report.issues.map((issue, index) => (
						<HealthIssueItem key={`${issue.location}-${index}`} issue={issue} index={index} language={language} />
					))}
				</div>
			)}
		</div>
	);
}

function HealthMetric({label, value, tone}: {label: string; value: number; tone: 'neutral' | 'success' | 'warning' | 'danger'}) {
	return (
		<div className={`karmind-health-metric karmind-health-metric-${tone}`}>
			<div className="karmind-health-metric-value">{value}</div>
			<div className="karmind-health-metric-label">{label}</div>
		</div>
	);
}

function HealthIssueItem({issue, index, language}: {issue: HealthCheckIssue; index: number; language: KarMindLanguage}) {
	return (
		<details className={`karmind-health-issue karmind-health-issue-${issue.severity}`}>
			<summary>
				<span className="karmind-health-issue-index">{index + 1}</span>
				<span className="karmind-health-issue-main">
					<span className="karmind-health-issue-title">{issue.description}</span>
					<span className="karmind-health-issue-meta">
						{t(language, 'healthIssueType', {type: issue.type})}
					</span>
				</span>
				<span className="karmind-health-issue-severity">
					{getHealthSeverityLabel(issue.severity, language)}
				</span>
			</summary>
			<div className="karmind-health-issue-body">
				<div>
					<strong>{t(language, 'healthIssueDescription')}</strong>
					<p>{issue.description}</p>
				</div>
				<div>
					<strong>{t(language, 'healthIssueLocation', {location: issue.location})}</strong>
				</div>
				<div>
					<strong>{t(language, 'healthIssueRecommendation', {recommendation: issue.recommendation})}</strong>
				</div>
				<div className="karmind-health-issue-footnote">
					{t(language, 'healthIssueSeverity', {severity: getHealthSeverityLabel(issue.severity, language)})}
				</div>
			</div>
		</details>
	);
}

function getHealthSeverityLabel(severity: HealthCheckIssue['severity'], language: KarMindLanguage): string {
	if (severity === 'high') return t(language, 'healthReportHigh');
	if (severity === 'medium') return t(language, 'healthReportMedium');
	return t(language, 'healthReportLow');
}

function FileOperationsDetails({operations, language}: {operations: NonNullable<TaskProgress['fileOperations']>; language: KarMindLanguage}) {
	if (operations.length === 0) {
		return null;
	}

	return (
		<details className="karmind-file-ops">
			<summary>
				<span>{t(language, 'fileOperationsLabel')}</span>
				<span className="karmind-file-ops-count">{operations.length}</span>
			</summary>
			<div className="karmind-file-ops-list">
				{operations.map((operation, index) => (
					<div key={`${operation.timestamp}-${index}`} className={`karmind-file-op karmind-file-op-${operation.action}`}>
						<div className="karmind-file-op-row">
							<span className="karmind-file-op-action">{getFileOperationLabel(operation.action, language)}</span>
							<code className="karmind-file-op-path">{operation.path}</code>
						</div>
						{operation.detail && (
							<div className="karmind-file-op-detail">{operation.detail}</div>
						)}
						{operation.preview && (
							<details className="karmind-file-op-preview">
								<summary>{t(language, 'fileOperationPreview')}</summary>
								<pre>{operation.preview}</pre>
							</details>
						)}
					</div>
				))}
			</div>
		</details>
	);
}

function getFileOperationLabel(action: NonNullable<TaskProgress['fileOperations']>[number]['action'], language: KarMindLanguage): string {
	if (action === 'read') return t(language, 'fileOperationRead');
	if (action === 'create') return t(language, 'fileOperationCreate');
	if (action === 'update') return t(language, 'fileOperationUpdate');
	if (action === 'delete') return t(language, 'fileOperationDelete');
	return t(language, 'fileOperationScan');
}

function getProgressPercent(progress: TaskProgress): number | null {
	if (progress.total === undefined || progress.completed === undefined || progress.total <= 0) {
		return null;
	}
	return Math.max(0, Math.min(100, Math.round(progress.completed / progress.total * 100)));
}

function getTaskStatusLabel(status: TaskProgress['status'], language: KarMindLanguage): string {
	if (status === 'success') return t(language, 'taskStatusSuccess');
	if (status === 'error') return t(language, 'taskStatusError');
	if (status === 'stopped') return t(language, 'taskStatusStopped');
	return t(language, 'taskStatusRunning');
}

function MarkdownContent({content, component, language}: {content: string; component: Component; language: KarMindLanguage}) {
	const app = useApp();
	const plugin = usePlugin();
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const sourcePath = `${plugin.settings.wikiFolder}/_index.md`;

		const handleClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;

			const anchor = target.closest('a.internal-link, a[data-href]');
			if (!(anchor instanceof HTMLAnchorElement)) return;

			const linkText = getInternalLinkText(anchor);
			if (!linkText) return;

			event.preventDefault();
			event.stopPropagation();
			void app.workspace.openLinkText(linkText, sourcePath, event.metaKey || event.ctrlKey)
				.catch((error) => console.error('[KarMind] Failed to open internal link', linkText, error));
		};

		el.addEventListener('click', handleClick);

		el.empty();
		if (!content.trim()) {
			el.setText(t(language, 'emptyMessage'));
			return () => el.removeEventListener('click', handleClick);
		}

		void MarkdownRenderer.render(app, content, el, sourcePath, component)
			.catch((error) => {
				console.error('[KarMind] Markdown render failed', error);
				el.empty();
				el.setText(content);
			});

		return () => el.removeEventListener('click', handleClick);
	}, [app, content, component, language, plugin.settings.wikiFolder]);

	return <div className="karmind-message-content markdown-rendered" ref={contentRef} />;
}

function getInternalLinkText(anchor: HTMLAnchorElement): string | null {
	const dataHref = anchor.getAttribute('data-href')?.trim();
	if (dataHref) return dataHref;

	const href = anchor.getAttribute('href')?.trim();
	if (href && !isExternalHref(href)) {
		return decodeURIComponent(href.replace(/^#/, '').replace(/\.md$/i, '')).trim() || null;
	}

	return anchor.textContent?.trim() || null;
}

function isExternalHref(href: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function getRenderableContent(message: ChatMessage, language: KarMindLanguage): string {
	if (message.content.trim()) {
		return message.content;
	}

	return message.role === 'error'
		? t(language, 'emptyErrorMessage')
		: t(language, 'emptyMessage');
}

function Welcome({apiKeyConfigured, language}: {apiKeyConfigured: boolean; language: KarMindLanguage}) {
	const commands = [
		{cmd: '/compile', desc: t(language, 'welcomeCompileDesc')},
		{cmd: '/qa', desc: t(language, 'welcomeQaDesc')},
		{cmd: '/backfill', desc: t(language, 'welcomeBackfillDesc')},
		{cmd: '/health', desc: t(language, 'welcomeHealthDesc')},
	];

	return (
		<div className="karmind-welcome">
			<div className="karmind-welcome-card">
				<div className="karmind-welcome-eyebrow">{t(language, 'welcomeEyebrow')}</div>
				<h3>{t(language, 'welcomeTitle')}</h3>
				<p>{t(language, 'welcomeBody')}</p>
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
					<strong>{t(language, 'tip')}</strong>
					<p>{t(language, 'welcomeTip')}</p>
				</div>
			</div>
			{!apiKeyConfigured && (
				<p className="karmind-setup-hint">{t(language, 'setupHint')}</p>
			)}
		</div>
	);
}
