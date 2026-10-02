import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, FileWarning, AlertTriangle, TrendingUp, TrendingDown,
  Minus, Zap, Table, ListTree, FileText, ChevronDown, ChevronRight, HeartPulse,
  CalendarDays
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
 *
 * La référence de comparaison ("Préc.") est par défaut l'exécution qui précède
 * immédiatement la dernière. `baseline` (AAAA-MM-JJ) permet de la fixer sur une
 * date précise : on prend alors le dernier chargement enregistré avant la fin de
 * cette journée-là, pour chaque couple (table, société).
 */

// ─── Date de comparaison ─────────────────────────────────────────────────────

/** Date locale au format AAAA-MM-JJ (pas toISOString : celui-ci décale en UTC). */
function toISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

/** AAAA-MM-JJ → JJ/MM (affichage compact dans les en-têtes de colonne). */
function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

const chipCls = (active) =>
  `text-[11px] px-2 py-1 rounded border transition-colors ${
    active
      ? 'bg-accent-soft text-accent-ink border-accent'
      : 'border-line text-ink-muted hover:text-ink hover:bg-raised'
  }`;

/**
 * Choix de la référence de comparaison : raccourcis (exécution précédente,
 * hier, semaine dernière) + calendrier libre. Valeur '' = mode automatique.
 */
function BaselinePicker({ value, onChange }) {
  const today = toISODate(new Date());
  const yesterday = daysAgo(1);
  const lastWeek = daysAgo(7);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-ink-faint flex items-center gap-1">
        <CalendarDays size={12} /> Comparer à
      </span>
      <button onClick={() => onChange('')} className={chipCls(!value)}
        title="Comparer à l'exécution qui précède immédiatement la dernière">
        Exécution préc.
      </button>
      <button onClick={() => onChange(yesterday)} className={chipCls(value === yesterday)}
        title={`Dernier chargement au ${fmtDay(yesterday)}`}>
        Hier
      </button>
      <button onClick={() => onChange(lastWeek)} className={chipCls(value === lastWeek)}
        title={`Dernier chargement au ${fmtDay(lastWeek)}`}>
        Semaine dernière
      </button>
      <input
        type="date"
        max={today}
        value={value}
        onChange={e => onChange(e.target.value)}
        title="Comparer au dernier chargement enregistré à cette date"
        className="bg-canvas border border-line rounded-lg px-2 py-1 text-xs text-ink outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}

const ANOMALY_LABELS = {
  collapsed: { label: 'Effondrement', color: 'bg-danger-soft text-danger border-danger', tip: 'Précédent > 0 → dernier = 0' },
  big_drop:  { label: 'Chute > 50%', color: 'bg-danger-soft text-danger border-danger', tip: 'delta ≤ -50%' },
  big_jump:  { label: 'Hausse > 200%', color: 'bg-warn-soft text-warn border-warn', tip: 'delta ≥ +200%' },
  z_score:   { label: 'Aberration stat.', color: 'bg-warn-soft text-warn border-warn', tip: '|z| > 2 sur 3+ runs' },
  stalled:   { label: 'Bloqué', color: 'bg-raised text-ink-muted border-line', tip: 'COUNT strictement identique' }
};

function fmtRows(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('fr-FR');
}

function fmtDelta(d) {
  if (d == null) return { text: '—', cls: 'text-ink-faint', Icon: Minus };
  if (d === 0) return { text: '0', cls: 'text-ink-faint', Icon: Minus };
  if (d > 0) return { text: `+${d.toLocaleString('fr-FR')}`, cls: 'text-accent-ink', Icon: TrendingUp };
  return { text: d.toLocaleString('fr-FR'), cls: 'text-danger', Icon: TrendingDown };
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
        const meta = ANOMALY_LABELS[a] || { label: a, color: 'bg-raised text-ink-muted' };
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

function SummaryView({ database, days, refSoc, baseline }) {
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
    ssisApi.updateLogSummary({ database, days, ref_societe: refSoc, baseline })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [database, days, refSoc, baseline]);

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
          <Card className="!p-2 border-danger"><div className="text-[10px] uppercase text-danger">Critiques</div><div className="text-lg font-bold text-danger">{stats.critical}</div></Card>
          <Card className="!p-2 border-warn"><div className="text-[10px] uppercase text-warn">Warnings</div><div className="text-lg font-bold text-warn">{stats.warning}</div></Card>
          <Card className="!p-2 border-warn"><div className="text-[10px] uppercase text-warn">Info</div><div className="text-lg font-bold text-warn">{stats.info}</div></Card>
          <Card className="!p-2 border-accent"><div className="text-[10px] uppercase text-accent-ink">OK</div><div className="text-lg font-bold text-accent-ink">{stats.ok}</div></Card>
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

      {baseline && (
        <div className="mb-3 text-[11px] text-ink-muted flex items-center gap-1.5">
          <CalendarDays size={12} className="text-accent-ink" />
          Comparaison avec le dernier chargement enregistré au <strong className="text-ink">{fmtDay(baseline)}</strong>.
          Les tables sans chargement antérieur à cette date apparaissent sans précédent.
        </div>
      )}

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
                  <th className="py-2 px-3 text-right">{baseline ? `Au ${fmtDay(baseline)}` : 'Préc.'}</th>
                  <th className="py-2 px-3 text-right">{baseline ? `Δ vs ${fmtDay(baseline)}` : 'Δ vs préc.'}</th>
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
                    r.severity === 'critical' ? 'bg-danger-soft' :
                    r.severity === 'warning'  ? 'bg-warn-soft' :
                    r.severity === 'info'     ? 'bg-warn-soft' : '';
                  return (
                    <tr key={i} className={`hover:bg-raised ${rowCls}`}>
                      <td className="py-2 px-3 font-mono text-info">{r.table}</td>
                      <td className="py-2 px-3 text-ink text-[11px]">{r.societeName || r.refSociete}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink">{fmtRows(r.lastCount)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink-muted"
                        title={r.prevAt ? `Chargement du ${fmtTime(r.prevAt)}` : 'Aucun chargement antérieur'}>
                        {fmtRows(r.prevCount)}
                      </td>
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
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised text-left">
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
                  <div className="border-t border-line bg-raised px-4 py-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[11px] font-mono">
                      {items.map((t, i) => (
                        <div key={i} className="flex justify-between border-b border-line py-0.5">
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

// ─── Vue Santé société ──────────────────────────────────────────────────────

function HealthView({ database, days, refSoc, baseline }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [sort, setSort] = useState('score_asc'); // score_asc = pires en tête

  useEffect(() => {
    if (!database) return;
    setLoading(true); setError(null);
    ssisApi.updateLogSummary({ database, days, ref_societe: refSoc, baseline })
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [database, days, refSoc, baseline]);

  // Agrégation par société : compte total, anomalies, score de santé.
  const societes = useMemo(() => {
    if (!data) return [];
    const byRef = new Map();
    for (const r of data) {
      const key = r.refSociete;
      if (!byRef.has(key)) byRef.set(key, {
        refSociete: key, name: r.societeName || key,
        total: 0, ok: 0, critical: 0, warning: 0, info: 0,
        anomalies: [], totalRows: 0, worstTables: []
      });
      const soc = byRef.get(key);
      soc.total++;
      soc[r.severity]++;
      soc.totalRows += (r.lastCount || 0);
      if (r.severity !== 'ok') {
        soc.anomalies.push({ table: r.table, severity: r.severity, anomalies: r.anomalies, delta: r.delta, deltaPct: r.deltaPct });
      }
    }

    const list = [...byRef.values()].map(s => {
      // Score de santé sur 100 : 100 - (crit×5 + warn×2 + info×0.5)*100/total, borné [0,100]
      const penalty = (s.critical * 5 + s.warning * 2 + s.info * 0.5) * 100 / Math.max(1, s.total);
      const score = Math.max(0, Math.min(100, 100 - penalty));
      // Top 5 pires tables (par sévérité puis |delta|)
      const rank = { critical: 3, warning: 2, info: 1 };
      const worst = s.anomalies
        .sort((a, b) => (rank[b.severity] - rank[a.severity]) || Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
        .slice(0, 5);
      return { ...s, score, worstTables: worst };
    });

    if (sort === 'score_asc') list.sort((a, b) => a.score - b.score);
    else if (sort === 'score_desc') list.sort((a, b) => b.score - a.score);
    else if (sort === 'anomalies_desc') list.sort((a, b) => (b.critical + b.warning) - (a.critical + a.warning));
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, sort]);

  const toggle = (ref) => {
    const s = new Set(expanded);
    s.has(ref) ? s.delete(ref) : s.add(ref);
    setExpanded(s);
  };

  const scoreColor = (score) => {
    if (score >= 90) return 'text-accent-ink';
    if (score >= 70) return 'text-warn';
    if (score >= 50) return 'text-warn';
    return 'text-danger';
  };
  const scoreBarColor = (score) => {
    if (score >= 90) return 'bg-accent';
    if (score >= 70) return 'bg-warn';
    if (score >= 50) return 'bg-warn';
    return 'bg-danger';
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <div className="text-xs text-ink-muted"><Loader2 size={13} className="inline animate-spin mr-1" /> Chargement…</div>;
  if (!data) return null;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Select value={sort} onChange={setSort}>
          <option value="score_asc">Tri : pires d'abord</option>
          <option value="score_desc">Tri : meilleures d'abord</option>
          <option value="anomalies_desc">Tri : + d'anomalies</option>
          <option value="name">Tri : nom</option>
        </Select>
        <span className="ml-auto text-[11px] text-ink-faint">{societes.length} sociétés</span>
      </div>

      {societes.length === 0 ? (
        <EmptyState icon={HeartPulse} title="Aucune donnée" description="Élargissez la fenêtre." />
      ) : (
        <div className="space-y-2">
          {societes.map(soc => {
            const open = expanded.has(soc.refSociete);
            return (
              <Card key={soc.refSociete} className="!py-0 !px-0 overflow-hidden">
                <button onClick={() => toggle(soc.refSociete)}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-raised text-left">
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{soc.name}</span>
                      <span className="text-[10px] text-ink-faint">({soc.refSociete})</span>
                    </div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {soc.total} tables · {fmtRows(soc.totalRows)} rows
                      {soc.critical > 0 && <span className="text-danger"> · {soc.critical} critiques</span>}
                      {soc.warning > 0 && <span className="text-warn"> · {soc.warning} warnings</span>}
                      {soc.info > 0    && <span className="text-warn"> · {soc.info} info</span>}
                    </div>
                  </div>
                  {/* Barre de santé */}
                  <div className="w-32 md:w-48 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-2 bg-raised rounded overflow-hidden">
                        <div className={`h-full ${scoreBarColor(soc.score)} transition-all`}
                          style={{ width: `${soc.score}%` }} />
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${scoreColor(soc.score)}`}>
                        {Math.round(soc.score)}
                      </span>
                    </div>
                    <div className="text-[9px] text-ink-faint text-right uppercase tracking-wider">Score santé</div>
                  </div>
                </button>
                {open && (
                  <div className="border-t border-line bg-raised px-4 py-3">
                    {soc.worstTables.length === 0 ? (
                      <p className="text-xs text-accent-ink">Aucune anomalie 🎉</p>
                    ) : (
                      <>
                        <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-2">
                          Top {soc.worstTables.length} tables problématiques
                        </div>
                        <div className="space-y-1">
                          {soc.worstTables.map((t, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                t.severity === 'critical' ? 'bg-danger-soft text-danger' :
                                t.severity === 'warning'  ? 'bg-warn-soft text-warn' :
                                                            'bg-warn-soft text-warn'}`}>
                                {t.severity}
                              </span>
                              <span className="font-mono text-info flex-1">{t.table}</span>
                              <AnomalyBadges list={t.anomalies} />
                              <span className={`font-mono tabular-nums text-[11px] ${fmtDelta(t.delta).cls}`}>
                                {fmtDelta(t.delta).text}
                                {t.deltaPct != null && <span className="text-[9px] text-ink-faint"> ({(t.deltaPct * 100).toFixed(0)}%)</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
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
                    <th key={c} className={`py-2 px-3 ${c === '__societe_name' ? 'text-accent-ink' : ''}`}>
                      {c === '__societe_name' ? 'Société (join)' : c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-raised">
                    {columns.map(c => (
                      <td key={c} className={`py-2 px-3 font-mono ${
                        c === '__societe_name' ? 'text-accent-ink' :
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
  // '' = comparaison automatique (exécution précédente) ; sinon AAAA-MM-JJ.
  const [baseline, setBaseline] = useState('');
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
        {/* Seules les vues Résumé et Santé exploitent le "précédent" — inutile
            d'afficher le sélecteur sur Runs et Log brut. */}
        {(tab === 'summary' || tab === 'health') && (
          <BaselinePicker value={baseline} onChange={setBaseline} />
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        {tabBtn('summary', 'Résumé & anomalies', AlertTriangle)}
        {tabBtn('health',  'Santé société',       HeartPulse)}
        {tabBtn('runs',    'Runs (batches)',      ListTree)}
        {tabBtn('raw',     'Log brut',            FileText)}
      </div>

      {tab === 'summary' && <SummaryView database={database} days={days} refSoc={refSoc} baseline={baseline} />}
      {tab === 'health'  && <HealthView  database={database} days={days} refSoc={refSoc} baseline={baseline} />}
      {tab === 'runs'    && <RunsView    database={database} days={days} refSoc={refSoc} />}
      {tab === 'raw'     && <RawView     database={database} days={days} refSoc={refSoc} />}
    </PageBody>
  );
}
