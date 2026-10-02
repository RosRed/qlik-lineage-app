import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy, GitFork, ChevronDown, ChevronRight, Layers, AlertTriangle,
  FileWarning, ArrowRight, Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import { globalApi } from '../../api/qlikApi';
import {
  PageBody, StatCard, Badge, SearchInput, Spinner, EmptyState, ErrorNote, Button
} from '../../components/ui/primitives';
import { QvdStatusBadge } from '../../components/global/bits.jsx';
import { downloadAuthed } from '../../lib/downloadAuthed';

const dl = (urlGetter, filename) => () =>
  downloadAuthed(urlGetter(), { filename }).catch(e => toast.error(e.error || e.message || 'Échec du téléchargement'));

/*
 * Analyse dédiée aux doublons du lineage.
 *
 * Deux sections indépendantes :
 *   • Familles de QVD versionnés : action1v1 / action1v2 / action1v3 → même
 *     racine, on affiche toutes les variantes avec leur statut pour choisir
 *     laquelle supprimer.
 *   • Batchs jumeaux : apps qui produisent (en grande partie) les mêmes QVD.
 *     Le % de recouvrement (Jaccard) est calculé sur les racines, pas sur les
 *     noms, donc la détection résiste au versioning des sorties.
 */

function shortAppLabel(a) {
  // Nom + éventuellement stream, tronqué visuellement mais lisible complet au survol
  return a.stream ? `${a.appName} · ${a.stream}` : a.appName;
}

// ─── Familles ─────────────────────────────────────────────────────────────────

function FamilyRow({ family, index, expanded, onToggle }) {
  const orphanTone = family.orphaned > 0 ? 'danger' : 'default';
  return (
    <>
      <tr className="hover:bg-raised cursor-pointer" onClick={onToggle}>
        <td className="py-2.5 pl-3 pr-2 text-ink-faint align-top pt-3">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="py-2.5 pr-2 align-top text-right tabular-nums text-ink-faint text-[12px]">
          {index}
        </td>
        <td className="py-2.5 pr-3 align-top">
          <span className="font-mono text-info">{family.root}</span>
          <span className="text-ink-faint">*.qvd</span>
        </td>
        <td className="py-2.5 pr-3 align-top text-right tabular-nums text-ink">
          {family.variantCount}
        </td>
        <td className="py-2.5 pr-3 align-top">
          {family.orphaned > 0
            ? <Badge tone={orphanTone}>{family.orphaned} orpheline{family.orphaned > 1 ? 's' : ''}</Badge>
            : <span className="text-ink-faint">—</span>}
        </td>
        <td className="py-2.5 pr-3 align-top text-ink-muted tabular-nums">
          {family.active} / {family.variantCount}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-raised">
          <td />
          <td colSpan={5} className="pb-3 pr-3">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                  <th className="py-1 pr-2 font-medium w-10 text-right">#</th>
                  <th className="py-1 pr-2 font-medium">Variante</th>
                  <th className="py-1 pr-2 font-medium">Statut</th>
                  <th className="py-1 pr-2 font-medium">Producteur</th>
                  <th className="py-1 pr-2 font-medium">Consommateurs</th>
                </tr>
              </thead>
              <tbody>
                {family.variants.map((v, i) => (
                  <tr key={v.name} className={v.status === 'orphelin' ? 'text-danger' : ''}>
                    <td className="py-1 pr-2 text-right tabular-nums text-ink-faint">{i + 1}</td>
                    <td className="py-1 pr-2 font-mono">{v.name}</td>
                    <td className="py-1 pr-2"><QvdStatusBadge status={v.status} /></td>
                    <td className="py-1 pr-2 text-ink-muted">
                      {v.producers.length === 0
                        ? <span className="text-ink-faint">—</span>
                        : v.producers.map(p => (
                            <Link key={p.appId} to={`/apps/${p.appId}`} className="hover:text-accent-ink block truncate max-w-[220px]" title={p.appName}>
                              {p.appName}
                            </Link>
                          ))}
                    </td>
                    <td className="py-1 pr-2 text-ink-muted tabular-nums">
                      {v.consumerCount === 0
                        ? <span className="text-ink-faint">personne</span>
                        : `${v.consumerCount} app${v.consumerCount > 1 ? 's' : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function FamiliesSection({ families }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return families;
    return families.filter(f =>
      f.root.includes(q) || f.variants.some(v => v.name.includes(q))
    );
  }, [families, search]);

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Layers size={15} className="text-accent" />
          Familles de QVD versionnés
        </h2>
        <span className="text-xs text-ink-faint">
          Regroupe les QVD dont le nom ne diffère que par un suffixe de version (_v1, _2024, _final…)
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Chercher une racine ou un nom de QVD…"
          className="w-full max-w-xs"
        />
        <span className="text-xs text-ink-faint tabular-nums">
          {filtered.length} / {families.length} famille{families.length > 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <Button icon={Download} onClick={dl(globalApi.exportFamiliesUrl, 'doublons-familles.csv')}>Export Excel</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Layers} title="Aucune famille détectée" description="Aucun QVD ne présente de variantes versionnées." />
      ) : (
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-raised">
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                <th className="py-2 pl-3 pr-2 w-8" />
                <th className="py-2 pr-2 text-right w-10">#</th>
                <th className="py-2 pr-3">Racine</th>
                <th className="py-2 pr-3 text-right w-24">Variantes</th>
                <th className="py-2 pr-3 w-32">Orphelines</th>
                <th className="py-2 pr-3 w-40">Actives</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((f, i) => (
                <FamilyRow
                  key={f.root}
                  family={f}
                  index={i + 1}
                  expanded={expanded === f.root}
                  onToggle={() => setExpanded(expanded === f.root ? null : f.root)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Batchs jumeaux ───────────────────────────────────────────────────────────

function AppCell({ app }) {
  // Le badge « publiée / privée » aide à décider laquelle des deux apps garder :
  // une non publiée qui a un jumeau publié est presque toujours à supprimer.
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Link to={`/apps/${app.appId}`} className="text-ink hover:text-accent-ink font-medium truncate max-w-[220px]" title={app.appName}>
          {app.appName}
        </Link>
        <Badge tone={app.published ? 'accent' : 'default'}>
          {app.published ? 'publiée' : 'privée'}
        </Badge>
      </div>
      <div className="text-[11px] text-ink-faint mt-0.5 truncate max-w-[240px]">
        {app.stream || 'Non publiée'}
        {app.owner && <span> · {app.owner}</span>}
      </div>
    </>
  );
}

function TwinRow({ twin, index, expanded, onToggle }) {
  const strong = twin.overlapPct >= 80;
  return (
    <>
      <tr className="hover:bg-raised cursor-pointer" onClick={onToggle}>
        <td className="py-2.5 pl-3 pr-2 text-ink-faint align-top pt-3">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="py-2.5 pr-2 align-top text-right tabular-nums text-ink-faint text-[12px]">
          {index}
        </td>
        <td className="py-2.5 pr-3 align-top">
          <AppCell app={twin.appA} />
        </td>
        <td className="py-2.5 pr-3 align-top text-ink-faint">
          <ArrowRight size={13} />
        </td>
        <td className="py-2.5 pr-3 align-top">
          <AppCell app={twin.appB} />
        </td>
        <td className="py-2.5 pr-3 align-top">
          <Badge tone={strong ? 'danger' : 'warn'}>{twin.overlapPct}%</Badge>
        </td>
        <td className="py-2.5 pr-3 align-top text-right tabular-nums text-ink">
          {twin.sharedCount}
        </td>
        <td className="py-2.5 pr-3 align-top text-right tabular-nums text-ink-faint text-[12px]">
          {twin.aOnly} / {twin.bOnly}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-raised">
          <td />
          <td colSpan={7} className="pb-3 pr-3 pt-1">
            <div className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">
              Racines de QVD partagées
            </div>
            <div className="flex flex-wrap gap-1">
              {twin.sharedRoots.map(r => (
                <span key={r} className="text-[11px] font-mono px-1.5 py-0.5 bg-canvas border border-line rounded text-info">
                  {r}
                </span>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-ink-faint">
              Exclusivités : <span className="text-ink-muted">{twin.aOnly}</span> chez « {twin.appA.appName} »,{' '}
              <span className="text-ink-muted">{twin.bOnly}</span> chez « {twin.appB.appName} ».
              {twin.overlapPct === 100 && ' — recouvrement complet, un des deux batchs peut probablement être retiré.'}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TwinsSection({ twins }) {
  const [search, setSearch] = useState('');
  const [strongOnly, setStrongOnly] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return twins.filter(t => {
      if (strongOnly && t.overlapPct < 80) return false;
      if (!q) return true;
      return t.appA.appName.toLowerCase().includes(q)
        || t.appB.appName.toLowerCase().includes(q)
        || t.sharedRoots.some(r => r.includes(q));
    });
  }, [twins, search, strongOnly]);

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <GitFork size={15} className="text-accent" />
          Batchs jumeaux
        </h2>
        <span className="text-xs text-ink-faint">
          Apps qui produisent les mêmes racines de QVD — candidates à la fusion ou à la suppression.
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Chercher une app ou une racine…"
          className="w-full max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={strongOnly}
            onChange={e => setStrongOnly(e.target.checked)}
            className="accent-accent"
          />
          Recouvrement fort (≥80%) uniquement
        </label>
        <span className="text-xs text-ink-faint tabular-nums">
          {filtered.length} / {twins.length} paire{twins.length > 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <Button icon={Download} onClick={dl(globalApi.exportTwinsUrl, 'doublons-paires.csv')}>Export Excel</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={GitFork} title="Aucune paire ne correspond" description="Retirez le filtre ou élargissez la recherche." />
      ) : (
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-raised">
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                <th className="py-2 pl-3 pr-2 w-8" />
                <th className="py-2 pr-2 text-right w-10">#</th>
                <th className="py-2 pr-3">App A</th>
                <th className="py-2 pr-3 w-8" />
                <th className="py-2 pr-3">App B</th>
                <th className="py-2 pr-3 w-28">Recouvrement</th>
                <th className="py-2 pr-3 text-right w-20">Partagés</th>
                <th className="py-2 pr-3 text-right w-24" title="QVD exclusifs à A / à B">Exclus. A/B</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((t, i) => (
                <TwinRow
                  key={`${t.appA.appId}-${t.appB.appId}-${i}`}
                  twin={t}
                  index={i + 1}
                  expanded={expanded === i}
                  onToggle={() => setExpanded(expanded === i ? null : i)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DoublonsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    globalApi.duplicates()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.error || e.message || 'Erreur de chargement'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Spinner label="Analyse des doublons…" />;
  if (error) return <PageBody><ErrorNote>{error}</ErrorNote></PageBody>;
  if (!data) return null;

  const s = data.stats;

  return (
    <PageBody>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Layers} label="Familles" value={s.familyCount} hint="QVD à variantes multiples" />
        <StatCard icon={Copy} label="Variantes redondantes" value={s.redundantVariants} tone="warn" />
        <StatCard icon={FileWarning} label="Variantes orphelines" value={s.orphanVariants} tone="danger" hint="candidates à la suppression" />
        <StatCard icon={GitFork} label="Batchs jumeaux" value={s.twinCount} tone={s.strongTwinCount > 0 ? 'warn' : 'default'} hint={`${s.strongTwinCount} à ≥80%`} />
      </div>

      <div className="space-y-8">
        <TwinsSection twins={data.twins} />
        <FamiliesSection families={data.families} />
      </div>
    </PageBody>
  );
}
