import React, { useState, useMemo } from 'react';
import { Download, GitBranch, Info, Search, LayoutDashboard, Table2, Rows3, ChevronDown, ChevronRight } from 'lucide-react';
import LineageGraph from './LineageGraph.jsx';

// ─── Vue groupée par table : table → source → champs ─────────────────────────

const METHOD_BADGE = {
  qvd:      'bg-info-soft text-info',
  sql:      'bg-info-soft text-info',
  excel:    'bg-accent-soft text-accent-ink',
  csv:      'bg-accent-soft text-accent-ink',
  file:     'bg-accent-soft text-accent-ink',
  resident: 'bg-raised text-ink-muted',
  inline:   'bg-raised text-ink-muted',
  autogenerate: 'bg-raised text-ink-muted',
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
    return <div className="flex items-center justify-center h-32 text-ink-faint text-xs">Aucun résultat</div>;
  }

  return (
    <div className="p-4 space-y-2">
      {groups.map(([table, rows]) => {
        const isCollapsed = collapsed[table];
        const type = factNames.has(table) ? 'FACT' : mapNames.has(table) ? 'MAP' : 'DIM';
        const typeCls = type === 'FACT' ? 'bg-accent-soft text-accent-ink' : type === 'MAP' ? 'bg-violet-soft text-violet' : 'bg-info-soft text-info';
        // Sources distinctes de la table (plusieurs si joins/concatenate)
        const srcs = [...new Map(rows.map(r => [`${r.tableSource}|${r.loadMethod}`, r])).values()];
        return (
          <div key={table} className="bg-surface border border-line rounded-lg overflow-hidden">
            <button
              onClick={() => setCollapsed(c => ({ ...c, [table]: !c[table] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-raised">
              {isCollapsed ? <ChevronRight size={13} className="text-ink-faint" /> : <ChevronDown size={13} className="text-ink-faint" />}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${typeCls}`}>{type}</span>
              <span className="font-mono text-xs text-ink font-semibold">{table}</span>
              <span className="text-[10px] text-ink-faint">{rows.length} champ{rows.length !== 1 ? 's' : ''}</span>
              <div className="flex-1" />
              <div className="flex items-center gap-1.5 min-w-0">
                {srcs.slice(0, 3).map((s, i) => (
                  <span key={i} className="flex items-center gap-1 min-w-0">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${METHOD_BADGE[s.loadMethod] || 'bg-raised text-ink-muted'}`}>
                      {s.loadMethod || '?'}
                    </span>
                    <span className="text-[10px] text-ink-muted font-mono truncate max-w-[180px]" title={s.sourcePath || s.tableSource}>
                      {s.tableSource}
                    </span>
                  </span>
                ))}
                {srcs.length > 3 && <span className="text-[10px] text-ink-faint">+{srcs.length - 3}</span>}
              </div>
            </button>
            {!isCollapsed && (
              <table className="w-full text-xs border-t border-line">
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-raised">
                      <td className="pl-9 pr-3 py-1.5 font-mono text-accent-ink whitespace-nowrap w-[220px]">
                        {r.fieldQlik}{r.isKey && <span className="ml-1.5 text-[8px] text-warn" title="Clé">🔑</span>}
                      </td>
                      <td className="px-3 py-1.5 text-ink-faint w-[20px]">←</td>
                      <td className="px-3 py-1.5 font-mono text-ink-muted whitespace-nowrap">
                        {r.fieldSource || '—'}
                        <span className="text-ink-faint"> · {r.tableSource || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5 max-w-xs">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] truncate max-w-full ${
                          r.isSynth ? 'bg-danger-soft text-danger'
                          : r.transformation?.includes('ApplyMap') ? 'bg-violet-soft text-violet'
                          : r.isCalculated ? 'bg-warn-soft text-warn'
                          : 'bg-raised text-ink-muted'
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
          <div key={i} className="h-12 bg-raised rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-full text-ink-faint">
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
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line flex-shrink-0 flex-wrap">

        {/* Toggle Par table / Tableau / Graphe */}
        <div className="flex rounded-lg overflow-hidden border border-line mr-1">
          <button
            onClick={() => setView('grouped')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-r border-line ${
              view === 'grouped'
                ? 'bg-accent-soft text-accent-ink'
                : 'bg-raised text-ink-muted hover:text-ink'
            }`}
          >
            <Rows3 size={11} />
            Par table
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-r border-line ${
              view === 'table'
                ? 'bg-info-soft text-info'
                : 'bg-raised text-ink-muted hover:text-ink'
            }`}
          >
            <Table2 size={11} />
            Tableau
          </button>
          <button
            onClick={() => setView('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'graph'
                ? 'bg-violet-soft text-violet'
                : 'bg-raised text-ink-muted hover:text-ink'
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
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                placeholder="Rechercher un champ, une table..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-raised text-xs text-ink border border-line rounded pl-6 pr-3 py-1.5 outline-none focus:border-accent w-56"
              />
            </div>
            <span className="text-xs text-ink-faint flex-1">
              {lineage.length} champs · {(analysis.facts?.length || 0) + (analysis.dims?.length || 0)} tables
              {analysis.metadata?.coverage && ` · couverture ${analysis.metadata.coverage.score} %`}
            </span>
          </>
        )}

        {/* Filtres (tableau uniquement) */}
        {view === 'table' && (
          <>
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                placeholder="Rechercher..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-raised text-xs text-ink border border-line rounded pl-6 pr-3 py-1.5 outline-none focus:border-accent w-40"
              />
            </div>
            <select
              className="bg-raised text-xs text-ink border border-line rounded px-2 py-1.5 outline-none focus:border-accent"
              value={filterTable}
              onChange={e => setFilterTable(e.target.value)}
            >
              <option value="">Toutes les tables</option>
              {allTables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              className="bg-raised text-xs text-ink border border-line rounded px-2 py-1.5 outline-none focus:border-accent"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="">Tous les types</option>
              <option value="direct">Direct</option>
              <option value="applymap">ApplyMap</option>
              <option value="synth">Clé synthétique</option>
              <option value="calculated">Calculé</option>
            </select>
            <span className="text-xs text-ink-faint flex-1">{filtered.length} / {lineage.length} champs</span>
          </>
        )}

        {view === 'graph' && (
          <span className="text-xs text-ink-faint flex-1">
            {(analysis.facts?.length || 0) + (analysis.dims?.length || 0) + (analysis.mappings?.length || 0)} tables
            · {(analysis.sources || []).length} sources
            · {lineage.length} champs
            {(analysis.stores?.length || 0) > 0 && ` · 💾 ${analysis.stores.length} STORE`}
          </span>
        )}

        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-soft hover:bg-accent-soft text-accent-ink border border-accent text-xs rounded transition-colors ml-auto"
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
            <div className="flex items-center justify-center h-32 text-ink-faint">
              <div className="text-center text-xs">
                <Info size={24} className="mx-auto mb-2 opacity-30" />
                Aucune donnée de lineage dans cette analyse
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-ink-faint text-xs">
              Aucun résultat pour ces filtres
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-line">
                  <th className="text-left px-4 py-2.5 text-ink-muted font-medium">Champ Qlik</th>
                  <th className="text-left px-4 py-2.5 text-ink-muted font-medium">Table Qlik</th>
                  <th className="text-left px-4 py-2.5 text-ink-muted font-medium">Champ Source</th>
                  <th className="text-left px-4 py-2.5 text-ink-muted font-medium">Table Source</th>
                  <th className="text-left px-4 py-2.5 text-ink-muted font-medium">Transformation</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const isCalc = row.isCalculated || (row.transformation && row.transformation !== 'Direct' && !row.transformation.startsWith('Renommé'));
                  const isApply = row.transformation?.includes('ApplyMap');
                  const isSynth = row.transformation?.includes('synthétique');

                  return (
                    <tr key={i} className="border-b border-line hover:bg-raised transition-colors">
                      <td className="px-4 py-2.5 font-mono text-accent-ink whitespace-nowrap">{row.fieldQlik}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                          (analysis.facts || []).find(f => f.name === row.tableQlik)
                            ? 'bg-accent-soft text-accent-ink border border-accent'
                            : 'bg-info-soft text-info border border-info'
                        }`}>{row.tableQlik}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-ink-muted">{row.fieldSource || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-violet whitespace-nowrap">{row.tableSource || '—'}</td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs truncate max-w-full ${
                          isSynth
                            ? 'bg-danger-soft text-danger border border-danger'
                            : isApply
                              ? 'bg-violet-soft text-violet border border-violet'
                              : isCalc
                                ? 'bg-warn-soft text-warn border border-warn'
                                : 'bg-raised text-ink-muted border border-line'
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
