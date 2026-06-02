import { useState, useCallback } from 'react';
import { appsApi } from '../api/appsApi';
import toast from 'react-hot-toast';

export function useApps() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await appsApi.getAll();
      setApps(data);
      return data;
    } catch {
      toast.error('Erreur lors du chargement des apps');
    } finally {
      setLoading(false);
    }
  }, []);

  const createApp = useCallback(async (name) => {
    try {
      const app = await appsApi.create(name);
      if (app.error) { toast.error(app.error); return null; }
      setApps(prev => [app, ...prev]);
      toast.success(`Application "${name}" créée`);
      return app;
    } catch {
      toast.error('Erreur lors de la création');
      return null;
    }
  }, []);

  const renameApp = useCallback(async (id, name, selectedAppId) => {
    try {
      const updated = await appsApi.rename(id, name);
      if (updated.error) { toast.error(updated.error); return null; }
      setApps(prev => prev.map(a => a.id === id ? updated : a));
      toast.success('Application renommée');
      return updated;
    } catch {
      toast.error('Erreur lors du renommage');
      return null;
    }
  }, []);

  const removeApp = useCallback(async (id) => {
    try {
      await appsApi.remove(id);
      setApps(prev => prev.filter(a => a.id !== id));
      toast.success('Application supprimée');
      return true;
    } catch {
      toast.error('Erreur lors de la suppression');
      return false;
    }
  }, []);

  return { apps, loading, loadApps, createApp, renameApp, removeApp };
}
