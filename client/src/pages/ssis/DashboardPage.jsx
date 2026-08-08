import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Activity, AlertOctagon, Clock } from 'lucide-react';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, StatCard, ErrorNote, Spinner } from '../../components/ui/primitives';
import { fmtDur, DaysPicker } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Vue synthétique : KPI globaux + histogramme journalier + top packages en
 * erreur. Une seule requête back (getDashboard) qui fait 3 SELECT en un.
 */

function DayBars({ perDay }) {
  if (!perDay?.length) return <p className="text-xs text-ink-faint">Aucune exécution sur la période.</p>;
  const max = Math.max(1, ...perDay.map(d => d.total));
  const barAreaHeight = 120; // px — évite les height:% qui collapsent avec items-end/stretch
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: barAreaHeight }}>
        {perDay.map(d => {
          const totalPx = Math.max(2, (d.total / max) * barAreaHeight);
          const failPx = d.total > 0 ? (d.failed / d.total) * totalPx : 0;
          const succPx = d.total > 0 ? (d.success / d.total) * totalPx : 0;
          return (
            <div key={d.day} className="flex-1 flex flex-col justify-end min-w-[24px]"
                 title={`${d.day} — ${d.success} OK · ${d.failed} KO · ${d.total} total`}>
              <div className="w-full rounded overflow-hidden flex flex-col justify-end" style={{ height: totalPx }}>
                {failPx > 0 && <div style={{ height: failPx, background: '#dc2626' }} />}
                {succPx > 0 && <div style={{ height: succPx, background: '#059669' }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {perDay.map(d => (
          <div key={d.day} className="flex-1 min-w-[24px] text-center text-[9px] text-ink-faint tabular-nums">
            {d.day.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { health } = useSsisContext();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!health?.configured) return;
    setLoading(true);
    setError(null);
    ssisApi.dashboard(days)
      .then(setData)
      .catch(e => setError(e.error || e.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, [days, health?.configured]);

  if (!health?.configured) return null; // le layout affiche déjà la mention "aucune connexion"

  return (
    <PageBody>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-ink-muted">Fenêtre :</span>
        <DaysPicker value={days} onChange={setDays} />
        {loading && <Loader2 size={13} className="animate-spin text-ink-faint" />}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            <StatCard icon={Activity}       label="Exécutions"    value={data.stats.total} />
            <StatCard icon={CheckCircle2}   label="Succès"        value={data.stats.success} tone={data.stats.success === data.stats.total ? 'default' : 'default'} />
            <StatCard icon={XCircle}        label="Échecs"        value={data.stats.failed} tone={data.stats.failed > 0 ? 'warn' : 'default'} />
            <StatCard icon={Clock}          label="Durée moy."    value={fmtDur(data.stats.avgDurSec)} />
            <StatCard icon={AlertOctagon}   label="Taux de succès" value={`${data.stats.successRate}%`} tone={data.stats.successRate < 90 ? 'warn' : 'default'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <h4 className="text-xs font-semibold text-ink mb-2">Exécutions par jour</h4>
              <p className="text-[11px] text-ink-muted mb-3">Vert = succès · Rouge = échecs</p>
              <DayBars perDay={data.perDay} />
            </Card>

            <Card>
              <h4 className="text-xs font-semibold text-ink mb-2">Top packages en échec</h4>
              {data.topFailures.length === 0 ? (
                <p className="text-xs text-ink-faint">Aucun échec 🎉</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
                      <th className="py-1.5 pr-2">Package</th>
                      <th className="py-1.5 pr-2">Projet · Folder</th>
                      <th className="py-1.5 pr-2 text-right">Échecs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.topFailures.map((f, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-2 font-mono text-ink">{f.package_name}</td>
                        <td className="py-1.5 pr-2 text-ink-muted">{f.project_name} · {f.folder_name}</td>
                        <td className="py-1.5 pr-2 text-right font-bold text-red-400">{f.failures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}

      {!data && !loading && !error && <Spinner label="Chargement…" />}
    </PageBody>
  );
}
