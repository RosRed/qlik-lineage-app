import React from 'react';
import { Table2, Layers, Zap, Database, AlertTriangle, CheckCircle, Info } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-raised rounded-lg p-4 border border-line">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-ink-muted">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function RiskBadge({ risk }) {
  const colors = { haut: 'bg-danger-soft text-danger border-danger', moyen: 'bg-warn-soft text-warn border-warn', faible: 'bg-accent-soft text-accent-ink border-accent' };
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
      <div className="flex items-center justify-center h-64 text-ink-faint">
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
        <StatCard icon={Table2} label="Tables de Faits" value={analysis.facts?.length || 0} color="text-accent-ink" />
        <StatCard icon={Layers} label="Dimensions" value={analysis.dims?.length || 0} color="text-info" />
        <StatCard icon={Zap} label="Champs Calculés" value={analysis.calcFields?.length || 0} color="text-warn" />
        <StatCard icon={Database} label="Sources" value={analysis.sources?.length || 0} color="text-violet" />
      </div>

      {/* Model type + couverture du parsing */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-raised rounded-lg p-4 border border-line">
          <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-2">Type de Modèle</h3>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{modelIcons[analysis.model] || '🔀'}</span>
            <span className="text-lg font-semibold text-ink capitalize">{analysis.model || 'Mixte'}</span>
          </div>
        </div>
        {analysis.metadata?.coverage && (() => {
          const cov = analysis.metadata.coverage;
          const color = cov.score >= 90 ? 'text-accent-ink border-accent'
            : cov.score >= 70 ? 'text-warn border-warn'
            : 'text-danger border-danger';
          return (
            <div className={`bg-raised rounded-lg p-4 border border-line`}>
              <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-2">Couverture du parsing</h3>
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold px-2 py-0.5 rounded border ${color}`}>{cov.score} %</span>
                <span className="text-[11px] text-ink-muted">
                  {cov.parsedBlocks}/{cov.loadStatements} LOAD rattachés
                </span>
              </div>
              {cov.unparsed?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[10px] text-ink-muted cursor-pointer hover:text-ink">
                    {cov.unparsed.length} LOAD non rattaché(s) — détail
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-[10px] text-ink-muted">
                    {cov.unparsed.map((u, i) => (
                      <li key={i}>ligne {u.line} : {u.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
              {cov.unresolvedVariables?.length > 0 && (
                <div className="mt-1.5 text-[10px] text-ink-faint">
                  Variables non résolues : <span className="font-mono">{cov.unresolvedVariables.slice(0, 6).join(', ')}{cov.unresolvedVariables.length > 6 ? '…' : ''}</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Summary */}
      {analysis.summary && (
        <div className="bg-raised rounded-lg p-4 border border-accent">
          <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-2">
            <CheckCircle size={13} className="text-accent-ink" />
            Résumé
          </h3>
          <p className="text-sm text-ink leading-relaxed">{analysis.summary}</p>
        </div>
      )}

      {/* Sources → voir l'onglet « Sources » dédié */}

      {/* Tables */}
      <div className="grid grid-cols-1 gap-4">
        {analysis.facts?.length > 0 && (
          <div className="bg-raised rounded-lg p-4 border border-line">
            <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-3">Tables de Faits</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.facts.map((f, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-accent-soft text-accent-ink border border-accent rounded font-mono">{f.name}</span>
              ))}
            </div>
          </div>
        )}
        {analysis.dims?.length > 0 && (
          <div className="bg-raised rounded-lg p-4 border border-line">
            <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-3">Dimensions</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.dims.map((d, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-info-soft text-info border border-info rounded font-mono">{d.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Synthetic keys risks */}
      {analysis.synthKeys?.length > 0 && (
        <div className="bg-raised rounded-lg p-4 border border-warn">
          <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle size={13} className="text-warn" />
            Clés Synthétiques ({analysis.synthKeys.length})
          </h3>
          <div className="space-y-2">
            {analysis.synthKeys.map((sk, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-mono text-warn">{sk.field}</span>
                <span className="text-ink-muted mx-2 truncate flex-1">{sk.formula}</span>
                <RiskBadge risk={sk.risk} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calc fields */}
      {analysis.calcFields?.length > 0 && (
        <div className="bg-raised rounded-lg p-4 border border-line">
          <h3 className="text-xs text-ink-muted uppercase tracking-wider mb-3">Champs Calculés</h3>
          <div className="space-y-2">
            {analysis.calcFields.map((cf, i) => (
              <div key={i} className="text-xs">
                <span className="font-mono text-warn">{cf.field}</span>
                <span className="text-ink-faint mx-2">·</span>
                <span className="text-ink-muted">{cf.table}</span>
                {cf.formula && <div className="mt-0.5 text-ink-faint font-mono pl-2 truncate">{cf.formula}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
