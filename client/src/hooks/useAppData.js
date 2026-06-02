import { useState, useCallback } from 'react';
import { appsApi } from '../api/appsApi';
import toast from 'react-hot-toast';

export function useAppData() {
  const [selectedApp, setSelectedApp] = useState(null);
  const [script, setScript] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

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

  const saveAndAnalyze = useCallback(async () => {
    if (!selectedApp) return;
    if (!script.trim()) { toast.error("Veuillez coller un script avant d'analyser"); return; }
    try {
      await appsApi.saveScript(selectedApp.id, script);
      setAnalyzing(true);
      const result = await appsApi.analyze(selectedApp.id);
      if (result.error) { toast.error(result.error); return; }
      const data = result.analysis || result;
      setAnalysis(data);
      toast.success(`Analyse terminée — ${(data.lineage || []).length} champs tracés`);
    } catch {
      toast.error("Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  }, [selectedApp, script]);

  return {
    selectedApp, setSelectedApp, script, setScript,
    analysis, analyzing, selectApp, clearApp, saveAndAnalyze
  };
}
