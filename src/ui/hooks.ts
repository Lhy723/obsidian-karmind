import {useContext} from 'react';
import {PluginContext} from './context';

export function usePlugin() {
	const ctx = useContext(PluginContext);
	if (!ctx) throw new Error('usePlugin must be used within PluginContext.Provider');
	return ctx.plugin;
}

export function useApp() {
	const ctx = useContext(PluginContext);
	if (!ctx) throw new Error('useApp must be used within PluginContext.Provider');
	return ctx.app;
}
