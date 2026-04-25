import {createContext} from 'react';
import type {App} from 'obsidian';
import type KarMindPlugin from '../main';

export interface PluginContextValue {
	app: App;
	plugin: KarMindPlugin;
}

export const PluginContext = createContext<PluginContextValue | null>(null);
