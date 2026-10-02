import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Loader2, CalendarClock, Search, ChevronDown, ChevronRight,
  Download, ListTree, ClipboardList, Clock, ExternalLink, Database
} from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { qlikApi } from '../api/qlikApi';
import { downloadAuthed } from '../lib/downloadAuthed';

const PROBLEM_META = {
  app_supprimee:           { label: 'App supprimée',         cls: 'bg-danger-soft text-danger' },
  desactivee:              { label: 'Désactivée',            cls: 'bg-raised text-ink-muted' },
  jamais_executee:         { label: 'Jamais exécutée',       cls: 'bg-danger-soft text-danger' },
  en_echec:                { label: 'En échec',              cls: 'bg-danger-soft text-danger' },
  sans_declencheur:        { label: 'Sans déclencheur',      cls: 'bg-warn-soft text-warn' },
  declencheurs_desactives: { label: 'Déclencheurs off',      cls: 'bg-warn-soft text-warn' },
  inactive_30j:            { label: 'Inactive +30j',         cls: 'bg-warn-soft text-warn' },
  chaine_morte:            { label: 'Chaîne morte',          cls: 'bg-danger-soft text-danger' },
  chaine_cassee:           { label: 'Chaîne cassée',         cls: 'bg-warn-soft text-warn' },
  orpheline_de_chaine:     { label: 'Amont supprimé',        cls: 'bg-danger-soft text-danger' },
  cycle:                   { label: 'Cycle',                 cls: 'bg-danger-soft text-danger' },
  ordre_incorrect:         { label: 'Ordre incorrect',       cls: 'bg-violet-soft text-violet' },
  source_figee:            { label: 'Source figée',          cls: 'bg-violet-soft text-violet' },
  chaine_sans_client:      { label: 'Chaîne sans client',    cls: 'bg-danger-soft text-danger' },
};

const RECO_META = {
  supprimer: { label: 'Supprimer', cls: 'bg-danger-soft text-danger border border-danger' },
  verifier:  { label: 'Vérifier',  cls: 'bg-warn-soft text-warn border border-warn' },
  conserver: { label: 'Conserver', cls: 'bg-accent-soft text-accent-ink border border-accent' },
};

const STATUS_CLS = {
  success: 'text-accent-ink', fail: 'text-danger', error: 'text-danger',
  aborted: 'text-warn', never: 'text-ink-muted', running: 'text-info',
};

const TRIGGER_META = {
  manual:   { label: '✋ Manuelle',   cls: 'bg-raised text-ink-muted border border-line' },
  schedule: { label: '🕐 Planifiée', cls: 'bg-accent-soft text-accent-ink border border-accent' },
  chain:    { label: '🔗 Chaînée',   cls: 'bg-info-soft text-info border border-info' },
  mixte:    { label: '🕐+🔗 Mixte',  cls: 'bg-violet-soft text-violet border border-violet' },
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

/** En-tête de colonne cliquable — affiche une flèche indiquant la colonne triée. */
function SortableTh({ label, k, sortKey, sortDir, onSort }) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
  return (
    <th className="py-2 pr-3">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink ${active ? 'text-accent-ink' : 'text-ink-muted'}`}
      >
        {label}
        {arrow && <span className="text-[9px]">{arrow}</span>}
      </button>
    </th>
  );
}

// ─── Vue Chaînes : arbre indenté ──────────────────────────────────────────────

function ChainNode({ node, depth, parentBroken, feedsClientById }) {
  const broken = node.broken || parentBroken;
  const statusIcon = STATUS_ICON[node.lastStatus] || '·';
  const statusCls = !node.enabled ? 'text-ink-faint' : (STATUS_CLS[node.lastStatus] || 'text-ink-muted');
  // "sans client" = ce nœud ni aucun descendant ne feed un stream client
  const isDead = feedsClientById && feedsClientById.get(node.taskId) === false;
  return (
    <>
      <div className={`flex items-center gap-2 py-1 text-xs ${
          isDead ? 'text-danger' : broken ? 'text-warn' : 'text-ink'
        }`}
        style={{ paddingLeft: depth * 22 }}>
        {depth > 0 && <span className="text-ink-faint">└─</span>}
        <span className={`font-mono w-3 text-center ${statusCls}`}>{node.enabled ? statusIcon : '–'}</span>
        <span className={`truncate max-w-[320px] ${
            !node.enabled ? 'line-through text-ink-faint' : (isDead ? 'line-through decoration-danger' : '')
          }`} title={node.name}>
          {node.name}
        </span>
        {isDead && <span className="text-[9px] px-1.5 py-0.5 rounded bg-danger-soft text-danger shrink-0"
                     title="Cette branche ne feed aucun stream client — candidate à suppression">
                     🗑 sans client
                   </span>}
        {node.cycle && <span className="text-[9px] px-1.5 py-0.5 rounded bg-danger-soft text-danger">cycle ↩</span>}
        {node.broken && <span className="text-[9px] px-1.5 py-0.5 rounded bg-warn-soft text-warn">cassée</span>}
        <span className="text-[10px] text-ink-faint truncate max-w-[180px]" title={node.appName}>{node.appName}</span>
        {node.durationMs ? <span className="text-[10px] text-ink-faint flex items-center gap-0.5"><Clock size={9} />{fmtDuration(node.durationMs)}</span> : null}
      </div>
      {(node.children || []).map(c => (
        <ChainNode key={c.taskId + String(depth)} node={c} depth={depth + 1} parentBroken={broken} feedsClientById={feedsClientById} />
      ))}
    </>
  );
}

const CHAIN_HEALTH = {
  ok:        { label: 'Saine',     cls: 'bg-accent-soft text-accent-ink border border-accent' },
  partielle: { label: 'Partielle', cls: 'bg-warn-soft text-warn border border-warn' },
  cassee:    { label: 'Cassée',    cls: 'bg-danger-soft text-danger border border-danger' },
  inactive:  { label: 'Inactive',  cls: 'bg-raised text-ink-muted border border-line' },
};

function ChainsView({ chains, tasks, focus }) {
  const [search, setSearch] = useState(focus?.name || '');
  const [healthFilter, setHealthFilter] = useState('');
  const [collapsed, setCollapsed] = useState({});

  // Arrivée depuis la Planification : on préfiltre sur la tâche cliquée.
  // `seq` s'incrémente à chaque clic pour que deux clics d'affilée sur la même
  // tâche rejouent le filtre même si l'utilisateur a vidé la recherche entre-temps.
  useEffect(() => {
    if (focus?.name) setSearch(focus.name);
  }, [focus?.seq]);

  const feedsClientById = useMemo(() => {
    const m = new Map();
    for (const t of tasks || []) m.set(t.taskId, t.feedsClient);
    return m;
  }, [tasks]);

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
    return <p className="text-xs text-ink-faint py-6 text-center">Aucune chaîne détectée — aucune tâche planifiée ou chaînée.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Synthèse : état des enchaînements en un coup d'œil */}
      <div className="grid grid-cols-4 gap-2 max-w-xl">
        {['ok', 'partielle', 'cassee', 'inactive'].map(h => (
          <button key={h} onClick={() => setHealthFilter(healthFilter === h ? '' : h)}
            className={`rounded-lg px-3 py-2 text-left border transition-colors ${
              healthFilter === h ? 'border-accent bg-surface' : 'border-line bg-surface hover:border-line'}`}>
            <div className="text-[9px] uppercase tracking-wider text-ink-muted">{CHAIN_HEALTH[h].label}s</div>
            <div className={`text-xl font-bold ${
              h === 'cassee' ? 'text-danger' : h === 'partielle' ? 'text-warn' : h === 'inactive' ? 'text-ink-muted' : 'text-accent-ink'}`}>
              {counts[h] || 0}
            </div>
          </button>
        ))}
      </div>

      <div className="relative max-w-xs">
        <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher dans les chaînes..."
          className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
      </div>

      {filtered.map(c => {
        const isCollapsed = collapsed[c.rootTaskId];
        return (
          <div key={c.rootTaskId} className="bg-surface border border-line rounded-lg overflow-hidden">
            {/* En-tête de chaîne : état, planification, durée, prochaine exécution */}
            <button
              onClick={() => setCollapsed(x => ({ ...x, [c.rootTaskId]: !x[c.rootTaskId] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-raised">
              {isCollapsed ? <ChevronRight size={12} className="text-ink-faint" /> : <ChevronDown size={12} className="text-ink-faint" />}
              <span className={`text-[9px] px-2 py-0.5 rounded ${CHAIN_HEALTH[c.health]?.cls}`}>
                {CHAIN_HEALTH[c.health]?.label}
              </span>
              <span className="text-xs text-ink font-semibold truncate max-w-[260px]" title={c.rootName}>{c.rootName}</span>
              <span className="text-[10px] text-ink-faint">
                {c.taskCount} tâche{c.taskCount !== 1 ? 's' : ''}
                {c.totalDurationMs ? ` · ~${fmtDuration(c.totalDurationMs)}` : ''}
              </span>
              <div className="flex-1" />
              <span className="text-[10px] text-ink-muted flex items-center gap-1.5">
                <CalendarClock size={11} className={c.scheduleEnabled ? 'text-accent-ink' : 'text-ink-faint'} />
                {c.schedule ? c.schedule : '✋ manuel'}
                {c.rootNextExecution && <span className="text-ink-faint">· prochaine : {fmtDate(c.rootNextExecution)}</span>}
              </span>
            </button>
            {/* Diagnostic court si problème */}
            {!isCollapsed && c.health !== 'ok' && (
              <div className="px-3 pb-1 text-[10px] text-ink-muted">
                {c.health === 'inactive' && 'La racine est désactivée ou sa planification est off — toute la chaîne est à l\'arrêt.'}
                {c.health === 'cassee' && `${c.brokenCount + c.failingCount} maillon(s) en échec ou cassé(s) — l'aval ne tournera pas.`}
                {c.health === 'partielle' && `${c.disabledCount} maillon(s) désactivé(s) dans la chaîne.`}
              </div>
            )}
            {!isCollapsed && (
              <div className="px-3 pb-2">
                <ChainNode node={c.tree} depth={0} parentBroken={false} feedsClientById={feedsClientById} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Chaînes candidates à suppression (aucun descendant ne feed un stream client) ───

function DeadChainsSection({ tasks, chains }) {
  const [collapsed, setCollapsed] = useState({});

  // Table des tâches par ID pour retrouver feedsClient
  const feedsClientById = useMemo(() => {
    const m = new Map();
    for (const t of tasks) m.set(t.taskId, t.feedsClient);
    return m;
  }, [tasks]);

  // Chaînes dont la racine ne feed aucun client (=> tout le sous-arbre est mort)
  const deadChains = useMemo(
    () => chains.filter(c => !feedsClientById.get(c.rootTaskId)),
    [chains, feedsClientById]
  );

  // Compter les tâches dans chaque chaîne morte
  const totalTasksInDead = deadChains.reduce((sum, c) => sum + (c.taskCount || 0), 0);

  if (deadChains.length === 0) return null;

  return (
    <section className="space-y-2 pt-3 border-t border-line">
      <div className="flex items-center gap-2">
        <ListTree size={14} className="text-danger" />
        <h4 className="text-xs font-semibold text-danger">
          Chaînes sans impact client ({deadChains.length}) — {totalTasksInDead} tâche(s) au total, candidates à suppression
        </h4>
      </div>
      <p className="text-[10px] text-ink-muted pl-6">
        Aucune tâche de ces chaînes n'aboutit à une app dans un stream client. La chaîne entière peut être supprimée.
      </p>
      <div className="space-y-1.5">
        {deadChains.map(c => {
          const isCollapsed = collapsed[c.rootTaskId] ?? true;
          return (
            <div key={c.rootTaskId} className="bg-danger-soft border border-danger rounded">
              <button onClick={() => setCollapsed(s => ({ ...s, [c.rootTaskId]: !isCollapsed }))}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-danger-soft">
                {isCollapsed ? <ChevronRight size={12} className="text-ink-muted" /> : <ChevronDown size={12} className="text-ink-muted" />}
                <span className="font-semibold text-danger truncate max-w-[280px]" title={c.rootName}>{c.rootName}</span>
                <span className="text-[10px] text-ink-muted truncate">
                  {c.schedule ? `🕐 ${c.schedule}` : '🔗 racine chaîne'}
                </span>
                <span className="flex-1" />
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-raised text-ink">
                  {c.taskCount} tâche{c.taskCount > 1 ? 's' : ''}
                </span>
                {c.brokenCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warn-soft text-warn">
                    {c.brokenCount} cassée{c.brokenCount > 1 ? 's' : ''}
                  </span>
                )}
                {c.failingCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-soft text-danger">
                    {c.failingCount} échec{c.failingCount > 1 ? 's' : ''}
                  </span>
                )}
              </button>
              {!isCollapsed && (
                <div className="px-3 pb-2">
                  <ChainNode node={c.tree} depth={0} parentBroken={false} feedsClientById={feedsClientById} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Vue Nettoyage : tableau trié par score ───────────────────────────────────

function CleanupView({ data }) {
  // Préfiltre depuis l'URL : ?app=NomApp → utile pour arriver ici depuis
  // une carte QVD ou une app détaillée en un clic.
  const initialSearch = (() => {
    if (typeof window === 'undefined') return '';
    const p = new URLSearchParams(window.location.search);
    return p.get('app') || '';
  })();
  const [search, setSearch] = useState(initialSearch);
  const [recoFilter, setRecoFilter] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [publicationFilter, setPublicationFilter] = useState(''); // '' | 'published' | 'draft' | 'orphan'
  const [problemFilter, setProblemFilter] = useState(''); // clé de PROBLEM_META ou ''
  const [expanded, setExpanded] = useState(null);
  // Tri des colonnes — cliquez sur un en-tête pour toggle asc/desc.
  // Défaut : durée décroissante pour repérer d'un coup d'œil les tâches lentes.
  const [sortKey, setSortKey] = useState('duration');
  const [sortDir, setSortDir] = useState('desc');

  const streams = useMemo(
    () => [...new Set(data.tasks.map(t => t.stream || '(non publiée)'))].sort(),
    [data]
  );

  // Publication de la cible : published / draft / orphan (app supprimée)
  const publicationOf = (t) => !t.qlikAppId ? 'orphan' : (t.appPublished ? 'published' : 'draft');

  const publicationStats = useMemo(() => {
    const s = { published: 0, draft: 0, orphan: 0 };
    for (const t of data.tasks) s[publicationOf(t)]++;
    return s;
  }, [data]);

  const problemCounts = useMemo(() => {
    const c = new Map();
    for (const t of data.tasks) for (const p of t.problems || []) c.set(p, (c.get(p) || 0) + 1);
    return c;
  }, [data]);

  // "Candidats safe" = à vérifier/supprimer ET cible non publiée (pas d'impact client)
  const safeCandidates = useMemo(
    () => data.tasks.filter(t => t.recommendation !== 'conserver' && publicationOf(t) !== 'published').length,
    [data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.tasks.filter(t => {
      if (q && !`${t.name} ${t.appName}`.toLowerCase().includes(q)) return false;
      if (recoFilter && t.recommendation !== recoFilter) return false;
      if (streamFilter && (t.stream || '(non publiée)') !== streamFilter) return false;
      if (triggerFilter && (t.triggerType || 'manual') !== triggerFilter) return false;
      if (publicationFilter && publicationOf(t) !== publicationFilter) return false;
      if (problemFilter && !(t.problems || []).includes(problemFilter)) return false;
      return true;
    });
  }, [data, search, recoFilter, streamFilter, triggerFilter, publicationFilter, problemFilter]);

  // Tri appliqué APRÈS le filtre — pour ne pas re-trier les 1000+ tâches
  // à chaque frappe dans la barre de recherche.
  const sorted = useMemo(() => {
    const RECO_ORDER = { supprimer: 0, verifier: 1, conserver: 2 };
    const getKey = (t) => {
      switch (sortKey) {
        case 'score':      return t.cleanupScore ?? 0;
        case 'reco':       return RECO_ORDER[t.recommendation] ?? 99;
        case 'name':       return (t.name || '').toLowerCase();
        case 'app':        return (t.appName || '').toLowerCase();
        case 'trigger':    return t.triggerType || 'manual';
        case 'problems':   return (t.problems || []).length;
        case 'lastRun':    return t.lastStart ? new Date(t.lastStart).getTime() : 0;
        case 'duration':   return t.durationMs ?? 0;
        default:           return 0;
      }
    };
    const rows = [...filtered];
    rows.sort((a, b) => {
      const ka = getKey(a), kb = getKey(b);
      if (ka < kb) return sortDir === 'asc' ? -1 : 1;
      if (ka > kb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      // Défaut : desc pour numérique (score/durée/problèmes/date), asc pour texte
      setSortDir(['score', 'duration', 'problems', 'lastRun'].includes(key) ? 'desc' : 'asc');
    }
  };

  const s = data.stats;
  const applySafePreset = () => {
    setRecoFilter('');            // n'importe quel niveau (verifier + supprimer)
    setPublicationFilter('draft'); // uniquement non publiée
    setStreamFilter(''); setTriggerFilter(''); setProblemFilter(''); setSearch('');
    // On veut à la fois draft + orphan → on définit un flag spécial via publicationFilter=draft
    // (orphan sera montré séparément avec le compteur dédié)
  };
  const resetFilters = () => {
    setSearch(''); setRecoFilter(''); setStreamFilter(''); setTriggerFilter('');
    setPublicationFilter(''); setProblemFilter('');
  };
  const hasActiveFilters = search || recoFilter || streamFilter || triggerFilter || publicationFilter || problemFilter;

  return (
    <div className="space-y-3">
      {/* Synthèse nettoyage — 3 recommandations + 1 raccourci safe */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 max-w-2xl">
        {['supprimer', 'verifier', 'conserver'].map(r => (
          <button key={r} onClick={() => setRecoFilter(recoFilter === r ? '' : r)}
            className={`rounded-lg px-3 py-2 text-left border transition-colors ${
              recoFilter === r ? 'border-accent bg-surface' : 'border-line bg-surface hover:border-line'}`}>
            <div className="text-[9px] uppercase tracking-wider text-ink-muted">{RECO_META[r].label}</div>
            <div className={`text-xl font-bold ${r === 'supprimer' ? 'text-danger' : r === 'verifier' ? 'text-warn' : 'text-accent-ink'}`}>
              {r === 'supprimer' ? s.toDelete : r === 'verifier' ? s.toReview : s.toKeep}
            </div>
          </button>
        ))}
        <button onClick={applySafePreset}
          className="rounded-lg px-3 py-2 text-left border border-info bg-info-soft hover:border-info">
          <div className="text-[9px] uppercase tracking-wider text-info">Candidats safe *</div>
          <div className="text-xl font-bold text-info">{safeCandidates}</div>
          <div className="text-[9px] text-ink-muted">à revoir + cible non publiée</div>
        </button>
      </div>

      {/* Répartition par publication de l'app cible */}
      <div className="flex flex-wrap gap-2 items-center text-[10px]">
        <span className="uppercase tracking-wider text-ink-faint">Cible :</span>
        <button onClick={() => setPublicationFilter(publicationFilter === 'published' ? '' : 'published')}
          className={`px-2 py-1 rounded border ${publicationFilter === 'published' ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-muted hover:border-line'}`}
          title="Tâches ciblant une app dans un stream — attention à ne pas casser le reload client">
          🌐 App publiée ({publicationStats.published})
        </button>
        <button onClick={() => setPublicationFilter(publicationFilter === 'draft' ? '' : 'draft')}
          className={`px-2 py-1 rounded border ${publicationFilter === 'draft' ? 'border-warn bg-warn-soft text-warn' : 'border-line bg-surface text-ink-muted hover:border-line'}`}
          title="Tâches ciblant une app non publiée — safe à nettoyer">
          🔒 App non publiée ({publicationStats.draft})
        </button>
        <button onClick={() => setPublicationFilter(publicationFilter === 'orphan' ? '' : 'orphan')}
          className={`px-2 py-1 rounded border ${publicationFilter === 'orphan' ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-surface text-ink-muted hover:border-line'}`}
          title="Tâches dont l'app cible n'existe plus (à supprimer sans risque)">
          🗑 App supprimée ({publicationStats.orphan})
        </button>
      </div>

      {/* Chips de problèmes cliquables */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-wider text-ink-faint mr-1">Problèmes :</span>
        {Object.entries(PROBLEM_META).map(([key, meta]) => {
          const n = problemCounts.get(key) || 0;
          if (n === 0) return null;
          const active = problemFilter === key;
          return (
            <button key={key} onClick={() => setProblemFilter(active ? '' : key)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                active ? `${meta.cls} border-current` : 'bg-surface border-line text-ink-muted hover:text-ink'
              }`}
              title={active ? 'Retirer ce filtre' : 'Filtrer sur ce problème'}>
              {meta.label} <span className="opacity-70">({n})</span>
            </button>
          );
        })}
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher une tâche ou une app..."
            className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
        </div>
        <select value={streamFilter} onChange={e => setStreamFilter(e.target.value)}
          className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
          <option value="">Tous les streams</option>
          {streams.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)}
          className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
          <option value="">Tout déclenchement</option>
          <option value="manual">✋ Manuelles ({data.stats.byTriggerType?.manual ?? '—'})</option>
          <option value="schedule">🕐 Planifiées ({data.stats.byTriggerType?.schedule ?? '—'})</option>
          <option value="chain">🔗 Chaînées ({data.stats.byTriggerType?.chain ?? '—'})</option>
          <option value="mixte">🕐+🔗 Mixtes ({data.stats.byTriggerType?.mixte ?? '—'})</option>
        </select>
        <span className="text-[10px] text-ink-faint">{filtered.length} tâche(s)</span>
        {hasActiveFilters && (
          <button onClick={resetFilters} className="text-[10px] text-ink-muted hover:text-ink underline">
            Réinitialiser
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => downloadAuthed(qlikApi.tasksExportUrl(), { filename: 'tasks.csv' })
            .catch(e => toast.error(e.error || e.message || 'Échec du téléchargement'))}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-raised hover:bg-raised text-ink rounded">
          <Download size={12} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-canvas">
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
            <th className="py-2 pr-2 w-4"></th>
            <SortableTh label="Score"          k="score"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Recommandation" k="reco"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Tâche"          k="name"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Application"    k="app"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Déclenchement"  k="trigger"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Problèmes"      k="problems" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Dernier run"    k="lastRun"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <SortableTh label="Durée"          k="duration" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map(t => (
            <React.Fragment key={t.taskId}>
              <tr className={`hover:bg-raised cursor-pointer ${!t.enabled ? 'opacity-60' : ''}`}
                onClick={() => setExpanded(expanded === t.taskId ? null : t.taskId)}>
                <td className="py-2 pr-1 text-ink-faint">
                  {expanded === t.taskId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </td>
                <td className="py-2 pr-3">
                  <span className={`font-mono font-bold ${t.cleanupScore >= 70 ? 'text-danger' : t.cleanupScore >= 30 ? 'text-warn' : 'text-ink-muted'}`}>
                    {t.cleanupScore}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${RECO_META[t.recommendation]?.cls}`}>
                    {RECO_META[t.recommendation]?.label}
                  </span>
                </td>
                <td className="py-2 pr-3 text-ink max-w-[220px] truncate" title={t.name}>{t.name}</td>
                <td className="py-2 pr-3 max-w-[180px]">
                  <div className="text-ink truncate flex items-center gap-1" title={t.appName}>
                    {/* Lien Apps ↔ Tâches — clic navigue vers /apps préfiltré par nom.
                        stopPropagation pour ne pas déclencher l'expand de la ligne. */}
                    <a href={`/apps?search=${encodeURIComponent(t.appName)}`}
                       onClick={e => e.stopPropagation()}
                       className="truncate hover:text-info hover:underline"
                       title={`Voir « ${t.appName} » dans les applications`}>
                      {t.appName}
                    </a>
                    {t.feedsClient && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-accent-soft text-accent-ink shrink-0"
                        title="Chaîne aboutissant à un stream client — ne pas casser">
                        🌐
                      </span>
                    )}
                    {!t.qlikAppId && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-danger-soft text-danger shrink-0"
                        title="App cible supprimée — tâche orpheline">
                        🗑
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-ink-faint">{t.stream || '(non publiée)'}</div>
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
                      <span key={p} className={`text-[9px] px-1.5 py-0.5 rounded ${PROBLEM_META[p]?.cls || 'bg-raised text-ink-muted'}`}>
                        {PROBLEM_META[p]?.label || p}
                      </span>
                    ))}
                    {!t.problems.length && <span className="text-[9px] text-ink-faint">—</span>}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className={STATUS_CLS[t.lastStatus] || 'text-ink-muted'}>{t.lastStatusLabel}</span>
                  <div className="text-[9px] text-ink-faint">{fmtDate(t.lastStart)}</div>
                </td>
                <td className="py-2 pr-3 text-ink-muted text-[10px]">{fmtDuration(t.durationMs) || '—'}</td>
              </tr>
              {expanded === t.taskId && (
                <tr className="bg-surface">
                  <td></td>
                  <td colSpan={8} className="py-2.5 pr-3 space-y-2 text-[11px]">
                    {t.brokenBy?.length > 0 && (
                      <div className="text-warn">
                        Chaîne cassée par : {t.brokenBy.join(', ')}
                      </div>
                    )}
                    {t.orderIssues?.length > 0 && (
                      <div className="text-violet">
                        Ordre incorrect — cette tâche n'est pas planifiée après le producteur :
                        {t.orderIssues.map(o => (
                          <div key={o.qvd} className="ml-3 font-mono text-[10px]">
                            {o.qvd} <span className="text-ink-muted">← produit par {o.producers.join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {t.staleQvds?.length > 0 && (
                      <div className="text-violet">
                        Sources figées (producteur sans tâche active) : <span className="font-mono text-[10px]">{t.staleQvds.join(', ')}</span>
                      </div>
                    )}
                    {t.imported ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-ink-muted uppercase text-[9px] tracking-wider mb-1">QVD générés par son app ({t.producedQvds.length})</div>
                          {t.producedQvds.length
                            ? <div className="font-mono text-violet space-y-0.5">{t.producedQvds.map(q => <div key={q}>{q}</div>)}</div>
                            : <span className="text-ink-faint">aucun</span>}
                        </div>
                        <div>
                          <div className="text-ink-muted uppercase text-[9px] tracking-wider mb-1">QVD consommés ({t.consumedQvds.length})</div>
                          {t.consumedQvds.length
                            ? <div className="font-mono text-accent-ink space-y-0.5">{t.consumedQvds.map(q => <div key={q}>{q}</div>)}</div>
                            : <span className="text-ink-faint">aucun</span>}
                        </div>
                      </div>
                    ) : (
                      <span className="text-ink-muted">
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

      {/* Chaînes sans impact client — visualisation groupée des candidats à suppression */}
      <DeadChainsSection tasks={data.tasks} chains={data.chains || []} />

      {/* Production QVD dupliquée */}
      {data.duplicateQvdProduction.length > 0 && (
        <section className="space-y-1.5 pt-2">
          <h4 className="text-xs font-semibold text-warn">
            QVD produits par plusieurs tâches actives ({data.duplicateQvdProduction.length}) — reloads redondants
          </h4>
          {data.duplicateQvdProduction.map(g => (
            <div key={g.qvd} className="text-xs bg-warn-soft border border-warn rounded px-3 py-2">
              <span className="font-mono text-warn">{g.qvd}</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.tasks.map((t, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 bg-raised text-ink rounded" title={t.appName}>
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

// ─── Vue Planification : calendrier de la semaine ─────────────────────────────

const DAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const UNSCHEDULED_REASON = {
  manuelle: 'Aucun déclencheur — lancement manuel uniquement',
  declencheurs_desactives: 'Déclencheurs présents mais désactivés',
  hors_semaine: 'Planifiée, mais aucune occurrence cette semaine',
  chaine_sans_racine_planifiee: 'Chaînée derrière une tâche qui n’est pas planifiée',
  chaine_sans_amont: 'Chaînée, mais la tâche amont n’existe plus',
};

/** Mini-calendrier 7 jours : les jours où la tâche tourne sur la semaine. */
function WeekDots({ weekDays = [], weekSlots = [] }) {
  const tip = weekSlots.length
    ? weekSlots.map(s => `${DAY_SHORT[s.day]} ${s.times.join(', ')}`).join('\n')
    : 'Aucune occurrence cette semaine';
  return (
    <div className="flex gap-0.5" title={tip}>
      {DAY_INITIALS.map((d, i) => (
        <span
          key={i}
          className={`w-4 h-4 text-[9px] leading-4 text-center rounded-sm ${
            weekDays.includes(i)
              ? 'bg-accent-soft text-accent-ink font-semibold'
              : 'bg-surface text-ink-faint'
          }`}
        >
          {d}
        </span>
      ))}
    </div>
  );
}

/** Colonne « Déclenchement » : récurrence propre, ou origine de la chaîne. */
function TriggerCell({ entry }) {
  if (entry.type === 'schedule') {
    return <span className="text-ink-muted">{entry.scheduleLabel || '—'}</span>;
  }
  const origins = entry.origins || [];
  if (!origins.length) return <span className="text-ink-faint">—</span>;
  return (
    <div className="space-y-0.5">
      {origins.map((o, i) => (
        <div key={i} title={`Chaîne : ${o.chainPath.join(' → ')} → ${entry.name}`}>
          <span className="text-info">↪ {o.name}</span>
          <span className="text-ink-faint"> · {o.times.join(', ')}</span>
          {o.depth > 1 && <span className="text-ink-faint"> · {o.depth} maillons</span>}
          <div className="text-[10px] text-ink-faint truncate max-w-[260px]">{o.scheduleLabel}</div>
        </div>
      ))}
    </div>
  );
}

const ACTION_BTN =
  'p-1 rounded border border-line text-ink-muted hover:text-accent-ink hover:border-accent hover:bg-raised';
const ACTION_OFF =
  'p-1 rounded border border-line text-ink-faint cursor-not-allowed';

/**
 * Les trois destinations d'une ligne. Une action sans cible est affichée grisée
 * avec la raison en infobulle plutôt que masquée : voir qu'une app n'est pas
 * importée est une information, un bouton qui disparaît n'en est pas une.
 */
function RowActions({ entry, hubBase, onShowInChains }) {
  const qlikUrl = entry.qlikAppId && hubBase ? `${hubBase}${entry.qlikAppId}` : null;
  return (
    <div className="flex items-center gap-1">
      {qlikUrl ? (
        <a href={qlikUrl} target="_blank" rel="noopener noreferrer" className={ACTION_BTN}
          title={`Ouvrir « ${entry.appName} » dans Qlik Sense`}>
          <ExternalLink size={12} />
        </a>
      ) : (
        <span className={ACTION_OFF} title="Application supprimée côté Qlik">
          <ExternalLink size={12} />
        </span>
      )}

      <button type="button" onClick={() => onShowInChains(entry.name)} className={ACTION_BTN}
        title={`Voir « ${entry.name} » dans les chaînes`}>
        <ListTree size={12} />
      </button>

      {entry.localAppId ? (
        <Link to={`/apps/${entry.localAppId}`} className={ACTION_BTN}
          title={`Ouvrir la fiche lineage de « ${entry.appName} »`}>
          <Database size={12} />
        </Link>
      ) : (
        <span className={ACTION_OFF} title="Application pas encore importée dans l'outil">
          <Database size={12} />
        </span>
      )}
    </div>
  );
}

function DayTable({ entries, hubBase, onShowInChains }) {
  if (!entries.length) {
    return (
      <div className="px-3 py-4 text-[11px] text-ink-faint italic">
        Aucune tâche ne se déclenche ce jour-là.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
            <th className="py-1.5 px-3 w-24">Heure</th>
            <th className="py-1.5 pr-3">Application</th>
            <th className="py-1.5 pr-3">Tâche</th>
            <th className="py-1.5 pr-3">Stream</th>
            <th className="py-1.5 pr-3 w-24">Type</th>
            <th className="py-1.5 pr-3">Déclenchement</th>
            <th className="py-1.5 pr-3 w-28">Semaine</th>
            <th className="py-1.5 pr-3 w-20">Liens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((e, i) => (
            <tr key={`${e.taskId}-${i}`} className={`hover:bg-raised ${e.enabled ? '' : 'opacity-50'}`}>
              <td className="py-1.5 px-3 font-mono tabular-nums text-accent-ink align-top">
                {e.times.slice(0, 3).join(' ')}
                {e.times.length > 3 && (
                  <span className="text-ink-faint" title={e.times.join(', ')}> +{e.times.length - 3}</span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-ink align-top">{e.appName}</td>
              <td className="py-1.5 pr-3 text-ink-muted align-top">
                {e.name}
                {!e.enabled && <span className="ml-1.5 text-[9px] px-1 rounded bg-raised text-ink-muted">off</span>}
                {e.uncertain && (
                  <span
                    className="ml-1.5 text-[9px] px-1 rounded bg-warn-soft text-warn"
                    title="Le prochain lancement annoncé par Qlik ne tombe pas sur un jour décodé — planification à vérifier en QMC."
                  >
                    ?
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-ink-muted align-top">{e.stream || '—'}</td>
              <td className="py-1.5 pr-3 align-top">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${TRIGGER_META[e.type].cls}`}>
                  {TRIGGER_META[e.type].label}
                </span>
              </td>
              <td className="py-1.5 pr-3 align-top"><TriggerCell entry={e} /></td>
              <td className="py-1.5 pr-3 align-top"><WeekDots weekDays={e.weekDays} weekSlots={e.weekSlots} /></td>
              <td className="py-1.5 pr-3 align-top">
                <RowActions entry={e} hubBase={hubBase} onShowInChains={onShowInChains} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanningView({ planning, onShowInChains }) {
  // Ouverture sur la journée en cours — c'est la question qu'on se pose en
  // arrivant. Repli sur la semaine entière si la grille ne contient pas
  // aujourd'hui (données en cache calculées sur une autre semaine).
  const [day, setDay] = useState(() => {
    const today = (planning?.days || []).find(d => d.isToday);
    return today ? today.index : -1;             // -1 = toute la semaine
  });
  const [search, setSearch] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [hideDisabled, setHideDisabled] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const streams = useMemo(() => {
    const set = new Set();
    for (const d of planning?.days || []) for (const e of d.entries) if (e.stream) set.add(e.stream);
    return [...set].sort();
  }, [planning]);

  const matches = useCallback((e) => {
    const q = search.trim().toLowerCase();
    if (q && ![e.name, e.appName, e.stream].some(v => String(v || '').toLowerCase().includes(q))) return false;
    if (streamFilter && e.stream !== streamFilter) return false;
    if (typeFilter && e.type !== typeFilter) return false;
    if (hideDisabled && !e.enabled) return false;
    return true;
  }, [search, streamFilter, typeFilter, hideDisabled]);

  const days = useMemo(
    () => (planning?.days || []).map(d => ({ ...d, entries: d.entries.filter(matches) })),
    [planning, matches]
  );

  if (!planning) {
    return <div className="text-xs text-ink-faint py-6">Planification indisponible — relancez un calcul.</div>;
  }

  const visible = day === -1 ? days : days.filter(d => d.index === day);
  const shown = visible.reduce((acc, d) => acc + d.entries.length, 0);
  const s = planning.stats;

  return (
    <div className="space-y-3">
      {/* Filtre de jour de la semaine */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setDay(-1)}
          className={`text-[11px] px-2.5 py-1 rounded border ${
            day === -1 ? 'bg-accent-soft text-accent-ink border-accent'
                       : 'border-line text-ink-muted hover:text-ink'}`}
        >
          Toute la semaine
        </button>
        {days.map(d => (
          <button
            key={d.index}
            onClick={() => setDay(d.index)}
            title={d.date}
            className={`text-[11px] px-2.5 py-1 rounded border ${
              day === d.index ? 'bg-accent-soft text-accent-ink border-accent'
                              : 'border-line text-ink-muted hover:text-ink'
            } ${d.isToday ? 'ring-1 ring-accent' : ''}`}
          >
            {DAY_SHORT[d.index]}
            <span className="ml-1 text-ink-faint">{d.entries.length}</span>
          </button>
        ))}
        <span className="ml-auto text-[10px] text-ink-faint">
          Semaine du {planning.weekStart} au {planning.weekEnd} · {s.totalRuns} déclenchements
        </span>
      </div>

      {/* Filtres secondaires */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tâche, app, stream…"
            className="bg-surface border border-line rounded pl-7 pr-2 py-1 text-xs text-ink w-56 outline-none focus:border-accent"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-surface border border-line rounded px-2 py-1 text-xs text-ink">
          <option value="">Tous types</option>
          <option value="schedule">Planifiées</option>
          <option value="chain">Chaînées</option>
        </select>
        {streams.length > 0 && (
          <select value={streamFilter} onChange={e => setStreamFilter(e.target.value)}
            className="bg-surface border border-line rounded px-2 py-1 text-xs text-ink">
            <option value="">Tous streams</option>
            {streams.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer">
          <input type="checkbox" checked={hideDisabled} onChange={e => setHideDisabled(e.target.checked)} />
          Masquer les désactivées
        </label>
        <span className="ml-auto text-[10px] text-ink-faint">
          {s.scheduledTasks} planifiées · {s.chainedTasks} chaînées · {shown} lignes affichées
          {s.uncertainTasks > 0 && (
            <span className="text-warn" title="Décodage de la récurrence contredit par le prochain lancement annoncé par Qlik">
              {' '}· {s.uncertainTasks} à vérifier
            </span>
          )}
        </span>
      </div>

      {/* Grille par jour */}
      <div className="space-y-2">
        {visible.map(d => (
          <div key={d.index} className="border border-line rounded overflow-hidden bg-surface">
            <div className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-2 ${
              d.isToday ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink'}`}>
              <CalendarClock size={12} />
              {d.label} {d.date}
              {d.isToday && <span className="text-[9px] px-1 rounded bg-accent-soft">aujourd’hui</span>}
              <span className="ml-auto text-[10px] font-normal text-ink-muted">{d.entries.length} tâche(s)</span>
            </div>
            <DayTable entries={d.entries} hubBase={planning.hubBase} onShowInChains={onShowInChains} />
          </div>
        ))}
      </div>

      {/* Tâches hors calendrier — ne pas les cacher : c'est là que se voient
          les planifications mortes. */}
      {(planning.unscheduled || []).length > 0 && (
        <div className="border border-line rounded overflow-hidden bg-surface">
          <button
            onClick={() => setShowUnscheduled(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface hover:bg-raised text-xs text-ink-muted"
          >
            {showUnscheduled ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Hors calendrier — {planning.unscheduled.length} tâche(s) sans déclenchement cette semaine
          </button>
          {showUnscheduled && (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-line">
                {planning.unscheduled.map(u => (
                  <tr key={u.taskId} className={`hover:bg-raised ${u.enabled ? '' : 'opacity-50'}`}>
                    <td className="py-1.5 px-3 text-ink">{u.appName}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">{u.name}</td>
                    <td className="py-1.5 pr-3 text-ink-faint">{u.stream || '—'}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${TRIGGER_META[u.type]?.cls || ''}`}>
                        {TRIGGER_META[u.type]?.label || u.type}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-ink-muted">{UNSCHEDULED_REASON[u.reason] || u.reason}</td>
                    <td className="py-1.5 pr-3">
                      <RowActions entry={u} hubBase={planning.hubBase} onShowInChains={onShowInChains} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('cleanup'); // 'cleanup' | 'chains' | 'planning'
  const [chainFocus, setChainFocus] = useState(null); // { name, seq } — voir ChainsView

  const showInChains = useCallback((taskName) => {
    setChainFocus(f => ({ name: taskName, seq: (f?.seq || 0) + 1 }));
    setView('chains');
  }, []);

  // forceRefresh=true → ?refresh=1, invalide le cache serveur avant recalcul.
  // Le premier chargement utilise le cache si présent (5 min) ; on ne le
  // rafraîchit explicitement que sur clic utilisateur.
  const load = useCallback((forceRefresh = false) => {
    setLoading(true);
    setError(null);
    qlikApi.tasks(forceRefresh)
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur — vérifiez la connexion au serveur Qlik'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-faint">
        <Loader2 className="animate-spin mr-2" size={16} />
        <span className="text-xs">Récupération des tâches depuis le serveur Qlik...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-xs text-danger bg-danger-soft border border-danger rounded px-3 py-2">{error}</div>
        <button onClick={load} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-raised hover:bg-raised text-ink rounded">
          <RefreshCw size={12} /> Réessayer
        </button>
      </div>
    );
  }

  const s = data.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <CalendarClock size={15} className="text-accent-ink" /> Tâches — {s.totalTasks} au total
        </h3>
        <span className="text-[10px] text-ink-faint">
          {s.enabled} actives · lineage QVD couvert sur {s.coveredByImport} tâches
          {data.cachedAt && (
            <>
              {' · '}
              <span title={`Données mises en cache le ${new Date(data.cachedAt).toLocaleString('fr-FR')}. Cliquez sur ⟳ pour forcer un recalcul.`}>
                données de {new Date(data.cachedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </>
          )}
        </span>
        <div className="flex-1" />
        {/* Bascule de vue */}
        <div className="flex rounded overflow-hidden border border-line">
          <button onClick={() => setView('cleanup')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${view === 'cleanup' ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-muted hover:text-ink'}`}>
            <ClipboardList size={12} /> Nettoyage
          </button>
          <button onClick={() => setView('chains')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${view === 'chains' ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-muted hover:text-ink'}`}>
            <ListTree size={12} /> Chaînes ({(data.chains || []).length})
          </button>
          <button onClick={() => setView('planning')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${view === 'planning' ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-ink-muted hover:text-ink'}`}>
            <CalendarClock size={12} /> Planification
          </button>
        </div>
        <button
          onClick={() => load(true)}
          className="p-1.5 text-ink-muted hover:text-ink"
          title="Forcer un recalcul (ignore le cache 5 min)"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {view === 'cleanup' && <CleanupView data={data} />}
      {view === 'chains' && <ChainsView chains={data.chains || []} tasks={data.tasks || []} focus={chainFocus} />}
      {view === 'planning' && <PlanningView planning={data.planning} onShowInChains={showInChains} />}
    </div>
  );
}
