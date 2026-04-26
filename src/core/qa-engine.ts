import {App, TFile, TFolder} from 'obsidian';
import {LLMClient} from '../llm/client';
import {KarMindSettings} from '../settings';
import {SYSTEM_PROMPT_QA} from '../constants';
import {t} from '../i18n';
import {type FileOperationLog} from '../types';

interface QAContextOptions {
	onFileOperation?: (operation: FileOperationLog) => void;
}

export class QAEngine {
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

	async getRelevantContext(question: string, options: QAContextOptions = {}): Promise<{role: 'system'; content: string}[]> {
		const wikiFiles = this.getWikiFiles();
		options.onFileOperation?.({
			action: 'scan',
			path: this.settings.wikiFolder,
			detail: t(this.settings.language, 'qaOperationScanWiki'),
			timestamp: Date.now(),
		});
		if (wikiFiles.length === 0) {
			return [];
		}

		const keywords = this.extractKeywords(question);
		const relevantFiles = this.rankFilesByRelevance(wikiFiles, keywords);

		const topFiles = relevantFiles.slice(0, 10);
		const contextParts: string[] = [];

		for (const file of topFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				options.onFileOperation?.({
					action: 'read',
					path: file.path,
					detail: t(this.settings.language, 'qaOperationReadContext'),
					preview: createPreview(content),
					timestamp: Date.now(),
				});
				const truncated = content.substring(0, 2000);
				contextParts.push(`## ${file.basename}\n\n${truncated}`);
			} catch {
				// skip unreadable files
			}
		}

		if (contextParts.length === 0) {
			return [];
		}

		return [{
			role: 'system',
			content: `${SYSTEM_PROMPT_QA}\n\n---\n\nWiki Context:\n\n${contextParts.join('\n\n---\n\n')}`,
		}];
	}

	async ask(question: string): Promise<string> {
		const contextMessages = await this.getRelevantContext(question);

		const messages = [
			...contextMessages,
			{role: 'user' as const, content: question},
		];

		return await this.llmClient.chat(messages);
	}

	private getWikiFiles(): TFile[] {
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiFolder);
		if (!wikiFolder || !(wikiFolder instanceof TFolder)) {
			return [];
		}

		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.startsWith(this.settings.wikiFolder + '/') && f.basename !== '_index' && f.basename !== 'log' && !f.path.includes('/.karmind/'));
	}

	private extractKeywords(question: string): string[] {
		const stopWords = new Set([
			'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
			'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
			'should', 'may', 'might', 'can', 'shall', 'what', 'who', 'how', 'when',
			'where', 'why', 'which', 'that', 'this', 'these', 'those', 'i', 'me',
			'my', 'we', 'our', 'you', 'your', 'it', 'its', 'of', 'in', 'to', 'for',
			'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into', 'through',
			'during', 'before', 'after', 'above', 'below', 'between', 'and', 'or',
			'but', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
			'的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
			'这', '中', '大', '为', '上', '个', '国', '他', '她', '它', '们', '吗',
			'什么', '怎么', '如何', '为什么', '哪', '那', '被', '把', '让', '给',
		]);

		return question
			.toLowerCase()
			.split(/[\s,.;:!?()[\]{}"'\\]+/u)
			.filter(word => word.length > 1 && !stopWords.has(word));
	}

	private rankFilesByRelevance(files: TFile[], keywords: string[]): TFile[] {
		const scored = files.map(file => {
			let score = 0;

			const cache = this.app.metadataCache.getFileCache(file);

			const fileName = file.basename.toLowerCase();
			for (const keyword of keywords) {
				if (fileName.includes(keyword)) score += 3;
			}

			if (cache?.tags) {
				for (const tag of cache.tags) {
					const tagText = tag.tag.toLowerCase().replace('#', '');
					for (const keyword of keywords) {
						if (tagText.includes(keyword)) score += 2;
					}
				}
			}

			if (cache?.headings) {
				for (const heading of cache.headings) {
					const headingText = heading.heading.toLowerCase();
					for (const keyword of keywords) {
						if (headingText.includes(keyword)) score += 2;
					}
				}
			}

			if (cache?.links) {
				for (const link of cache.links) {
					const linkText = link.link.toLowerCase();
					for (const keyword of keywords) {
						if (linkText.includes(keyword)) score += 1;
					}
				}
			}

			return {file, score};
		});

		scored.sort((a, b) => b.score - a.score);
		return scored.map(s => s.file);
	}
}

function createPreview(content: string): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	return normalized.length > 420 ? normalized.substring(0, 420) + '...' : normalized;
}
