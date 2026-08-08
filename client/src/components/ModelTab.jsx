import React from 'react';
import { LayoutGrid, Key, Link, Zap, Info } from 'lucide-react';

function TableCard({ table, type }) {
  const typeConfig = {
    fact: { border: 'border-emerald-700/60', header: 'bg-emerald-900/40', badge: 'bg-emerald-500', label: 'FACT' },
    dim: { border: 'border-blue-700/60', header: 'bg-blue-900/40', badge: 'bg-blue-500', label: 'DIM' },
    mapping: { border: 'border-orange-700/60', header: 'bg-orange-900/40', badge: 'bg-orange-500', label: 'MAP' }
  };
  const cfg = typeConfig[type] || typeConfig.dim;

  return (
    <div className={`bg-gray-800/60 border ${cfg.border} rounded-lg overflow-hidden`}>
      <div className={`${cfg.header} px-3 py-2 flex items-center justify-between`}>
        <span className="font-mono text-sm font-semibold text-white">{table.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${cfg.badge} text-white font-medium`}>{cfg.label}</span>
      </div>
      <div className="p-3 space-y-1">
        {table.fields?.map((field, i) => {
          const isPK = table.keys?.includes(field);
          const isCalc = field.includes('_CALC') || field.startsWith('%') || field.includes('=');
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              {isPK ? (
                <Key size={11} className="text-yellow-400 shrink-0" />
              ) : isCalc ? (
                <Zap size={11} className="text-orange-400 shrink-0" />
              ) : (
                <div className="w-[11px] shrink-0" />
              )}
              <span className={`font-mono ${isPK ? 'text-yellow-300' : isCalc ? 'text-orange-300' : 'text-gray-300'}`}>
                {field}
              </span>
              {isPK && <span className="text-xs text-gray-600 ml-auto">PK</span>}
            </div>
          );
        })}
        {(!table.fields || table.fields.length === 0) && (
          <div className="text-xs text-gray-600 italic">Aucun champ détecté</div>
        )}
      </div>
    </div>
  );
}

export default function ModelTab({ analysis, analyzing }) {
  if (analyzing) {
    return (
      <div className="p-6 grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-40 rounded-lg" />)}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600">
        <div className="text-center">
          <LayoutGrid size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Analysez un script pour voir le modèle de données</p>
        </div>
      </div>
    );
  }

  const modelIcons = { etoile: '⭐', flocon: '❄️', mixte: '🔀' };

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <span className="text-xl">{modelIcons[analysis.model] || '🔀'}</span>
          Modèle {analysis.model || 'Mixte'}
        </h2>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Key size={10} className="text-yellow-400" /> Clé primaire</span>
          <span className="flex items-center gap-1"><Zap size={10} className="text-orange-400" /> Calculé</span>
          <span className="flex items-center gap-1"><Link size={10} className="text-blue-400" /> FK</span>
        </div>
      </div>

      {/* Facts */}
      {analysis.facts?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Tables de Faits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.facts.map((table, i) => (
              <TableCard key={i} table={table} type="fact" />
            ))}
          </div>
        </div>
      )}

      {/* Dims */}
      {analysis.dims?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Dimensions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.dims.map((table, i) => (
              <TableCard key={i} table={table} type="dim" />
            ))}
          </div>
        </div>
      )}

      {/* Mappings */}
      {analysis.mappings?.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Tables de Mapping</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {analysis.mappings.map((m, i) => (
              <div key={i} className="bg-gray-800/60 border border-orange-700/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-orange-300">{m.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500 text-white font-medium">MAP</span>
                </div>
                <div className="text-xs text-gray-500">
                  <span className="text-gray-400">{m.from}</span>
                  <span className="mx-2 text-orange-500">→</span>
                  <span className="text-gray-400">{m.to}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.facts?.length === 0 && analysis.dims?.length === 0 && (
        <div className="text-center text-gray-600 py-12">
          <Info size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucune table détectée dans l'analyse</p>
        </div>
      )}
    </div>
  );
}
