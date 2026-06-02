import React, { useState, useMemo } from 'react';
import { Download, GitBranch, Info, Search, LayoutDashboard, Table2 } from 'lucide-react';
import LineageGraph from './LineageGraph.jsx';

export default function LineageTab({ analysis, appName, analyzing }) {
  const [view, setView] = useState('graph'); // 'graph' | 'table'
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

        {/* Toggle Graphe / Tableau */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 mr-1">
          <button
            onClick={() => setView('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'graph'
                ? 'bg-emerald-700/30 text-emerald-400 border-r border-emerald-700/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300 border-r border-gray-700'
            }`}
          >
            <LayoutDashboard size={11} />
            Graphe
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'table'
                ? 'bg-blue-700/30 text-blue-400'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            <Table2 size={11} />
            Tableau
          </button>
        </div>

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
