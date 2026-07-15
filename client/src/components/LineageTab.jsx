import React, { useState, useMemo } from 'react';
import { Download, GitBranch, Info, Search, LayoutDashboard, Table2, Rows3, ChevronDown, ChevronRight } from 'lucide-react';
import LineageGraph from './LineageGraph.jsx';

// ─── Vue groupée par table : table → source → champs ─────────────────────────

const METHOD_BADGE = {
  qvd:      'bg-cyan-900/40 text-cyan-300',
  sql:      'bg-blue-900/40 text-blue-300',
  excel:    'bg-emerald-900/40 text-emerald-300',
  csv:      'bg-emerald-900/40 text-emerald-300',
  file:     'bg-emerald-900/40 text-emerald-300',
  resident: 'bg-gray-800 text-gray-400',
  inline:   'bg-gray-800 text-gray-400',
  autogenerate: 'bg-gray-800 text-gray-400',
};

function GroupedView({ analysis, search }) {
  const [collapsed, setCollapsed] = useState({});
  const lineage = analysis?.lineage || [];
  const factNames = useMemo(() => new Set((analysis?.facts || []).map(f => f.name)), [analysis]);
  const mapNames = useMemo(() => new Set((analysis?.mappings || []).map(m => m.name)), [analysis]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byTable = new Map();
    for (const l of lineage) {
      if (q && !`${l.fieldQlik} ${l.tableQlik} ${l.fieldSource || ''} ${l.tableSource || ''}`.toLowerCase().includes(q)) continue;
      if (!byTable.has(l.tableQlik)) byTable.set(l.tableQlik, []);
      byTable.get(l.tableQlik).push(l);
    }
    return [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lineage, search]);

  if (!groups.length) {
    return <div className="flex items-center justify-center h-32 text-gray-600 text-xs">Aucun résultat</div>;
  }

  return (
    <div className="p-4 space-y-2">
      {groups.map(([table, rows]) => {
        const isCollapsed = collapsed[table];
        const type = factNames.has(table) ? 'FACT' : mapNames.has(table) ? 'MAP' : 'DIM';
        const typeCls = type === 'FACT' ? 'bg-emerald-900/40 text-emerald-300' : type === 'MAP' ? 'bg-violet-900/40 text-violet-300' : 'bg-blue-900/40 text-blue-300';
        // Sources distinctes de la table (plusieurs si joins/concatenate)
        const srcs = [...new Map(rows.map(r => [`${r.tableSource}|${r.loadMethod}`, r])).values()];
        return (
          <div key={table} className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setCollapsed(c => ({ ...c, [table]: !c[table] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-900/70">
              {isCollapsed ? <ChevronRight size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${typeCls}`}>{type}</span>
              <span className="font-mono text-xs text-gray-100 font-semibold">{table}</span>
              <span className="text-[10px] text-gray-600">{rows.length} champ{rows.length !== 1 ? 's' : ''}</span>
              <div className="flex-1" />
              <div className="flex items-center gap-1.5 min-w-0">
                {srcs.slice(0, 3).map((s, i) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${METHOD_BADGE[s.loadMethod] || 'bg-gray-800 text-gray-400'}`}>
                      {s.loadMethod || '?'}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono truncate max-w-[180px]" title={s.sourcePath || s.tableSource}>
                      {s.tableSource}
                    </span>
                  </span>
                ))}
                {srcs.length > 3 && <span className="text-[10px] text-gray-600">+{srcs.length - 3}</span>}
              </div>
            </button>
            {!isCollapsed && (
              <table className="w-full text-xs border-t border-gray-800/60">
                <tbody className="divide-y divide-gray-800/40">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-800/20">
                      <td className="pl-9 pr-3 py-1.5 font-mono text-emerald-300 whitespace-nowrap w-[220px]">
                        {r.fieldQlik}{r.isKey && <span className="ml-1.5 text-[8px] text-yellow-500" title="Clé">🔑</span>}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 w-[20px]">←</td>
                      <td className="px-3 py-1.5 font-mono text-gray-400 whitespace-nowrap">
                        {r.fieldSource || '—'}
                        <span className="text-gray-600"> · {r.tableSource || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5 max-w-xs">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] truncate max-w-full ${
                          r.isSynth ? 'bg-red-900/30 text-red-400'
                          : r.transformation?.includes('ApplyMap') ? 'bg-violet-900/30 text-violet-400'
                          : r.isCalculated ? 'bg-orange-900/30 text-orange-400'
                          : 'bg-gray-800/80 text-gray-500'
                        }`} title={r.transformation}>
                          {r.transformation || 'Direct'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function LineageTab({ analysis, appName, analyzing }) {
  const [view, setView] = useState('grouped'); // 'grouped' (défaut) | 'table' | 'graph'
  const [filterTable, setFilterTable] = useState('');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  const lineage = analysis?.lineage || [];
  const allTables = useMemo(
    () => [...new Set(lineage.map(l => l.tableQlik).filter(Boolean))],
    [lineage]
  );

  const filtered = useMemo(() => {
    return lineage.filter(l => {
      const matchTable = !filterTable || l.tableQlik === filterTable;
      const matchType =
        !filterType ||
        (filterType === 'calculated' && l.isCalculated) ||
        (filterType === 'applymap' && l.transformation?.includes('ApplyMap')) ||
        (filterType === 'synth' && l.transformation?.includes('synthétique')) ||
        (filterType === 'direct' && l.transformation === 'Direct');
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        (l.fieldQlik || '').toLowerCase().includes(q) ||
        (l.tableQlik || '').toLowerCase().includes(q) ||
        (l.fieldSource || '').toLowerCase().includes(q) ||
        (l.tableSource || '').toLowerCase().includes(q);
      return matchTable && matchType && matchSearch;
    });
  }, [lineage, filterTable, filterType, search]);

  function exportCSV() {
    const headers = ['Champ Qlik', 'Table Qlik', 'Champ Source', 'Table Source', 'Transformation'];
    const rows = filtered.map(l => [
      l.fieldQlik, l.tableQlik, l.fieldSource || '', l.tableSource || '', l.transformation || ''
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lineage_${appName || 'app'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (analyzing) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-gray-800/50 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <div className="text-center">
          <GitBranch size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Analysez un script pour voir le lineage</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Barre d'outils ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 flex-shrink-0 flex-wrap">

        {/* Toggle Par table / Tableau / Graphe */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 mr-1">
          <button
            onClick={() => setView('grouped')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-700 ${
              view === 'grouped'
                ? 'bg-emerald-700/30 text-emerald-400'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            <Rows3 size={11} />
            Par table
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-700 ${
              view === 'table'
                ? 'bg-blue-700/30 text-blue-400'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            <Table2 size={11} />
            Tableau
          </button>
          <button
            onClick={() => setView('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'graph'
                ? 'bg-violet-700/30 text-violet-400'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            <LayoutDashboard size={11} />
            Graphe
          </button>
        </div>

        {/* Recherche (vue groupée) */}
        {view === 'grouped' && (
          <>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                placeholder="Rechercher un champ, une table..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded pl-6 pr-3 py-1.5 outline-none focus:border-emerald-500 w-56"
              />
            </div>
            <span className="text-xs text-gray-600 flex-1">
              {lineage.length} champs · {(analysis.facts?.length || 0) + (analysis.dims?.length || 0)} tables
              {analysis.metadata?.coverage && ` · couverture ${analysis.metadata.coverage.score} %`}
            </span>
          </>
        )}

        {/* Filtres (tableau uniquement) */}
        {view === 'table' && (
          <>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                placeholder="Rechercher..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded pl-6 pr-3 py-1.5 outline-none focus:border-emerald-500 w-40"
              />
            </div>
            <select
              className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded px-2 py-1.5 outline-none focus:border-emerald-500"
              value={filterTable}
              onChange={e => setFilterTable(e.target.value)}
            >
              <option value="">Toutes les tables</option>
              {allTables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded px-2 py-1.5 outline-none focus:border-emerald-500"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="">Tous les types</option>
              <option value="direct">Direct</option>
              <option value="applymap">ApplyMap</option>
              <option value="synth">Clé synthétique</option>
              <option value="calculated">Calculé</option>
            </select>
            <span className="text-xs text-gray-600 flex-1">{filtered.length} / {lineage.length} champs</span>
          </>
        )}

        {view === 'graph' && (
          <span className="text-xs text-gray-600 flex-1">
            {(analysis.facts?.length || 0) + (analysis.dims?.length || 0) + (analysis.mappings?.length || 0)} tables
            · {(analysis.sources || []).length} sources
            · {lineage.length} champs
            {(analysis.stores?.length || 0) > 0 && ` · 💾 ${analysis.stores.length} STORE`}
          </span>
        )}

        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-400 border border-emerald-700/40 text-xs rounded transition-colors ml-auto"
        >
          <Download size={11} />
          CSV
        </button>
      </div>

      {/* ── Vue Par table (groupée) ── */}
      {view === 'grouped' && (
        <div className="flex-1 overflow-auto min-h-0">
          <GroupedView analysis={analysis} search={search} />
        </div>
      )}

      {/* ── Vue Graphe ── */}
      {view === 'graph' && (
        <div className="flex-1 min-h-0">
          <LineageGraph analysis={analysis} />
        </div>
      )}

      {/* ── Vue Tableau ── */}
      {view === 'table' && (
        <div className="flex-1 overflow-auto min-h-0">
          {lineage.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-600">
              <div className="text-center text-xs">
                <Info size={24} className="mx-auto mb-2 opacity-30" />
                Aucune donnée de lineage dans cette analyse
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-600 text-xs">
              Aucun résultat pour ces filtres
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Champ Qlik</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Table Qlik</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Champ Source</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Table Source</th>
                  <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Transformation</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const isCalc = row.isCalculated || (row.transformation && row.transformation !== 'Direct' && !row.transformation.startsWith('Renommé'));
                  const isApply = row.transformation?.includes('ApplyMap');
                  const isSynth = row.transformation?.includes('synthétique');

                  return (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-emerald-300 whitespace-nowrap">{row.fieldQlik}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                          (analysis.facts || []).find(f => f.name === row.tableQlik)
                            ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40'
                            : 'bg-blue-900/30 text-blue-400 border border-blue-700/40'
                        }`}>{row.tableQlik}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-400">{row.fieldSource || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-purple-300 whitespace-nowrap">{row.tableSource || '—'}</td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs truncate max-w-full ${
                          isSynth
                            ? 'bg-red-900/30 text-red-400 border border-red-700/40'
                            : isApply
                              ? 'bg-violet-900/30 text-violet-400 border border-violet-700/40'
                              : isCalc
                                ? 'bg-orange-900/30 text-orange-400 border border-orange-700/40'
                                : 'bg-gray-800 text-gray-500 border border-gray-700'
                        }`} title={row.transformation}>
                          {row.transformation || 'Direct'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
