import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, ShieldCheck, Search, Boxes, Plug, UserX, Database, ClipboardList, AlertTriangle,
  Copy, Download, X, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';
import { qlikApi } from '../api/qlikApi';
import { downloadAuthed } from '../lib/downloadAuthed';

const APP_FLAG_META = {
  jamais_rechargee:    { label: 'Jamais rechargée',    cls: 'bg-danger-soft text-danger' },
  rechargement_ancien: { label: 'Reload ancien',       cls: 'bg-warn-soft text-warn' },
  non_publiee_ancienne:{ label: 'Brouillon abandonné', cls: 'bg-warn-soft text-warn' },
  sans_tache:          { label: 'Sans tâche',          cls: 'bg-warn-soft text-warn' },
  volumineuse:         { label: 'Volumineuse',         cls: 'bg-violet-soft text-violet' },
  doublon_nom:         { label: 'Doublon de nom',      cls: 'bg-warn-soft text-warn' },
  proprietaire_parti:  { label: 'Propriétaire parti',  cls: 'bg-danger-soft text-danger' },
  copie_probable:      { label: 'Copie probable',      cls: 'bg-info-soft text-info' },
};

const CONN_FLAG_META = {
  inutilisee:         { label: 'Inutilisée',          cls: 'bg-warn-soft text-warn' },
  doublon:            { label: 'Doublon',             cls: 'bg-warn-soft text-warn' },
  personnelle:        { label: 'Personnelle',         cls: 'bg-violet-soft text-violet' },
  proprietaire_parti: { label: 'Propriétaire parti',  cls: 'bg-danger-soft text-danger' },
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

function Counter({ icon: Icon, label, value, warn, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`bg-surface border rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'border-accent' : 'border-line hover:border-line'}`}>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-ink-muted">
        <Icon size={11} /> {label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${warn && value > 0 ? 'text-danger' : 'text-ink'}`}>
        {value ?? '—'}
      </div>
    </button>
  );
}

function FlagBadges({ flags, meta }) {
  if (!flags?.length) return <span className="text-[9px] text-ink-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(f => (
        <span key={f} className={`text-[9px] px-1.5 py-0.5 rounded ${meta[f]?.cls || 'bg-raised text-ink-muted'}`}>
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
  const [onlyCopies, setOnlyCopies] = useState(false);
  const [publication, setPublication] = useState('all');   // all | published | draft
  const [streamFilter, setStreamFilter] = useState('all'); // all | '__none__' | streamName
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');     // all | lt1 | 1to10 | 10to100 | 100to500 | gt500 | unknown
  const [ageFilter, setAgeFilter] = useState('all');       // all | gt24 | gt12 | gt6 | gt3 | lt3 | never
  const [activeFlags, setActiveFlags] = useState([]);      // click-to-filter drapeaux

  const toggleFlag = (f) => setActiveFlags(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  const resetFilters = () => {
    setSearch(''); setOnlyFlagged(true); setOnlyCopies(false);
    setPublication('all'); setStreamFilter('all'); setOwnerFilter('all');
    setSizeFilter('all'); setAgeFilter('all'); setActiveFlags([]);
  };

  const { streams, owners, flagCounts } = useMemo(() => {
    const s = new Map(), o = new Map(), fc = new Map();
    for (const a of audit.apps) {
      const sk = a.stream || '__none__';
      s.set(sk, (s.get(sk) || 0) + 1);
      if (a.owner) o.set(a.owner, (o.get(a.owner) || 0) + 1);
      for (const f of a.flags || []) fc.set(f, (fc.get(f) || 0) + 1);
    }
    return {
      streams: [...s.entries()].sort((a, b) => b[1] - a[1]),
      owners:  [...o.entries()].sort((a, b) => b[1] - a[1]),
      flagCounts: fc
    };
  }, [audit]);

  const ageMs = (label) => ({ gt24: 730, gt12: 365, gt6: 183, gt3: 91 }[label] * 86400000);
  const now = Date.now();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audit.apps.filter(a => {
      if (onlyCopies && !a.probableParent) return false;
      if (onlyFlagged && a.flags.length === 0) return false;
      if (publication === 'published' && !a.published) return false;
      if (publication === 'draft' && a.published) return false;
      if (streamFilter !== 'all') {
        if (streamFilter === '__none__' && a.stream) return false;
        if (streamFilter !== '__none__' && a.stream !== streamFilter) return false;
      }
      if (ownerFilter !== 'all' && a.owner !== ownerFilter) return false;
      if (sizeFilter !== 'all') {
        const mb = a.fileSizeMb;
        if (sizeFilter === 'unknown' && mb != null) return false;
        if (sizeFilter === 'lt1' && !(mb != null && mb < 1)) return false;
        if (sizeFilter === '1to10' && !(mb != null && mb >= 1 && mb < 10)) return false;
        if (sizeFilter === '10to100' && !(mb != null && mb >= 10 && mb < 100)) return false;
        if (sizeFilter === '100to500' && !(mb != null && mb >= 100 && mb < 500)) return false;
        if (sizeFilter === 'gt500' && !(mb != null && mb >= 500)) return false;
      }
      if (ageFilter !== 'all') {
        const ts = a.lastReload ? Date.parse(a.lastReload) : null;
        if (ageFilter === 'never' && ts) return false;
        if (['gt24', 'gt12', 'gt6', 'gt3'].includes(ageFilter)) {
          if (!ts || (now - ts) < ageMs(ageFilter)) return false;
        }
        if (ageFilter === 'lt3' && (!ts || (now - ts) >= 91 * 86400000)) return false;
      }
      if (activeFlags.length && !activeFlags.every(f => a.flags.includes(f))) return false;
      if (q && !`${a.name} ${a.owner || ''} ${a.stream || ''} ${a.probableParent?.name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [audit, search, onlyFlagged, onlyCopies, publication, streamFilter, ownerFilter, sizeFilter, ageFilter, activeFlags]);

  const exportHref = `/api/qlik/apps/cleanup/export${onlyFlagged ? '?flaggedOnly=1' : ''}`;
  const hasActiveFilters = onlyCopies || publication !== 'all' || streamFilter !== 'all' ||
    ownerFilter !== 'all' || sizeFilter !== 'all' || ageFilter !== 'all' || activeFlags.length > 0 || search;

  const selectCls = 'bg-surface border border-line rounded px-2 py-1 text-[11px] text-ink focus:outline-none focus:border-accent';

  return (
    <div className="space-y-2">
      {/* Ligne 1 : recherche + cases + compteur + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une app..."
            className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer">
          <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} className="accent-emerald-600" />
          Avec drapeaux uniquement
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-ink-muted cursor-pointer">
          <input type="checkbox" checked={onlyCopies} onChange={e => setOnlyCopies(e.target.checked)} className="accent-blue-500" />
          Copies probables uniquement
        </label>
        <span className="text-[10px] text-ink-faint">{filtered.length} / {audit.apps.length} apps</span>
        <div className="flex-1" />
        <button type="button"
          onClick={() => downloadAuthed(exportHref, { filename: `apps-cleanup${onlyFlagged ? '-flagged' : ''}.csv` })
            .catch(e => toast.error(e.error || e.message || 'Échec du téléchargement'))}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-accent-soft hover:bg-accent-soft text-accent-ink rounded border border-accent">
          <Download size={11} /> Export CSV
        </button>
      </div>

      {/* Ligne 2 : filtres avances */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded px-2 py-1.5">
        <Filter size={11} className="text-ink-faint" />

        <select value={publication} onChange={e => setPublication(e.target.value)} className={selectCls}>
          <option value="all">Toutes publications</option>
          <option value="published">Publiées</option>
          <option value="draft">Non publiées</option>
        </select>

        <select value={streamFilter} onChange={e => setStreamFilter(e.target.value)} className={selectCls}>
          <option value="all">Tous streams</option>
          <option value="__none__">Sans stream (Work)</option>
          {streams.filter(([k]) => k !== '__none__').map(([k, n]) => (
            <option key={k} value={k}>{k} ({n})</option>
          ))}
        </select>

        <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className={selectCls}>
          <option value="all">Tous propriétaires</option>
          {owners.map(([k, n]) => (
            <option key={k} value={k}>{k} ({n})</option>
          ))}
        </select>

        <select value={sizeFilter} onChange={e => setSizeFilter(e.target.value)} className={selectCls}>
          <option value="all">Toutes tailles</option>
          <option value="unknown">Inconnue</option>
          <option value="lt1">&lt; 1 Mo</option>
          <option value="1to10">1 – 10 Mo</option>
          <option value="10to100">10 – 100 Mo</option>
          <option value="100to500">100 – 500 Mo</option>
          <option value="gt500">&gt; 500 Mo</option>
        </select>

        <select value={ageFilter} onChange={e => setAgeFilter(e.target.value)} className={selectCls}>
          <option value="all">Tous âges de reload</option>
          <option value="never">Jamais rechargée</option>
          <option value="gt24">Reload &gt; 24 mois</option>
          <option value="gt12">Reload &gt; 12 mois</option>
          <option value="gt6">Reload &gt; 6 mois</option>
          <option value="gt3">Reload &gt; 3 mois</option>
          <option value="lt3">Reload &lt; 3 mois</option>
        </select>

        {hasActiveFilters && (
          <button onClick={resetFilters}
            className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink ml-auto">
            <X size={11} /> Réinitialiser
          </button>
        )}
      </div>

      {/* Ligne 3 : drapeaux cliquables (chips) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-ink-faint mr-1">Drapeaux :</span>
        {Object.entries(APP_FLAG_META).map(([f, meta]) => {
          const n = flagCounts.get(f) || 0;
          if (n === 0) return null;
          const active = activeFlags.includes(f);
          return (
            <button key={f} onClick={() => toggleFlag(f)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                active ? `${meta.cls} border-current` : 'bg-surface border-line text-ink-muted hover:text-ink'
              }`}
              title={active ? 'Retirer ce filtre' : 'Filtrer sur ce drapeau'}>
              {meta.label} <span className="opacity-70">({n})</span>
            </button>
          );
        })}
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-canvas">
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
            <th className="py-2 pr-3">Application</th>
            <th className="py-2 pr-3">Stream</th>
            <th className="py-2 pr-3">Propriétaire</th>
            <th className="py-2 pr-3 text-right">Taille</th>
            <th className="py-2 pr-3">Dernier reload</th>
            <th className="py-2 pr-3">Parent probable</th>
            <th className="py-2 pr-3">Drapeaux</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {filtered.map(a => (
            <tr key={a.qlikAppId} className="hover:bg-raised">
              <td className="py-2 pr-3 text-ink max-w-[220px] truncate" title={a.name}>
                {a.name}
                {!a.published && <span className="ml-1.5 text-[9px] text-ink-faint">(privée)</span>}
              </td>
              <td className="py-2 pr-3 text-ink-muted">{a.stream || '—'}</td>
              <td className="py-2 pr-3 text-ink-muted text-[10px] max-w-[130px] truncate" title={a.owner || ''}>{a.owner || '—'}</td>
              <td className="py-2 pr-3 text-right font-mono text-ink-muted">{a.fileSizeMb != null ? `${a.fileSizeMb} Mo` : '—'}</td>
              <td className="py-2 pr-3 text-ink-muted text-[10px]">{fmtDate(a.lastReload)}</td>
              <td className="py-2 pr-3 text-[10px] max-w-[180px] truncate"
                  title={a.probableParent ? `${a.probableParent.name} (confiance ${a.probableParent.matchConfidence})` : ''}>
                {a.probableParent
                  ? <span className="flex items-center gap-1 text-info">
                      <Copy size={10} className={a.probableParent.matchConfidence === 'high' ? 'text-info' : 'text-info'} />
                      <span className="truncate">{a.probableParent.name}</span>
                    </span>
                  : <span className="text-ink-faint">—</span>}
              </td>
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
      <p className="text-[10px] text-ink-faint">
        « Inutilisée » = non référencée par les {audit.coverage.analyzedScripts} script(s) analysés localement — importez plus d'apps pour affiner.
      </p>
      <div className="relative max-w-xs">
        <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une connexion..."
          className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
      </div>

      {audit.ghosts.length > 0 && (
        <div className="text-xs bg-danger-soft border border-danger rounded px-3 py-2 space-y-1">
          <div className="font-semibold text-danger flex items-center gap-1.5">
            <AlertTriangle size={12} /> Connexions fantômes ({audit.ghosts.length}) — référencées dans un script mais absentes du serveur : le reload échouera
          </div>
          {audit.ghosts.map(g => (
            <div key={g.name}>
              <span className="font-mono text-danger">{g.name}</span>
              <span className="text-ink-muted"> — utilisée par {g.usedByApps.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-canvas">
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
            <th className="py-2 pr-3">Connexion</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Propriétaire</th>
            <th className="py-2 pr-3 text-right">Apps</th>
            <th className="py-2 pr-3">Drapeaux</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {filtered.map(c => (
            <React.Fragment key={c.id}>
              <tr className="hover:bg-raised cursor-pointer"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <td className="py-2 pr-3 text-ink max-w-[220px] truncate" title={c.name}>{c.name}</td>
                <td className="py-2 pr-3 text-ink-muted">{c.type || '—'}</td>
                <td className="py-2 pr-3 text-ink-muted text-[10px] max-w-[130px] truncate" title={c.owner || ''}>{c.owner || '—'}</td>
                <td className="py-2 pr-3 text-right font-mono text-ink-muted">{c.usedByCount}</td>
                <td className="py-2 pr-3"><FlagBadges flags={c.flags} meta={CONN_FLAG_META} /></td>
              </tr>
              {expanded === c.id && (
                <tr className="bg-surface">
                  <td colSpan={5} className="py-2.5 px-3 space-y-1.5 text-[11px]">
                    {c.connectionString && (
                      <div className="font-mono text-[10px] text-ink-muted break-all">{c.connectionString}</div>
                    )}
                    {c.duplicateOf.length > 0 && (
                      <div className="text-warn">Même cible que : {c.duplicateOf.join(', ')}</div>
                    )}
                    <div className="text-ink-muted">
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
      <div className="flex items-center justify-center py-16 text-ink-faint">
        <Loader2 className="animate-spin mr-2" size={16} />
        <span className="text-xs">Audit de gouvernance en cours (apps, connexions, tâches)...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-xs text-danger bg-danger-soft border border-danger rounded px-3 py-2">{error}</div>
        <button onClick={() => load()} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-raised hover:bg-raised text-ink rounded">
          <RefreshCw size={12} /> Réessayer
        </button>
      </div>
    );
  }

  const c = data.counters;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <ShieldCheck size={15} className="text-accent-ink" /> Gouvernance serveur
        </h3>
        <span className="text-[10px] text-ink-faint">données QRS en cache 10 min</span>
        <div className="flex-1" />
        <button onClick={() => load(true)} className="p-1.5 text-ink-muted hover:text-ink" title="Rafraîchir (vide le cache QRS)">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Compteurs */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-2">
        <Counter icon={Boxes} label="Apps à nettoyer" value={c.appsToClean} warn
          active={section === 'apps'} onClick={() => setSection('apps')} />
        <Counter icon={Copy} label="Copies probables" value={c.probableCopies}
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
        <p className="text-[10px] text-ink-muted">
          Tâches : {data.tasks.stats.toDelete} supprimables · {data.tasks.stats.toReview} à vérifier · détail dans l'onglet « Tâches & planification ».
        </p>
      )}

      {/* Sections */}
      <div className="flex rounded overflow-hidden border border-line w-fit">
        <button onClick={() => setSection('apps')}
          className={`px-3 py-1.5 text-xs ${section === 'apps' ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-muted hover:text-ink'}`}>
          Audit apps ({data.apps?.stats?.withFlags ?? '—'})
        </button>
        <button onClick={() => setSection('connections')}
          className={`px-3 py-1.5 text-xs ${section === 'connections' ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-muted hover:text-ink'}`}>
          Connexions ({data.connections?.stats?.totalConnections ?? '—'})
        </button>
      </div>

      {section === 'apps' && (data.apps?.apps
        ? <AppsAudit audit={data.apps} />
        : <p className="text-xs text-danger">{data.apps?.error || 'Audit apps indisponible'}</p>)}
      {section === 'connections' && (data.connections?.connections
        ? <ConnectionsAudit audit={data.connections} />
        : <p className="text-xs text-danger">{data.connections?.error || 'Audit connexions indisponible'}</p>)}
    </div>
  );
}
