import {useState, useCallback, type KeyboardEvent} from 'react';

interface InputAreaProps {
	onSend: (input: string) => void;
	onStop: () => void;
	isStreaming: boolean;
}

export function InputArea({onSend, onStop, isStreaming}: InputAreaProps) {
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
		<div className="karmind-input-area">
			<div className="karmind-input-shell">
				<textarea
					className="karmind-input"
					placeholder="Ask, paste an insight, or type /help..."
					rows={3}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isStreaming}
				/>
				<div className="karmind-input-hint">Enter to send · Shift Enter for newline</div>
			</div>
			<div className="karmind-input-buttons">
				{isStreaming && (
					<button className="karmind-stop-btn" onClick={onStop}>Stop</button>
				)}
				<button
					className="karmind-send-btn"
					onClick={handleSendClick}
					disabled={isStreaming || !input.trim()}
				>Send</button>
			</div>
		</div>
	);
}
