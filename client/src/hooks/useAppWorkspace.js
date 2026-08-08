import { useState, useCallback, useEffect } from 'react';
import { appsApi } from '../api/appsApi';
import toast from 'react-hot-toast';

/*
 * Données de travail d'une application, pilotées par l'id de l'URL.
 *
 * Remplace useAppData : son `selectApp(app)` supposait une sélection par clic
 * dans la sidebar. Avec le routeur, c'est l'URL (/apps/:id/...) qui est la
 * source de vérité, donc le chargement se déclenche sur l'id.
 */
export function useAppWorkspace(appId) {
  const [script, setScript] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState('local'); // 'local' (défaut) | 'claude'

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;

    setLoading(true);
    setScript('');
    setAnalysis(null);

    Promise.all([appsApi.getScript(appId), appsApi.getAnalysis(appId)])
      .then(([scriptData, analysisData]) => {
        // Navigation rapide d'une app à l'autre : on ignore la réponse obsolète
        if (cancelled) return;
        if (scriptData) setScript(scriptData.content || '');
        if (analysisData) setAnalysis(analysisData.result);
      })
      .catch(() => {
        if (!cancelled) toast.error('Erreur lors du chargement des données');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [appId]);

  const saveAndAnalyze = useCallback(async (mode) => {
    const effectiveMode = mode || analyzeMode;
    if (!appId) return;
    if (!script.trim()) {
      toast.error("Veuillez coller un script avant d'analyser");
      return;
    }

    try {
      await appsApi.saveScript(appId, script);
      setAnalyzing(true);

      const result = await appsApi.analyze(appId, effectiveMode);
      if (result.error) { toast.error(result.error); return; }

      const data = result.analysis || result;
      setAnalysis(data);

      const isLocal = effectiveMode === 'local' || data?.metadata?.mode === 'local';
      const fieldCount = (data.lineage || []).length;

      if (data?._cached) {
        toast.success('Script inchangé — analyse en cache réutilisée', { icon: '💾' });
      } else if (isLocal) {
        toast.success(`Analyse locale terminée — ${fieldCount} champs tracés`, { icon: '⚡' });
      } else {
        toast.success(`Analyse Claude terminée — ${fieldCount} champs tracés`, { icon: '🤖' });
      }
    } catch {
      toast.error("Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  }, [appId, script, analyzeMode]);

  return {
    script, setScript, analysis, loading, analyzing,
    analyzeMode, setAnalyzeMode, saveAndAnalyze
  };
}
