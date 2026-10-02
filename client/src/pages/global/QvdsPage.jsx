import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Clock, Link2, Zap, User, Ban } from 'lucide-react';
import { useGlobalContext } from '../../layouts/GlobalLayout.jsx';
import { qlikApi } from '../../api/qlikApi';
import { PageBody, SearchInput, Select, EmptyState } from '../../components/ui/primitives';
import { AppChips, QvdStatusBadge } from '../../components/global/bits.jsx';

/* Tableau des QVD : recherche, filtre par statut, détail dépliable. */

function QvdDetail({ qvd }) {
  return (
    <tr className="bg-raised">
      <td />
      <td colSpan={4} className="py-3 pr-3">
        <div className="grid md:grid-cols-2 gap-5 text-[13px]">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1.5">
              Générée par ({qvd.producers.length})
            </div>
            {qvd.producers.length ? qvd.producers.map((p, i) => (
              <div key={i} className="mb-1.5">
                <span className="text-violet font-medium">{p.appName}</span>
                {p.stream && <span className="text-ink-faint"> · {p.stream}</span>}
                <div className="text-ink-muted">
                  table <span className="font-mono text-ink">{p.tableName}</span>
                </div>
                {p.path && <div className="font-mono text-[11px] text-ink-faint break-all">{p.path}</div>}
              </div>
            )) : (
              <span className="text-ink-faint">
                Producteur inconnu — app batch non importée, ou source externe.
              </span>
            )}
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1.5">
              Consommée par ({qvd.consumers.length})
            </div>
            {qvd.consumers.length ? qvd.consumers.map((c, i) => (
              <div key={i} className="mb-1.5">
                <span className="text-accent-ink font-medium">{c.appName}</span>
                {c.stream && <span className="text-ink-faint"> · {c.stream}</span>}
                {c.tables?.length > 0 && (
                  <div className="text-ink-muted">
                    dans : <span className="font-mono text-ink">{c.tables.join(', ')}</span>
                  </div>
                )}
              </div>
            )) : (
              <span className="text-ink-faint">Personne — candidat à la suppression.</span>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

const parentFolder = (name) => {
  const s = String(name || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i > 0 ? s.slice(0, i) : '(sans dossier)';
};

export default function QvdsPage() {
  const { data } = useGlobalContext();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [folder, setFolder] = useState('');
  const [stream, setStream] = useState('');
  const [consumers, setConsumers] = useState(''); // '', '0', '1', '2+', '5+'
  const [app, setApp] = useState('');             // filtre par appId (producteur OU consommateur)
  const [taskFilter, setTaskFilter] = useState(''); // '' | 'has_task' | 'no_task' | 'no_producer_task'
  const [sort, setSort] = useState('name');       // name | consumers | producers
  const [expanded, setExpanded] = useState(null);

  // Charge les tâches Qlik une fois → Map<qlikAppId, {triggerType, enabled, name}>.
  // Sans cache Qlik → renvoie null et les pictos affichent "inconnu".
  const [taskMap, setTaskMap] = useState(null);
  useEffect(() => {
    qlikApi.tasks(false)
      .then(res => {
        const list = Array.isArray(res) ? res : (res?.tasks || []);
        const m = new Map();
        for (const t of list) {
          if (!t.qlikAppId) continue;
          const prev = m.get(t.qlikAppId);
          // Priorité aux tâches activées et aux triggers "réels" (schedule/chain)
          const rank = (tt) => (tt.enabled ? 10 : 0) + ({ schedule: 3, mixte: 3, chain: 2, manual: 1 }[tt.triggerType] || 0);
          if (!prev || rank(t) > rank(prev)) m.set(t.qlikAppId, t);
        }
        setTaskMap(m);
      })
      .catch(() => setTaskMap(new Map())); // vide → pictos "pas de tâche" au lieu d'inconnu
  }, []);

  const { folders, streams, appsList } = useMemo(() => {
    const fset = new Set();
    const sset = new Set();
    const aset = new Map(); // appId -> appName (dedup)
    for (const q of data.qvds) {
      fset.add(parentFolder(q.name));
      for (const a of q.producers) {
        sset.add(a.stream || '(non publiée)');
        if (a.appId) aset.set(a.appId, a.appName);
      }
      for (const a of q.consumers) {
        sset.add(a.stream || '(non publiée)');
        if (a.appId) aset.set(a.appId, a.appName);
      }
    }
    const appsList = [...aset.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { folders: [...fset].sort(), streams: [...sset].sort(), appsList };
  }, [data.qvds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const appId = app ? Number(app) : null;
    const list = data.qvds.filter(x => {
      if (status && x.status !== status) return false;
      if (folder && parentFolder(x.name) !== folder) return false;
      if (stream) {
        const has = [...x.producers, ...x.consumers].some(a => (a.stream || '(non publiée)') === stream);
        if (!has) return false;
      }
      if (consumers) {
        const n = x.consumers.length;
        if (consumers === '0' && n !== 0) return false;
        if (consumers === '1' && n !== 1) return false;
        if (consumers === '2+' && n < 2) return false;
        if (consumers === '5+' && n < 5) return false;
      }
      if (appId != null) {
        const involved = [...x.producers, ...x.consumers].some(a => a.appId === appId);
        if (!involved) return false;
      }
      if (taskFilter && taskMap) {
        const apps = [...x.producers, ...x.consumers];
        const producers = x.producers;
        if (taskFilter === 'has_task' && !apps.some(a => taskMap.get(a.qlikAppId))) return false;
        if (taskFilter === 'no_task' && apps.some(a => taskMap.get(a.qlikAppId))) return false;
        if (taskFilter === 'no_producer_task' && (producers.length === 0 || producers.some(a => taskMap.get(a.qlikAppId)))) return false;
      }
      if (!q) return true;
      return x.name.toLowerCase().includes(q)
        || x.producers.some(p => p.appName.toLowerCase().includes(q))
        || x.consumers.some(c => c.appName.toLowerCase().includes(q));
    });
    if (sort === 'consumers') list.sort((a, b) => b.consumers.length - a.consumers.length || a.name.localeCompare(b.name));
    else if (sort === 'producers') list.sort((a, b) => b.producers.length - a.producers.length || a.name.localeCompare(b.name));
    return list;
  }, [data.qvds, search, status, folder, stream, consumers, app, taskFilter, taskMap, sort]);

  const hasActiveFilter = search || status || folder || stream || consumers || app || taskFilter || sort !== 'name';
  const resetAll = () => {
    setSearch(''); setStatus(''); setFolder(''); setStream(''); setConsumers('');
    setApp(''); setTaskFilter(''); setSort('name');
  };

  return (
    <PageBody>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Chercher un QVD ou une app…"
          className="w-full max-w-xs"
        />
        <Select value={status} onChange={setStatus} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          <option value="ok">ok</option>
          <option value="orphelin">orphelin</option>
          <option value="externe">externe</option>
        </Select>
        <Select value={folder} onChange={setFolder} aria-label="Filtrer par dossier">
          <option value="">Tous dossiers ({folders.length})</option>
          {folders.map(f => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Select value={stream} onChange={setStream} aria-label="Filtrer par stream">
          <option value="">Tous streams</option>
          {streams.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={consumers} onChange={setConsumers} aria-label="Filtrer par nombre de consommateurs">
          <option value="">Nb consommateurs</option>
          <option value="0">0 (orphelin)</option>
          <option value="1">1</option>
          <option value="2+">2 et +</option>
          <option value="5+">5 et +</option>
        </Select>
        <Select value={app} onChange={setApp} aria-label="Filtrer par app">
          <option value="">Toutes apps ({appsList.length})</option>
          {appsList.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={taskFilter} onChange={setTaskFilter} aria-label="Filtrer par tâche">
          <option value="">Tâches : tous</option>
          <option value="has_task">≥ 1 app avec tâche</option>
          <option value="no_task">Aucune app avec tâche</option>
          <option value="no_producer_task">Producteur sans tâche ⚠</option>
        </Select>
        <Select value={sort} onChange={setSort} aria-label="Trier">
          <option value="name">Trier : nom</option>
          <option value="consumers">Trier : + consommé</option>
          <option value="producers">Trier : + produit</option>
        </Select>
        {hasActiveFilter && (
          <button onClick={resetAll}
            className="text-[11px] px-2.5 py-1.5 rounded border border-line hover:bg-raised text-ink-muted">
            Reset
          </button>
        )}
        <span className="text-xs text-ink-faint tabular-nums">
          {filtered.length} / {data.qvds.length} QVD
        </span>
      </div>

      {taskMap && (
        <div className="flex items-center gap-3 text-[10px] text-ink-faint mb-3">
          <span className="uppercase tracking-wider">Légende tâches :</span>
          <span className="inline-flex items-center gap-1"><Clock size={11} className="text-accent-ink" /> planifiée</span>
          <span className="inline-flex items-center gap-1"><Link2 size={11} className="text-violet" /> chaînée</span>
          <span className="inline-flex items-center gap-1"><Zap size={11} className="text-accent-ink" /> planifiée + chaînée</span>
          <span className="inline-flex items-center gap-1"><User size={11} className="text-warn" /> manuelle</span>
          <span className="inline-flex items-center gap-1"><Ban size={11} className="text-danger" /> aucune tâche</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Aucun QVD ne correspond"
          description="Élargissez la recherche ou changez le filtre de statut."
        />
      ) : (
        <div className="overflow-x-auto">
          {/*
           * table-fixed + colgroup : sans ça, la colonne QVD se laisse écraser
           * par les listes de producteurs/consommateurs et le texte finit par
           * s'empiler en vertical (bug remonté par l'utilisateur).
           */}
          <table className="w-full text-[13px] table-fixed">
            <colgroup>
              <col style={{ width: '32px' }} />
              <col style={{ minWidth: '260px', width: '30%' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                <th className="py-2 pr-1" />
                <th className="py-2 pr-3">QVD</th>
                <th className="py-2 pr-3">Statut</th>
                <th className="py-2 pr-3">Générée par</th>
                <th className="py-2 pr-3">Consommée par</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map(x => (
                <React.Fragment key={x.name}>
                  <tr
                    className="hover:bg-raised cursor-pointer"
                    onClick={() => setExpanded(expanded === x.name ? null : x.name)}
                  >
                    <td className="py-2 pr-1 text-ink-faint align-top pt-2.5">
                      {expanded === x.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    {/* break-words (pas break-all) : coupe entre mots plutôt que
                        lettre par lettre, ce qui suffit pour les noms de type
                        fait_ventes_2024_v2.qvd tout en évitant le rendu vertical. */}
                    <td className="py-2 pr-3 font-mono text-info break-words align-top" title={x.name}>
                      {x.name}
                    </td>
                    <td className="py-2 pr-3 align-top"><QvdStatusBadge status={x.status} /></td>
                    <td className="py-2 pr-3 align-top"><AppChips list={x.producers} taskMap={taskMap} /></td>
                    <td className="py-2 pr-3 align-top"><AppChips list={x.consumers} taskMap={taskMap} /></td>
                  </tr>
                  {expanded === x.name && <QvdDetail qvd={x} />}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageBody>
  );
}
