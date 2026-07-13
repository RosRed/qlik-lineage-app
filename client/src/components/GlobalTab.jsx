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
  if (!nodes.length) return <div className="p-8 text-center text-xs text-gray-600">Aucune donnée de graphe — importe ou analyse des apps d'abord.</div>;
  return (
    <div style={{ height: 420 }} className="border border-gray-800 rounded-lg overflow-hidden bg-gray-950">
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
    default: 'border-gray-800 text-gray-200',
    warn:    value > 0 ? 'border-red-800/60 text-red-400' : 'border-gray-800 text-gray-200',
    info:    value > 0 ? 'border-yellow-800/60 text-yellow-400' : 'border-gray-800 text-gray-200',
  };
  return (
    <div className={`bg-gray-900/60 border rounded-lg px-4 py-3 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
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
  if (!list?.length) return <span className="text-gray-700">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((a, i) => (
        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded whitespace-nowrap">
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
    return <div className="flex-1 flex items-center justify-center text-gray-600"><Loader2 className="animate-spin mr-2" size={16} /> <span className="text-xs">Construction du lineage global...</span></div>;
  }

  const problemCount = data ? data.orphans.length + data.multiProduced.length + data.duplicateExtractions.length : 0;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Barre d'actions */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Globe size={15} className="text-emerald-400" /> Lineage global — toutes applications
        </h3>
        <div className="flex-1" />
        <button onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded">
          <Server size={12} /> Importer du serveur Qlik
        </button>
        <a href={globalApi.exportUrl()} download
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 rounded">
          <Download size={12} /> CSV
        </a>
        <button onClick={load} className="p-1.5 text-gray-500 hover:text-gray-200" title="Rafraîchir">
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
          className="p-1.5 text-gray-600 hover:text-red-400" title="Réinitialiser la base locale (sauvegarde auto)">
          <Trash2 size={13} />
        </button>
      </div>

      {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{error}</div>}

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
          <div className="flex gap-1 border-b border-gray-800">
            {[
              ['synthese', '📊 Synthèse'],
              ['qvds', `QVD (${data.qvds.length})`],
              ['graph', 'Graphe de flux'],
              ['problemes', `⚠ Problèmes (${problemCount})`],
              ['apps', `Apps (${data.apps.length})`],
              ['taches', '⏱ Tâches & planification'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${view === id ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
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
                    className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
                    <option value="">Tous les streams ({data.graph.nodes.length} nœuds)</option>
                    {streams.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <span className="text-[10px] text-gray-600">{g.nodes.length} nœuds · {g.edges.length} liens</span>
                </div>
                <div className="flex gap-4 text-[10px] text-gray-500">
                  <span><span className="text-violet-400">■</span> App batch (génère des QVD)</span>
                  <span><span className="text-yellow-400">■</span> App transform (lit + écrit)</span>
                  <span><span className="text-emerald-400">■</span> App front (consomme)</span>
                  <span><span className="text-red-400">◌</span> QVD orphelin</span>
                  <span><span className="text-yellow-400">◌</span> QVD externe (producteur inconnu)</span>
                </div>
                {tooBig ? (
                  <div className="border border-gray-800 rounded-lg p-8 text-center space-y-3 bg-gray-950">
                    <p className="text-xs text-gray-400">
                      ⚠ {g.nodes.length} nœuds — le rendu du graphe complet gèlerait l'interface.
                      <br />Choisis un <span className="text-emerald-400">stream</span> ci-dessus pour un graphe lisible.
                    </p>
                    <button onClick={() => setForceGraph(true)}
                      className="text-[10px] px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded">
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
            const filteredQvds = data.qvds.filter(x => {
              if (q && !x.name.toLowerCase().includes(q) &&
                  !x.producers.some(p => p.appName.toLowerCase().includes(q)) &&
                  !x.consumers.some(c => c.appName.toLowerCase().includes(q))) return false;
              if (qvdStatus && x.status !== qvdStatus) return false;
              return true;
            });
            return (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-xs">
                    <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
                    <input value={qvdSearch} onChange={e => setQvdSearch(e.target.value)}
                      placeholder="Chercher un QVD ou une app..."
                      className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
                  </div>
                  <select value={qvdStatus} onChange={e => setQvdStatus(e.target.value)}
                    className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
                    <option value="">Tous statuts</option>
                    <option value="ok">ok</option>
                    <option value="orphelin">orphelin</option>
                    <option value="externe">externe</option>
                  </select>
                  <span className="text-[10px] text-gray-600">{filteredQvds.length} QVD</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-950">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                      <th className="py-2 pr-1 w-4"></th>
                      <th className="py-2 pr-3">QVD</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2 pr-3">Générée par</th>
                      <th className="py-2 pr-3">Consommée par</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {filteredQvds.map(x => (
                      <React.Fragment key={x.name}>
                        <tr className="hover:bg-gray-900/40 cursor-pointer"
                          onClick={() => setExpandedQvd(expandedQvd === x.name ? null : x.name)}>
                          <td className="py-2 pr-1 text-gray-600">
                            {expandedQvd === x.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </td>
                          <td className="py-2 pr-3 font-mono text-cyan-300">{x.name}</td>
                          <td className="py-2 pr-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              x.status === 'orphelin' ? 'bg-red-900/40 text-red-400' :
                              x.status === 'externe' ? 'bg-yellow-900/30 text-yellow-400' :
                              'bg-emerald-900/30 text-emerald-400'}`}>
                              {x.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3"><AppChips list={x.producers} /></td>
                          <td className="py-2 pr-3"><AppChips list={x.consumers} /></td>
                        </tr>
                        {expandedQvd === x.name && (
                          <tr className="bg-gray-900/30">
                            <td></td>
                            <td colSpan={4} className="py-2.5 pr-3">
                              <div className="grid grid-cols-2 gap-4 text-[11px]">
                                <div>
                                  <div className="text-gray-500 uppercase text-[9px] tracking-wider mb-1">
                                    💾 Générée par ({x.producers.length})
                                  </div>
                                  {x.producers.length ? x.producers.map((p, i) => (
                                    <div key={i} className="mb-1">
                                      <span className="text-violet-300">{p.appName}</span>
                                      {p.stream && <span className="text-gray-600"> · {p.stream}</span>}
                                      <div className="text-gray-500">table <span className="font-mono text-gray-400">{p.tableName}</span></div>
                                      {p.path && <div className="font-mono text-[10px] text-gray-600">{p.path}</div>}
                                    </div>
                                  )) : <span className="text-gray-600">producteur inconnu — app batch non importée ou source externe</span>}
                                </div>
                                <div>
                                  <div className="text-gray-500 uppercase text-[9px] tracking-wider mb-1">
                                    📥 Consommée par ({x.consumers.length})
                                  </div>
                                  {x.consumers.length ? x.consumers.map((c, i) => (
                                    <div key={i} className="mb-1">
                                      <span className="text-emerald-300">{c.appName}</span>
                                      {c.stream && <span className="text-gray-600"> · {c.stream}</span>}
                                      {c.tables?.length > 0 && (
                                        <div className="text-gray-500">dans : <span className="font-mono text-gray-400">{c.tables.join(', ')}</span></div>
                                      )}
                                    </div>
                                  )) : <span className="text-gray-600">personne — candidat à la suppression</span>}
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

          {/* Problèmes */}
          {view === 'problemes' && (
            <div className="space-y-5">
              <section>
                <h4 className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1.5">
                  <FileWarning size={13} /> QVD orphelins ({data.orphans.length}) — générés mais jamais consommés
                </h4>
                {data.orphans.length === 0 ? <p className="text-xs text-gray-600">Aucun 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.orphans.map(q => (
                      <div key={q.name} className="text-xs bg-red-900/10 border border-red-900/30 rounded px-3 py-2">
                        <span className="font-mono text-red-300">{q.name}</span>
                        <span className="text-gray-500"> — écrit par {q.producers.map(p => p.appName).join(', ')}</span>
                        {q.paths[0] && <div className="text-[10px] text-gray-600 font-mono mt-0.5">{q.paths[0]}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-orange-400 mb-2 flex items-center gap-1.5">
                  <CopyIcon size={13} /> Extractions dupliquées ({data.duplicateExtractions.length}) — même table SQL tirée par plusieurs apps
                </h4>
                {data.duplicateExtractions.length === 0 ? <p className="text-xs text-gray-600">Aucune 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.duplicateExtractions.map(d => (
                      <div key={d.table} className="text-xs bg-orange-900/10 border border-orange-900/30 rounded px-3 py-2">
                        <span className="font-mono text-orange-300">{d.table}</span>
                        <span className="text-gray-500"> extraite par : </span>
                        <AppChips list={d.apps} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-yellow-400 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> QVD écrits par plusieurs apps ({data.multiProduced.length}) — risque d'écrasement
                </h4>
                {data.multiProduced.length === 0 ? <p className="text-xs text-gray-600">Aucun 🎉</p> : (
                  <div className="space-y-1.5">
                    {data.multiProduced.map(q => (
                      <div key={q.name} className="text-xs bg-yellow-900/10 border border-yellow-900/30 rounded px-3 py-2">
                        <span className="font-mono text-yellow-300">{q.name}</span>
                        <span className="text-gray-500"> écrit par : </span>
                        <AppChips list={q.producers} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
                  <Database size={13} /> QVD externes ({data.externals.length}) — consommés mais producteur non identifié
                </h4>
                <p className="text-[10px] text-gray-600 mb-2">Soit l'app batch qui les génère n'est pas encore importée, soit ils viennent d'un autre système.</p>
                {data.externals.length === 0 ? <p className="text-xs text-gray-600">Aucun</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.externals.map(q => (
                      <span key={q.name} className="text-[10px] font-mono px-2 py-1 bg-gray-900 border border-gray-800 rounded text-gray-400">{q.name}</span>
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
                    <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
                    <input value={appSearch} onChange={e => setAppSearch(e.target.value)}
                      placeholder="Chercher app ou propriétaire..."
                      className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
                  </div>
                  <select value={appStream} onChange={e => setAppStream(e.target.value)}
                    className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
                    <option value="">Tous les streams</option>
                    {streams.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <select value={appPublished} onChange={e => setAppPublished(e.target.value)}
                    className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
                    <option value="">Publiée ou non</option>
                    <option value="oui">Publiées</option>
                    <option value="non">Non publiées</option>
                  </select>
                  <select value={appRole} onChange={e => setAppRole(e.target.value)}
                    className="bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300">
                    <option value="">Tous rôles</option>
                    <option value="batch">batch</option>
                    <option value="transform">transform</option>
                    <option value="front">front</option>
                    <option value="autonome">autonome</option>
                  </select>
                  <span className="text-[10px] text-gray-600">{filteredApps.length} app(s) — triées par orphelins produits</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-950">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
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
                  <tbody className="divide-y divide-gray-800/50">
                    {filteredApps.map(a => (
                      <tr key={a.appId} className={!a.analyzed ? 'opacity-50' : ''}>
                        <td className="py-2 pr-3 text-gray-200 max-w-[200px] truncate" title={a.appName}>{a.appName}</td>
                        <td className="py-2 pr-3 text-gray-500">{a.stream || '—'}</td>
                        <td className="py-2 pr-3">
                          {a.published
                            ? <span className="text-[9px] px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded">publiée</span>
                            : <span className="text-[9px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">privée</span>}
                        </td>
                        <td className="py-2 pr-3"><RoleBadge role={a.role} /></td>
                        <td className="py-2 pr-3 text-gray-500 text-[10px] max-w-[130px] truncate" title={a.owner || ''}>{a.owner || '—'}</td>
                        <td className="py-2 pr-3 text-gray-500 text-[10px]">
                          {a.lastReload ? new Date(a.lastReload).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-violet-300">{a.producedQvds.length || '—'}</td>
                        <td className={`py-2 pr-3 text-right font-mono ${a.orphansProduced > 0 ? 'text-red-400 font-bold' : 'text-gray-600'}`}>
                          {a.orphansProduced || '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-emerald-300/80">{a.consumedQvds.length || '—'}</td>
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
