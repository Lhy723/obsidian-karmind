import {useState, useCallback, type KeyboardEvent} from 'react';
import {PermissionLevel} from '../types';
import {type KarMindLanguage, t} from '../i18n';

export interface CommandSuggestionItem {
	name: string;
	description: string;
	insertText: string;
}

interface InputAreaProps {
	onSend: (input: string) => void;
	onStop: () => void;
	isStreaming: boolean;
	activePermission: PermissionLevel;
	onChangePermission: (permission: PermissionLevel) => void;
	commandSuggestions: CommandSuggestionItem[];
	language: KarMindLanguage;
}

export function InputArea({onSend, onStop, isStreaming, activePermission, onChangePermission, commandSuggestions, language}: InputAreaProps) {
	const [input, setInput] = useState('');
	const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
	const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);

	const commandQuery = getCommandQuery(input);
	const filteredCommands = commandQuery === null || commandMenuDismissed
		? []
		: commandSuggestions.filter(command => command.name.toLowerCase().startsWith(`/${commandQuery}`.toLowerCase()));
	const showCommandMenu = filteredCommands.length > 0 && !isStreaming;

	const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (showCommandMenu) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedCommandIndex(index => Math.min(index + 1, filteredCommands.length - 1));
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedCommandIndex(index => Math.max(index - 1, 0));
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				const selected = filteredCommands[selectedCommandIndex] ?? filteredCommands[0];
				if (selected) {
					setInput(selected.insertText);
					setCommandMenuDismissed(true);
				}
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				setCommandMenuDismissed(true);
				return;
			}
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const value = input.trim();
			if (value && !isStreaming) {
				onSend(value);
				setInput('');
			}
		}
	}, [filteredCommands, input, isStreaming, onSend, selectedCommandIndex, showCommandMenu]);

	const handleInputChange = useCallback((value: string) => {
		setInput(value);
		setSelectedCommandIndex(0);
		setCommandMenuDismissed(false);
	}, []);

	const completeCommand = useCallback((command: CommandSuggestionItem) => {
		setInput(command.insertText);
		setSelectedCommandIndex(0);
		setCommandMenuDismissed(true);
	}, []);

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
				{showCommandMenu && (
					<div className="karmind-command-menu" role="listbox" aria-label={t(language, 'commandSuggestionsLabel')}>
						{filteredCommands.map((command, index) => (
							<div
								key={command.name}
								className={`karmind-command-menu-item ${index === selectedCommandIndex ? 'is-selected' : ''}`}
								onMouseDown={(e) => {
									e.preventDefault();
									completeCommand(command);
								}}
								role="option"
								aria-selected={index === selectedCommandIndex}
							>
								<code>{command.name}</code>
								<span>{command.description}</span>
							</div>
						))}
					</div>
				)}
				<textarea
					className="karmind-input"
					placeholder={t(language, 'inputPlaceholder')}
					rows={3}
					value={input}
					onChange={(e) => handleInputChange(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isStreaming}
					aria-autocomplete="list"
					aria-expanded={showCommandMenu}
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

function getCommandQuery(input: string): string | null {
	const match = input.match(/^\/([^\s/]*)$/);
	return match ? match[1] ?? '' : null;
}
