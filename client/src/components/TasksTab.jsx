import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, CalendarClock, Ban, AlertOctagon, Timer,
  Link2Off, CopyX, CheckCircle2, Search, ChevronDown, ChevronRight
} from 'lucide-react';
import { qlikApi } from '../api/qlikApi';

const PROBLEM_META = {
  desactivee:              { label: 'Désactivée',            cls: 'bg-gray-800 text-gray-400' },
  jamais_executee:         { label: 'Jamais exécutée',       cls: 'bg-red-900/40 text-red-400' },
  en_echec:                { label: 'En échec',              cls: 'bg-red-900/40 text-red-400' },
  sans_declencheur:        { label: 'Sans déclencheur',      cls: 'bg-yellow-900/30 text-yellow-400' },
  declencheurs_desactives: { label: 'Déclencheurs off',      cls: 'bg-yellow-900/30 text-yellow-400' },
  inactive_30j:            { label: 'Inactive +30j',         cls: 'bg-orange-900/30 text-orange-400' },
  chaine_morte:            { label: 'Chaîne morte',          cls: 'bg-red-900/40 text-red-300' },
};

const STATUS_CLS = {
  success: 'text-emerald-400', fail: 'text-red-400', error: 'text-red-400',
  aborted: 'text-orange-400', never: 'text-gray-500', running: 'text-cyan-400',
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

function TriggerSummary({ triggers }) {
  if (!triggers.length) return <span className="text-yellow-500/70 text-[10px]">aucun</span>;
  return (
    <div className="space-y-0.5">
      {triggers.map((t, i) => (
        <div key={i} className={`text-[10px] ${t.enabled ? 'text-gray-400' : 'text-gray-600 line-through'}`}>
          {t.type === 'chain'
            ? <>🔗 après : {t.after?.join(', ') || t.name}</>
            : <>🕐 {t.name}</>}
        </div>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone, active, onClick }) {
  const toneCls = tone === 'warn' && value > 0 ? 'text-red-400' : tone === 'info' && value > 0 ? 'text-yellow-400' : 'text-gray-200';
  return (
    <button onClick={onClick}
      className={`bg-gray-900/60 border rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'border-emerald-500' : 'border-gray-800 hover:border-gray-700'}`}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500">
        <Icon size={11} /> {label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${toneCls}`}>{value}</div>
    </button>
  );
}

export default function TasksTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [problemFilter, setProblemFilter] = useState('');   // '' | 'any' | clé de PROBLEM_META
  const [streamFilter, setStreamFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [showDupes, setShowDupes] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    qlikApi.tasks()
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur — vérifie la connexion au serveur Qlik'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const streams = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.tasks.map(t => t.stream || '(non publiée)'))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.tasks.filter(t => {
      if (q && !`${t.name} ${t.appName}`.toLowerCase().includes(q)) return false;
      if (streamFilter && (t.stream || '(non publiée)') !== streamFilter) return false;
      if (problemFilter === 'any' && t.problems.length === 0) return false;
      if (problemFilter && problemFilter !== 'any' && !t.problems.includes(problemFilter)) return false;
      return true;
    });
  }, [data, search, problemFilter, streamFilter]);

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
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <CalendarClock size={15} className="text-emerald-400" /> Tâches & planification — {s.totalTasks} tâches
        </h3>
        <span className="text-[10px] text-gray-600">
          lineage QVD couvert sur {s.coveredByImport} tâches (apps importées)
        </span>
        <div className="flex-1" />
        <button onClick={load} className="p-1.5 text-gray-500 hover:text-gray-200" title="Rafraîchir">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats cliquables = filtres */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        <StatCard icon={CheckCircle2} label="Actives" value={s.enabled}
          active={!problemFilter} onClick={() => setProblemFilter('')} />
        <StatCard icon={Ban} label="Désactivées" value={s.disabled} tone="info"
          active={problemFilter === 'desactivee'} onClick={() => setProblemFilter('desactivee')} />
        <StatCard icon={AlertOctagon} label="En échec" value={s.failing} tone="warn"
          active={problemFilter === 'en_echec'} onClick={() => setProblemFilter('en_echec')} />
        <StatCard icon={Link2Off} label="Sans déclencheur" value={s.noTrigger} tone="info"
          active={problemFilter === 'sans_declencheur'} onClick={() => setProblemFilter('sans_declencheur')} />
        <StatCard icon={Timer} label="Inactives +30j" value={s.stale} tone="info"
          active={problemFilter === 'inactive_30j'} onClick={() => setProblemFilter('inactive_30j')} />
        <StatCard icon={AlertOctagon} label="Jamais lancées" value={s.neverRun} tone="warn"
          active={problemFilter === 'jamais_executee'} onClick={() => setProblemFilter('jamais_executee')} />
        <StatCard icon={Link2Off} label="Chaînes mortes" value={s.deadChains} tone="warn"
          active={problemFilter === 'chaine_morte'} onClick={() => setProblemFilter('chaine_morte')} />
        <StatCard icon={CopyX} label="QVD dupliqués" value={s.duplicateQvdGroups} tone="warn"
          active={showDupes && problemFilter === '__dupes'} onClick={() => { setProblemFilter('__dupes'); setShowDupes(true); }} />
      </div>

      {/* Production QVD dupliquée */}
      {(problemFilter === '__dupes') && (
        <section className="space-y-1.5">
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
          {data.duplicateQvdProduction.length === 0 && <p className="text-xs text-gray-600">Aucune 🎉</p>}
        </section>
      )}

      {/* Filtres */}
      {problemFilter !== '__dupes' && (
        <>
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
            <select value={problemFilter} onChange={e => setProblemFilter(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
              <option value="">Toutes les tâches</option>
              <option value="any">⚠ Avec problème(s)</option>
              {Object.entries(PROBLEM_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <span className="text-[10px] text-gray-600">{filtered.length} tâche(s)</span>
          </div>

          {/* Table */}
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-950">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                <th className="py-2 pr-2 w-4"></th>
                <th className="py-2 pr-3">Tâche</th>
                <th className="py-2 pr-3">Application</th>
                <th className="py-2 pr-3">Planification</th>
                <th className="py-2 pr-3">Dernière exécution</th>
                <th className="py-2 pr-3">Prochaine</th>
                <th className="py-2 pr-3">Problèmes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filtered.map(t => (
                <React.Fragment key={t.taskId}>
                  <tr className={`hover:bg-gray-900/40 cursor-pointer ${!t.enabled ? 'opacity-50' : ''}`}
                    onClick={() => setExpanded(expanded === t.taskId ? null : t.taskId)}>
                    <td className="py-2 pr-1 text-gray-600">
                      {expanded === t.taskId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="py-2 pr-3 text-gray-200 max-w-[220px] truncate" title={t.name}>{t.name}</td>
                    <td className="py-2 pr-3 max-w-[160px]">
                      <div className="text-gray-300 truncate" title={t.appName}>{t.appName}</div>
                      <div className="text-[9px] text-gray-600">{t.stream || '(non publiée)'}</div>
                    </td>
                    <td className="py-2 pr-3"><TriggerSummary triggers={t.triggers} /></td>
                    <td className="py-2 pr-3">
                      <span className={STATUS_CLS[t.lastStatus] || 'text-gray-400'}>{t.lastStatusLabel}</span>
                      <div className="text-[9px] text-gray-600">{fmtDate(t.lastStart)} {t.durationMs ? `· ${fmtDuration(t.durationMs)}` : ''}</div>
                    </td>
                    <td className="py-2 pr-3 text-gray-500 text-[10px]">{fmtDate(t.nextExecution)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {t.problems.map(p => (
                          <span key={p} className={`text-[9px] px-1.5 py-0.5 rounded ${PROBLEM_META[p]?.cls || 'bg-gray-800 text-gray-400'}`}>
                            {PROBLEM_META[p]?.label || p}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {expanded === t.taskId && (
                    <tr className="bg-gray-900/30">
                      <td></td>
                      <td colSpan={6} className="py-2.5 pr-3">
                        {t.imported ? (
                          <div className="grid grid-cols-2 gap-4 text-[11px]">
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
                          <span className="text-[11px] text-gray-500">
                            App non importée — importe-la (bouton "Importer du serveur Qlik") pour voir sa chaîne QVD.
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
