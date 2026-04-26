import {App, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {SYSTEM_PROMPT_HEALTH_CHECK} from '../constants';
import {type FileOperationLog, HealthCheckIssue, HealthCheckReport} from '../types';
import {ensureFolder} from '../utils/ensure-folder';
import {t} from '../i18n';
import {WikiStateStore} from './wiki-state';

interface WikiGraphStats {
	nodes: number;
	edges: number;
	brokenLinks: number;
	orphanedPages: number;
	rawFiles: number;
}

interface LinkScanResult {
	issues: HealthCheckIssue[];
	stats: WikiGraphStats;
}

export interface HealthCheckProgress {
	phase: 'scanning' | 'reading' | 'quick-scan' | 'deep-scan' | 'saving' | 'complete';
	completed: number;
	total: number;
	message: string;
}

interface HealthCheckOptions {
	onProgress?: (progress: HealthCheckProgress) => void;
	onFileOperation?: (operation: FileOperationLog) => void;
}

export class HealthChecker {
	private app: App;
	private llmClient: LLMClient;
	private settings: KarMindSettings;
	private wikiState: WikiStateStore;

	constructor(app: App, llmClient: LLMClient, settings: KarMindSettings) {
		this.app = app;
		this.llmClient = llmClient;
		this.settings = settings;
		this.wikiState = new WikiStateStore(app, settings.wikiFolder);
	}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
		this.wikiState.updateWikiFolder(settings.wikiFolder);
	}

	async check(options: HealthCheckOptions = {}): Promise<HealthCheckReport> {
		const {onProgress} = options;
		onProgress?.({
			phase: 'scanning',
			completed: 0,
			total: 5,
			message: t(this.settings.language, 'healthProgressScanning'),
		});
		const wikiFiles = this.getWikiFiles();
		options.onFileOperation?.({
			action: 'scan',
			path: this.settings.wikiFolder,
			detail: t(this.settings.language, 'healthOperationScanWiki'),
			timestamp: Date.now(),
		});

		if (wikiFiles.length === 0) {
			onProgress?.({
				phase: 'complete',
				completed: 5,
				total: 5,
				message: t(this.settings.language, 'healthProgressComplete'),
			});
			return {
				timestamp: Date.now(),
				totalPages: 0,
				issues: [],
				summary: t(this.settings.language, 'healthNoWikiPages'),
			};
		}

		onProgress?.({
			phase: 'reading',
			completed: 1,
			total: 5,
			message: t(this.settings.language, 'healthProgressReading'),
		});
		const wikiContent = await this.readWikiContent(wikiFiles, options.onFileOperation);

		onProgress?.({
			phase: 'quick-scan',
			completed: 2,
			total: 5,
			message: t(this.settings.language, 'healthProgressQuickScan'),
		});
		const {issues: quickIssues, stats} = await this.quickScan(wikiFiles, options.onFileOperation);

		onProgress?.({
			phase: 'deep-scan',
			completed: 3,
			total: 5,
			message: t(this.settings.language, 'healthProgressDeepScan'),
		});
		const llmAnalysis = await this.llmDeepScan(wikiContent);

		const allIssues = [...quickIssues, ...llmAnalysis];

		const report: HealthCheckReport = {
			timestamp: Date.now(),
			totalPages: wikiFiles.length,
			issues: allIssues,
			summary: this.formatReport(wikiFiles.length, allIssues, stats),
		};

		onProgress?.({
			phase: 'saving',
			completed: 4,
			total: 5,
			message: t(this.settings.language, 'healthProgressSaving'),
		});
		const reportPath = await this.saveReport(report);
		options.onFileOperation?.({
			action: 'create',
			path: reportPath,
			detail: t(this.settings.language, 'healthOperationSaveReport'),
			preview: createPreview(report.summary),
			timestamp: Date.now(),
		});
		const wikiLogAction = await this.wikiState.appendLog({
			type: 'health',
			title: 'Health check',
			summary: report.summary.split('\n').find(Boolean) ?? 'Health check complete',
			touchedPages: [reportPath],
			issueCount: report.issues.length,
		});
		options.onFileOperation?.({
			action: wikiLogAction,
			path: `${this.settings.wikiFolder}/log.md`,
			detail: t(this.settings.language, 'compilerOperationWriteLog'),
			timestamp: Date.now(),
		});

		onProgress?.({
			phase: 'complete',
			completed: 5,
			total: 5,
			message: t(this.settings.language, 'healthProgressComplete'),
		});

		return report;
	}

	private getWikiFiles(): TFile[] {
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiFolder);
		if (!wikiFolder || !(wikiFolder instanceof TFolder)) {
			return [];
		}

		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && f.basename !== '_index' && f.basename !== 'log' && !f.path.includes('/.karmind/'));
	}

	private async readWikiContent(files: TFile[], onFileOperation?: (operation: FileOperationLog) => void): Promise<string> {
		const parts: string[] = [];

		for (const file of files.slice(0, 20)) {
			try {
				const content = await this.app.vault.cachedRead(file);
				onFileOperation?.({
					action: 'read',
					path: file.path,
					detail: t(this.settings.language, 'healthOperationReadWiki'),
					preview: createPreview(content),
					timestamp: Date.now(),
				});
				parts.push(`## ${file.basename}\n\n${content.substring(0, 1500)}`);
			} catch {
				// skip
			}
		}

		return parts.join('\n\n---\n\n');
	}

	private async quickScan(files: TFile[], onFileOperation?: (operation: FileOperationLog) => void): Promise<LinkScanResult> {
		const issues: HealthCheckIssue[] = [];
		const allBasenames = new Set(files.map(f => f.basename));
		const incomingCounts = new Map(files.map(file => [file.basename, 0]));
		const edges = new Set<string>();
		let brokenLinks = 0;

		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			onFileOperation?.({
				action: 'read',
				path: file.path,
				detail: t(this.settings.language, 'healthOperationReadForLinks'),
				timestamp: Date.now(),
			});
			const links = extractWikiLinks(content);

			if (links.length === 0) {
				issues.push({
					type: 'connectivity',
					severity: 'medium',
					description: t(this.settings.language, 'healthNoOutgoingLinksDesc'),
					location: file.path,
					recommendation: t(this.settings.language, 'healthNoOutgoingLinksRec'),
				});
			}

			for (const link of links) {
				const target = normalizeWikiLinkTarget(link);
				if (!target) continue;

				if (allBasenames.has(target)) {
					incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
					if (target !== file.basename) {
						edges.add(`${file.basename}->${target}`);
					}
				} else {
					brokenLinks++;
					issues.push({
						type: 'completeness',
						severity: 'medium',
						description: t(this.settings.language, 'healthBrokenLinkDesc', {link}),
						location: file.path,
						recommendation: t(this.settings.language, 'healthBrokenLinkRec'),
					});
				}
			}
		}

		let orphanedPages = 0;
		for (const file of files) {
			if ((incomingCounts.get(file.basename) ?? 0) > 0) continue;
			orphanedPages++;
			issues.push({
				type: 'connectivity',
				severity: 'low',
				description: t(this.settings.language, 'healthOrphanDesc'),
				location: file.path,
				recommendation: t(this.settings.language, 'healthOrphanRec', {page: file.basename}),
			});
		}

		return {
			issues,
			stats: {
				nodes: files.length,
				edges: edges.size,
				brokenLinks,
				orphanedPages,
				rawFiles: this.getRawFiles().length,
			},
		};
	}

	private async llmDeepScan(wikiContent: string): Promise<HealthCheckIssue[]> {
		try {
			const response = await this.llmClient.chat([
				{role: 'system', content: SYSTEM_PROMPT_HEALTH_CHECK},
				{role: 'user', content: t(this.settings.language, 'healthLlmInstruction', {content: wikiContent})},
			]);

			return this.parseLLMIssues(response);
		} catch {
			return [];
		}
	}

	private parseLLMIssues(response: string): HealthCheckIssue[] {
		const issues: HealthCheckIssue[] = [];

		const lines = response.split('\n');
		let currentIssue: Partial<HealthCheckIssue> | null = null;

		for (const line of lines) {
			const typeMatch = line.match(/\*\*Type\*\*:\s*(.+)/i);
			const severityMatch = line.match(/\*\*Severity\*\*:\s*(.+)/i);
			const descMatch = line.match(/\*\*Description\*\*:\s*(.+)/i);
			const locMatch = line.match(/\*\*Location\*\*:\s*(.+)/i);
			const recMatch = line.match(/\*\*Recommendation\*\*:\s*(.+)/i);

			if (typeMatch && typeMatch[1]) {
				if (currentIssue && currentIssue.type) {
					issues.push(currentIssue as HealthCheckIssue);
				}
				currentIssue = {type: typeMatch[1].trim().toLowerCase() as HealthCheckIssue['type']};
			}
			if (severityMatch && severityMatch[1] && currentIssue) {
				currentIssue.severity = severityMatch[1].trim().toLowerCase() as HealthCheckIssue['severity'];
			}
			if (descMatch && descMatch[1] && currentIssue) {
				currentIssue.description = descMatch[1].trim();
			}
			if (locMatch && locMatch[1] && currentIssue) {
				currentIssue.location = locMatch[1].trim();
			}
			if (recMatch && recMatch[1] && currentIssue) {
				currentIssue.recommendation = recMatch[1].trim();
			}
		}

		if (currentIssue && currentIssue.type) {
			issues.push(currentIssue as HealthCheckIssue);
		}

		return issues;
	}

	private getRawFiles(): TFile[] {
		const rawFolder = this.app.vault.getAbstractFileByPath(this.settings.rawFolder);
		if (!rawFolder || !(rawFolder instanceof TFolder)) {
			return [];
		}

		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.rawFolder + '/'));
	}

	private formatReport(totalPages: number, issues: HealthCheckIssue[], stats: WikiGraphStats): string {
		const highCount = issues.filter(i => i.severity === 'high').length;
		const mediumCount = issues.filter(i => i.severity === 'medium').length;
		const lowCount = issues.filter(i => i.severity === 'low').length;

		let summary = `${t(this.settings.language, 'healthReportTitle')}\n\n`;
		summary += `${t(this.settings.language, 'healthTotalWikiPages', {count: totalPages})}\n`;
		summary += `${t(this.settings.language, 'healthRawFiles', {count: stats.rawFiles})}\n`;
		summary += `${t(this.settings.language, 'healthKnowledgeGraph', {nodes: stats.nodes, edges: stats.edges})}\n`;
		summary += `${t(this.settings.language, 'healthBrokenLinks', {count: stats.brokenLinks})}\n`;
		summary += `${t(this.settings.language, 'healthOrphanedPages', {count: stats.orphanedPages})}\n`;
		summary += `${t(this.settings.language, 'healthIssuesFound', {count: issues.length})}\n`;
		summary += `  [HIGH] ${highCount}\n`;
		summary += `  [MEDIUM] ${mediumCount}\n`;
		summary += `  [LOW] ${lowCount}\n\n`;

		if (issues.length > 0) {
			summary += `## ${t(this.settings.language, 'healthIssuesHeading')}\n\n`;
			for (const issue of issues.slice(0, 15)) {
				const tag = issue.severity === 'high' ? '[HIGH]' : issue.severity === 'medium' ? '[MEDIUM]' : '[LOW]';
				summary += `${tag} **[${issue.type}]** ${issue.description}\n   ${t(this.settings.language, 'healthIssueLocation', {location: issue.location ?? ''})}\n   ${t(this.settings.language, 'healthIssueRecommendation', {recommendation: issue.recommendation ?? ''})}\n\n`;
			}

			if (issues.length > 15) {
				summary += `${t(this.settings.language, 'healthMoreIssues', {count: issues.length - 15})}\n`;
			}
		} else {
			summary += t(this.settings.language, 'healthNoIssues');
		}

		return summary;
	}

	private async saveReport(report: HealthCheckReport): Promise<string> {
		await ensureFolder(this.app, this.settings.wikiFolder);
		const timestamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-');
		const filePath = `${this.settings.wikiFolder}/_health-${timestamp}.md`;

		const frontmatter = `---\nkarmind:\n  type: health-report\n  timestamp: ${report.timestamp}\n---\n\n`;

		await this.app.vault.create(filePath, frontmatter + report.summary);
		return filePath;
	}
}

function createPreview(content: string): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	return normalized.length > 420 ? normalized.substring(0, 420) + '...' : normalized;
}

function extractWikiLinks(content: string): string[] {
	const links: string[] = [];
	const linkRegex = /!?\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;

	while ((match = linkRegex.exec(content)) !== null) {
		if (match[1]) {
			links.push(match[1]);
		}
	}

	return links;
}

function normalizeWikiLinkTarget(link: string): string {
	const withoutAlias = link.split('|')[0] ?? '';
	const withoutHeading = withoutAlias.split('#')[0] ?? '';
	const pathParts = withoutHeading.trim().replace(/\\/g, '/').split('/');
	const fileName = pathParts[pathParts.length - 1] ?? '';
	return fileName.replace(/\.md$/i, '').trim();
}
