// Composes useApps + useAppData — interface publique inchangée pour App.jsx
import { useCallback } from 'react';
import { useApps } from './useApps';
import { useAppData } from './useAppData';

export function useApp() {
  const {
    apps, loading: loadingApps,
    loadApps, createApp, renameApp: renameInList, removeApp
  } = useApps();

  const {
    selectedApp, setSelectedApp, script, setScript,
    analysis, analyzing, analyzeMode, setAnalyzeMode,
    selectApp, clearApp, saveAndAnalyze
  } = useAppData();

  // renameApp syncs both the list and the selectedApp if it's the one being renamed
  const renameApp = useCallback(async (id, name) => {
    const updated = await renameInList(id, name);
    if (updated && selectedApp?.id === id) setSelectedApp(updated);
  }, [renameInList, selectedApp, setSelectedApp]);

  // deleteApp clears selected state if the deleted app was selected
  const deleteApp = useCallback(async (id) => {
    const ok = await removeApp(id);
    if (ok && selectedApp?.id === id) clearApp();
  }, [removeApp, selectedApp, clearApp]);

  return {
    apps, selectedApp, script, analysis, analyzing, loadingApps,
    analyzeMode, setAnalyzeMode,
    setScript, loadApps, selectApp, createApp, renameApp, deleteApp, saveAndAnalyze
  };
}
