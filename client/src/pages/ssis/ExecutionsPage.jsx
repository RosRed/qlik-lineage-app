import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, SearchInput, Select, ErrorNote, Button } from '../../components/ui/primitives';
import { fmtDur, fmtTime, DaysPicker, StatusBadge } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

const STATUS_OPTIONS = [
  ['', 'Tous statuts'],
  ['7', 'Succès'],
  ['4', 'Échec'],
  ['6', 'Ended unexpectedly'],
  ['2', 'En cours'],
  ['3', 'Annulé']
];

const DURATION_OPTIONS = [
  ['', 'Toute durée'],
  ['lt_1m', '< 1 min'],
  ['1_10m', '1–10 min'],
  ['gt_10m', '> 10 min'],
  ['gt_1h', '> 1 heure']
];

const SORT_OPTIONS = [
  ['start_desc',    'Date : + récent'],
  ['start_asc',     'Date : + ancien'],
  ['duration_desc', 'Durée : + long'],
  ['duration_asc',  'Durée : + court'],
  ['package_asc',   'Package A→Z']
];

function ExecutionDetail({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    ssisApi.executionDetail(id).then(setData).catch(e => setError(e.error || e.message));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-line rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h3 className="text-sm font-semibold text-ink">Exécution #{id}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!data && !error && <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>}
          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-4">
                <div><div className="text-ink-faint text-[10px] uppercase">Package</div><div className="font-mono">{data.execution.package}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Projet · Folder</div><div>{data.execution.project} · {data.execution.folder}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Statut</div><StatusBadge bucket={data.execution.bucket} label={data.execution.statusLabel} /></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Durée</div><div>{fmtDur(data.execution.durationSec)}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Début</div><div>{fmtTime(data.execution.startTime)}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Fin</div><div>{fmtTime(data.execution.endTime)}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Machine</div><div>{data.execution.machine || '—'}</div></div>
                <div><div className="text-ink-faint text-[10px] uppercase">Exécuté par</div><div>{data.execution.executedAs || '—'}</div></div>
              </div>
              <h4 className="text-xs font-semibold text-ink mb-2">Messages ({data.messages.length})</h4>
              {data.messages.length === 0 ? (
                <p className="text-xs text-ink-faint">Aucun warning ni erreur.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.messages.map(m => (
                    <div key={m.id} className={`text-[11px] rounded border px-2.5 py-1.5 ${
                      m.typeLabel === 'error' || m.typeLabel === 'task_failed'
                        ? 'border-danger bg-danger-soft'
                        : 'border-warn bg-warn-soft'}`}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`font-semibold ${m.typeLabel === 'error' || m.typeLabel === 'task_failed' ? 'text-danger' : 'text-warn'}`}>
                          {m.typeLabel}
                        </span>
                        <span className="text-ink-faint">{fmtTime(m.time)}</span>
                        <span className="text-ink-muted">{m.source}{m.subcomponent ? ` › ${m.subcomponent}` : ''}</span>
                      </div>
                      <div className="text-ink whitespace-pre-wrap break-words font-mono">{m.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExecutionsPage() {
  const { health } = useSsisContext();
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState('');
  const [pkg, setPkg] = useState('');
  const [folder, setFolder] = useState('');
  const [project, setProject] = useState('');
  const [machine, setMachine] = useState('');
  const [duration, setDuration] = useState('');
  const [sort, setSort] = useState('start_desc');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [foldersData, setFoldersData] = useState({ folders: [], machines: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const limit = 50;

  useEffect(() => {
    if (!health?.configured) return;
    ssisApi.folders().then(setFoldersData).catch(() => {});
  }, [health?.configured]);

  useEffect(() => {
    if (!health?.configured) return;
    setLoading(true);
    setError(null);
    ssisApi.executions({ days, status, folder, project, pkg, machine, duration, sort, limit, offset })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [days, status, folder, project, pkg, machine, duration, sort, offset, health?.configured]);

  // Reset offset when filters change
  useEffect(() => { setOffset(0); }, [days, status, folder, project, pkg, machine, duration, sort]);

  const projects = useMemo(() => {
    const f = foldersData.folders?.find(x => x.folder === folder);
    return f ? f.projects : [];
  }, [foldersData, folder]);

  const hasActiveFilter = status || folder || project || pkg || machine || duration || sort !== 'start_desc';
  const resetFilters = () => {
    setStatus(''); setFolder(''); setProject(''); setPkg('');
    setMachine(''); setDuration(''); setSort('start_desc');
  };

  if (!health?.configured) return null;

  return (
    <PageBody>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <DaysPicker value={days} onChange={setDays} />
        <Select value={status} onChange={setStatus}>
          {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select value={folder} onChange={v => { setFolder(v); setProject(''); }}>
          <option value="">Tous folders</option>
          {foldersData.folders?.map(f => <option key={f.folder} value={f.folder}>{f.folder}</option>)}
        </Select>
        {folder && (
          <Select value={project} onChange={setProject}>
            <option value="">Tous projets</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        {foldersData.machines?.length > 1 && (
          <Select value={machine} onChange={setMachine}>
            <option value="">Toutes machines</option>
            {foldersData.machines.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}
        <Select value={duration} onChange={setDuration}>
          {DURATION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <SearchInput value={pkg} onChange={setPkg} placeholder="Filtre package…" className="max-w-[220px]" />
        <Select value={sort} onChange={setSort}>
          {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {hasActiveFilter && (
          <button onClick={resetFilters}
            className="text-[11px] px-2.5 py-1.5 rounded border border-line hover:bg-raised text-ink-muted">
            Reset
          </button>
        )}
        {loading && <Loader2 size={13} className="animate-spin text-ink-faint" />}
        <span className="ml-auto text-[11px] text-ink-faint tabular-nums">
          {data ? `${offset + 1}–${Math.min(offset + limit, data.total)} / ${data.total}` : ''}
        </span>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {data && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
                  <th className="py-2 px-3">Statut</th>
                  <th className="py-2 px-3">Package</th>
                  <th className="py-2 px-3">Projet · Folder</th>
                  <th className="py-2 px-3">Début</th>
                  <th className="py-2 px-3">Durée</th>
                  <th className="py-2 px-3">Machine</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map(r => (
                  <tr key={r.execution_id} onClick={() => setSelected(r.execution_id)}
                      className="hover:bg-raised cursor-pointer">
                    <td className="py-2 px-3"><StatusBadge bucket={r.bucket} label={r.statusLabel} /></td>
                    <td className="py-2 px-3 font-mono text-info">{r.package}</td>
                    <td className="py-2 px-3 text-ink-muted">{r.project} · {r.folder}</td>
                    <td className="py-2 px-3">{fmtTime(r.startTime)}</td>
                    <td className="py-2 px-3 tabular-nums">{fmtDur(r.durationSec)}</td>
                    <td className="py-2 px-3 text-ink-faint text-[11px]">{r.machine || '—'}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-ink-faint">Aucune exécution.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data.total > limit && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-line bg-raised">
              <Button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>
                <ChevronLeft size={13} /> Précédent
              </Button>
              <span className="text-[11px] text-ink-muted">Page {Math.floor(offset / limit) + 1} / {Math.ceil(data.total / limit)}</span>
              <Button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= data.total}>
                Suivant <ChevronRight size={13} />
              </Button>
            </div>
          )}
        </Card>
      )}

      {selected && <ExecutionDetail id={selected} onClose={() => setSelected(null)} />}
    </PageBody>
  );
}
