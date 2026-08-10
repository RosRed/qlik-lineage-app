import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import {
  Server, RefreshCw, Settings, BarChart3, ListChecks, AlertOctagon, Clock, FileText, Camera
} from 'lucide-react';
import { ssisApi, cacheInvalidate } from '../api/qlikApi';
import { PageHeader, SubTabs, Button, Spinner, ErrorNote } from '../components/ui/primitives';
import SubTabLink from '../components/ui/SubTabLink';

/*
 * Monitoring & maintenance ETL SSIS. Vague 1 : config + connexion.
 * Les vues Dashboard/Executions/Erreurs/Tables/Jobs sont des scaffolds — elles
 * s'activent dès que la connexion à SSISDB est valide (data.configured).
 */

export default function SsisLayout() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ssisApi.health()
      .then(setHealth)
      .catch(e => setError(e.error || e.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        icon={Server}
        title="Monitoring SSIS"
        subtitle={health?.configured
          ? `Serveur : ${health.host}`
          : 'Aucune connexion — allez dans Réglages SSIS pour configurer'}
        actions={
          <Button variant="ghost"
            onClick={() => { cacheInvalidate('/api/ssis'); load(); }}
            title="Rafraîchir (vide le cache SSIS)" aria-label="Rafraîchir">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </Button>
        }
      >
        <SubTabs>
          <SubTabLink to="." end icon={BarChart3} label="Dashboard" />
          <SubTabLink to="executions" icon={ListChecks} label="Exécutions" />
          <SubTabLink to="errors" icon={AlertOctagon} label="Erreurs" />
          <SubTabLink to="snapshots" icon={Camera} label="Snapshots" />
          <SubTabLink to="update-log" icon={FileText} label="Rechargements" />
          <SubTabLink to="jobs" icon={Clock} label="Jobs Agent" />
          <SubTabLink to="settings" icon={Settings} label="Réglages" />
        </SubTabs>
      </PageHeader>

      {error && <div className="px-5 pt-4"><ErrorNote>{error}</ErrorNote></div>}

      {loading && !health
        ? <Spinner label="Chargement…" />
        : <Outlet context={{ health, reload: load }} />}
    </>
  );
}

export function useSsisContext() {
  return useOutletContext();
}
