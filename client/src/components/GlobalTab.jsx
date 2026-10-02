import React, { useEffect, useState, useMemo, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, MarkerType, Position } from 'reactflow';
import dagre from '@dagrejs/dagre';
import 'reactflow/dist/style.css';
import {
  Globe, RefreshCw, Download, Server, AlertTriangle, Database,
  Boxes, GitBranch, Loader2, FileWarning, Copy as CopyIcon,
  Search, ChevronDown, ChevronRight, Trash2
} from 'lucide-react';
import { globalApi, adminApi } from '../api/qlikApi';
import QlikImportModal from './QlikImportModal.jsx';
import TasksTab from './TasksTab.jsx';
import SyntheseTab from './SyntheseTab.jsx';
import GovernanceTab from './GovernanceTab.jsx';

// ─── Graphe global apps ↔ QVD ────────────────────────────────────────────────

const ROLE_COLORS = {
  batch:     { bg: 'rgba(139,92,246,.15)', border: '#8b5cf6', text: '#a78bfa', label: 'BATCH' },
  transform: { bg: 'rgba(245,158,11,.15)', border: '#f59e0b', text: '#fbbf24', label: 'TRANSFORM' },
  front:     { bg: 'rgba(16,185,129,.15)', border: '#10b981', text: '#34d399', label: 'FRONT' },
  autonome:  { bg: 'rgba(107,114,128,.15)', border: '#6b7280', text: '#9ca3af', label: 'AUTONOME' },
  inconnu:   { bg: 'rgba(107,114,128,.1)', border: '#4b5563', text: '#6b7280', label: '?' },
};

const QVD_COLORS = {
  ok:       { border: '#0891b2', text: '#22d3ee' },
  orphelin: { border: '#dc2626', text: '#f87171' },
  externe:  { border: '#ca8a04', text: '#facc15' },
};

function layoutGraph(rawNodes, rawEdges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  rawNodes.forEach(n => g.setNode(n.id, { width: 190, height: 46 }));
  rawEdges.forEach(e => g.setEdge(e.from, e.to));
  dagre.layout(g);

  const nodes = rawNodes.map(n => {
    const p = g.node(n.id);
    const isApp = n.type === 'app';
    const c = isApp ? (ROLE_COLORS[n.role] || ROLE_COLORS.inconnu) : (QVD_COLORS[n.status] || QVD_COLORS.ok);
    return {
      id: n.id,
      position: { x: p.x - 95, y: p.y - 23 },
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      data: {
        label: (
          <div style={{ textAlign: 'left', lineHeight: 1.25 }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.08em', color: c.text }}>
              {isApp ? `📱 ${(ROLE_COLORS[n.role] || ROLE_COLORS.inconnu).label}` : n.status === 'orphelin' ? '💾 QVD ⚠ ORPHELIN' : n.status === 'externe' ? '💾 QVD (externe)' : '💾 QVD'}
            </div>
            <div style={{ fontSize: 10, color: '#e5e7eb', fontWeight: 600, wordBreak: 'break-all' }}>{n.label}</div>
            {isApp && n.stream && <div style={{ fontSize: 8, color: '#6b7280' }}>{n.stream}</div>}
          </div>
        )
      },
      style: {
        width: 190, padding: '6px 10px', borderRadius: 8,
        background: isApp ? '#111827' : '#0c1420',
        border: `1.5px ${isApp ? 'solid' : 'dashed'} ${c.border}`,
        boxShadow: '0 2px 8px rgba(0,0,0,.4)'
      }
    };
  });

  const edges = rawEdges.map((e, i) => ({
    id: `e${i}`, source: e.from, target: e.to, animated: e.kind === 'store',
    style: { stroke: e.kind === 'store' ? '#8b5cf6' : '#10b981', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === 'store' ? '#8b5cf6' : '#10b981' }
  }));

  return { nodes, edges };
}

function GlobalGraph({ graph }) {
  const { nodes, edges } = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  if (!nodes.length) return <div className="p-8 text-center text-xs text-ink-faint">Aucune donnée de graphe — importe ou analyse des apps d'abord.</div>;
  return (
    <div style={{ height: 420 }} className="border border-line rounded-lg overflow-hidden bg-canvas">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#1f2937" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ background: '#0b0f19' }} maskColor="rgba(0,0,0,.6)" nodeColor="#374151" />
      </ReactFlow>
    </div>
  );
}

// ─── Composants UI ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, tone = 'default' }) {
  const tones = {
    default: 'border-line text-ink',
    warn:    value > 0 ? 'border-danger text-danger' : 'border-line text-ink',
    info:    value > 0 ? 'border-warn text-warn' : 'border-line text-ink',
  };
  return (
    <div className={`bg-surface border rounded-lg px-4 py-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-muted">
        <Icon size={12} /> {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || ROLE_COLORS.inconnu;
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: c.bg, color: c.text }}>
      {c.label}
    </span>
  );
}

function AppChips({ list }) {
  if (!list?.length) return <span className="text-ink-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((a, i) => (
        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-raised text-ink rounded whitespace-nowrap">
          {a.appName}
        </span>
      ))}
    </div>
  );
}

// ─── Onglet principal ─────────────────────────────────────────────────────────

export default function GlobalTab({ onAppsChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [view, setView] = useState('synthese'); // synthese | qvds | graph | problemes | apps | taches
  const [appSearch, setAppSearch] = useState('');
  const [appStream, setAppStream] = useState('');
  const [appPublished, setAppPublished] = useState('');
  const [appRole, setAppRole] = useState('');
  const [graphStream, setGraphStream] = useState('');
  const [forceGraph, setForceGraph] = useState(false);
  const [qvdSearch, setQvdSearch] = useState('');
  const [qvdStatus, setQvdStatus] = useState('');
  const [qvdFolder, setQvdFolder] = useState('');
  const [qvdStream, setQvdStream] = useState('');
  const [qvdConsumers, setQvdConsumers] = useState(''); // '', '0', '1', '2+', '5+'
  const [qvdSort, setQvdSort] = useState('name'); // name | consumers | producers
  const [expandedQvd, setExpandedQvd] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    globalApi.getLineage()
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="flex-1 flex items-center justify-center text-ink-faint"><Loader2 className="animate-spin mr-2" size={16} /> <span className="text-xs">Construction du lineage global...</span></div>;
  }

  const problemCount = data ? data.orphans.length + data.multiProduced.length + data.duplicateExtractions.length : 0;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Barre d'actions */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Globe size={15} className="text-accent-ink" /> Lineage global — toutes applications
        </h3>
        <div className="flex-1" />
        <button onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent text-white rounded">
          <Server size={12} /> Importer du serveur Qlik
        </button>
        <a href={globalApi.exportUrl()} download
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-raised hover:bg-raised text-ink rounded">
          <Download size={12} /> CSV
        </a>
        <button onClick={load} className="p-1.5 text-ink-muted hover:text-ink" title="Rafraîchir">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={async () => {
            if (!window.confirm('Vider toute la base locale (apps, scripts, analyses, chat) ?\nUne sauvegarde du fichier .db est faite automatiquement.\nLa configuration serveur Qlik est conservée.')) return;
            try {
              await adminApi.reset();
              load();
              onAppsChanged?.();
            } catch (e) {
              alert(e.error || e.message || 'Échec du reset');
            }
          }}
          className="p-1.5 text-ink-faint hover:text-danger" title="Réinitialiser la base locale (sauvegarde auto)">
          <Trash2 size={13} />
        </button>
      </div>

      {error && <div className="text-xs text-danger bg-danger-soft border border-danger rounded px-3 py-2">{error}</div>}

      {data && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            <StatCard icon={Boxes} label="Apps" value={data.stats.totalApps} />
            <StatCard icon={GitBranch} label="Analysées" value={data.stats.analyzedApps} />
            <StatCard icon={Database} label="QVD" value={data.stats.totalQvds} />
            <StatCard icon={FileWarning} label="Orphelins" value={data.stats.orphanQvds} tone="warn" />
            <StatCard icon={CopyIcon} label="Doublons extract." value={data.stats.duplicateExtractions} tone="warn" />
            <StatCard icon={AlertTriangle} label="QVD externes" value={data.stats.externalQvds} tone="info" />
          </div>

          {/* Sous-onglets */}
          <div className="flex gap-1 border-b border-line">
            {[
              ['synthese', '📊 Synthèse'],
              ['qvds', `QVD (${data.qvds.length})`],
              ['graph', 'Graphe de flux'],
              ['problemes', `⚠ Problèmes (${problemCount})`],
              ['apps', `Apps (${data.apps.length})`],
              ['taches', '⏱ Tâches & planification'],
              ['gouvernance', '🛡 Gouvernance'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${view === id ? 'border-accent text-accent-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Graphe — filtré par stream pour rester fluide */}
          {view === 'graph' && (() => {
            const streams = [...new Set(data.apps.map(a => a.stream || '(non publiée)'))].sort();

            // Filtrage par stream : apps du stream + leurs QVD + apps connectées à ces QVD
            let g = data.graph;
            if (graphStream) {
              const streamApps = new Set(
                data.apps.filter(a => (a.stream || '(non publiée)') === graphStream).map(a => `app:${a.appId}`)
              );
              const qvdIds = new Set(
                data.graph.edges.filter(e => streamApps.has(e.from) || streamApps.has(e.to))
                  .map(e => e.from.startsWith('qvd:') ? e.from : e.to)
                  .filter(id => id.startsWith('qvd:'))
              );
              const keep = new Set([...streamApps, ...qvdIds]);
              for (const e of data.graph.edges) {
                if (qvdIds.has(e.from) && e.to.startsWith('app:')) keep.add(e.to);
                if (qvdIds.has(e.to) && e.from.startsWith('app:')) keep.add(e.from);
              }
              g = {
                nodes: data.graph.nodes.filter(n => keep.has(n.id)),
                edges: data.graph.edges.filter(e => keep.has(e.from) && keep.has(e.to))
              };
            }

            const tooBig = g.nodes.length > 150 && !forceGraph;
            return (
              <>
                <div className="flex items-center gap-2">
                  <select value={graphStream} onChange={e => { setGraphStream(e.target.value); setForceGraph(false); }}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Tous les streams ({data.graph.nodes.length} nœuds)</option>
                    {streams.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <span className="text-[10px] text-ink-faint">{g.nodes.length} nœuds · {g.edges.length} liens</span>
                </div>
                <div className="flex gap-4 text-[10px] text-ink-muted">
                  <span><span className="text-violet">■</span> App batch (génère des QVD)</span>
                  <span><span className="text-warn">■</span> App transform (lit + écrit)</span>
                  <span><span className="text-accent-ink">■</span> App front (consomme)</span>
                  <span><span className="text-danger">◌</span> QVD orphelin</span>
                  <span><span className="text-warn">◌</span> QVD externe (producteur inconnu)</span>
                </div>
                {tooBig ? (
                  <div className="border border-line rounded-lg p-8 text-center space-y-3 bg-canvas">
                    <p className="text-xs text-ink-muted">
                      ⚠ {g.nodes.length} nœuds — le rendu du graphe complet gèlerait l'interface.
                      <br />Choisis un <span className="text-accent-ink">stream</span> ci-dessus pour un graphe lisible.
                    </p>
                    <button onClick={() => setForceGraph(true)}
                      className="text-[10px] px-3 py-1.5 bg-raised hover:bg-raised text-ink rounded">
                      Afficher quand même (peut être lent)
                    </button>
                  </div>
                ) : (
                  <GlobalGraph graph={g} />
                )}
              </>
            );
          })()}

          {/* Synthèse — classements chiffrés orientés décision */}
          {view === 'synthese' && <SyntheseTab data={data} />}

          {/* Table QVD — recherche + filtre statut + détail dépliable */}
          {view === 'qvds' && (() => {
            const q = qvdSearch.trim().toLowerCase();
            const parentFolder = (name) => {
              const s = String(name || '');
              const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
              return idx > 0 ? s.slice(0, idx) : '(sans dossier)';
            };
            const folders = [...new Set(data.qvds.map(x => parentFolder(x.name)))].sort();
            const streams = [...new Set(data.qvds.flatMap(x =>
              [...x.producers, ...x.consumers].map(a => a.stream || '(non publiée)')
            ))].sort();

            const filteredQvds = data.qvds.filter(x => {
              if (q && !x.name.toLowerCase().includes(q) &&
                  !x.producers.some(p => p.appName.toLowerCase().includes(q)) &&
                  !x.consumers.some(c => c.appName.toLowerCase().includes(q))) return false;
              if (qvdStatus && x.status !== qvdStatus) return false;
              if (qvdFolder && parentFolder(x.name) !== qvdFolder) return false;
              if (qvdStream) {
                const has = [...x.producers, ...x.consumers].some(a => (a.stream || '(non publiée)') === qvdStream);
                if (!has) return false;
              }
              if (qvdConsumers) {
                const n = x.consumers.length;
                if (qvdConsumers === '0' && n !== 0) return false;
                if (qvdConsumers === '1' && n !== 1) return false;
                if (qvdConsumers === '2+' && n < 2) return false;
                if (qvdConsumers === '5+' && n < 5) return false;
              }
              return true;
            });

            if (qvdSort === 'consumers') filteredQvds.sort((a, b) => b.consumers.length - a.consumers.length || a.name.localeCompare(b.name));
            else if (qvdSort === 'producers') filteredQvds.sort((a, b) => b.producers.length - a.producers.length || a.name.localeCompare(b.name));

            const resetFilters = () => {
              setQvdSearch(''); setQvdStatus(''); setQvdFolder('');
              setQvdStream(''); setQvdConsumers(''); setQvdSort('name');
            };
            const hasActiveFilter = qvdSearch || qvdStatus || qvdFolder || qvdStream || qvdConsumers || qvdSort !== 'name';

            return (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 max-w-xs min-w-[180px]">
                    <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
                    <input value={qvdSearch} onChange={e => setQvdSearch(e.target.value)}
                      placeholder="Chercher un QVD ou une app..."
                      className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
                  </div>
                  <select value={qvdStatus} onChange={e => setQvdStatus(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Tous statuts</option>
                    <option value="ok">ok</option>
                    <option value="orphelin">orphelin</option>
                    <option value="externe">externe</option>
                  </select>
                  <select value={qvdFolder} onChange={e => setQvdFolder(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink max-w-[240px] truncate"
                    title={qvdFolder}>
                    <option value="">Tous dossiers ({folders.length})</option>
                    {folders.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select value={qvdStream} onChange={e => setQvdStream(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Tous streams</option>
                    {streams.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={qvdConsumers} onChange={e => setQvdConsumers(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Nb conso.</option>
                    <option value="0">0 (orphelin)</option>
                    <option value="1">1</option>
                    <option value="2+">2+</option>
                    <option value="5+">5+</option>
                  </select>
                  <select value={qvdSort} onChange={e => setQvdSort(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="name">Trier: nom</option>
                    <option value="consumers">Trier: + consommé</option>
                    <option value="producers">Trier: + produit</option>
                  </select>
                  {hasActiveFilter && (
                    <button onClick={resetFilters}
                      className="text-[10px] px-2 py-1.5 bg-raised hover:bg-raised text-ink-muted rounded">
                      Reset
                    </button>
                  )}
                  <span className="text-[10px] text-ink-faint">{filteredQvds.length} QVD</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-canvas">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="py-2 pr-1 w-4"></th>
                      <th className="py-2 pr-3">QVD</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2 pr-3">Générée par</th>
                      <th className="py-2 pr-3">Consommée par</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredQvds.map(x => (
                      <React.Fragment key={x.name}>
                        <tr className="hover:bg-raised cursor-pointer"
                          onClick={() => setExpandedQvd(expandedQvd === x.name ? null : x.name)}>
                          <td className="py-2 pr-1 text-ink-faint">
                            {expandedQvd === x.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </td>
                          <td className="py-2 pr-3 font-mono text-info">{x.name}</td>
                          <td className="py-2 pr-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              x.status === 'orphelin' ? 'bg-danger-soft text-danger' :
                              x.status === 'externe' ? 'bg-warn-soft text-warn' :
                              'bg-accent-soft text-accent-ink'}`}>
                              {x.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3"><AppChips list={x.producers} /></td>
                          <td className="py-2 pr-3"><AppChips list={x.consumers} /></td>
                        </tr>
                        {expandedQvd === x.name && (
                          <tr className="bg-surface">
                            <td></td>
                            <td colSpan={4} className="py-2.5 pr-3">
                              <div className="grid grid-cols-2 gap-4 text-[11px]">
                                <div>
                                  <div className="text-ink-muted uppercase text-[9px] tracking-wider mb-1">
                                    💾 Générée par ({x.producers.length})
                                  </div>
                                  {x.producers.length ? x.producers.map((p, i) => (
                                    <div key={i} className="mb-1">
                                      <span className="text-violet">{p.appName}</span>
                                      {p.stream && <span className="text-ink-faint"> · {p.stream}</span>}
                                      <div className="text-ink-muted">table <span className="font-mono text-ink-muted">{p.tableName}</span></div>
                                      {p.path && <div className="font-mono text-[10px] text-ink-faint">{p.path}</div>}
                                    </div>
                                  )) : <span className="text-ink-faint">producteur inconnu — app batch non importée ou source externe</span>}
                                </div>
                                <div>
                                  <div className="text-ink-muted uppercase text-[9px] tracking-wider mb-1">
                                    📥 Consommée par ({x.consumers.length})
                                  </div>
                                  {x.consumers.length ? x.consumers.map((c, i) => (
                                    <div key={i} className="mb-1">
                                      <span className="text-accent-ink">{c.appName}</span>
                                      {c.stream && <span className="text-ink-faint"> · {c.stream}</span>}
                                      {c.tables?.length > 0 && (
                                        <div className="text-ink-muted">dans : <span className="font-mono text-ink-muted">{c.tables.join(', ')}</span></div>
                                      )}
                                    </div>
                                  )) : <span className="text-ink-faint">personne — candidat à la suppression</span>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })()}

          {/* Tâches & planification */}
          {view === 'taches' && <TasksTab />}

          {/* Gouvernance serveur */}
          {view === 'gouvernance' && <GovernanceTab />}

          {/* Problèmes */}
          {view === 'problemes' && (
            <div className="space-y-5">
              <section>
                <h4 className="text-xs font-semibold text-danger mb-2 flex items-center gap-1.5">
                  <FileWarning size={13} /> QVD orphelins ({data.orphans.length}) — générés mais jamais consommés
                </h4>
                {data.orphans.length === 0 ? <p className="text-xs text-ink-faint">Aucun 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.orphans.map(q => (
                      <div key={q.name} className="text-xs bg-danger-soft border border-danger rounded px-3 py-2">
                        <span className="font-mono text-danger">{q.name}</span>
                        <span className="text-ink-muted"> — écrit par {q.producers.map(p => p.appName).join(', ')}</span>
                        {q.paths[0] && <div className="text-[10px] text-ink-faint font-mono mt-0.5">{q.paths[0]}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-warn mb-2 flex items-center gap-1.5">
                  <CopyIcon size={13} /> Extractions dupliquées ({data.duplicateExtractions.length}) — même table SQL tirée par plusieurs apps
                </h4>
                {data.duplicateExtractions.length === 0 ? <p className="text-xs text-ink-faint">Aucune 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.duplicateExtractions.map(d => (
                      <div key={d.table} className="text-xs bg-warn-soft border border-warn rounded px-3 py-2">
                        <span className="font-mono text-warn">{d.table}</span>
                        <span className="text-ink-muted"> extraite par : </span>
                        <AppChips list={d.apps} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-warn mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> QVD écrits par plusieurs apps ({data.multiProduced.length}) — risque d'écrasement
                </h4>
                {data.multiProduced.length === 0 ? <p className="text-xs text-ink-faint">Aucun 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.multiProduced.map(q => (
                      <div key={q.name} className="text-xs bg-warn-soft border border-warn rounded px-3 py-2">
                        <span className="font-mono text-warn">{q.name}</span>
                        <span className="text-ink-muted"> écrit par : </span>
                        <AppChips list={q.producers} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-ink-muted mb-2 flex items-center gap-1.5">
                  <Database size={13} /> QVD externes ({data.externals.length}) — consommés mais producteur non identifié
                </h4>
                <p className="text-[10px] text-ink-faint mb-2">Soit l'app batch qui les génère n'est pas encore importée, soit ils viennent d'un autre système.</p>
                {data.externals.length === 0 ? <p className="text-xs text-ink-faint">Aucun</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.externals.map(q => (
                      <span key={q.name} className="text-[10px] font-mono px-2 py-1 bg-surface border border-line rounded text-ink-muted">{q.name}</span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Apps — filtres administratifs (publiée, stream, rôle) + métadonnées QRS */}
          {view === 'apps' && (() => {
            const orphanNames = new Set(data.orphans.map(q => q.name));
            const streams = [...new Set(data.apps.map(a => a.stream || '(non publiée)'))].sort();
            const q = appSearch.trim().toLowerCase();
            const filteredApps = data.apps.filter(a => {
              if (q && !`${a.appName} ${a.owner || ''}`.toLowerCase().includes(q)) return false;
              if (appStream && (a.stream || '(non publiée)') !== appStream) return false;
              if (appPublished === 'oui' && !a.published) return false;
              if (appPublished === 'non' && a.published) return false;
              if (appRole && a.role !== appRole) return false;
              return true;
            }).map(a => ({
              ...a,
              orphansProduced: a.producedQvds.filter(x => orphanNames.has(x)).length
            })).sort((a, b) => b.orphansProduced - a.orphansProduced);

            return (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 max-w-xs min-w-[180px]">
                    <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
                    <input value={appSearch} onChange={e => setAppSearch(e.target.value)}
                      placeholder="Chercher app ou propriétaire..."
                      className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
                  </div>
                  <select value={appStream} onChange={e => setAppStream(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Tous les streams</option>
                    {streams.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <select value={appPublished} onChange={e => setAppPublished(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Publiée ou non</option>
                    <option value="oui">Publiées</option>
                    <option value="non">Non publiées</option>
                  </select>
                  <select value={appRole} onChange={e => setAppRole(e.target.value)}
                    className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                    <option value="">Tous rôles</option>
                    <option value="batch">batch</option>
                    <option value="transform">transform</option>
                    <option value="front">front</option>
                    <option value="autonome">autonome</option>
                  </select>
                  <span className="text-[10px] text-ink-faint">{filteredApps.length} app(s) — triées par orphelins produits</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-canvas">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="py-2 pr-3">Application</th>
                      <th className="py-2 pr-3">Stream</th>
                      <th className="py-2 pr-3">Publiée</th>
                      <th className="py-2 pr-3">Rôle</th>
                      <th className="py-2 pr-3">Propriétaire</th>
                      <th className="py-2 pr-3">Dernier reload</th>
                      <th className="py-2 pr-3 text-right">QVD gén.</th>
                      <th className="py-2 pr-3 text-right">dont orphelins</th>
                      <th className="py-2 pr-3 text-right">QVD cons.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredApps.map(a => (
                      <tr key={a.appId} className={!a.analyzed ? 'opacity-50' : ''}>
                        <td className="py-2 pr-3 text-ink max-w-[200px] truncate" title={a.appName}>{a.appName}</td>
                        <td className="py-2 pr-3 text-ink-muted">{a.stream || '—'}</td>
                        <td className="py-2 pr-3">
                          {a.published
                            ? <span className="text-[9px] px-1.5 py-0.5 bg-accent-soft text-accent-ink rounded">publiée</span>
                            : <span className="text-[9px] px-1.5 py-0.5 bg-raised text-ink-muted rounded">privée</span>}
                        </td>
                        <td className="py-2 pr-3"><RoleBadge role={a.role} /></td>
                        <td className="py-2 pr-3 text-ink-muted text-[10px] max-w-[130px] truncate" title={a.owner || ''}>{a.owner || '—'}</td>
                        <td className="py-2 pr-3 text-ink-muted text-[10px]">
                          {a.lastReload ? new Date(a.lastReload).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-violet">{a.producedQvds.length || '—'}</td>
                        <td className={`py-2 pr-3 text-right font-mono ${a.orphansProduced > 0 ? 'text-danger font-bold' : 'text-ink-faint'}`}>
                          {a.orphansProduced || '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-accent-ink">{a.consumedQvds.length || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })()}
        </>
      )}

      {showImport && (
        <QlikImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { load(); onAppsChanged?.(); }}
        />
      )}
    </div>
  );
}
