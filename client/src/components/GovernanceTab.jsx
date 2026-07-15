import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, ShieldCheck, Search, Boxes, Plug, UserX, Database, ClipboardList, AlertTriangle
} from 'lucide-react';
import { qlikApi } from '../api/qlikApi';

const APP_FLAG_META = {
  jamais_rechargee:    { label: 'Jamais rechargée',    cls: 'bg-red-900/40 text-red-400' },
  rechargement_ancien: { label: 'Reload ancien',       cls: 'bg-orange-900/30 text-orange-400' },
  non_publiee_ancienne:{ label: 'Brouillon abandonné', cls: 'bg-yellow-900/30 text-yellow-400' },
  sans_tache:          { label: 'Sans tâche',          cls: 'bg-yellow-900/30 text-yellow-400' },
  volumineuse:         { label: 'Volumineuse',         cls: 'bg-violet-900/30 text-violet-300' },
  doublon_nom:         { label: 'Doublon de nom',      cls: 'bg-orange-900/30 text-orange-400' },
  proprietaire_parti:  { label: 'Propriétaire parti',  cls: 'bg-red-900/40 text-red-300' },
};

const CONN_FLAG_META = {
  inutilisee:         { label: 'Inutilisée',          cls: 'bg-yellow-900/30 text-yellow-400' },
  doublon:            { label: 'Doublon',             cls: 'bg-orange-900/30 text-orange-400' },
  personnelle:        { label: 'Personnelle',         cls: 'bg-violet-900/30 text-violet-300' },
  proprietaire_parti: { label: 'Propriétaire parti',  cls: 'bg-red-900/40 text-red-300' },
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

function Counter({ icon: Icon, label, value, warn, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`bg-gray-900/60 border rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'border-emerald-500' : 'border-gray-800 hover:border-gray-700'}`}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500">
        <Icon size={11} /> {label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${warn && value > 0 ? 'text-red-400' : 'text-gray-200'}`}>
        {value ?? '—'}
      </div>
    </button>
  );
}

function FlagBadges({ flags, meta }) {
  if (!flags?.length) return <span className="text-[9px] text-gray-700">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(f => (
        <span key={f} className={`text-[9px] px-1.5 py-0.5 rounded ${meta[f]?.cls || 'bg-gray-800 text-gray-400'}`}>
          {meta[f]?.label || f}
        </span>
      ))}
    </div>
  );
}

// ─── Audit apps serveur ───────────────────────────────────────────────────────

function AppsAudit({ audit }) {
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audit.apps.filter(a => {
      if (onlyFlagged && a.flags.length === 0) return false;
      if (q && !`${a.name} ${a.owner || ''} ${a.stream || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [audit, search, onlyFlagged]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une app..."
            className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} className="accent-emerald-600" />
          Avec drapeaux uniquement
        </label>
        <span className="text-[10px] text-gray-600">{filtered.length} / {audit.apps.length} apps</span>
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-950">
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="py-2 pr-3">Application</th>
            <th className="py-2 pr-3">Stream</th>
            <th className="py-2 pr-3">Propriétaire</th>
            <th className="py-2 pr-3 text-right">Taille</th>
            <th className="py-2 pr-3">Dernier reload</th>
            <th className="py-2 pr-3">Drapeaux</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {filtered.map(a => (
            <tr key={a.qlikAppId} className="hover:bg-gray-900/40">
              <td className="py-2 pr-3 text-gray-200 max-w-[220px] truncate" title={a.name}>
                {a.name}
                {!a.published && <span className="ml-1.5 text-[9px] text-gray-600">(privée)</span>}
              </td>
              <td className="py-2 pr-3 text-gray-500">{a.stream || '—'}</td>
              <td className="py-2 pr-3 text-gray-500 text-[10px] max-w-[130px] truncate" title={a.owner || ''}>{a.owner || '—'}</td>
              <td className="py-2 pr-3 text-right font-mono text-gray-400">{a.fileSizeMb != null ? `${a.fileSizeMb} Mo` : '—'}</td>
              <td className="py-2 pr-3 text-gray-500 text-[10px]">{fmtDate(a.lastReload)}</td>
              <td className="py-2 pr-3"><FlagBadges flags={a.flags} meta={APP_FLAG_META} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Audit connexions ─────────────────────────────────────────────────────────

function ConnectionsAudit({ audit }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return audit.connections;
    return audit.connections.filter(c =>
      `${c.name} ${c.connectionString || ''} ${c.owner || ''}`.toLowerCase().includes(q));
  }, [audit, search]);

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-gray-600">
        « Inutilisée » = non référencée par les {audit.coverage.analyzedScripts} script(s) analysés localement — importez plus d'apps pour affiner.
      </p>
      <div className="relative max-w-xs">
        <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une connexion..."
          className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
      </div>

      {audit.ghosts.length > 0 && (
        <div className="text-xs bg-red-900/10 border border-red-900/30 rounded px-3 py-2 space-y-1">
          <div className="font-semibold text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Connexions fantômes ({audit.ghosts.length}) — référencées dans un script mais absentes du serveur : le reload échouera
          </div>
          {audit.ghosts.map(g => (
            <div key={g.name}>
              <span className="font-mono text-red-300">{g.name}</span>
              <span className="text-gray-500"> — utilisée par {g.usedByApps.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-950">
          <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
            <th className="py-2 pr-3">Connexion</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Propriétaire</th>
            <th className="py-2 pr-3 text-right">Apps</th>
            <th className="py-2 pr-3">Drapeaux</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {filtered.map(c => (
            <React.Fragment key={c.id}>
              <tr className="hover:bg-gray-900/40 cursor-pointer"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <td className="py-2 pr-3 text-gray-200 max-w-[220px] truncate" title={c.name}>{c.name}</td>
                <td className="py-2 pr-3 text-gray-500">{c.type || '—'}</td>
                <td className="py-2 pr-3 text-gray-500 text-[10px] max-w-[130px] truncate" title={c.owner || ''}>{c.owner || '—'}</td>
                <td className="py-2 pr-3 text-right font-mono text-gray-400">{c.usedByCount}</td>
                <td className="py-2 pr-3"><FlagBadges flags={c.flags} meta={CONN_FLAG_META} /></td>
              </tr>
              {expanded === c.id && (
                <tr className="bg-gray-900/30">
                  <td colSpan={5} className="py-2.5 px-3 space-y-1.5 text-[11px]">
                    {c.connectionString && (
                      <div className="font-mono text-[10px] text-gray-500 break-all">{c.connectionString}</div>
                    )}
                    {c.duplicateOf.length > 0 && (
                      <div className="text-orange-300">Même cible que : {c.duplicateOf.join(', ')}</div>
                    )}
                    <div className="text-gray-400">
                      {c.usedByApps.length
                        ? <>Utilisée par : {c.usedByApps.join(', ')}</>
                        : 'Référencée par aucun script analysé.'}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function GovernanceTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [section, setSection] = useState('apps'); // 'apps' | 'connections'

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    qlikApi.governance(refresh)
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur — vérifiez la connexion au serveur Qlik'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-600">
        <Loader2 className="animate-spin mr-2" size={16} />
        <span className="text-xs">Audit de gouvernance en cours (apps, connexions, tâches)...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</div>
        <button onClick={() => load()} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded">
          <RefreshCw size={12} /> Réessayer
        </button>
      </div>
    );
  }

  const c = data.counters;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ShieldCheck size={15} className="text-emerald-400" /> Gouvernance serveur
        </h3>
        <span className="text-[10px] text-gray-600">données QRS en cache 10 min</span>
        <div className="flex-1" />
        <button onClick={() => load(true)} className="p-1.5 text-gray-500 hover:text-gray-200" title="Rafraîchir (vide le cache QRS)">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <Counter icon={Boxes} label="Apps à nettoyer" value={c.appsToClean} warn
          active={section === 'apps'} onClick={() => setSection('apps')} />
        <Counter icon={ClipboardList} label="Tâches à supprimer" value={c.tasksToDelete} warn
          active={false} onClick={() => {}} />
        <Counter icon={Plug} label="Conn. inutilisées" value={c.unusedConnections} warn
          active={section === 'connections'} onClick={() => setSection('connections')} />
        <Counter icon={Plug} label="Conn. doublons" value={c.duplicateConnections} warn
          active={section === 'connections'} onClick={() => setSection('connections')} />
        <Counter icon={UserX} label="Sans propriétaire" value={c.ownerGoneObjects} warn
          active={false} onClick={() => setSection('apps')} />
        <Counter icon={Database} label="QVD orphelins" value={c.orphanQvds} warn
          active={false} onClick={() => {}} />
      </div>

      {data.tasks?.stats && (
        <p className="text-[10px] text-gray-500">
          Tâches : {data.tasks.stats.toDelete} supprimables · {data.tasks.stats.toReview} à vérifier · détail dans l'onglet « Tâches & planification ».
        </p>
      )}

      {/* Sections */}
      <div className="flex rounded overflow-hidden border border-gray-800 w-fit">
        <button onClick={() => setSection('apps')}
          className={`px-3 py-1.5 text-xs ${section === 'apps' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
          Audit apps ({data.apps?.stats?.withFlags ?? '—'})
        </button>
        <button onClick={() => setSection('connections')}
          className={`px-3 py-1.5 text-xs ${section === 'connections' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}>
          Connexions ({data.connections?.stats?.totalConnections ?? '—'})
        </button>
      </div>

      {section === 'apps' && (data.apps?.apps
        ? <AppsAudit audit={data.apps} />
        : <p className="text-xs text-red-400">{data.apps?.error || 'Audit apps indisponible'}</p>)}
      {section === 'connections' && (data.connections?.connections
        ? <ConnectionsAudit audit={data.connections} />
        : <p className="text-xs text-red-400">{data.connections?.error || 'Audit connexions indisponible'}</p>)}
    </div>
  );
}
