import { useState, useCallback } from 'react';
import { api } from '../api';
import toast from 'react-hot-toast';

export function useApp() {
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [script, setScript] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingApps, setLoadingApps] = useState(false);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      const data = await api.getApps();
      setApps(data);
      return data;
    } catch {
      toast.error('Erreur lors du chargement des apps');
    } finally {
      setLoadingApps(false);
    }
  }, []);

  const selectApp = useCallback(async (app) => {
    setSelectedApp(app);
    setAnalysis(null);
    setScript('');
    try {
      const [scriptData, analysisData] = await Promise.all([
        api.getScript(app.id),
        api.getAnalysis(app.id)
      ]);
      if (scriptData) setScript(scriptData.content || '');
      if (analysisData) setAnalysis(analysisData.result);
    } catch {
      toast.error('Erreur lors du chargement des données');
    }
  }, []);

  const createApp = useCallback(async (name) => {
    try {
      const app = await api.createApp(name);
      if (app.error) { toast.error(app.error); return null; }
      setApps(prev => [app, ...prev]);
      toast.success(`Application "${name}" créée`);
      return app;
    } catch {
      toast.error('Erreur lors de la création');
      return null;
    }
  }, []);

  const renameApp = useCallback(async (id, name) => {
    try {
      const updated = await api.renameApp(id, name);
      if (updated.error) { toast.error(updated.error); return; }
      setApps(prev => prev.map(a => a.id === id ? updated : a));
      if (selectedApp?.id === id) setSelectedApp(updated);
      toast.success('Application renommée');
    } catch {
      toast.error('Erreur lors du renommage');
    }
  }, [selectedApp]);

  const deleteApp = useCallback(async (id) => {
    try {
      await api.deleteApp(id);
      setApps(prev => prev.filter(a => a.id !== id));
      if (selectedApp?.id === id) {
        setSelectedApp(null);
        setScript('');
        setAnalysis(null);
      }
      toast.success('Application supprimée');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  }, [selectedApp]);

  const saveAndAnalyze = useCallback(async () => {
    if (!selectedApp) return;
    if (!script.trim()) { toast.error('Veuillez coller un script avant d\'analyser'); return; }
    try {
      await api.saveScript(selectedApp.id, script);
      setAnalyzing(true);
      const result = await api.analyze(selectedApp.id);
      if (result.error) { toast.error(result.error); return; }
      // API returns { success, analysis } or legacy direct object
      const analysisData = result.analysis || result;
      setAnalysis(analysisData);
      const lineageCount = (analysisData.lineage || []).length;
      toast.success(`Analyse terminée — ${lineageCount} champs tracés`);
    } catch {
      toast.error('Erreur lors de l\'analyse');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedApp, script]);

  return {
    apps, selectedApp, script, analysis, analyzing, loadingApps,
    setScript, loadApps, selectApp, createApp, renameApp, deleteApp, saveAndAnalyze
  };
}
