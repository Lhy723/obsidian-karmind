import {ChatSession, PermissionLevel, getPermissionLabel} from '../types';

interface HeaderProps {
	sessions: ChatSession[];
	activeSessionId: string;
	isStreaming: boolean;
	apiKeyConfigured: boolean;
	onSwitchSession: (id: string) => void;
	onNewSession: (permission: PermissionLevel) => void;
	onDeleteSession: (id: string) => void;
	activePermission: PermissionLevel;
	onChangePermission: (permission: PermissionLevel) => void;
}

export function Header({sessions, activeSessionId, isStreaming, apiKeyConfigured, onSwitchSession, onNewSession, onDeleteSession, activePermission, onChangePermission}: HeaderProps) {
	const statusText = !apiKeyConfigured ? 'Not configured' : isStreaming ? 'Processing...' : 'Ready';
	const statusClass = !apiKeyConfigured ? 'karmind-status karmind-status-warning' : isStreaming ? 'karmind-status karmind-status-busy' : 'karmind-status karmind-status-ready';

	return (
		<div className="karmind-header">
			<div className="karmind-title-row">
				<div className="karmind-brand">
					<div className="karmind-brand-mark">K</div>
					<div>
						<h4>KarMind</h4>
						<div className="karmind-subtitle">Compile raw notes into a living wiki</div>
					</div>
				</div>
				<span className={statusClass}>{statusText}</span>
			</div>
			<div className="karmind-toolbar">
				<label className="karmind-field">
					<span>Conversation</span>
					<select
						className="karmind-session-select"
						value={activeSessionId}
						onChange={(e) => onSwitchSession(e.target.value)}
						disabled={isStreaming}
					>
						{sessions.map(s => (
							<option key={s.id} value={s.id}>{s.title}</option>
						))}
					</select>
				</label>
				<label className="karmind-field karmind-field-permission">
					<span>Mode</span>
					<select
						className="karmind-permission-select"
						value={activePermission}
						onChange={(e) => onChangePermission(e.target.value as PermissionLevel)}
						disabled={isStreaming}
						title="Session permission level"
					>
						<option value="basic">{getPermissionLabel('basic')}</option>
						<option value="enhanced">{getPermissionLabel('enhanced')}</option>
					</select>
				</label>
				<div className="karmind-header-actions">
					<button
						className="karmind-session-btn"
						onClick={() => onNewSession(activePermission)}
						title="New conversation"
					>New</button>
					<button
						className="karmind-session-btn karmind-session-btn-danger"
						onClick={() => onDeleteSession(activeSessionId)}
						disabled={sessions.length <= 1 || isStreaming}
						title="Delete conversation"
					>Delete</button>
				</div>
			</div>
		</div>
	);
}
