import {TFile} from 'obsidian';

export const WIKI_INTERNAL_FOLDER = '.karmind';
export const WIKI_REPORTS_FOLDER = '_reports';
export const WIKI_HEALTH_REPORTS_FOLDER = `${WIKI_REPORTS_FOLDER}/health`;

export function getHealthReportsFolder(wikiFolder: string): string {
	return `${wikiFolder}/${WIKI_HEALTH_REPORTS_FOLDER}`;
}

export function isSpecialWikiFile(file: TFile): boolean {
	return file.basename === '_index'
		|| file.basename === 'log'
		|| file.path.includes(`/${WIKI_INTERNAL_FOLDER}/`)
		|| file.path.includes(`/${WIKI_REPORTS_FOLDER}/`);
}
