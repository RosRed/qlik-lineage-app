import React, { useEffect, useState } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, ErrorNote, EmptyState } from '../../components/ui/primitives';
import { fmtTime, DaysPicker } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';
import { AlertOctagon } from 'lucide-react';

/*
 * Erreurs récentes (message_type 120 = error, 130 = task_failed) groupées par
 * package, triées par volume. Chaque groupe se déploie pour voir les 5 dernières
 * occurrences avec le message complet.
 */

export default function ErrorsPage() {
  const { health } = useSsisContext();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    if (!health?.configured) return;
    setLoading(true); setError(null);
    ssisApi.errors(days, 150)
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [days, health?.configured]);

  if (!health?.configured) return null;

  const toggle = (key) => {
    const s = new Set(expanded);
    s.has(key) ? s.delete(key) : s.add(key);
    setExpanded(s);
  };

  return (
    <PageBody>
      <div className="flex items-center gap-2 mb-4">
        <DaysPicker value={days} onChange={setDays} />
        {loading && <Loader2 size={13} className="animate-spin text-ink-faint" />}
        {data && <span className="ml-auto text-[11px] text-ink-faint tabular-nums">
          {data.rows.length} erreurs · {data.groups.length} packages
        </span>}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {data && data.groups.length === 0 && (
        <EmptyState icon={AlertOctagon} title="Aucune erreur sur la période" description="Rien à signaler 🎉" />
      )}

      {data && data.groups.map(g => {
        const key = `${g.folder}/${g.project}/${g.package}`;
        const open = expanded.has(key);
        return (
          <Card key={key} className="!py-0 !px-0 mb-2 overflow-hidden">
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised text-left">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-danger truncate">{g.package}</div>
                <div className="text-[11px] text-ink-muted">{g.project} · {g.folder}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-danger tabular-nums">{g.count}</div>
                <div className="text-[10px] text-ink-faint">dernière {fmtTime(g.lastError)}</div>
              </div>
            </button>
            {open && (
              <div className="border-t border-line bg-raised divide-y divide-line">
                {g.items.map(m => (
                  <div key={m.id} className="px-4 py-2">
                    <div className="flex items-center gap-2 text-[10px] mb-1">
                      <span className="uppercase font-semibold text-danger">{m.typeLabel}</span>
                      <span className="text-ink-faint">{fmtTime(m.time)}</span>
                      <span className="text-ink-muted">{m.source}{m.subcomponent ? ` › ${m.subcomponent}` : ''}</span>
                    </div>
                    <div className="text-[11px] font-mono text-ink whitespace-pre-wrap break-words">{m.message}</div>
                  </div>
                ))}
                {g.count > g.items.length && (
                  <div className="px-4 py-2 text-[11px] text-ink-faint">
                    …et {g.count - g.items.length} autre(s) occurrence(s).
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </PageBody>
  );
}
