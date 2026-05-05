import React, { useState, useMemo } from 'react';
import { Download, GitBranch, ArrowRight, Info, Search } from 'lucide-react';

export default function LineageTab({ analysis, appName, analyzing }) {
  const [filterTable, setFilterTable] = useState('');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  const lineage = analysis?.lineage || [];
  const allTables = useMemo(() => [...new Set(lineage.map(l => l.tableQlik).filter(Boolean))], [lineage]);

  const filtered = useMemo(() => {
    return lineage.filter(l => {
      const matchTable = !filterTable || l.tableQlik === filterTable;
      const matchType =
        !filterType ||
        (filterType === 'calculated' && l.isCalculated) ||
        (filterType === 'direct' && !l.isCalculated && !l.transformation?.includes('ApplyMap')) ||
        (filterType === 'mapping' && l.transformation?.includes('ApplyMap'));
      const matchSearch =
        !search ||
        (l.fieldQlik || '').toLowerCase().includes(search.toLowerCase()) ||
        (l.tableQlik || '').toLowerCase().includes(search.toLowerCase()) ||
        (l.fieldSource || '').toLowerCase().includes(search.toLowerCase()) ||
        (l.tableSource || '').toLowerCase().includes(search.toLowerCase());
      return matchTable && matchType && matchSearch;
    });
  }, [lineage, filterTable, filterType, search]);

  function exportCSV() {
    const headers = ['Champ Qlik', 'Table Qlik', 'Champ Source', 'Table Source', 'Transformation', 'Calculé', 'Type Donnée'];
    const rows = filtered.map(l => [
      l.fieldQlik, l.tableQlik, l.fieldSource || '', l.tableSource || '',
      l.transformation || '', l.isCalculated ? 'Oui' : 'Non', l.dataType || ''
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
      <div className="p-6 space-y-4">
        <div className="skeleton h-10 rounded" />
        <div className="skeleton h-64 rounded" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600">
        <div className="text-center">
          <GitBranch size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Analysez un script pour voir le lineage</p>
        </div>
      </div>
    );
  }

  const sources = analysis.sources || [];
  const facts = analysis.facts?.map(f => f.name) || [];
  const dims = analysis.dims?.map(d => d.name) || [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Graphe de flux */}
      <div className="p-4 border-b border-gray-800 bg-gray-900/30 flex-shrink-0 max-h-44 overflow-y-auto">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <GitBranch size={12} />
          Graphe de Flux
        </h3>
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          <div className="flex flex-col gap-1.5 min-w-max">
            <div className="text-xs text-gray-600 mb-1 font-semibold">SOURCES</div>
            {sources.map((s, i) => (
              <div key={i} className="px-2.5 py-1.5 bg-purple-900/40 border border-purple-700/50 rounded text-xs font-mono text-purple-300 whitespace-nowrap">{s}</div>
            ))}
          </div>
          <div className="flex items-center pt-6"><ArrowRight size={16} className="text-gray-600" /></div>
          <div className="flex flex-col gap-1.5 min-w-max">
            <div className="text-xs text-gray-600 mb-1 font-semibold">QVD</div>
            <div className="px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-400">Couche QVD</div>
          </div>
          {facts.length > 0 && (
            <>
              <div className="flex items-center pt-6"><ArrowRight size={16} className="text-gray-600" /></div>
              <div className="flex flex-col gap-1.5 min-w-max">
                <div className="text-xs text-gray-600 mb-1 font-semibold">FAITS</div>
                {facts.map((f, i) => (
                  <div key={i} className="px-2.5 py-1.5 bg-emerald-900/40 border border-emerald-700/50 rounded text-xs font-mono text-emerald-300 whitespace-nowrap">{f}</div>
                ))}
              </div>
            </>
          )}
          {dims.length > 0 && (
            <>
              <div className="flex items-center pt-6"><ArrowRight size={16} className="text-gray-600" /></div>
              <div className="flex flex-col gap-1.5 min-w-max">
                <div className="text-xs text-gray-600 mb-1 font-semibold">DIMS</div>
                {dims.map((d, i) => (
                  <div key={i} className="px-2.5 py-1.5 bg-blue-900/40 border border-blue-700/50 rounded text-xs font-mono text-blue-300 whitespace-nowrap">{d}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filtres + Recherche + Export */}
      <div className="p-3 border-b border-gray-800 flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            placeholder="Rechercher un champ..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded pl-6 pr-3 py-1.5 outline-none focus:border-emerald-500 w-44"
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
          <option value="calculated">Calculé</option>
          <option value="mapping">ApplyMap</option>
        </select>
        <span className="text-xs text-gray-600 flex-1">{filtered.length} / {lineage.length} champs</span>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs text-white rounded transition-colors"
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>

      {/* Tableau */}
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
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">Champ Qlik</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">Table Qlik</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">Champ Source</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">Table Source</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">Type</th>
                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Transformation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-emerald-300">{row.fieldQlik}</td>
                  <td className="px-4 py-2.5 font-mono text-blue-300">{row.tableQlik}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-400">{row.fieldSource}</td>
                  <td className="px-4 py-2.5 font-mono text-purple-300">{row.tableSource}</td>
                  <td className="px-4 py-2.5">
                    {row.isCalculated
                      ? <span className="px-1.5 py-0.5 bg-orange-900/40 text-orange-300 border border-orange-700/50 rounded text-xs">Calculé</span>
                      : row.transformation?.includes('ApplyMap')
                        ? <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 border border-blue-700/50 rounded text-xs">ApplyMap</span>
                        : <span className="px-1.5 py-0.5 bg-gray-800 text-gray-500 border border-gray-700 rounded text-xs">Direct</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 max-w-xs truncate">{row.transformation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
