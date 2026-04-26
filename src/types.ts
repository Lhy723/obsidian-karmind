export type PermissionLevel = 'basic' | 'enhanced';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'error' | 'suggestion';
	content: string;
	timestamp?: number;
	suggestion?: WorkflowSuggestion;
	taskProgress?: TaskProgress;
}

export interface WorkflowSuggestion {
	command: string;
	label: string;
	description: string;
	requiresConfirmation: boolean;
}

export interface TaskProgress {
	kind: 'compile' | 'health' | 'backfill' | 'qa';
	title: string;
	status: 'running' | 'success' | 'error' | 'stopped';
	message: string;
	completed?: number;
	total?: number;
	currentPath?: string;
	targetPath?: string;
	error?: string;
	startedAt?: number;
	updatedAt?: number;
	fileOperations?: FileOperationLog[];
	healthReport?: TaskHealthReport;
}

export interface FileOperationLog {
	action: 'scan' | 'read' | 'create' | 'update' | 'delete';
	path: string;
	detail?: string;
	preview?: string;
	timestamp: number;
}

export interface TaskHealthReport {
	timestamp: number;
	totalPages: number;
	issues: HealthCheckIssue[];
}

export interface ChatSession {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
	permission: PermissionLevel;
}

export interface CompilationResult {
	filePath: string;
	summary: string;
	concepts: string[];
	links: string[];
}

export interface HealthCheckIssue {
	type: 'consistency' | 'completeness' | 'connectivity' | 'redundancy' | 'depth';
	severity: 'high' | 'medium' | 'low';
	description: string;
	location: string;
	recommendation: string;
}

export interface HealthCheckReport {
	timestamp: number;
	totalPages: number;
	issues: HealthCheckIssue[];
	summary: string;
}

export interface WikiPageIndex {
	concepts: Record<string, string[]>;
	lastCompiled: number;
	totalPages: number;
}

export interface RawFileMeta {
	path: string;
	collectedAt: number;
	compiled: boolean;
	compiledPath?: string;
}

export const BASIC_COMMANDS = new Set(['/qa', '/help', '/skills', '/new', '/clear']);
export const ENHANCED_COMMANDS = new Set(['/compile', '/backfill', '/health', '/skill']);

export function requiresEnhancedPermission(command: string): boolean {
	return ENHANCED_COMMANDS.has(command);
}

export function isCommandAllowed(command: string, permission: PermissionLevel): boolean {
	if (BASIC_COMMANDS.has(command)) return true;
	if (permission === 'enhanced' && ENHANCED_COMMANDS.has(command)) return true;
	if (!BASIC_COMMANDS.has(command) && !ENHANCED_COMMANDS.has(command)) return true;
	return false;
}

export function getPermissionLabel(permission: PermissionLevel): string {
	return permission === 'basic' ? 'Basic Q&A' : 'Enhanced Notes';
}
