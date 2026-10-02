import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera, GitCompareArrows, Trash2, Loader2, RefreshCw, Plus,
  TrendingUp, TrendingDown, Minus, ArrowRight, ChevronDown, ChevronRight,
  AlertCircle, FileWarning
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ssisApi, cacheInvalidate } from '../../api/qlikApi';
import { PageBody, Card, Select, SearchInput, Button, ErrorNote, EmptyState } from '../../components/ui/primitives';
import { fmtTime } from './shared.jsx';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Snapshots nommés — capture manuelle à la demande, grain (table × société).
 * Usage : "je fais un run SSIS, je snapshotte avant et après, je compare".
 *
 * Trois modes affichés en tabs internes : List | Compare | Detail.
 */

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

function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

// ─── Capture d'un nouveau snapshot ──────────────────────────────────────────

function CaptureForm({ databases, onDone, onRunningChange }) {
  const [database, setDatabase] = useState(
    databases.find(n => n.toLowerCase().includes('groupe')) || databases[0] || ''
  );
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(null); // { id, label, progress_current, progress_total }

  useEffect(() => {
    if (!database && databases.length) {
      setDatabase(databases.find(n => n.toLowerCase().includes('groupe')) || databases[0]);
    }
  }, [databases, database]);

  // Signale au parent qu'une capture est en cours (utile pour afficher un
  // indicateur global et déclencher un reload de la liste à la fin).
  useEffect(() => { onRunningChange?.(running); }, [running, onRunningChange]);

  const submit = async () => {
    if (!label.trim()) { toast.error('Donnez un nom au snapshot'); return; }
    if (!database) { toast.error('Sélectionnez une base'); return; }
    setBusy(true);
    try {
      const started = await ssisApi.namedSnapshotCreate({ database, label: label.trim(), description: description.trim() || null });
      toast.success(`Capture lancée en arrière-plan — ${started.progressTotal} tables à traiter`);
      setRunning({ id: started.snapshotId, label: label.trim(), progressCurrent: 0, progressTotal: started.progressTotal });
      setLabel('');
      setDescription('');
    } catch (e) {
      toast.error(e.error || e.message || 'Échec du démarrage');
    } finally {
      setBusy(false);
    }
  };

  // Polling status pendant la capture en background — s'arrête dès qu'elle finit.
  useEffect(() => {
    if (!running?.id) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const st = await ssisApi.namedSnapshotStatus(running.id);
        if (st.status === 'running') {
          setRunning(r => r ? { ...r, progressCurrent: st.progress_current || 0, progressTotal: st.progress_total || r.progressTotal } : r);
        } else if (st.status === 'succeeded') {
          toast.success(`« ${st.label} » — ${st.table_count} tables · ${fmtRows(st.row_count_total)} rows · ${fmtDuration(st.duration_ms)}`);
          setRunning(null);
          onDone?.(st);
          return;
        } else if (st.status === 'failed') {
          toast.error(`Capture « ${st.label} » échouée : ${st.error_message || 'erreur inconnue'}`);
          setRunning(null);
          onDone?.(st);
          return;
        }
      } catch (_) { /* réseau coupé ? on retente au prochain tick */ }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 2000);
    return () => { stopped = true; };
  }, [running?.id]);

  const suggestLabel = (kind) => {
    const now = new Date();
    const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setLabel(`${kind} — ${stamp}`);
  };

  return (
    <Card className="mb-4">
      <div className="flex items-start gap-3 mb-3">
        <Camera size={16} className="text-accent mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-ink">Prendre un snapshot nommé</h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Capture les <b>row counts par table × société</b> à cet instant. À combiner : un snapshot avant votre run SSIS,
            un snapshot après, puis comparez les deux.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">Base</label>
          <Select value={database} onChange={setDatabase}>
            {databases.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">Nom du snapshot</label>
          <input value={label} onChange={e => setLabel(e.target.value)}
            placeholder="ex: Avant run BKAM_RATES"
            className="w-full bg-raised border border-line rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent" />
          <div className="flex gap-1 mt-1">
            <button onClick={() => suggestLabel('Avant')} className="text-[10px] text-ink-faint hover:text-accent-ink hover:underline">+ Avant run</button>
            <button onClick={() => suggestLabel('Après')} className="text-[10px] text-ink-faint hover:text-accent-ink hover:underline">+ Après run</button>
            <button onClick={() => suggestLabel('Référence')} className="text-[10px] text-ink-faint hover:text-accent-ink hover:underline">+ Référence</button>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">Description (optionnelle)</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="ex: package MAIN.dtsx, ticket JIRA-1234"
            className="w-full bg-raised border border-line rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={submit}
          disabled={busy || !!running || !label.trim() || !database}
          icon={busy ? Loader2 : Plus}>
          {busy ? 'Démarrage…' : running ? 'Capture en cours en arrière-plan…' : 'Lancer la capture'}
        </Button>
        {running && (
          <div className="flex-1 flex items-center gap-2 text-xs">
            <div className="flex-1 h-2 bg-raised rounded overflow-hidden">
              <div className="h-full bg-accent transition-all"
                   style={{ width: `${Math.round((running.progressCurrent / Math.max(1, running.progressTotal)) * 100)}%` }} />
            </div>
            <span className="text-ink-muted tabular-nums whitespace-nowrap">
              {running.progressCurrent} / {running.progressTotal} tables
            </span>
          </div>
        )}
      </div>
      {running && (
        <p className="text-[11px] text-ink-faint mt-2">
          Vous pouvez fermer cet onglet ou naviguer ailleurs — la capture continue côté serveur.
        </p>
      )}
    </Card>
  );
}

// ─── Liste des snapshots ────────────────────────────────────────────────────

function SnapshotList({ snapshots, selectedA, selectedB, onSelectA, onSelectB, onDelete }) {
  if (!snapshots.length) {
    return <EmptyState icon={Camera} title="Aucun snapshot"
      description="Lancez votre première capture ci-dessus. Elle apparaîtra ici." />;
  }
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
              <th className="py-2 px-3">A</th>
              <th className="py-2 px-3">B</th>
              <th className="py-2 px-3">Nom</th>
              <th className="py-2 px-3">Base</th>
              <th className="py-2 px-3">Capturé le</th>
              <th className="py-2 px-3 text-right">Tables</th>
              <th className="py-2 px-3 text-right">Rows total</th>
              <th className="py-2 px-3">Durée</th>
              <th className="py-2 px-3">Description</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snapshots.map(s => {
              const isRunning = s.status === 'running';
              const isFailed = s.status === 'failed';
              const canCompare = !isRunning && !isFailed;
              const rowBg =
                selectedA === s.id ? 'bg-info-soft' :
                selectedB === s.id ? 'bg-warn-soft' :
                isRunning ? 'bg-accent-soft' :
                isFailed  ? 'bg-danger-soft' : '';
              return (
              <tr key={s.id} className={`hover:bg-raised ${rowBg}`}>
                <td className="py-2 px-3">
                  <input type="radio" name="a" checked={selectedA === s.id}
                    disabled={!canCompare} title={canCompare ? '' : 'Snapshot en cours ou en échec'}
                    onChange={() => onSelectA(s.id)} />
                </td>
                <td className="py-2 px-3">
                  <input type="radio" name="b" checked={selectedB === s.id}
                    disabled={!canCompare} title={canCompare ? '' : 'Snapshot en cours ou en échec'}
                    onChange={() => onSelectB(s.id)} />
                </td>
                <td className="py-2 px-3 font-mono text-info">
                  {isRunning && <span className="mr-1 inline-block w-2 h-2 rounded-full bg-accent animate-pulse" title="Capture en cours" />}
                  {isFailed  && <span className="mr-1 inline-block w-2 h-2 rounded-full bg-danger" title={s.error_message || 'Échec'} />}
                  {s.label}
                  {isRunning && s.progress_total > 0 && (
                    <span className="ml-2 text-[10px] text-ink-muted tabular-nums">
                      {s.progress_current || 0} / {s.progress_total}
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-ink-muted text-[11px]">{s.database_name}</td>
                <td className="py-2 px-3 text-[11px]">{fmtTime(s.captured_at)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{s.table_count}</td>
                <td className="py-2 px-3 text-right tabular-nums font-mono">{fmtRows(s.row_count_total)}</td>
                <td className="py-2 px-3 text-[11px] text-ink-faint">{fmtDuration(s.duration_ms)}</td>
                <td className="py-2 px-3 text-[11px] text-ink-muted max-w-[220px] truncate" title={s.description || ''}>
                  {s.description || <span className="text-ink-faint">—</span>}
                </td>
                <td className="py-2 px-3">
                  <button onClick={() => onDelete(s)} title="Supprimer"
                    className="text-ink-faint hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Vue de comparaison A ↔ B ───────────────────────────────────────────────

function CompareView({ aId, bId, onReset }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true); setError(null); setData(null);
    ssisApi.namedSnapshotCompare(aId, bId)
      .then(setData)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  }, [aId, bId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.diffs.filter(d => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (q && ![d.table, d.schema, d.refSociete].some(v => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, statusFilter, search]);

  if (loading) return <div className="p-8 text-center text-ink-muted"><Loader2 size={16} className="inline animate-spin mr-2" /> Comparaison en cours…</div>;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;

  const s = data.stats;
  const deltaTotal = fmtDelta(s.deltaTotal);

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <Button onClick={onReset} icon={ArrowRight}>← Retour à la liste</Button>
        <div className="flex-1 flex items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded bg-info-soft border border-info text-info">
            <b>A</b> · {data.a.label} · {fmtTime(data.a.captured_at)} · {fmtRows(data.a.row_count_total)} rows
          </div>
          <ArrowRight size={14} className="text-ink-faint" />
          <div className="px-3 py-1.5 rounded bg-warn-soft border border-warn text-warn">
            <b>B</b> · {data.b.label} · {fmtTime(data.b.captured_at)} · {fmtRows(data.b.row_count_total)} rows
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        <Card className="!p-2"><div className="text-[10px] uppercase text-ink-faint">Changements</div><div className="text-lg font-bold">{s.totalChanges}</div></Card>
        <Card className="!p-2 border-accent"><div className="text-[10px] uppercase text-accent-ink">Augmentées</div><div className="text-lg font-bold text-accent-ink">{s.grew}</div></Card>
        <Card className="!p-2 border-danger"><div className="text-[10px] uppercase text-danger">Diminuées</div><div className="text-lg font-bold text-danger">{s.shrunk}</div></Card>
        <Card className="!p-2 border-info"><div className="text-[10px] uppercase text-info">Ajoutées</div><div className="text-lg font-bold text-info">{s.added}</div></Card>
        <Card className="!p-2 border-warn"><div className="text-[10px] uppercase text-warn">Retirées</div><div className="text-lg font-bold text-warn">{s.removed}</div></Card>
        <Card className={`!p-2 ${s.deltaTotal !== 0 ? (s.deltaTotal > 0 ? 'border-accent' : 'border-danger') : ''}`}>
          <div className="text-[10px] uppercase text-ink-faint">Δ total rows</div>
          <div className={`text-lg font-bold ${deltaTotal.cls}`}>{deltaTotal.text}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Chercher table, schéma, société…" className="max-w-xs" />
        <Select value={statusFilter} onChange={setStatusFilter}>
          <option value="">Tous changements</option>
          <option value="grew">Augmentées</option>
          <option value="shrunk">Diminuées</option>
          <option value="added">Ajoutées (nouvelle en B)</option>
          <option value="removed">Retirées (existait en A)</option>
          <option value="unchanged">Inchangées</option>
        </Select>
        <span className="ml-auto text-[11px] text-ink-faint">{filtered.length} / {data.diffs.length}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileWarning} title="Rien à afficher" description="Aucun changement ne correspond aux filtres." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted border-b border-line bg-raised">
                  <th className="py-2 px-3">Table</th>
                  <th className="py-2 px-3">Société</th>
                  <th className="py-2 px-3">Statut</th>
                  <th className="py-2 px-3 text-right">A (avant)</th>
                  <th className="py-2 px-3 text-right">B (après)</th>
                  <th className="py-2 px-3 text-right">Δ</th>
                  <th className="py-2 px-3 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.slice(0, 500).map((d, i) => {
                  const df = fmtDelta(d.delta);
                  const bg =
                    d.status === 'grew'    ? 'bg-accent-soft' :
                    d.status === 'shrunk'  ? 'bg-danger-soft' :
                    d.status === 'added'   ? 'bg-info-soft' :
                    d.status === 'removed' ? 'bg-warn-soft' : '';
                  return (
                    <tr key={i} className={`hover:bg-raised ${bg}`}>
                      <td className="py-2 px-3 font-mono text-info">
                        <span className="text-ink-faint">{d.schema}.</span>{d.table}
                      </td>
                      <td className="py-2 px-3 text-[11px]">{d.refSociete || <span className="text-ink-faint">—</span>}</td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          d.status === 'grew'      ? 'bg-accent-soft text-accent-ink' :
                          d.status === 'shrunk'    ? 'bg-danger-soft text-danger' :
                          d.status === 'added'     ? 'bg-info-soft text-info' :
                          d.status === 'removed'   ? 'bg-warn-soft text-warn' :
                                                     'bg-raised text-ink-muted'}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink-muted">{fmtRows(d.countA)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-ink">{fmtRows(d.countB)}</td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums ${df.cls}`}>{df.text}</td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums text-[11px] ${df.cls}`}>
                        {d.deltaPct != null ? `${(d.deltaPct * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="p-2 text-center text-[11px] text-ink-faint bg-raised">
                Affichage limité à 500 lignes — utilisez les filtres pour raffiner.
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

export default function NamedSnapshotsPage() {
  const { health } = useSsisContext();
  const [databases, setDatabases] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [mode, setMode] = useState('list'); // list | compare

  const load = (fresh = false) => {
    setLoading(true); setError(null);
    // Invalide le cache si on veut forcer un refresh (polling pendant capture)
    if (fresh) cacheInvalidate('/api/ssis/named-snapshots');
    ssisApi.namedSnapshotList()
      .then(setSnapshots)
      .catch(e => setError(e.error || e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!health?.configured) return;
    ssisApi.databases().then(setDatabases).catch(() => {});
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health?.configured]);

  // Auto-refresh de la liste dès qu'un snapshot en cours est présent.
  // Utile si l'utilisateur navigue ailleurs puis revient sur la page pendant
  // une capture longue lancée précédemment : la liste montre l'avancement.
  const hasRunning = snapshots.some(s => s.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => load(true), 4000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRunning]);

  const wipe = async () => {
    if (!window.confirm('Supprimer TOUS les snapshots (nommés + auto) ? Cette action est irréversible.')) return;
    try {
      const r = await ssisApi.wipeAllSnapshots();
      toast.success(`${r.deletedTableSnapshots || 0} snapshots auto supprimés + tous les snapshots nommés`);
      load();
    } catch (e) { toast.error(e.error || e.message); }
  };

  const del = async (s) => {
    if (!window.confirm(`Supprimer le snapshot "${s.label}" ?`)) return;
    try {
      await ssisApi.namedSnapshotDelete(s.id);
      toast.success('Snapshot supprimé');
      if (selectedA === s.id) setSelectedA(null);
      if (selectedB === s.id) setSelectedB(null);
      load();
    } catch (e) { toast.error(e.error || e.message); }
  };

  if (!health?.configured) return null;

  if (mode === 'compare' && selectedA && selectedB) {
    return (
      <PageBody>
        <CompareView aId={selectedA} bId={selectedB} onReset={() => setMode('list')} />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <CaptureForm databases={databases} onDone={load} />

      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink">Historique ({snapshots.length})</h3>
        <Button onClick={load} disabled={loading} title="Rafraîchir">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
        <div className="flex-1" />
        <Button
          variant="primary"
          onClick={() => setMode('compare')}
          disabled={!selectedA || !selectedB || selectedA === selectedB}
          icon={GitCompareArrows}>
          Comparer A → B
        </Button>
        <Button onClick={wipe}>
          <Trash2 size={13} className="inline mr-1 text-danger" /> Tout vider
        </Button>
      </div>

      {selectedA && selectedB && selectedA === selectedB && (
        <div className="text-xs text-warn mb-2 flex items-center gap-1.5">
          <AlertCircle size={12} /> A et B doivent être des snapshots différents.
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <SnapshotList
        snapshots={snapshots}
        selectedA={selectedA}
        selectedB={selectedB}
        onSelectA={setSelectedA}
        onSelectB={setSelectedB}
        onDelete={del}
      />
    </PageBody>
  );
}
