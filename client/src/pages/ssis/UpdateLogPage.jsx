import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, FileWarning, AlertTriangle, TrendingUp, TrendingDown,
  Minus, Zap, Table, ListTree, FileText, ChevronDown, ChevronRight
} from 'lucide-react';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, Select, SearchInput, Button, ErrorNote, EmptyState } from '../../components/ui/primitives';
import { fmtTime, DaysPicker } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Analyse des rechargements TABLE_UPDATE_LOG en trois angles :
 *   - Résumé  : 1 ligne par (table, société) avec dernier vs préc, delta, moyenne,
 *               score d'anomalie (chute, écart statistique, plantage…)
 *   - Runs    : regroupement par proximité temporelle (≤ 10 min) → "batch"
 *   - Brut    : le log détaillé (le rendu générique précédent)
 */

const ANOMALY_LABELS = {
  collapsed: { label: 'Effondrement', color: 'bg-red-900/50 text-red-200 border-red-700', tip: 'Précédent > 0 → dernier = 0' },
  big_drop:  { label: 'Chute > 50%', color: 'bg-red-900/30 text-red-300 border-red-800/40', tip: 'delta ≤ -50%' },
  big_jump:  { label: 'Hausse > 200%', color: 'bg-yellow-900/30 text-yellow-300 border-yellow-800/40', tip: 'delta ≥ +200%' },
  z_score:   { label: 'Aberration stat.', color: 'bg-orange-900/30 text-orange-300 border-orange-800/40', tip: '|z| > 2 sur 3+ runs' },
  stalled:   { label: 'Bloqué', color: 'bg-gray-800 text-gray-400 border-gray-700', tip: 'COUNT strictement identique' }
};

function fmtRows(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('fr-FR');
}

function fmtDelta(d) {
  if (d == null) return { text: '—', cls: 'text-ink-faint', Icon: Minus };
  if (d === 0) return { text: '0', cls: 'text-ink-faint', Icon: Minus };
  if (d > 0) return { text: `+${d.toLocaleString('fr-FR')}`, cls: 'text-emerald-400', Icon: TrendingUp };
  return { text: d.toLocaleString('fr-FR'), cls: 'text-red-400', Icon: TrendingDown };
}

function fmtPct(p) {
  if (p == null) return '';
  return ` (${(p * 100).toFixed(0)}%)`;
}

function AnomalyBadges({ list }) {
  if (!list?.length) return <span className="text-ink-faint text-[10px]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map(a => {
        const meta = ANOMALY_LABELS[a] || { label: a, color: 'bg-gray-800 text-gray-400' };
        return (
          <span key={a} title={meta.tip}
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${meta.color}`}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Vue Résumé ──────────────────────────────────────────────────────────────

function SummaryView({ database, days, refSoc }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [anomalyType, setAnomalyType] = useState('');
  const [minRows, setMinRows] = useState('');
  const [withPrevOnly, setWithPrevOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [sort, setSort] = useState('red_first');

  useEffect(() => {
    if (!database) return;
    setLoading(true); setError(null);
    ssisApi.updateLogSummary({ database, days, ref_societe: refSoc })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [database, days, refSoc]);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.length,
      critical: data.filter(r => r.severity === 'critical').length,
      warning: data.filter(r => r.severity === 'warning').length,
      info: data.filter(r => r.severity === 'info').length,
      ok: data.filter(r => r.severity === 'ok').length
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const minR = parseInt(minRows, 10) || 0;
    let list = data.filter(r => {
      if (severity && r.severity !== severity) return false;
      if (anomalyType && !r.anomalies.includes(anomalyType)) return false;
      if (withPrevOnly && r.prevCount == null) return false;
      if (changedOnly && (r.delta === null || r.delta === 0)) return false;
      if (minR > 0 && (r.lastCount || 0) < minR) return false;
      if (q && ![r.table, r.societeName, r.refSociete].some(v => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    // Tri par défaut : rouges (delta < 0) au-dessus, indépendamment de la sévérité.
    // Ordre exact : critiques → deltas négatifs (plus rouge en 1er) → deltas
    // positifs (plus gros gain en 1er) → deltas nuls (Bloqué) → sans précédent.
    if (sort === 'red_first') {
      const bucket = (r) => {
        if (r.severity === 'critical') return 0; // toujours en tête
        if (r.delta == null) return 4;           // sans précédent
        if (r.delta < 0) return 1;               // rouge
        if (r.delta > 0) return 2;               // vert
        return 3;                                // 0 (Bloqué)
      };
      list.sort((a, b) => {
        const ba = bucket(a), bb = bucket(b);
        if (ba !== bb) return ba - bb;
        if (ba === 1) return a.delta - b.delta;         // plus négatif en 1er
        if (ba === 2) return b.delta - a.delta;         // plus positif en 1er
        return Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
      });
    } else if (sort === 'delta_neg') {
      // Δ négatif d'abord, du plus négatif au moins négatif
      list.sort((a, b) => (a.delta ?? Infinity) - (b.delta ?? Infinity));
    } else if (sort === 'delta_abs') {
      list.sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
    } else if (sort === 'rows_desc') {
      list.sort((a, b) => (b.lastCount || 0) - (a.lastCount || 0));
    } else if (sort === 'name') {
      list.sort((a, b) => (a.table + a.refSociete).localeCompare(b.table + b.refSociete));
    } else if (sort === 'last_at_desc') {
      list.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    }
    return list;
  }, [data, search, severity, anomalyType, withPrevOnly, changedOnly, minRows, sort]);

  const hasActiveFilter = search || severity || anomalyType || withPrevOnly || changedOnly || minRows || sort !== 'red_first';
  const resetFilters = () => {
    setSearch(''); setSeverity(''); setAnomalyType(''); setWithPrevOnly(false);
    setChangedOnly(false); setMinRows(''); setSort('red_first');
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>;
  if (!data) return null;

  return (
    <>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <Card className="!p-2"><div className="text-[10px] uppercase text-ink-faint">Total</div><div className="text-lg font-bold">{stats.total}</div></Card>
          <Card className="!p-2 border-red-800/40"><div className="text-[10px] uppercase text-red-400">Critiques</div><div className="text-lg font-bold text-red-300">{stats.critical}</div></Card>
          <Card className="!p-2 border-yellow-800/40"><div className="text-[10px] uppercase text-yellow-400">Warnings</div><div className="text-lg font-bold text-yellow-300">{stats.warning}</div></Card>
          <Card className="!p-2 border-orange-800/40"><div className="text-[10px] uppercase text-orange-400">Info</div><div className="text-lg font-bold text-orange-300">{stats.info}</div></Card>
          <Card className="!p-2 border-emerald-800/40"><div className="text-[10px] uppercase text-emerald-400">OK</div><div className="text-lg font-bold text-emerald-300">{stats.ok}</div></Card>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Chercher table ou société…" className="max-w-xs" />
        <Select value={severity} onChange={setSeverity}>
          <option value="">Toutes sévérités</option>
          <option value="critical">Critique</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="ok">OK seulement</option>
        </Select>
        <Select value={anomalyType} onChange={setAnomalyType}>
          <option value="">Toutes anomalies</option>
          <option value="collapsed">Effondrement</option>
          <option value="big_drop">Chute &gt; 50%</option>
          <option value="big_jump">Hausse &gt; 200%</option>
          <option value="z_score">Aberration stat.</option>
          <option value="stalled">Bloqué</option>
        </Select>
        <Select value={minRows} onChange={setMinRows}>
          <option value="">Toute taille</option>
          <option value="100">≥ 100 rows</option>
          <option value="1000">≥ 1 000 rows</option>
          <option value="10000">≥ 10 000 rows</option>
          <option value="100000">≥ 100 000 rows</option>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
          <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} />
          Modifiés seulement
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
          <input type="checkbox" checked={withPrevOnly} onChange={e => setWithPrevOnly(e.target.checked)} />
          Avec précédent
        </label>
        <Select value={sort} onChange={setSort}>
          <option value="red_first">Tri : rouges d'abord</option>
          <option value="delta_neg">Tri : Δ négatif d'abord</option>
          <option value="delta_abs">Tri : |Δ| décroissant</option>
          <option value="last_at_desc">Tri : + récent</option>
          <option value="rows_desc">Tri : + gros volume</option>
          <option value="name">Tri : nom</option>
        </Select>
        {hasActiveFilter && (
          <button onClick={resetFilters}
            className="text-[11px] px-2.5 py-1.5 rounded border border-line hover:bg-raised text-ink-muted">
            Reset
          </button>
        )}
        <span className="ml-auto text-[11px] text-ink-faint">{filtered.length} / {data.length}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileWarning} title="Rien à afficher" description="Aucun rechargement ne correspond." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
                  <th className="py-2 px-3">Table</th>
                  <th className="py-2 px-3">Société</th>
                  <th className="py-2 px-3 text-right">Dernier</th>
                  <th className="py-2 px-3 text-right">Préc.</th>
                  <th className="py-2 px-3 text-right">Δ vs préc.</th>
                  <th className="py-2 px-3 text-right">Δ vs moy.</th>
                  <th className="py-2 px-3 text-right">Runs</th>
                  <th className="py-2 px-3">Anomalies</th>
                  <th className="py-2 px-3">Dernier run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r, i) => {
                  const d = fmtDelta(r.delta);
                  const da = fmtDelta(r.deltaVsAvg);
                  const rowCls =
                    r.severity === 'critical' ? 'bg-red-950/30' :
                    r.severity === 'warning'  ? 'bg-yellow-950/20' :
                    r.severity === 'info'     ? 'bg-orange-950/10' : '';
                  return (
                    <tr key={i} className={`hover:bg-raised/60 ${rowCls}`}>
                      <td className="py-2 px-3 font-mono text-info">{r.table}</td>
                      <td className="py-2 px-3 text-ink text-[11px]">{r.societeName || r.refSociete}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink">{fmtRows(r.lastCount)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink-muted">{fmtRows(r.prevCount)}</td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums ${d.cls}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          <d.Icon size={11} /> {d.text}<span className="text-[10px] text-ink-faint">{fmtPct(r.deltaPct)}</span>
                        </span>
                      </td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums ${da.cls}`}>{da.text}</td>
                      <td className="py-2 px-3 text-right text-[11px] text-ink-muted tabular-nums">{r.runCount}</td>
                      <td className="py-2 px-3"><AnomalyBadges list={r.anomalies} /></td>
                      <td className="py-2 px-3 text-[11px] text-ink-muted">{fmtTime(r.lastAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

// ─── Vue Runs ────────────────────────────────────────────────────────────────

function RunsView({ database, days, refSoc }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [gap, setGap] = useState(10);

  useEffect(() => {
    if (!database) return;
    setLoading(true); setError(null);
    ssisApi.updateLogRuns({ database, days, ref_societe: refSoc, gap })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [database, days, refSoc, gap]);

  const toggle = (id) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>;
  if (!data) return null;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-ink-muted">Écart max entre 2 tables d'un même run :</label>
        <Select value={String(gap)} onChange={v => setGap(parseInt(v, 10))}>
          <option value="5">5 min</option>
          <option value="10">10 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">1 heure</option>
        </Select>
        <span className="ml-auto text-[11px] text-ink-faint">{data.length} runs</span>
      </div>

      {data.length === 0 ? (
        <EmptyState icon={FileWarning} title="Aucun run détecté" description="Élargissez la fenêtre temporelle." />
      ) : (
        <div className="space-y-2">
          {data.map(run => {
            const open = expanded.has(run.runId);
            const items = run.tablesSummary
              ? run.tablesSummary.split(', ').map(s => {
                  const [name, count] = s.split(':');
                  return { name, count: Number(count) };
                })
              : [];
            return (
              <Card key={run.runId} className="!py-0 !px-0 overflow-hidden">
                <button onClick={() => toggle(run.runId)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised/50 text-left">
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{run.societeName || run.refSociete}</span>
                      <span className="text-[10px] text-ink-faint">({run.refSociete})</span>
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {fmtTime(run.startedAt)} → {fmtTime(run.endedAt)} · {run.durationMinutes} min
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-info">{run.tableCount} tables</div>
                    <div className="text-[10px] text-ink-faint tabular-nums">{fmtRows(run.totalRows)} rows</div>
                  </div>
                </button>
                {open && items.length > 0 && (
                  <div className="border-t border-line bg-raised/30 px-4 py-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[11px] font-mono">
                      {items.map((t, i) => (
                        <div key={i} className="flex justify-between border-b border-line/30 py-0.5">
                          <span className="text-info truncate">{t.name}</span>
                          <span className="text-ink tabular-nums">{fmtRows(t.count)}</span>
                        </div>
                      ))}
                    </div>
                    {run.tableCount > items.length && (
                      <div className="text-[10px] text-ink-faint mt-2">
                        …et {run.tableCount - items.length} autre(s) table(s) — limité à 30 pour l'affichage.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Vue Brute ───────────────────────────────────────────────────────────────

function fmtCell(val) {
  if (val == null) return <span className="text-ink-faint">—</span>;
  if (typeof val === 'number') return val.toLocaleString('fr-FR');
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return fmtTime(val);
  if (val instanceof Date) return fmtTime(val.toISOString());
  return String(val).trim();
}

function RawView({ database, days, refSoc }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!database) return;
    setLoading(true); setError(null);
    ssisApi.updateLog({ database, days, ref_societe: refSoc, search: '', limit: 500 })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [database, days, refSoc]);

  const columns = useMemo(() => {
    if (!data) return [];
    const cols = data.columns.map(c => c.name);
    if (data.rows.some(r => r.__societe_name !== undefined)) cols.push('__societe_name');
    return cols;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
  }, [data, search]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>;
  if (!data) return null;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Chercher…" className="max-w-xs" />
        <span className="ml-auto text-[11px] text-ink-faint">{filtered.length} / {data.rows.length}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileWarning} title="Aucune ligne" description="La table TABLE_UPDATE_LOG est vide sur ces filtres." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
                  {columns.map(c => (
                    <th key={c} className={`py-2 px-3 ${c === '__societe_name' ? 'text-emerald-400' : ''}`}>
                      {c === '__societe_name' ? 'Société (join)' : c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-raised/60">
                    {columns.map(c => (
                      <td key={c} className={`py-2 px-3 font-mono ${
                        c === '__societe_name' ? 'text-emerald-300' :
                        typeof r[c] === 'number' ? 'text-right tabular-nums text-ink' : 'text-ink-muted'
                      }`}>{fmtCell(r[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function UpdateLogPage() {
  const { health } = useSsisContext();
  const [databases, setDatabases] = useState([]);
  const [database, setDatabase] = useState('');
  const [societes, setSocietes] = useState([]);
  const [refSoc, setRefSoc] = useState('');
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState('summary');

  useEffect(() => {
    if (!health?.configured) return;
    ssisApi.databases().then(list => {
      setDatabases(list);
      const preferred = list.find(n => n.toLowerCase().includes('groupe')) || list[0];
      if (preferred) setDatabase(preferred);
    }).catch(() => {});
  }, [health?.configured]);

  useEffect(() => {
    if (!database) return;
    ssisApi.societes(database).then(setSocietes).catch(() => setSocietes([]));
  }, [database]);

  if (!health?.configured) return null;

  const tabBtn = (id, label, Icon) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        tab === id ? 'bg-accent-soft text-accent-ink border-accent' : 'border-line text-ink-muted hover:text-ink hover:bg-raised'
      }`}>
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <PageBody>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Select value={database} onChange={setDatabase}>
          <option value="">— Base —</option>
          {databases.map(d => <option key={d} value={d}>{d}</option>)}
        </Select>
        <DaysPicker value={days} onChange={setDays} />
        {societes.length > 0 && (
          <Select value={refSoc} onChange={setRefSoc}>
            <option value="">Toutes sociétés ({societes.length})</option>
            {societes.map(s => <option key={s.ref} value={s.ref}>{String(s.name || s.ref).trim()}</option>)}
          </Select>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        {tabBtn('summary', 'Résumé & anomalies', AlertTriangle)}
        {tabBtn('runs',    'Runs (batches)',      ListTree)}
        {tabBtn('raw',     'Log brut',            FileText)}
      </div>

      {tab === 'summary' && <SummaryView database={database} days={days} refSoc={refSoc} />}
      {tab === 'runs'    && <RunsView    database={database} days={days} refSoc={refSoc} />}
      {tab === 'raw'     && <RawView     database={database} days={days} refSoc={refSoc} />}
    </PageBody>
  );
}
