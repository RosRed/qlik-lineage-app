import React, { useMemo, useEffect, useState, useCallback } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  MarkerType, Position, Handle, Panel
} from 'reactflow';
import dagre from '@dagrejs/dagre';
import 'reactflow/dist/style.css';

// ─── Layout ───────────────────────────────────────────────────────────────────

const NODE_W  = 250;
const NODE_H  = 108;

function applyDagreLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 180, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map(n => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }, targetPosition: Position.Left, sourcePosition: Position.Right };
  });
}

// ─── Styles injectés une fois ─────────────────────────────────────────────────

const CSS = `
.ln-node {
  width:${NODE_W}px; min-height:${NODE_H}px;
  background:#111827; border:1px solid #374151; border-radius:10px;
  overflow:hidden; font-family:'Inter',sans-serif;
  box-shadow:0 2px 10px rgba(0,0,0,.5);
  transition:box-shadow .15s, border-color .15s;
  cursor:pointer;
}
.ln-node:hover { box-shadow:0 4px 20px rgba(0,0,0,.7); border-color:#6b7280; }
.ln-node.selected { border-color:#f59e0b; box-shadow:0 0 0 2px rgba(245,158,11,.35); }

/* headers */
.ln-hdr { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; border-bottom:1px solid; }
.ln-hdr.source  { background:rgba(139,92,246,.18);  color:#a78bfa; border-bottom-color:rgba(139,92,246,.25); }
.ln-hdr.fact    { background:rgba(16,185,129,.15);  color:#34d399; border-bottom-color:rgba(16,185,129,.22); }
.ln-hdr.dim     { background:rgba(59,130,246,.15);  color:#60a5fa; border-bottom-color:rgba(59,130,246,.22); }
.ln-hdr.mapping { background:rgba(245,158,11,.15);  color:#fbbf24; border-bottom-color:rgba(245,158,11,.22); }
.ln-hdr.temp    { background:rgba(107,114,128,.12); color:#9ca3af; border-bottom-color:rgba(107,114,128,.18); }
.ln-hdr.output  { background:rgba(6,182,212,.13);  color:#22d3ee; border-bottom-color:rgba(6,182,212,.22); }

/* load badge */
.ln-badge {
  font-size:9px; font-weight:600; padding:2px 6px; border-radius:4px; letter-spacing:.05em;
}
.ln-badge.qvd         { background:rgba(16,185,129,.2);  color:#34d399; }
.ln-badge.sql         { background:rgba(59,130,246,.2);  color:#60a5fa; }
.ln-badge.excel       { background:rgba(34,197,94,.2);   color:#4ade80; }
.ln-badge.csv         { background:rgba(234,179,8,.2);   color:#facc15; }
.ln-badge.resident    { background:rgba(168,85,247,.2);  color:#c084fc; }
.ln-badge.inline      { background:rgba(107,114,128,.2); color:#9ca3af; }
.ln-badge.autogenerate{ background:rgba(107,114,128,.2); color:#9ca3af; }
.ln-badge.unknown     { background:rgba(107,114,128,.15);color:#6b7280; }

.ln-name { padding:8px 10px 3px; font-size:12px; font-weight:700; color:#f3f4f6; font-family:'JetBrains Mono',monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ln-path { padding:0 10px 4px; font-size:9px; color:#6b7280; font-family:'JetBrains Mono',monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ln-stats{ padding:3px 10px 8px; font-size:10px; color:#6b7280; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ln-key  { background:rgba(251,191,36,.12); color:#fbbf24; border:1px solid rgba(251,191,36,.25); border-radius:3px; padding:1px 5px; font-size:9px; }
.ln-synth{ background:rgba(239,68,68,.12);  color:#f87171; border:1px solid rgba(239,68,68,.25);  border-radius:3px; padding:1px 5px; font-size:9px; }
.ln-calc { background:rgba(251,146,60,.12); color:#fb923c; border:1px solid rgba(251,146,60,.25); border-radius:3px; padding:1px 5px; font-size:9px; }

.ln-handle { width:8px !important; height:8px !important; background:#374151 !important; border:1.5px solid #6b7280 !important; }

/* réinitialisation React Flow */
.react-flow__background { background:#030712 !important; }
.react-flow__controls { background:#0f172a !important; border:1px solid #1f2937 !important; border-radius:8px; overflow:hidden; }
.react-flow__controls-button { background:#0f172a !important; border-color:#1f2937 !important; color:#6b7280 !important; }
.react-flow__controls-button:hover { background:#1f2937 !important; }
.react-flow__minimap { border:1px solid #1f2937 !important; border-radius:8px; }
.react-flow__edge-label-renderer .react-flow__edge-label { font-size:9px; }
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el);
  cssInjected = true;
}

// ─── Badge méthode de chargement ──────────────────────────────────────────────

const LOAD_LABELS = {
  qvd: '▶ QVD', sql: '🗄 SQL', excel: '📗 Excel', csv: '📄 CSV',
  resident: '♻ Resident', inline: '✎ Inline', autogenerate: '⚙ Auto', unknown: '? Source'
};

function LoadBadge({ method }) {
  const cls   = LOAD_LABELS[method] ? method : 'unknown';
  const label = LOAD_LABELS[cls] || method?.toUpperCase() || '?';
  return <span className={`ln-badge ${cls}`}>{label}</span>;
}

// ─── Nœud SOURCE ─────────────────────────────────────────────────────────────

function SourceNode({ data, selected }) {
  const srcIcons = { qvd: '🟩', sql: '🗄️', excel: '📗', csv: '📄', unknown: '📦' };
  const icon = srcIcons[data.sourceType] || '📦';
  const srcLabel = data.sourceType === 'sql' ? 'SQL DB' : data.sourceType === 'excel' ? 'Excel' : data.sourceType === 'csv' ? 'CSV/Flat' : 'QVD';

  return (
    <div className={`ln-node${selected ? ' selected' : ''}`}>
      <Handle type="source" position={Position.Right} className="ln-handle" />
      <div className="ln-hdr source">
        <span style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:13 }}>{icon}</span>
          <span>{srcLabel}</span>
        </span>
        <LoadBadge method={data.sourceType} />
      </div>
      <div className="ln-name" title={data.label}>{data.label}</div>
      <div className="ln-path" title={data.path || data.connection}>
        {data.path || (data.connection ? `🔌 ${data.connection}` : '—')}
      </div>
      <div className="ln-stats">
        <span>{data.fieldCount || 0} champ{(data.fieldCount || 0) > 1 ? 's' : ''}</span>
        {data.usedBy?.length > 0 && <span>→ {data.usedBy.length} table{data.usedBy.length > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

// ─── Nœud TABLE (FACT / DIM / MAP) ───────────────────────────────────────────

function TableNode({ data, selected }) {
  const configs = {
    fact:    { icon: '🏭', label: 'FACT',    cls: 'fact'    },
    dim:     { icon: '📐', label: 'DIM',     cls: 'dim'     },
    mapping: { icon: '🗺️', label: 'MAPPING', cls: 'mapping' },
    temp:    { icon: '⏳', label: 'TMP',     cls: 'temp'    }
  };
  const { icon, label, cls } = configs[data.tableType] || configs.dim;

  const synthCount = data.synthCount || 0;
  const calcCount  = data.calcCount  || 0;

  return (
    <div className={`ln-node${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left}  className="ln-handle" />
      <Handle type="source" position={Position.Right} className="ln-handle" />
      <div className={`ln-hdr ${cls}`}>
        <span style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:13 }}>{icon}</span>
          <span>{label}</span>
        </span>
        <LoadBadge method={data.loadMethod} />
      </div>
      <div className="ln-name" title={data.label}>{data.label}</div>
      <div className="ln-path" title={data.sourcePath || data.source}>
        {data.sourcePath || data.source || '—'}
      </div>
      <div className="ln-stats">
        <span>{data.fieldCount} champs</span>
        {data.keyCount > 0  && <span className="ln-key">🔑 {data.keyCount}</span>}
        {synthCount > 0     && <span className="ln-synth">⚠️ {synthCount} synth</span>}
        {calcCount  > 0     && <span className="ln-calc">🧮 {calcCount} calc</span>}
      </div>
    </div>
  );
}

// ─── Nœud OUTPUT (QVD écrit via STORE) ───────────────────────────────────────

function OutputNode({ data, selected }) {
  return (
    <div className={`ln-node${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="ln-handle" />
      <div className="ln-hdr output">
        <span style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:13 }}>💾</span>
          <span>QVD OUT</span>
        </span>
        <span className="ln-badge qvd">STORE</span>
      </div>
      <div className="ln-name" title={data.label}>{data.label}</div>
      <div className="ln-path" title={data.outputPath}>{data.outputPath || '—'}</div>
      <div className="ln-stats">
        <span style={{ color:'#6b7280', fontSize:9 }}>← {data.fromTable}</span>
      </div>
    </div>
  );
}

const NODE_TYPES = { sourceNode: SourceNode, tableNode: TableNode, outputNode: OutputNode };

// ─── Construction du graphe ───────────────────────────────────────────────────

function buildGraphData(analysis) {
  const rawNodes = []; const rawEdges = [];
  const nodeSet  = new Set(); const edgeSet = new Set();

  const factsMap   = new Map((analysis.facts    || []).map(t => [t.name, t]));
  const dimsMap    = new Map((analysis.dims     || []).map(t => [t.name, t]));
  const mapsMap    = new Map((analysis.mappings || []).map(t => [t.name, t]));
  const lineage    = analysis.lineage || [];
  const sourceMeta = Object.fromEntries((analysis.sourceMeta || []).map(s => [s.name, s]));

  // Compter synth/calc par table pour les badges
  const synthByTable = {}, calcByTable = {};
  for (const r of lineage) {
    if (r.isSynth)      synthByTable[r.tableQlik] = (synthByTable[r.tableQlik] || 0) + 1;
    if (r.isCalculated) calcByTable[r.tableQlik]  = (calcByTable[r.tableQlik]  || 0) + 1;
  }

  // Nœuds TABLE
  for (const [name, t] of [...factsMap, ...dimsMap, ...mapsMap]) {
    const tableType = factsMap.has(name) ? 'fact' : mapsMap.has(name) ? 'mapping' : 'dim';
    const id = `tbl__${name}`;
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      rawNodes.push({
        id, type: 'tableNode',
        data: {
          label:       name,
          tableType,
          fieldCount:  t.fields?.length || 0,
          keyCount:    t.keys?.length   || 0,
          synthCount:  synthByTable[name] || 0,
          calcCount:   calcByTable[name]  || 0,
          loadMethod:  t.loadMethod   || null,
          sourcePath:  t.sourcePath   || null,
          source:      t.source       || null,
          connection:  t.connection   || null,
          sqlQuery:    t.sqlQuery     || null,
          fieldDetails: t.fieldDetails || []
        }
      });
    }
  }

  // Nœuds SOURCE + arêtes depuis lineage
  const fieldCountPerEdge = {};
  for (const row of lineage) {
    const src = row.tableSource;
    const tbl = row.tableQlik;
    if (!src || src === '—' || !tbl) continue;

    const srcId = `src__${src}`;
    const tblId = `tbl__${tbl}`;
    const eKey  = `${srcId}→${tblId}`;
    fieldCountPerEdge[eKey] = (fieldCountPerEdge[eKey] || 0) + 1;

    if (!nodeSet.has(srcId)) {
      const sm = sourceMeta[src] || {};
      nodeSet.add(srcId);
      rawNodes.push({
        id: srcId, type: 'sourceNode',
        data: {
          label:       src,
          sourceType:  sm.type || (row.loadMethod === 'sql' ? 'sql' : 'qvd'),
          path:        sm.path || row.sourcePath || null,
          connection:  sm.connection || row.connection || null,
          fieldCount:  sm.fieldCount || 0,
          usedBy:      sm.usedBy || []
        }
      });
    }

    if (nodeSet.has(tblId) && !edgeSet.has(eKey)) {
      edgeSet.add(eKey);
      rawEdges.push({
        id: eKey, source: srcId, target: tblId, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: '#4b5563' },
        style: { stroke: '#374151', strokeWidth: 1.5 },
        _eKey: eKey
      });
    }
  }

  // Arêtes RESIDENT (table Qlik → table Qlik)
  for (const row of lineage) {
    if (row.loadMethod !== 'resident' || !row.tableSource || !row.tableQlik) continue;
    const srcId = `tbl__${row.tableSource}`;
    const tblId = `tbl__${row.tableQlik}`;
    if (!nodeSet.has(srcId) || !nodeSet.has(tblId) || srcId === tblId) continue;
    const eKey = `${srcId}→${tblId}`;
    if (!edgeSet.has(eKey)) {
      edgeSet.add(eKey);
      rawEdges.push({
        id: eKey, source: srcId, target: tblId, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: '#6b7280' },
        style: { stroke: '#4b5563', strokeWidth: 1.5, strokeDasharray: '4 3' },
        _eKey: eKey
      });
    }
  }

  // Nœuds OUTPUT (STORE → QVD) + arêtes table → output
  for (const store of (analysis.stores || [])) {
    const tblId = `tbl__${store.tableName}`;
    const outId = `out__${store.outputName}`;

    if (!nodeSet.has(outId)) {
      nodeSet.add(outId);
      rawNodes.push({
        id: outId, type: 'outputNode',
        data: {
          label:      store.outputName,
          outputPath: store.outputPath,
          fromTable:  store.tableName
        }
      });
    }

    if (!edgeSet.has(`${tblId}→${outId}`)) {
      edgeSet.add(`${tblId}→${outId}`);
      rawEdges.push({
        id:     `${tblId}→${outId}`,
        source: nodeSet.has(tblId) ? tblId : rawNodes.find(n => n.data?.label === store.tableName)?.id || tblId,
        target: outId,
        type:   'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: '#0891b2' },
        style:  { stroke: '#0e7490', strokeWidth: 1.5, strokeDasharray: '5 3' },
        label:  'STORE',
        labelStyle: { fontSize: 9, fill: '#22d3ee', fontFamily: 'monospace' },
        labelBgStyle: { fill: '#0f172a', fillOpacity: .85 },
        labelBgBorderRadius: 3,
        labelBgPadding: [3, 4]
      });
    }
  }

  // Ajouter label de champ count aux arêtes
  const edges = rawEdges.map(e => {
    const cnt = fieldCountPerEdge[e._eKey] || 0;
    return {
      ...e,
      label: cnt > 0 ? `${cnt}` : undefined,
      labelStyle: { fontSize: 9, fill: '#6b7280', fontFamily: 'monospace' },
      labelBgStyle: { fill: '#0f172a', fillOpacity: .85 },
      labelBgBorderRadius: 3,
      labelBgPadding: [3, 4]
    };
  });

  // Fallback si aucune arête : connecter tout source → tout table
  if (edges.length === 0 && rawNodes.length > 0) {
    const srcs = rawNodes.filter(n => n.type === 'sourceNode');
    const tbls = rawNodes.filter(n => n.type === 'tableNode');
    srcs.forEach(s => tbls.forEach(t => {
      const id = `${s.id}→${t.id}`;
      edges.push({
        id, source: s.id, target: t.id, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: '#4b5563' },
        style: { stroke: '#374151', strokeWidth: 1.5 }
      });
    }));
  }

  return { rawNodes, edges };
}

// ─── Panel de détail (panneau latéral cliquable) ──────────────────────────────

const LOAD_ICON = { qvd:'🟩', sql:'🗄️', excel:'📗', csv:'📄', resident:'♻️', inline:'✎', autogenerate:'⚙️', unknown:'❓' };

function DetailPanel({ nodeId, analysis, onClose }) {
  if (!nodeId) return null;

  const lineage  = analysis?.lineage || [];
  const isSource = nodeId.startsWith('src__');
  const isOutput = nodeId.startsWith('out__');
  const name = nodeId.replace(/^(src|tbl|out)__/, '');

  const style = {
    position: 'absolute', top: 0, right: 0, width: 310, height: '100%',
    background: 'rgba(9,14,25,.97)', borderLeft: '1px solid #1f2937',
    zIndex: 20, display: 'flex', flexDirection: 'column',
    fontFamily: "'Inter',sans-serif", fontSize: 12
  };
  const hdrStyle = {
    padding: '12px 14px 10px', borderBottom: '1px solid #1f2937',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
  };
  const sectionStyle = {
    padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
    color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid #1f2937', marginTop: 4
  };
  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', padding: '3px 14px',
    borderBottom: '1px solid #0f172a', alignItems: 'flex-start', gap: 8
  };
  const labelS = { color: '#6b7280', flexShrink: 0 };
  const valueS = { color: '#d1d5db', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, wordBreak: 'break-all' };
  const pillStyle = (bg, col, border) => ({
    display: 'inline-block', background: bg, color: col, border: `1px solid ${border}`,
    borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 600, marginLeft: 4
  });

  // ─ OUTPUT panel ─
  if (isOutput) {
    const store = (analysis.stores || []).find(s => s.outputName === name) || {};
    return (
      <div style={style}>
        <div style={hdrStyle}>
          <span style={{ fontWeight: 700, color: '#22d3ee', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>💾</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{name}</span>
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={sectionStyle}>Fichier de sortie (STORE)</div>
          {[
            ['Table source',  store.tableName  || name],
            ['Nom du fichier', store.outputName || name],
            store.outputPath ? ['Chemin complet', store.outputPath] : null,
            ['Format', 'QVD']
          ].filter(Boolean).map(([k, v]) => (
            <div key={k} style={rowStyle}>
              <span style={labelS}>{k}</span>
              <span style={{ ...valueS, maxWidth: 200, wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
          <div style={{ margin: '10px 14px', padding: '8px 10px', background: 'rgba(6,182,212,.07)', border: '1px solid rgba(6,182,212,.2)', borderRadius: 6, fontSize: 10, color: '#67e8f9' }}>
            💾 Ce fichier QVD est <strong>écrit</strong> par le script via la commande <code style={{ background: 'rgba(6,182,212,.1)', padding: '1px 5px', borderRadius: 3 }}>STORE</code>. Il peut être relu par d'autres applications en entrée.
          </div>
        </div>
      </div>
    );
  }

  // ─ SOURCE panel ─
  if (isSource) {
    const sm = (analysis.sourceMeta || []).find(s => s.name === name) || {};
    const rows = lineage.filter(r => r.tableSource === name);
    const byTable = {};
    rows.forEach(r => { if (!byTable[r.tableQlik]) byTable[r.tableQlik] = []; byTable[r.tableQlik].push(r); });
    const icon = LOAD_ICON[sm.type] || '📦';

    return (
      <div style={style}>
        <div style={hdrStyle}>
          <span style={{ fontWeight: 700, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{name}</span>
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={sectionStyle}>Métadonnées</div>
          {[
            ['Type', sm.type?.toUpperCase() || '?'],
            sm.path ? ['Chemin', sm.path] : null,
            sm.connection ? ['Connexion', sm.connection] : null,
            ['Tables cibles', sm.usedBy?.join(', ') || '—'],
            ['Champs alimentés', rows.length]
          ].filter(Boolean).map(([k, v]) => (
            <div key={k} style={rowStyle}>
              <span style={labelS}>{k}</span>
              <span style={valueS}>{v}</span>
            </div>
          ))}

          {Object.entries(byTable).map(([tbl, fields]) => (
            <React.Fragment key={tbl}>
              <div style={{ ...sectionStyle, color: '#34d399' }}>→ {tbl} ({fields.length} champs)</div>
              {fields.map((f, i) => (
                <div key={i} style={{ padding: '2px 14px', borderBottom: '1px solid #0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
                    {f.fieldSource !== '—' && f.fieldSource ? f.fieldSource : f.fieldQlik}
                  </span>
                  <span style={{ color: '#4b5563' }}>→</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: f.isKey ? '#fbbf24' : f.isCalculated ? '#fb923c' : '#e5e7eb' }}>
                    {f.isKey && '🔑 '}{f.fieldQlik}
                  </span>
                  {f.transformation && f.transformation !== 'Direct' && (
                    <span style={{ ...pillStyle('rgba(139,92,246,.12)', '#a78bfa', 'rgba(139,92,246,.25)'), marginLeft: 4, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={f.transformation}>{f.transformation.slice(0, 15)}…</span>
                  )}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  // ─ TABLE panel ─
  const tableData = [
    ...(analysis.facts    || []),
    ...(analysis.dims     || []),
    ...(analysis.mappings || [])
  ].find(t => t.name === name);

  const tableType   = (analysis.facts    || []).find(t => t.name === name) ? 'fact' : (analysis.mappings || []).find(t => t.name === name) ? 'mapping' : 'dim';
  const tableRows   = lineage.filter(r => r.tableQlik === name);
  const synthFields = tableRows.filter(r => r.isSynth);
  const calcFields2 = tableRows.filter(r => r.isCalculated && !r.isSynth);
  const keyFields   = tableRows.filter(r => r.isKey);

  const typeColors = { fact: '#34d399', dim: '#60a5fa', mapping: '#fbbf24' };
  const typeIcons  = { fact: '🏭', dim: '📐', mapping: '🗺️' };
  const tColor     = typeColors[tableType] || '#9ca3af';
  const tIcon      = typeIcons[tableType]  || '📋';

  const fm = tableData?.loadMethod;

  return (
    <div style={style}>
      <div style={hdrStyle}>
        <span style={{ fontWeight: 700, color: tColor, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>{tIcon}</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{name}</span>
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Métadonnées */}
        <div style={sectionStyle}>Métadonnées de chargement</div>
        {[
          ['Type',       tableType.toUpperCase()],
          fm ? ['Méthode',    `${LOAD_ICON[fm] || ''} FROM ${fm.toUpperCase()}`] : null,
          tableData?.sourcePath  ? ['Source',     tableData.sourcePath]  : null,
          tableData?.source && !tableData?.sourcePath ? ['Source', tableData.source] : null,
          tableData?.connection  ? ['Connexion',  tableData.connection]  : null,
          tableData?.residentTable ? ['RESIDENT de', tableData.residentTable] : null,
          ['Champs',     `${tableRows.length} chargés`],
          keyFields.length  ? ['Clés (PK/FK)', keyFields.length]  : null,
          calcFields2.length ? ['Calculés',   calcFields2.length] : null,
          synthFields.length ? ['Synthétiques ⚠️', synthFields.length] : null
        ].filter(Boolean).map(([k, v]) => (
          <div key={k} style={rowStyle}>
            <span style={labelS}>{k}</span>
            <span style={valueS}>{v}</span>
          </div>
        ))}

        {/* Requête SQL */}
        {tableData?.sqlQuery && (
          <>
            <div style={{ ...sectionStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Requête SQL</span>
              <span style={{ color: '#4b5563', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 9 }}>
                {tableData.sqlQuery.length} car.
              </span>
            </div>
            <div style={{ margin: '6px 14px', position: 'relative' }}>
              <pre style={{
                padding: 10,
                background: '#060d1a',
                border: '1px solid #1e3a5f',
                borderRadius: 6,
                fontSize: 10,
                lineHeight: 1.65,
                color: '#7dd3fc',
                /* Scroll vertical complet */
                maxHeight: 320,
                overflowY: 'auto',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                margin: 0,
                scrollbarWidth: 'thin',
                scrollbarColor: '#1e3a5f #060d1a'
              }}>
                {tableData.sqlQuery}
              </pre>
            </div>
          </>
        )}

        {/* Champs */}
        <div style={sectionStyle}>Champs ({tableRows.length})</div>
        {tableRows.map((f, i) => {
          const isKey   = f.isKey;
          const isCalc  = f.isCalculated && !f.isSynth;
          const isSynth = f.isSynth;
          const fieldColor = isKey ? '#fbbf24' : isSynth ? '#f87171' : isCalc ? '#fb923c' : '#d1d5db';

          return (
            <div key={i} style={{ padding: '3px 14px', borderBottom: '1px solid #0f172a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 600, color: fieldColor, display: 'flex', alignItems: 'center', gap: 3 }}>
                  {isKey && '🔑 '}{isSynth && '⚠️ '}{isCalc && '🧮 '}
                  {f.fieldQlik}
                </span>
                {f.dataType && (
                  <span style={{ fontSize: 9, color: '#4b5563', fontStyle: 'italic' }}>{f.dataType}</span>
                )}
              </div>
              {f.fieldSource && f.fieldSource !== '—' && f.fieldSource !== f.fieldQlik && (
                <div style={{ fontSize: 9, color: '#6b7280', paddingLeft: 2 }}>
                  ← <span style={{ color: '#9ca3af', fontFamily: "'JetBrains Mono',monospace" }}>{f.fieldSource}</span>
                  {f.tableSource && f.tableSource !== '—' && <span style={{ color: '#4b5563' }}> ({f.tableSource})</span>}
                </div>
              )}
              {f.transformation && f.transformation !== 'Direct' && (
                <div style={{ fontSize: 9, color: '#7c3aed', paddingLeft: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={f.transformation}>
                  ↳ {f.transformation}
                </div>
              )}
            </div>
          );
        })}

        {/* Alertes */}
        {synthFields.length > 0 && (
          <>
            <div style={{ ...sectionStyle, color: '#f87171' }}>⚠️ Clés synthétiques</div>
            {synthFields.map((f, i) => (
              <div key={i} style={{ padding: '4px 14px', borderBottom: '1px solid #0f172a' }}>
                <div style={{ color: '#fca5a5', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 600 }}>{f.fieldQlik}</div>
                <div style={{ fontSize: 9, color: '#6b7280' }}>Formule : {f.transformation?.replace('Clé synthétique: ', '')}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Légende ──────────────────────────────────────────────────────────────────

function Legend({ stats }) {
  const items = [
    { color: '#a78bfa', label: `Sources (${stats.sources})` },
    { color: '#34d399', label: `Faits (${stats.facts})` },
    { color: '#60a5fa', label: `Dimensions (${stats.dims})` },
    { color: '#fbbf24', label: `Mappings (${stats.mappings})` }
  ];
  if (stats.outputs > 0) items.push({ color: '#22d3ee', label: `Sorties QVD (${stats.outputs})` });

  return (
    <div style={{ background: 'rgba(9,14,25,.95)', border: '1px solid #1f2937', borderRadius: 8, padding: '8px 12px', fontSize: 10, color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 700, color: '#f3f4f6', marginBottom: 2 }}>Légende</div>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
          {label}
        </div>
      ))}
      <div style={{ borderTop: '1px solid #1f2937', paddingTop: 4, marginTop: 2, color: '#4b5563', fontSize: 9 }}>
        Cliquez sur un nœud pour voir les détails
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function LineageGraph({ analysis }) {
  injectCSS();

  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const { rawNodes, edges: rawEdges } = useMemo(() => buildGraphData(analysis), [analysis]);

  const laidOutNodes = useMemo(() => rawNodes.length ? applyDagreLayout(rawNodes, rawEdges) : [], [rawNodes, rawEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(laidOutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  useEffect(() => { setNodes(laidOutNodes); }, [laidOutNodes, setNodes]);
  useEffect(() => { setEdges(rawEdges);    }, [rawEdges, setEdges]);

  const onNodeClick = useCallback((_, node) => {
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
  }, []);

  const nodesWithSelection = useMemo(() =>
    nodes.map(n => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId]
  );

  const stats = {
    sources:  rawNodes.filter(n => n.type === 'sourceNode').length,
    facts:    (analysis.facts    || []).length,
    dims:     (analysis.dims     || []).length,
    mappings: (analysis.mappings || []).length,
    outputs:  rawNodes.filter(n => n.type === 'outputNode').length
  };

  if (rawNodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#030712', color: '#4b5563' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
          <p style={{ fontSize: 13 }}>Aucun nœud à afficher</p>
          <p style={{ fontSize: 11, marginTop: 4 }}>Analysez un script pour voir le graphe de lineage</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNodeId(null)}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a2035" gap={28} size={1} variant="dots" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="bottom-left"
          nodeColor={n => {
            if (n.type === 'sourceNode') return '#7c3aed';
            if (n.type === 'outputNode') return '#0891b2';
            const t = n.data?.tableType;
            return t === 'fact' ? '#059669' : t === 'dim' ? '#2563eb' : t === 'mapping' ? '#d97706' : '#374151';
          }}
          maskColor="rgba(3,7,18,.75)"
          style={{ background: '#0a0f1c', border: '1px solid #1f2937' }}
        />
        <Panel position="top-right"><Legend stats={stats} /></Panel>
        <Panel position="top-left">
          <div style={{ background: 'rgba(9,14,25,.92)', border: '1px solid #1f2937', borderRadius: 8, padding: '5px 12px', fontSize: 10, color: '#6b7280' }}>
            🔗 {rawNodes.length} nœuds · {rawEdges.length} connexions &nbsp;·&nbsp; Scroll: zoom · Drag: déplacer
          </div>
        </Panel>
      </ReactFlow>

      {/* Panel de détail */}
      <DetailPanel
        nodeId={selectedNodeId}
        analysis={analysis}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  );
}
