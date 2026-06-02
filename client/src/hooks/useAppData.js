import { useState, useCallback } from 'react';
import { appsApi } from '../api/appsApi';
import toast from 'react-hot-toast';

export function useAppData() {
  const [selectedApp, setSelectedApp] = useState(null);
  const [script, setScript] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState('claude'); // 'local' | 'claude'

  const selectApp = useCallback(async (app) => {
    setSelectedApp(app);
    setAnalysis(null);
    setScript('');
    try {
      const [scriptData, analysisData] = await Promise.all([
        appsApi.getScript(app.id),
        appsApi.getAnalysis(app.id)
      ]);
      if (scriptData) setScript(scriptData.content || '');
      if (analysisData) setAnalysis(analysisData.result);
    } catch {
      toast.error('Erreur lors du chargement des données');
    }
  }, []);

  const clearApp = useCallback(() => {
    setSelectedApp(null);
    setScript('');
    setAnalysis(null);
  }, []);

  const saveAndAnalyze = useCallback(async (mode) => {
    const effectiveMode = mode || analyzeMode;
    if (!selectedApp) return;
    if (!script.trim()) { toast.error("Veuillez coller un script avant d'analyser"); return; }

    try {
      await appsApi.saveScript(selectedApp.id, script);
      setAnalyzing(true);

      const result = await appsApi.analyze(selectedApp.id, effectiveMode);
      if (result.error) { toast.error(result.error); return; }

      const data = result.analysis || result;
      setAnalysis(data);

      const isLocal = effectiveMode === 'local' || data?.metadata?.mode === 'local';
      const isCached = data?._cached;

      if (isCached) {
        toast.success('✅ Script inchangé — analyse en cache réutilisée', { icon: '💾' });
      } else if (isLocal) {
        toast.success(`⚡ Analyse locale terminée — ${(data.lineage || []).length} champs tracés`, { icon: '⚡' });
      } else {
        toast.success(`🤖 Analyse Claude terminée — ${(data.lineage || []).length} champs tracés`);
      }
    } catch {
      toast.error("Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  }, [selectedApp, script, analyzeMode]);

  return {
    selectedApp, setSelectedApp, script, setScript,
    analysis, analyzing, analyzeMode, setAnalyzeMode,
    selectApp, clearApp, saveAndAnalyze
  };
}
