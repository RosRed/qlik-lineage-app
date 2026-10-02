import React, { useState } from 'react';
import { Outlet, useParams, useOutletContext, Link, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Database, GitBranch, Network, MessageSquare, FileCode,
  Zap, Brain, HardDrive, Loader2, ArrowLeft, Boxes, Clock, FolderGit2, Copy, GitPullRequestArrow
} from 'lucide-react';
import toast from 'react-hot-toast';
import { appsApi } from '../api/appsApi';
import { useAppsList } from '../context/AppsContext';
import { useAppWorkspace } from '../hooks/useAppWorkspace';
import { PageHeader, SubTabs, Badge, EmptyState, Button, Spinner } from '../components/ui/primitives';
import SubTabLink from '../components/ui/SubTabLink';
import GitSyncModal from '../components/GitSyncModal.jsx';

/*
 * Écran d'une application : /apps/:id/*
 *
 * L'id de l'URL est la source de vérité. Les données de travail (script,
 * analyse) sont chargées ici une seule fois et distribuées aux pages filles
 * par le contexte d'Outlet, ce qui évite de les recharger à chaque onglet.
 */

const TABS = [
  { to: '.', end: true, icon: LayoutGrid, label: "Vue d'ensemble" },
  { to: 'sources', icon: Database, label: 'Sources' },
  { to: 'lineage', icon: GitBranch, label: 'Lineage' },
  { to: 'model', icon: Network, label: 'Modèle' },
  { to: 'script', icon: FileCode, label: 'Script' },
  { to: 'chat', icon: MessageSquare, label: 'SQL / Qlik' }
];

/** Choix du mode + lancement de l'analyse, accessible depuis tous les onglets. */
function AnalyzeControls({ analyzeMode, setAnalyzeMode, analyzing, onAnalyze, hasScript }) {
  const isLocal = analyzeMode === 'local';

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg overflow-hidden border border-line" role="group" aria-label="Mode d'analyse">
        <button
          onClick={() => setAnalyzeMode('local')}
          aria-pressed={isLocal}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
            isLocal ? 'bg-warn-soft text-warn' : 'bg-surface text-ink-faint hover:text-ink'
          }`}
          title="Analyse par parser local — instantanée et gratuite"
        >
          <Zap size={12} /> Local
        </button>
        <button
          onClick={() => setAnalyzeMode('claude')}
          aria-pressed={!isLocal}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-l border-line transition-colors ${
            !isLocal ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-faint hover:text-ink'
          }`}
          title="Analyse sémantique par Claude — nécessite une clé API"
        >
          <Brain size={12} /> Claude
        </button>
      </div>

      <Button
        variant="primary"
        onClick={() => onAnalyze(analyzeMode)}
        disabled={analyzing || !hasScript}
        title={!hasScript ? "Aucun script à analyser — ouvrez l'onglet Script" : undefined}
      >
        {analyzing
          ? <><Loader2 size={15} className="animate-spin" /> Analyse…</>
          : <>{isLocal ? <Zap size={15} /> : <Brain size={15} />} Analyser</>}
      </Button>
    </div>
  );
}

export default function AppDetailLayout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { apps, loading: loadingApps } = useAppsList();
  const workspace = useAppWorkspace(id);
  const [exporting, setExporting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const { script, analysis, analyzing, analyzeMode, setAnalyzeMode, saveAndAnalyze } = workspace;

  const app = apps.find(a => String(a.id) === String(id));

  if (loadingApps && !app) return <Spinner label="Chargement de l'application…" />;

  if (!app) {
    return (
      <EmptyState
        icon={Boxes}
        title="Application introuvable"
        description="Elle a peut-être été supprimée, ou le lien est obsolète."
        action={<Link to="/apps"><Button icon={ArrowLeft}>Retour à la liste</Button></Link>}
      />
    );
  }

  const mode = analysis?.metadata?.mode;
  const subtitle = analysis
    ? `${analysis.facts?.length || 0} faits · ${analysis.dims?.length || 0} dimensions · ${analysis.lineage?.length || 0} lignes de lineage`
    : 'Pas encore analysée';

  return (
    <>
      <PageHeader
        title={app.name}
        subtitle={subtitle}
        actions={
          <>
            {analysis && (
              <Badge tone={analysis._cached ? 'info' : mode === 'local' ? 'warn' : 'accent'}>
                {analysis._cached
                  ? <><HardDrive size={11} /> Cache</>
                  : mode === 'local'
                    ? <><Zap size={11} /> Local</>
                    : <><Brain size={11} /> Claude</>}
              </Badge>
            )}
            {app.qlik_app_id && (
              <Button variant="ghost" icon={Copy} disabled={duplicating}
                title="Créer une copie complète de l'app côté Qlik (données et objets inclus)"
                onClick={async () => {
                  const nom = window.prompt('Nom de la copie :', `${app.name} (copie)`);
                  if (!nom) return;
                  setDuplicating(true);
                  try {
                    const r = await appsApi.duplicate(app.id, nom);
                    toast.success(`Copie créée : ${r.name}`);
                    navigate(`/apps/${r.appId}`);
                  } catch (e) {
                    toast.error(e.error || e.message || 'Échec de la duplication');
                  } finally {
                    setDuplicating(false);
                  }
                }}>
                {duplicating ? 'Copie…' : 'Dupliquer'}
              </Button>
            )}
            {app.qlik_app_id && (
              <Button variant="ghost" icon={GitPullRequestArrow}
                title="Comparer le dossier d'export avec l'app, puis réappliquer les modifications"
                onClick={() => setShowSync(true)}>
                Appliquer
              </Button>
            )}
            {app.qlik_app_id && (
              <Button variant="ghost" icon={FolderGit2} disabled={exporting}
                title="Écrire l'app (script par sections, mesures, feuilles, variables) au format Gitoqlok"
                onClick={async () => {
                  setExporting(true);
                  try {
                    const r = await appsApi.exportGitoqlok(app.id);
                    // Le chemin est la premiere question qu'on se pose apres
                    // un export : on l'affiche plutot que de le faire chercher.
                    toast.success(
                      `${r.tabs} sections · ${r.counts.measures} mesures · ` +
                      `${r.counts.sheets} feuilles · ${r.counts.variables} variables
${r.outDir}`,
                      { duration: 10000, style: { maxWidth: '560px', wordBreak: 'break-all' } }
                    );
                  } catch (e) {
                    toast.error(e.error || e.message || "Échec de l'export");
                  } finally {
                    setExporting(false);
                  }
                }}>
                {exporting ? 'Export…' : 'Export Git'}
              </Button>
            )}
            {/* Lien Apps → Tâches : jump vers /tasks préfiltré sur l'app courante */}
            <Link to={`/tasks?app=${encodeURIComponent(app.name)}`}
                  title="Voir les tâches de reload de cette app">
              <Button variant="ghost" icon={Clock}>Tâches</Button>
            </Link>
            <AnalyzeControls
              analyzeMode={analyzeMode}
              setAnalyzeMode={setAnalyzeMode}
              analyzing={analyzing}
              onAnalyze={saveAndAnalyze}
              hasScript={!!script.trim()}
            />
          </>
        }
      >
        <SubTabs>
          {TABS.map(tab => <SubTabLink key={tab.label} {...tab} />)}
        </SubTabs>
      </PageHeader>

      <Outlet context={{ app, ...workspace }} />

      {showSync && (
        <GitSyncModal app={app} onClose={() => setShowSync(false)} />
      )}
    </>
  );
}

/** Accès aux données de l'app courante depuis une page fille. */
export function useAppContext() {
  return useOutletContext();
}
