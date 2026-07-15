import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, CalendarClock, Search, ChevronDown, ChevronRight,
  Download, ListTree, ClipboardList, Clock
} from 'lucide-react';
import { qlikApi } from '../api/qlikApi';

const PROBLEM_META = {
  app_supprimee:           { label: 'App supprimée',         cls: 'bg-red-900/40 text-red-300' },
  desactivee:              { label: 'Désactivée',            cls: 'bg-gray-800 text-gray-400' },
  jamais_executee:         { label: 'Jamais exécutée',       cls: 'bg-red-900/40 text-red-400' },
  en_echec:                { label: 'En échec',              cls: 'bg-red-900/40 text-red-400' },
  sans_declencheur:        { label: 'Sans déclencheur',      cls: 'bg-yellow-900/30 text-yellow-400' },
  declencheurs_desactives: { label: 'Déclencheurs off',      cls: 'bg-yellow-900/30 text-yellow-400' },
  inactive_30j:            { label: 'Inactive +30j',         cls: 'bg-orange-900/30 text-orange-400' },
  chaine_morte:            { label: 'Chaîne morte',          cls: 'bg-red-900/40 text-red-300' },
  chaine_cassee:           { label: 'Chaîne cassée',         cls: 'bg-orange-900/30 text-orange-300' },
  orpheline_de_chaine:     { label: 'Amont supprimé',        cls: 'bg-red-900/40 text-red-300' },
  cycle:                   { label: 'Cycle',                 cls: 'bg-red-900/40 text-red-300' },
  ordre_incorrect:         { label: 'Ordre incorrect',       cls: 'bg-violet-900/30 text-violet-300' },
  source_figee:            { label: 'Source figée',          cls: 'bg-violet-900/30 text-violet-300' },
};

const RECO_META = {
  supprimer: { label: 'Supprimer', cls: 'bg-red-900/50 text-red-300 border border-red-800/50' },
  verifier:  { label: 'Vérifier',  cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-800/50' },
  conserver: { label: 'Conserver', cls: 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/50' },
};

const STATUS_CLS = {
  success: 'text-emerald-400', fail: 'text-red-400', error: 'text-red-400',
  aborted: 'text-orange-400', never: 'text-gray-500', running: 'text-cyan-400',
};

const TRIGGER_META = {
  manual:   { label: '✋ Manuelle',   cls: 'bg-gray-800 text-gray-400 border border-gray-700' },
  schedule: { label: '🕐 Planifiée', cls: 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/40' },
  chain:    { label: '🔗 Chaînée',   cls: 'bg-cyan-900/30 text-cyan-300 border border-cyan-800/40' },
  mixte:    { label: '🕐+🔗 Mixte',  cls: 'bg-violet-900/30 text-violet-300 border border-violet-800/40' },
};

const STATUS_ICON = {
  success: '✓', fail: '✗', error: '✗', aborted: '✗', never: '·', running: '▶',
};

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.toLocaleDateString('fr-FR')} ${dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min${s % 60 ? ` ${s % 60}s` : ''}`;
}

// ─── Vue Chaînes : arbre indenté ──────────────────────────────────────────────

function ChainNode({ node, depth, parentBroken }) {
  const broken = node.broken || parentBroken;
  const statusIcon = STATUS_ICON[node.lastStatus] || '·';
  const statusCls = !node.enabled ? 'text-gray-600' : (STATUS_CLS[node.lastStatus] || 'text-gray-400');
  return (
    <>
      <div className={`flex items-center gap-2 py-1 text-xs ${broken ? 'text-orange-300' : 'text-gray-300'}`}
        style={{ paddingLeft: depth * 22 }}>
        {depth > 0 && <span className="text-gray-700">└─</span>}
        <span className={`font-mono w-3 text-center ${statusCls}`}>{node.enabled ? statusIcon : '–'}</span>
        <span className={`truncate max-w-[320px] ${!node.enabled ? 'line-through text-gray-600' : ''}`} title={node.name}>
          {node.name}
        </span>
        {node.cycle && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">cycle ↩</span>}
        {node.broken && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-300">cassée</span>}
        <span className="text-[10px] text-gray-600 truncate max-w-[180px]" title={node.appName}>{node.appName}</span>
        {node.durationMs ? <span className="text-[10px] text-gray-600 flex items-center gap-0.5"><Clock size={9} />{fmtDuration(node.durationMs)}</span> : null}
      </div>
      {(node.children || []).map(c => (
        <ChainNode key={c.taskId + String(depth)} node={c} depth={depth + 1} parentBroken={broken} />
      ))}
    </>
  );
}

const CHAIN_HEALTH = {
  ok:        { label: 'Saine',     cls: 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/50' },
  partielle: { label: 'Partielle', cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-800/50' },
  cassee:    { label: 'Cassée',    cls: 'bg-red-900/50 text-red-300 border border-red-800/50' },
  inactive:  { label: 'Inactive',  cls: 'bg-gray-800 text-gray-400 border border-gray-700' },
};

function ChainsView({ chains }) {
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const counts = useMemo(() => {
    const c = { total: chains.length, ok: 0, partielle: 0, cassee: 0, inactive: 0 };
    for (const ch of chains) c[ch.health] = (c[ch.health] || 0) + 1;
    return c;
  }, [chains]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return chains.filter(c => {
      if (healthFilter && c.health !== healthFilter) return false;
      if (!q) return true;
      const matches = (node) => node.name.toLowerCase().includes(q) || (node.children || []).some(matches);
      return matches(c.tree);
    });
  }, [chains, search, healthFilter]);

  if (!chains.length) {
    return <p className="text-xs text-gray-600 py-6 text-center">Aucune chaîne détectée — aucune tâche planifiée ou chaînée.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Synthèse : état des enchaînements en un coup d'œil */}
      <div className="grid grid-cols-4 gap-2 max-w-xl">
        {['ok', 'partielle', 'cassee', 'inactive'].map(h => (
          <button key={h} onClick={() => setHealthFilter(healthFilter === h ? '' : h)}
            className={`rounded-lg px-3 py-2 text-left border transition-colors ${
              healthFilter === h ? 'border-emerald-500 bg-gray-900' : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'}`}>
            <div className="text-[9px] uppercase tracking-wider text-gray-500">{CHAIN_HEALTH[h].label}s</div>
            <div className={`text-xl font-bold ${
              h === 'cassee' ? 'text-red-400' : h === 'partielle' ? 'text-yellow-400' : h === 'inactive' ? 'text-gray-500' : 'text-emerald-400'}`}>
              {counts[h] || 0}
            </div>
          </button>
        ))}
      </div>

      <div className="relative max-w-xs">
        <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher dans les chaînes..."
          className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
      </div>

      {filtered.map(c => {
        const isCollapsed = collapsed[c.rootTaskId];
        return (
          <div key={c.rootTaskId} className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
            {/* En-tête de chaîne : état, planification, durée, prochaine exécution */}
            <button
              onClick={() => setCollapsed(x => ({ ...x, [c.rootTaskId]: !x[c.rootTaskId] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-900/70">
              {isCollapsed ? <ChevronRight size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
              <span className={`text-[9px] px-2 py-0.5 rounded ${CHAIN_HEALTH[c.health]?.cls}`}>
                {CHAIN_HEALTH[c.health]?.label}
              </span>
              <span className="text-xs text-gray-200 font-semibold truncate max-w-[260px]" title={c.rootName}>{c.rootName}</span>
              <span className="text-[10px] text-gray-600">
                {c.taskCount} tâche{c.taskCount !== 1 ? 's' : ''}
                {c.totalDurationMs ? ` · ~${fmtDuration(c.totalDurationMs)}` : ''}
              </span>
              <div className="flex-1" />
              <span className="text-[10px] text-gray-500 flex items-center gap-1.5">
                <CalendarClock size={11} className={c.scheduleEnabled ? 'text-emerald-400' : 'text-gray-600'} />
                {c.schedule ? c.schedule : '✋ manuel'}
                {c.rootNextExecution && <span className="text-gray-600">· prochaine : {fmtDate(c.rootNextExecution)}</span>}
              </span>
            </button>
            {/* Diagnostic court si problème */}
            {!isCollapsed && c.health !== 'ok' && (
              <div className="px-3 pb-1 text-[10px] text-gray-500">
                {c.health === 'inactive' && 'La racine est désactivée ou sa planification est off — toute la chaîne est à l\'arrêt.'}
                {c.health === 'cassee' && `${c.brokenCount + c.failingCount} maillon(s) en échec ou cassé(s) — l'aval ne tournera pas.`}
                {c.health === 'partielle' && `${c.disabledCount} maillon(s) désactivé(s) dans la chaîne.`}
              </div>
            )}
            {!isCollapsed && (
              <div className="px-3 pb-2">
                <ChainNode node={c.tree} depth={0} parentBroken={false} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Vue Nettoyage : tableau trié par score ───────────────────────────────────

function CleanupView({ data }) {
  const [search, setSearch] = useState('');
  const [recoFilter, setRecoFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [expanded, setExpanded] = useState(null);

  const streams = useMemo(
    () => [...new Set(data.tasks.map(t => t.stream || '(non publiée)'))].sort(),
    [data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.tasks.filter(t => {
      if (q && !`${t.name} ${t.appName}`.toLowerCase().includes(q)) return false;
      if (recoFilter && t.recommendation !== recoFilter) return false;
      if (streamFilter && (t.stream || '(non publiée)') !== streamFilter) return false;
      if (triggerFilter && (t.triggerType || 'manual') !== triggerFilter) return false;
      return true;
    });
  }, [data, search, recoFilter, streamFilter, triggerFilter]);

  const s = data.stats;

  return (
    <div className="space-y-3">
      {/* Synthèse nettoyage */}
      <div className="grid grid-cols-3 gap-2 max-w-md">
        {['supprimer', 'verifier', 'conserver'].map(r => (
          <button key={r} onClick={() => setRecoFilter(recoFilter === r ? '' : r)}
            className={`rounded-lg px-3 py-2 text-left border transition-colors ${
              recoFilter === r ? 'border-emerald-500 bg-gray-900' : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'}`}>
            <div className="text-[9px] uppercase tracking-wider text-gray-500">{RECO_META[r].label}</div>
            <div className={`text-xl font-bold ${r === 'supprimer' ? 'text-red-400' : r === 'verifier' ? 'text-yellow-400' : 'text-emerald-400'}`}>
              {r === 'supprimer' ? s.toDelete : r === 'verifier' ? s.toReview : s.toKeep}
            </div>
          </button>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une tâche ou une app..."
            className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
        </div>
        <select value={streamFilter} onChange={e => setStreamFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
          <option value="">Tous les streams</option>
          {streams.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
          <option value="">Tout déclenchement</option>
          <option value="manual">✋ Manuelles ({data.stats.byTriggerType?.manual ?? '—'})</option>
          <option value="schedule">🕐 Planifiées ({data.stats.byTriggerType?.schedule ?? '—'})</option>
          <option value="chain">🔗 Chaînées ({data.stats.byTriggerType?.chain ?? '—'})</option>
          <option value="mixte">🕐+🔗 Mixtes ({data.stats.byTriggerType?.mixte ?? '—'})</option>
        </select>
        <span className="text-[10px] text-gray-600">{filtered.length} tâche(s)</span>
        <div className="flex-1" />
        <a href={qlikApi.tasksExportUrl()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded">
          <Download size={12} /> Export CSV
        </a>
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-950">
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="py-2 pr-2 w-4"></th>
            <th className="py-2 pr-3">Score</th>
            <th className="py-2 pr-3">Recommandation</th>
            <th className="py-2 pr-3">Tâche</th>
            <th className="py-2 pr-3">Application</th>
            <th className="py-2 pr-3">Déclenchement</th>
            <th className="py-2 pr-3">Problèmes</th>
            <th className="py-2 pr-3">Dernier run</th>
            <th className="py-2 pr-3">Durée</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {filtered.map(t => (
            <React.Fragment key={t.taskId}>
              <tr className={`hover:bg-gray-900/40 cursor-pointer ${!t.enabled ? 'opacity-60' : ''}`}
                onClick={() => setExpanded(expanded === t.taskId ? null : t.taskId)}>
                <td className="py-2 pr-1 text-gray-600">
                  {expanded === t.taskId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </td>
                <td className="py-2 pr-3">
                  <span className={`font-mono font-bold ${t.cleanupScore >= 70 ? 'text-red-400' : t.cleanupScore >= 30 ? 'text-yellow-400' : 'text-gray-500'}`}>
                    {t.cleanupScore}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${RECO_META[t.recommendation]?.cls}`}>
                    {RECO_META[t.recommendation]?.label}
                  </span>
                </td>
                <td className="py-2 pr-3 text-gray-200 max-w-[220px] truncate" title={t.name}>{t.name}</td>
                <td className="py-2 pr-3 max-w-[160px]">
                  <div className="text-gray-300 truncate" title={t.appName}>{t.appName}</div>
                  <div className="text-[9px] text-gray-600">{t.stream || '(non publiée)'}</div>
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${TRIGGER_META[t.triggerType || 'manual']?.cls}`}
                    title={t.triggers?.map(tr => tr.name).join(', ') || 'Aucun déclencheur — lancement manuel uniquement'}>
                    {TRIGGER_META[t.triggerType || 'manual']?.label}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {t.problems.map(p => (
                      <span key={p} className={`text-[9px] px-1.5 py-0.5 rounded ${PROBLEM_META[p]?.cls || 'bg-gray-800 text-gray-400'}`}>
                        {PROBLEM_META[p]?.label || p}
                      </span>
                    ))}
                    {!t.problems.length && <span className="text-[9px] text-gray-700">—</span>}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className={STATUS_CLS[t.lastStatus] || 'text-gray-400'}>{t.lastStatusLabel}</span>
                  <div className="text-[9px] text-gray-600">{fmtDate(t.lastStart)}</div>
                </td>
                <td className="py-2 pr-3 text-gray-500 text-[10px]">{fmtDuration(t.durationMs) || '—'}</td>
              </tr>
              {expanded === t.taskId && (
                <tr className="bg-gray-900/30">
                  <td></td>
                  <td colSpan={8} className="py-2.5 pr-3 space-y-2 text-[11px]">
                    {t.brokenBy?.length > 0 && (
                      <div className="text-orange-300">
                        Chaîne cassée par : {t.brokenBy.join(', ')}
                      </div>
                    )}
                    {t.orderIssues?.length > 0 && (
                      <div className="text-violet-300">
                        Ordre incorrect — cette tâche n'est pas planifiée après le producteur :
                        {t.orderIssues.map(o => (
                          <div key={o.qvd} className="ml-3 font-mono text-[10px]">
                            {o.qvd} <span className="text-gray-500">← produit par {o.producers.join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {t.staleQvds?.length > 0 && (
                      <div className="text-violet-300">
                        Sources figées (producteur sans tâche active) : <span className="font-mono text-[10px]">{t.staleQvds.join(', ')}</span>
                      </div>
                    )}
                    {t.imported ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-gray-500 uppercase text-[9px] tracking-wider mb-1">QVD générés par son app ({t.producedQvds.length})</div>
                          {t.producedQvds.length
                            ? <div className="font-mono text-violet-300 space-y-0.5">{t.producedQvds.map(q => <div key={q}>{q}</div>)}</div>
                            : <span className="text-gray-600">aucun</span>}
                        </div>
                        <div>
                          <div className="text-gray-500 uppercase text-[9px] tracking-wider mb-1">QVD consommés ({t.consumedQvds.length})</div>
                          {t.consumedQvds.length
                            ? <div className="font-mono text-emerald-300/80 space-y-0.5">{t.consumedQvds.map(q => <div key={q}>{q}</div>)}</div>
                            : <span className="text-gray-600">aucun</span>}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-500">
                        App non importée — importez-la (bouton « Importer du serveur Qlik ») pour croiser sa chaîne QVD.
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {/* Production QVD dupliquée */}
      {data.duplicateQvdProduction.length > 0 && (
        <section className="space-y-1.5 pt-2">
          <h4 className="text-xs font-semibold text-orange-400">
            QVD produits par plusieurs tâches actives ({data.duplicateQvdProduction.length}) — reloads redondants
          </h4>
          {data.duplicateQvdProduction.map(g => (
            <div key={g.qvd} className="text-xs bg-orange-900/10 border border-orange-900/30 rounded px-3 py-2">
              <span className="font-mono text-orange-300">{g.qvd}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.tasks.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded" title={t.appName}>
                    {t.taskName}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function TasksTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('cleanup'); // 'cleanup' | 'chains'

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    qlikApi.tasks()
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur — vérifiez la connexion au serveur Qlik'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600">
        <Loader2 className="animate-spin mr-2" size={16} />
        <span className="text-xs">Récupération des tâches depuis le serveur Qlik...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</div>
        <button onClick={load} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded">
          <RefreshCw size={12} /> Réessayer
        </button>
      </div>
    );
  }

  const s = data.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <CalendarClock size={15} className="text-emerald-400" /> Tâches — {s.totalTasks} au total
        </h3>
        <span className="text-[10px] text-gray-600">
          {s.enabled} actives · lineage QVD couvert sur {s.coveredByImport} tâches
        </span>
        <div className="flex-1" />
        {/* Bascule de vue */}
        <div className="flex rounded overflow-hidden border border-gray-800">
          <button onClick={() => setView('cleanup')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${view === 'cleanup' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
            <ClipboardList size={12} /> Nettoyage
          </button>
          <button onClick={() => setView('chains')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${view === 'chains' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
            <ListTree size={12} /> Chaînes ({(data.chains || []).length})
          </button>
        </div>
        <button onClick={load} className="p-1.5 text-gray-500 hover:text-gray-200" title="Rafraîchir">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {view === 'cleanup'
        ? <CleanupView data={data} />
        : <ChainsView chains={data.chains || []} />}
    </div>
  );
}
