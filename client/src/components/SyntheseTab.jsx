import React, { useMemo } from 'react';

/**
 * Synthèse — visualisations orientées décision : des classements chiffrés
 * (où sont les orphelins, qui duplique quoi), pas de décoration.
 */

function BarList({ title, subtitle, rows, unit = '', accent = '#10b981', emptyText = 'Rien à signaler' }) {
  const max = rows.length ? rows[0].value : 0;
  return (
    <section className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
      <h4 className="text-xs font-semibold text-gray-200">{title}</h4>
      {subtitle && <p className="text-[10px] text-gray-600 mt-0.5 mb-3">{subtitle}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-600 mt-2">{emptyText}</p>
      ) : (
        <div className="space-y-1.5 mt-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-44 shrink-0 text-[11px] text-gray-400 truncate text-right" title={r.label}>
                {r.label}
              </div>
              <div className="flex-1 h-4 bg-gray-800/60 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: accent, opacity: 0.75 }} />
              </div>
              <div className="w-14 shrink-0 text-[11px] font-mono text-gray-200">{r.value}{unit}</div>
              {r.extra && <div className="w-28 shrink-0 text-[9px] text-gray-600 truncate" title={r.extra}>{r.extra}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function KeyFigure({ value, label, detail }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-lg px-4 py-3">
      <div className="text-2xl font-bold text-gray-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</div>
      {detail && <div className="text-[10px] text-gray-600 mt-1">{detail}</div>}
    </div>
  );
}

export default function SyntheseTab({ data }) {
  const computed = useMemo(() => {
    if (!data) return null;

    // Orphelins par stream (où concentrer le ménage)
    const orphansByStream = new Map();
    const orphansByApp = new Map();
    for (const q of data.orphans) {
      for (const p of q.producers) {
        const st = p.stream || '(non publiée)';
        orphansByStream.set(st, (orphansByStream.get(st) || 0) + 1);
        const key = p.appName;
        orphansByApp.set(key, (orphansByApp.get(key) || 0) + 1);
      }
    }

    // Extractions dupliquées les plus coûteuses (nb d'apps qui tirent la même table)
    const topDuplicates = [...data.duplicateExtractions]
      .sort((a, b) => b.apps.length - a.apps.length)
      .slice(0, 12)
      .map(d => ({ label: d.table, value: d.apps.length, extra: d.connections.join(', ') }));

    // Rôles
    const roles = { batch: 0, transform: 0, front: 0, autonome: 0, inconnu: 0 };
    let published = 0, unpublished = 0;
    for (const a of data.apps) {
      roles[a.role] = (roles[a.role] || 0) + 1;
      if (a.published) published++; else unpublished++;
    }

    // Ratio de QVD utiles
    const okQvds = data.qvds.filter(q => q.status === 'ok').length;
    const wasteRatio = data.qvds.length ? Math.round((data.orphans.length / data.qvds.length) * 100) : 0;

    return {
      orphansByStream: [...orphansByStream.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12),
      orphansByApp: [...orphansByApp.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12),
      topDuplicates,
      roles,
      published, unpublished,
      okQvds, wasteRatio
    };
  }, [data]);

  if (!computed) return null;
  const s = data.stats;

  return (
    <div className="space-y-4">
      {/* Chiffres clés : lecture directe de l'état du parc */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <KeyFigure value={`${computed.wasteRatio}%`} label="QVD gaspillés"
          detail={`${s.orphanQvds} orphelins sur ${s.totalQvds} QVD tracés`} />
        <KeyFigure value={computed.okQvds} label="QVD sains"
          detail="générés ET consommés" />
        <KeyFigure value={s.duplicateExtractions} label="Tables en double"
          detail="extraites par plusieurs apps" />
        <KeyFigure value={s.externalQvds} label="Producteur inconnu"
          detail="importer les apps batch manquantes" />
        <KeyFigure value={`${computed.unpublished}`} label="Apps non publiées"
          detail={`${computed.published} publiées · ${computed.roles.batch + computed.roles.transform} génèrent des QVD`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <BarList
          title="Extractions SQL dupliquées — les plus répandues"
          subtitle="Nombre d'apps qui extraient la même table source. Chaque barre = des reloads redondants à mutualiser en un seul batch."
          rows={computed.topDuplicates}
          unit=" apps"
          accent="#f59e0b"
          emptyText="Aucune extraction dupliquée 🎉"
        />
        <BarList
          title="QVD orphelins par stream"
          subtitle="Où se concentre le gaspillage : QVD générés que personne ne lit."
          rows={computed.orphansByStream}
          accent="#ef4444"
          emptyText="Aucun orphelin 🎉"
        />
        <BarList
          title="Apps qui produisent le plus de QVD orphelins"
          subtitle="Candidates prioritaires : soit leur sortie est obsolète, soit les consommateurs manquent à l'import."
          rows={computed.orphansByApp}
          accent="#ef4444"
        />
        <BarList
          title="Répartition des apps par rôle"
          subtitle="batch = écrit des QVD · transform = lit et écrit · front = consomme seulement"
          rows={[
            { label: 'transform (lit + écrit)', value: computed.roles.transform },
            { label: 'batch (génère)', value: computed.roles.batch },
            { label: 'front (consomme)', value: computed.roles.front },
            { label: 'autonome (sources directes)', value: computed.roles.autonome },
          ].filter(r => r.value > 0).sort((a, b) => b.value - a.value)}
          accent="#3b82f6"
        />
      </div>
    </div>
  );
}
