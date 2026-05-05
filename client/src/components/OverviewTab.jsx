import React from 'react';
import { Table2, Layers, Zap, Database, AlertTriangle, CheckCircle, Info } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function RiskBadge({ risk }) {
  const colors = { haut: 'bg-red-900/50 text-red-400 border-red-700/50', moyen: 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50', faible: 'bg-green-900/50 text-green-400 border-green-700/50' };
  return <span className={`text-xs px-2 py-0.5 rounded border font-medium ${colors[risk] || colors.faible}`}>{risk}</span>;
}

export default function OverviewTab({ analysis, analyzing }) {
  if (analyzing) {
    return (
      <div className="p-6 space-y-4 overflow-y-auto h-full">
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24 rounded-lg" />)}
        </div>
        <div className="skeleton h-32 rounded-lg" />
        <div className="skeleton h-24 rounded-lg" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600">
        <div className="text-center">
          <Info size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Analysez un script pour voir la vue d'ensemble</p>
        </div>
      </div>
    );
  }

  const modelIcons = { etoile: '⭐', flocon: '❄️', mixte: '🔀' };

  return (
    <div className="p-6 overflow-y-auto space-y-6 h-full">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Table2} label="Tables de Faits" value={analysis.facts?.length || 0} color="text-emerald-400" />
        <StatCard icon={Layers} label="Dimensions" value={analysis.dims?.length || 0} color="text-blue-400" />
        <StatCard icon={Zap} label="Champs Calculés" value={analysis.calcFields?.length || 0} color="text-orange-400" />
        <StatCard icon={Database} label="Sources" value={analysis.sources?.length || 0} color="text-purple-400" />
      </div>

      {/* Model type */}
      <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
        <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-2">Type de Modèle</h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{modelIcons[analysis.model] || '🔀'}</span>
          <span className="text-lg font-semibold text-white capitalize">{analysis.model || 'Mixte'}</span>
        </div>
      </div>

      {/* Summary */}
      {analysis.summary && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-emerald-700/30">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle size={13} className="text-emerald-500" />
            Résumé
          </h3>
          <p className="text-sm text-gray-300 leading-relaxed">{analysis.summary}</p>
        </div>
      )}

      {/* Sources */}
      {analysis.sources?.length > 0 && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">Sources de données</h3>
          <div className="flex flex-wrap gap-2">
            {analysis.sources.map((s, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-purple-900/40 text-purple-300 border border-purple-700/50 rounded font-mono">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tables */}
      <div className="grid grid-cols-1 gap-4">
        {analysis.facts?.length > 0 && (
          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
            <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">Tables de Faits</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.facts.map((f, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 rounded font-mono">{f.name}</span>
              ))}
            </div>
          </div>
        )}
        {analysis.dims?.length > 0 && (
          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
            <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">Dimensions</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.dims.map((d, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-blue-900/40 text-blue-300 border border-blue-700/50 rounded font-mono">{d.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Synthetic keys risks */}
      {analysis.synthKeys?.length > 0 && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-yellow-700/30">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle size={13} className="text-yellow-500" />
            Clés Synthétiques ({analysis.synthKeys.length})
          </h3>
          <div className="space-y-2">
            {analysis.synthKeys.map((sk, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-mono text-yellow-300">{sk.field}</span>
                <span className="text-gray-500 mx-2 truncate flex-1">{sk.formula}</span>
                <RiskBadge risk={sk.risk} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calc fields */}
      {analysis.calcFields?.length > 0 && (
        <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-3">Champs Calculés</h3>
          <div className="space-y-2">
            {analysis.calcFields.map((cf, i) => (
              <div key={i} className="text-xs">
                <span className="font-mono text-orange-300">{cf.field}</span>
                <span className="text-gray-600 mx-2">·</span>
                <span className="text-gray-500">{cf.table}</span>
                {cf.formula && <div className="mt-0.5 text-gray-600 font-mono pl-2 truncate">{cf.formula}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
