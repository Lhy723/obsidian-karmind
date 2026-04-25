import {App, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {SYSTEM_PROMPT_HEALTH_CHECK} from '../constants';
import {HealthCheckIssue, HealthCheckReport} from '../types';
import {ensureFolder} from '../utils/ensure-folder';

export class HealthChecker {
	private app: App;
	private llmClient: LLMClient;
	private settings: KarMindSettings;

	constructor(app: App, llmClient: LLMClient, settings: KarMindSettings) {
		this.app = app;
		this.llmClient = llmClient;
		this.settings = settings;
	}

	updateSettings(settings: KarMindSettings): void {
		this.settings = settings;
	}

	async check(): Promise<HealthCheckReport> {
		const wikiFiles = this.getWikiFiles();

		if (wikiFiles.length === 0) {
			return {
				timestamp: Date.now(),
				totalPages: 0,
				issues: [],
				summary: 'No wiki pages found. Compile some raw notes first.',
			};
		}

		const wikiContent = await this.readWikiContent(wikiFiles);
		const quickIssues = this.quickScan(wikiFiles);

		const llmAnalysis = await this.llmDeepScan(wikiContent);

		const allIssues = [...quickIssues, ...llmAnalysis];

		const report: HealthCheckReport = {
			timestamp: Date.now(),
			totalPages: wikiFiles.length,
			issues: allIssues,
			summary: this.formatReport(wikiFiles.length, allIssues),
		};

		await this.saveReport(report);

		return report;
	}

	private getWikiFiles(): TFile[] {
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiFolder);
		if (!wikiFolder || !(wikiFolder instanceof TFolder)) {
			return [];
		}

		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && f.basename !== '_index');
	}

	private async readWikiContent(files: TFile[]): Promise<string> {
		const parts: string[] = [];

		for (const file of files.slice(0, 20)) {
			try {
				const content = await this.app.vault.cachedRead(file);
				parts.push(`## ${file.basename}\n\n${content.substring(0, 1500)}`);
			} catch {
				// skip
			}
		}

		return parts.join('\n\n---\n\n');
	}

	private quickScan(files: TFile[]): HealthCheckIssue[] {
		const issues: HealthCheckIssue[] = [];
		const allBasenames = new Set(files.map(f => f.basename));

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);

			if (!cache?.links || cache.links.length === 0) {
				issues.push({
					type: 'connectivity',
					severity: 'medium',
					description: `Page has no outgoing links`,
					location: file.path,
					recommendation: `Add [[wiki-links]] to connect this page with related concepts`,
				});
			}

			const hasIncoming = this.hasIncomingLinks(file);
		if (!hasIncoming) {
				issues.push({
					type: 'connectivity',
					severity: 'low',
					description: `Orphaned page (no incoming links)`,
					location: file.path,
					recommendation: `Other pages should reference this page using [[${file.basename}]]`,
				});
			}

			if (cache?.links) {
				for (const link of cache.links) {
					if (!allBasenames.has(link.link)) {
						issues.push({
							type: 'completeness',
							severity: 'medium',
							description: `Broken link: [[${link.link}]] points to non-existent page`,
							location: file.path,
							recommendation: `Create the missing page or fix the link`,
						});
					}
				}
			}
		}

		return issues;
	}

	private async llmDeepScan(wikiContent: string): Promise<HealthCheckIssue[]> {
		try {
			const response = await this.llmClient.chat([
				{role: 'system', content: SYSTEM_PROMPT_HEALTH_CHECK},
				{role: 'user', content: `Analyze the following wiki content for issues:\n\n${wikiContent}\n\nProvide a structured list of issues found, including type, severity, location, and recommendation.`},
			]);

			return this.parseLLMIssues(response);
		} catch {
			return [];
		}
	}

	private hasIncomingLinks(file: TFile): boolean {
		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		for (const [, targets] of Object.entries(resolvedLinks)) {
			if (targets[file.path] !== undefined) {
				return true;
			}
		}
		return false;
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

	private formatReport(totalPages: number, issues: HealthCheckIssue[]): string {
		const highCount = issues.filter(i => i.severity === 'high').length;
		const mediumCount = issues.filter(i => i.severity === 'medium').length;
		const lowCount = issues.filter(i => i.severity === 'low').length;

		let summary = `Health check report\n\n`;
		summary += `Total wiki pages: ${totalPages}\n`;
		summary += `Issues found: ${issues.length}\n`;
		summary += `  [HIGH] ${highCount}\n`;
		summary += `  [MEDIUM] ${mediumCount}\n`;
		summary += `  [LOW] ${lowCount}\n\n`;

		if (issues.length > 0) {
			summary += `## Issues\n\n`;
			for (const issue of issues.slice(0, 15)) {
				const tag = issue.severity === 'high' ? '[HIGH]' : issue.severity === 'medium' ? '[MEDIUM]' : '[LOW]';
				summary += `${tag} **[${issue.type}]** ${issue.description}\n   Location: ${issue.location}\n   Recommendation: ${issue.recommendation}\n\n`;
			}

			if (issues.length > 15) {
				summary += `... and ${issues.length - 15} more issues.\n`;
			}
		} else {
			summary += `No issues found. Your wiki is healthy.`;
		}

		return summary;
	}

	private async saveReport(report: HealthCheckReport): Promise<void> {
		await ensureFolder(this.app, this.settings.wikiFolder);
		const timestamp = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-');
		const filePath = `${this.settings.wikiFolder}/_health-${timestamp}.md`;

		const frontmatter = `---\nkarmind:\n  type: health-report\n  timestamp: ${report.timestamp}\n---\n\n`;

		await this.app.vault.create(filePath, frontmatter + report.summary);
	}
}
