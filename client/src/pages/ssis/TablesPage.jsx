import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Camera, TrendingUp, TrendingDown, Minus, X, RefreshCw, Search, Zap, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, Select, SearchInput, Button, ErrorNote, EmptyState } from '../../components/ui/primitives';
import { fmtTime } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Vague 3 — écart de rows entre rechargements.
 * Étapes utilisateur :
 *  1. Choisir la base cible (défaut Groupe si détecté)
 *  2. Cliquer "Snapshoter maintenant" une première fois → capture les row counts
 *  3. Attendre le prochain reload SSIS (ou snapshoter à nouveau) → delta calculé
 *
 * Le row count est lu via sys.dm_db_partition_stats → O(1), pas de scan.
 */

function fmtRows(n) {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR');
}

function fmtDelta(d) {
  if (d == null) return { text: '—', className: 'text-ink-faint', icon: Minus };
  if (d === 0) return { text: '0', className: 'text-ink-faint', icon: Minus };
  if (d > 0) return { text: `+${d.toLocaleString('fr-FR')}`, className: 'text-emerald-400', icon: TrendingUp };
  return { text: d.toLocaleString('fr-FR'), className: 'text-red-400', icon: TrendingDown };
}

function TableHistoryDrawer({ database, schema, table, onClose }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setHistory(null); setError(null);
    ssisApi.tableHistory(database, schema, table, 50)
      .then(h => setHistory(h.reverse())) // du + récent au + ancien pour l'affichage
      .catch(e => setError(e.error || e.message));
  }, [database, schema, table]);

  const del = async () => {
    if (!window.confirm(`Supprimer tout l'historique de ${schema}.${table} ?`)) return;
    try {
      await ssisApi.deleteSnapshots({ database, schema, table });
      toast.success('Historique supprimé');
      onClose(true);
    } catch (e) {
      toast.error(e.error || e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-end" onClick={() => onClose()}>
      <div className="bg-surface border-l border-line w-full max-w-lg h-full overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <h3 className="text-sm font-semibold text-ink font-mono">{schema}.{table}</h3>
            <p className="text-[11px] text-ink-muted">{database} — historique des snapshots</p>
          </div>
          <button onClick={() => onClose()} className="text-ink-faint hover:text-ink"><X size={16} /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!history && !error && <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>}
          {history && history.length === 0 && <p className="text-xs text-ink-faint">Aucun snapshot pour cette table.</p>}
          {history && history.length > 0 && (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line">
                    <th className="py-1.5 pr-2">Date</th>
                    <th className="py-1.5 pr-2 text-right">Rows</th>
                    <th className="py-1.5 pr-2 text-right">Δ vs préc.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.map(h => {
                    const d = fmtDelta(h.delta);
                    return (
                      <tr key={h.id}>
                        <td className="py-1.5 pr-2 text-ink-muted">{fmtTime(h.capturedAt)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{fmtRows(h.rowCount)}</td>
                        <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${d.className}`}>{d.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-4">
                <button onClick={del} className="text-[11px] text-red-400 hover:underline">
                  Supprimer tout l'historique
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TablesPage() {
  const { health } = useSsisContext();
  const [databases, setDatabases] = useState([]);
  const [database, setDatabase] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [sort, setSort] = useState('rows_desc'); // rows_desc | delta_desc | name_asc
  const [selected, setSelected] = useState(null);
  const [autoState, setAutoState] = useState(null);

  const loadAutoState = () => ssisApi.autosnapshotStatus().then(setAutoState).catch(() => {});
  useEffect(() => { loadAutoState(); }, []);

  const toggleAuto = async () => {
    if (!database) { toast.error('Sélectionnez une base d\'abord'); return; }
    try {
      const enabled = !autoState?.enabled;
      const s = await ssisApi.autosnapshotSet(enabled, database);
      setAutoState(s);
      toast.success(enabled ? `Auto-snapshot activé sur ${database}` : 'Auto-snapshot désactivé');
    } catch (e) { toast.error(e.error || e.message); }
  };

  const triggerAuto = async () => {
    try {
      const s = await ssisApi.autosnapshotTrigger();
      setAutoState(s);
      toast.success('Vérification lancée');
      setTimeout(loadStatus, 3000);
    } catch (e) { toast.error(e.error || e.message); }
  };

  // Charge la liste des bases
  useEffect(() => {
    if (!health?.configured) return;
    ssisApi.databases().then(list => {
      setDatabases(list);
      // Défaut : première base contenant "groupe" (ex "Groupe Premium"), sinon la première
      const preferred = list.find(n => n.toLowerCase().includes('groupe')) || list[0];
      if (preferred) setDatabase(preferred);
    }).catch(e => setError(e.error || e.message));
  }, [health?.configured]);

  const loadStatus = () => {
    if (!database) return;
    setLoading(true); setError(null);
    ssisApi.tablesStatus(database)
      .then(setStatus)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (database) loadStatus(); /* eslint-disable-next-line */ }, [database]);

  const snapshot = async () => {
    setSnapshotting(true);
    try {
      const res = await ssisApi.snapshot(database);
      toast.success(`Snapshot pris : ${res.tables} tables`);
      loadStatus();
    } catch (e) {
      toast.error(e.error || e.message || 'Échec du snapshot');
    } finally {
      setSnapshotting(false);
    }
  };

  const filtered = useMemo(() => {
    if (!status) return [];
    const q = search.trim().toLowerCase();
    let list = status.filter(t => {
      if (q && !`${t.schema}.${t.name}`.toLowerCase().includes(q)) return false;
      if (changedOnly && (t.delta === null || t.delta === 0)) return false;
      return true;
    });
    if (sort === 'rows_desc') list.sort((a, b) => b.rowCount - a.rowCount);
    else if (sort === 'delta_desc') list.sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
    else if (sort === 'name_asc') list.sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
    return list;
  }, [status, search, changedOnly, sort]);

  const summary = useMemo(() => {
    if (!status) return null;
    const withHistory = status.filter(t => t.snapshotCount > 0).length;
    const changed = status.filter(t => t.delta !== null && t.delta !== 0).length;
    const grew = status.filter(t => t.delta > 0).length;
    const shrunk = status.filter(t => t.delta < 0).length;
    const totalRows = status.reduce((s, t) => s + t.rowCount, 0);
    return { total: status.length, withHistory, changed, grew, shrunk, totalRows };
  }, [status]);

  if (!health?.configured) return null;

  return (
    <PageBody>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Select value={database} onChange={setDatabase}>
          <option value="">— Sélectionner une base —</option>
          {databases.map(d => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Button variant="primary" onClick={snapshot} disabled={!database || snapshotting || loading}>
          {snapshotting ? <><Loader2 size={13} className="animate-spin mr-1 inline" /> En cours…</> : <><Camera size={13} className="mr-1 inline" /> Snapshoter maintenant</>}
        </Button>
        <Button onClick={loadStatus} disabled={!database || loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
        {summary && (
          <span className="ml-auto text-[11px] text-ink-faint">
            {summary.total} tables · {fmtRows(summary.totalRows)} rows · {summary.withHistory} avec historique
            {summary.changed > 0 && <> · <span className="text-yellow-400">{summary.changed} modifiées</span></>}
          </span>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className={`mb-4 ${autoState?.enabled ? 'border-emerald-800/40 bg-emerald-900/10' : ''}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Zap size={14} className={autoState?.enabled ? 'text-emerald-400' : 'text-ink-faint'} />
              Auto-snapshot après chaque exécution SSIS
              {autoState?.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">ACTIF</span>}
            </div>
            <p className="text-[11px] text-ink-muted mt-1">
              Le serveur polle <code>catalog.executions</code> toutes les 5 min. Dès qu'un package se termine,
              il snapshotte automatiquement les tables de la base configurée.
              {autoState?.database && <> Base cible : <b className="text-ink">{autoState.database}</b></>}
              {autoState?.lastExecId != null && <> · Dernière exécution vue : <code>{autoState.lastExecId}</code></>}
            </p>
            {autoState?.recentEvents?.length > 0 && (
              <details className="mt-2">
                <summary className="text-[11px] text-ink-muted cursor-pointer hover:text-ink">
                  Voir les {autoState.recentEvents.length} derniers événements
                </summary>
                <div className="mt-2 space-y-0.5 text-[10px] font-mono max-h-40 overflow-y-auto">
                  {autoState.recentEvents.map((e, i) => (
                    <div key={i} className={
                      e.type === 'error' ? 'text-red-400'
                      : e.type === 'snapshot' ? 'text-emerald-400'
                      : 'text-ink-muted'
                    }>
                      [{fmtTime(e.at)}] {e.type}
                      {e.package && ` ${e.package}`}
                      {e.tables != null && ` (${e.tables} tables)`}
                      {e.detail && ` — ${e.detail}`}
                      {e.error && ` — ${e.error}`}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button onClick={triggerAuto} disabled={!autoState?.enabled}>
              <Play size={12} className="inline mr-1" /> Vérifier maintenant
            </Button>
            <Button
              variant={autoState?.enabled ? 'secondary' : 'primary'}
              onClick={toggleAuto}
              disabled={!database}>
              {autoState?.enabled ? 'Désactiver' : 'Activer'}
            </Button>
          </div>
        </div>
      </Card>

      {status && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Chercher schema.table…" className="max-w-xs" />
            <Select value={sort} onChange={setSort}>
              <option value="rows_desc">Trier : plus grosses</option>
              <option value="delta_desc">Trier : |Δ| décroissant</option>
              <option value="name_asc">Trier : nom A→Z</option>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
              <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} />
              Modifiées seulement
            </label>
            <span className="ml-auto text-[11px] text-ink-faint">{filtered.length} affichées</span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Search} title="Aucune table" description="Aucune table ne correspond aux filtres." />
          ) : (
            <Card className="!p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
                      <th className="py-2 px-3">Table</th>
                      <th className="py-2 px-3 text-right">Rows actuels</th>
                      <th className="py-2 px-3 text-right">Δ vs dernier snapshot</th>
                      <th className="py-2 px-3">Dernier snapshot</th>
                      <th className="py-2 px-3 text-right">Historique</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filtered.map(t => {
                      const d = fmtDelta(t.delta);
                      const Icon = d.icon;
                      const pct = t.lastSnapshotRowCount && t.delta !== null && t.lastSnapshotRowCount > 0
                        ? ((t.delta / t.lastSnapshotRowCount) * 100).toFixed(1)
                        : null;
                      return (
                        <tr key={`${t.schema}.${t.name}`}
                            onClick={() => setSelected({ schema: t.schema, name: t.name })}
                            className="hover:bg-raised/60 cursor-pointer">
                          <td className="py-2 px-3 font-mono text-info">
                            <span className="text-ink-faint">{t.schema}.</span>{t.name}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-ink">{fmtRows(t.rowCount)}</td>
                          <td className={`py-2 px-3 text-right font-mono tabular-nums ${d.className}`}>
                            <span className="inline-flex items-center gap-1 justify-end">
                              <Icon size={11} /> {d.text}
                              {pct && <span className="text-[10px] text-ink-faint">({pct}%)</span>}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-ink-muted text-[11px]">{t.lastSnapshotAt ? fmtTime(t.lastSnapshotAt) : '—'}</td>
                          <td className="py-2 px-3 text-right text-[11px] text-ink-muted">
                            {t.snapshotCount > 0 ? `${t.snapshotCount} snapshot(s)` : <span className="text-ink-faint">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {selected && database && (
        <TableHistoryDrawer
          database={database}
          schema={selected.schema}
          table={selected.name}
          onClose={(refresh) => {
            setSelected(null);
            if (refresh) loadStatus();
          }}
        />
      )}
    </PageBody>
  );
}
