import {ChatSession, PermissionLevel} from '../types';
import {type KarMindLanguage, t} from '../i18n';

interface HeaderProps {
	sessions: ChatSession[];
	activeSessionId: string;
	isStreaming: boolean;
	apiKeyConfigured: boolean;
	onSwitchSession: (id: string) => void;
	onNewSession: (permission: PermissionLevel) => void;
	onDeleteSession: (id: string) => void;
	defaultPermission: PermissionLevel;
	language: KarMindLanguage;
}

export function Header({sessions, activeSessionId, isStreaming, apiKeyConfigured, onSwitchSession, onNewSession, onDeleteSession, defaultPermission, language}: HeaderProps) {
	const statusText = !apiKeyConfigured ? t(language, 'statusNotConfigured') : isStreaming ? t(language, 'statusProcessing') : t(language, 'statusReady');
	const statusClass = !apiKeyConfigured ? 'karmind-status karmind-status-warning' : 'karmind-status';

	return (
		<div className="karmind-header">
			<div className="karmind-header-row">
				<h4>KarMind</h4>
				<div className="karmind-session-picker">
					<select
						className="karmind-session-select"
						value={activeSessionId}
						onChange={(e) => onSwitchSession(e.target.value)}
						disabled={isStreaming}
						aria-label={t(language, 'sessionSelectLabel')}
					>
						{sessions.map(s => (
							<option key={s.id} value={s.id}>{s.title}</option>
						))}
					</select>
				</div>
				<span className={statusClass}>{statusText}</span>
				<button
					className="karmind-session-btn"
					onClick={() => onNewSession(defaultPermission)}
					title={t(language, 'newConversation')}
				>{t(language, 'newConversation')}</button>
				<button
					className="karmind-session-btn karmind-session-btn-danger"
					onClick={() => onDeleteSession(activeSessionId)}
					disabled={sessions.length <= 1 || isStreaming}
					title={t(language, 'deleteConversation')}
				>{t(language, 'deleteConversation')}</button>
			</div>
		</div>
	);
}
