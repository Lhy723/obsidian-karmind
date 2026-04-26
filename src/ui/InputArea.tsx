import {useState, useCallback, type KeyboardEvent} from 'react';
import {PermissionLevel} from '../types';
import {type KarMindLanguage, t} from '../i18n';

interface InputAreaProps {
	onSend: (input: string) => void;
	onStop: () => void;
	isStreaming: boolean;
	activePermission: PermissionLevel;
	onChangePermission: (permission: PermissionLevel) => void;
	language: KarMindLanguage;
}

export function InputArea({onSend, onStop, isStreaming, activePermission, onChangePermission, language}: InputAreaProps) {
	const [input, setInput] = useState('');

	const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const value = input.trim();
			if (value && !isStreaming) {
				onSend(value);
				setInput('');
			}
		}
	}, [input, isStreaming, onSend]);

	const handleSendClick = useCallback(() => {
		const value = input.trim();
		if (value && !isStreaming) {
			onSend(value);
			setInput('');
		}
	}, [input, isStreaming, onSend]);

	return (
		<div className="karmind-input-panel">
			<div className="karmind-input-area">
				<textarea
					className="karmind-input"
					placeholder={t(language, 'inputPlaceholder')}
					rows={3}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isStreaming}
				/>
			</div>
			<div className="karmind-input-actions-row">
				<div className="karmind-permission-row">
					<span>{t(language, 'permission')}</span>
					<select
						className="karmind-permission-select"
						value={activePermission}
						onChange={(e) => onChangePermission(e.target.value as PermissionLevel)}
						disabled={isStreaming}
						title={t(language, 'sessionPermissionTitle')}
					>
						<option value="basic">{t(language, 'permissionBasic')}</option>
						<option value="enhanced">{t(language, 'permissionEnhanced')}</option>
					</select>
				</div>
				<div className="karmind-input-buttons">
					<button
						className="karmind-send-btn"
						onClick={handleSendClick}
						disabled={isStreaming || !input.trim()}
					>{t(language, 'send')}</button>
					{isStreaming && (
						<button className="karmind-stop-btn" onClick={onStop}>{t(language, 'stop')}</button>
					)}
				</div>
			</div>
		</div>
	);
}
