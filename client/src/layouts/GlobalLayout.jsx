import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import {
  Globe, RefreshCw, Download, Server, BarChart3, Database,
  AlertTriangle, Boxes, Network, Copy, CalendarClock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { globalApi } from '../api/qlikApi';
import { useAppsList } from '../context/AppsContext';
import QlikImportModal from '../components/QlikImportModal.jsx';
import { PageHeader, SubTabs, Button, Spinner, ErrorNote } from '../components/ui/primitives';
import SubTabLink from '../components/ui/SubTabLink';
import { downloadAuthed } from '../lib/downloadAuthed';

/*
 * Lineage inter-applications : /global/*
 *
 * L'ancien GlobalTab.jsx faisait 576 lignes et jouait au routeur avec un
 * `useState('synthese')`, en imbriquant sept sous-vues — dont Tâches et
 * Gouvernance, qui sont maintenant des sections de premier niveau.
 * Ici on ne garde que le chargement des données et la navigation ; chaque vue
 * est une page à part entière.
 */

export default function GlobalLayout() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const { loadApps } = useAppsList();

  // load(force) : au montage on utilise le cache (SWR : renvoie l'ancien pendant
  // le refresh en fond) ; le bouton "Rafraîchir" passe `force=true` pour
  // court-circuiter le cache et re-fetcher.
  const load = useCallback((force = false) => {
    if (!force) setLoading(true);
    setError(null);
    globalApi.getLineage(force)
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const problemCount = data
    ? data.orphans.length + data.multiProduced.length + data.duplicateExtractions.length
    : undefined;

  return (
    <>
      <PageHeader
        icon={Globe}
        title="Lineage global"
        subtitle="Flux de données entre toutes les applications"
        actions={
          <>
            <Button variant="primary" icon={Server} onClick={() => setShowImport(true)}>
              Importer du serveur Qlik
            </Button>
            <Button icon={Download}
              onClick={() => downloadAuthed(globalApi.exportUrl(), { filename: 'lineage-global.csv' })
                .catch(e => toast.error(e.error || e.message || 'Échec du téléchargement'))}>
              CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => load(true)}
              title="Rafraîchir (force)"
              aria-label="Rafraîchir les données"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </Button>
          </>
        }
      >
        <SubTabs>
          <SubTabLink to="." end icon={BarChart3} label="Synthèse" />
          <SubTabLink to="producteurs" icon={CalendarClock} label="Producteurs" />
          <SubTabLink to="qvds" icon={Database} label="QVD" count={data?.qvds.length} />
          <SubTabLink to="apps" icon={Boxes} label="Apps" count={data?.apps.length} />
          <SubTabLink to="problemes" icon={AlertTriangle} label="Problèmes" count={problemCount} />
          <SubTabLink to="doublons" icon={Copy} label="Doublons" />
          <SubTabLink to="graphe" icon={Network} label="Graphe" />
        </SubTabs>
      </PageHeader>

      {error && <div className="px-5 pt-4"><ErrorNote>{error}</ErrorNote></div>}

      {loading && !data
        ? <Spinner label="Construction du lineage global…" />
        : data
          ? <Outlet context={{ data, reload: load, loading }} />
          : null}

      {showImport && (
        <QlikImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { load(); loadApps(); }}
        />
      )}
    </>
  );
}

/** Accès aux données du lineage global depuis une page fille. */
export function useGlobalContext() {
  return useOutletContext();
}
