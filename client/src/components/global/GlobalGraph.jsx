import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap, MarkerType, Position } from 'reactflow';
import dagre from '@dagrejs/dagre';
import 'reactflow/dist/style.css';
import { EmptyState } from '../ui/primitives';
import { Network } from 'lucide-react';

/*
 * Graphe de flux apps ↔ QVD. Extrait de GlobalTab.jsx.
 *
 * Note : les couleurs sont en hexadécimal car ReactFlow applique des styles
 * inline et ne peut pas consommer les classes Tailwind. Elles sont calées sur
 * le thème sombre ; leur passage aux variables CSS fait partie de la phase 2.
 */

export const ROLE_COLORS = {
  batch:     { bg: 'rgba(139,92,246,.15)', border: '#8b5cf6', text: '#a78bfa', label: 'BATCH' },
  transform: { bg: 'rgba(245,158,11,.15)', border: '#f59e0b', text: '#fbbf24', label: 'TRANSFORM' },
  front:     { bg: 'rgba(16,185,129,.15)', border: '#10b981', text: '#34d399', label: 'FRONT' },
  autonome:  { bg: 'rgba(107,114,128,.15)', border: '#6b7280', text: '#9ca3af', label: 'AUTONOME' },
  inconnu:   { bg: 'rgba(107,114,128,.1)',  border: '#4b5563', text: '#6b7280', label: '?' }
};

export const QVD_COLORS = {
  ok:       { border: '#0891b2', text: '#22d3ee' },
  orphelin: { border: '#dc2626', text: '#f87171' },
  externe:  { border: '#ca8a04', text: '#facc15' }
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
              {isApp
                ? `📱 ${(ROLE_COLORS[n.role] || ROLE_COLORS.inconnu).label}`
                : n.status === 'orphelin' ? '💾 QVD ⚠ ORPHELIN'
                : n.status === 'externe' ? '💾 QVD (externe)'
                : '💾 QVD'}
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
    id: `e${i}`,
    source: e.from,
    target: e.to,
    animated: e.kind === 'store',
    style: { stroke: e.kind === 'store' ? '#8b5cf6' : '#10b981', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === 'store' ? '#8b5cf6' : '#10b981' }
  }));

  return { nodes, edges };
}

export default function GlobalGraph({ graph, height = 560 }) {
  const { nodes, edges } = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);

  if (!nodes.length) {
    return (
      <EmptyState
        icon={Network}
        title="Aucune donnée de graphe"
        description="Importez ou analysez des applications pour voir apparaître les flux."
      />
    );
  }

  return (
    <div style={{ height }} className="border border-line rounded-xl overflow-hidden bg-surface">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#1f2937" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ background: '#0b0f19' }} maskColor="rgba(0,0,0,.6)" nodeColor="#374151" />
      </ReactFlow>
    </div>
  );
}
