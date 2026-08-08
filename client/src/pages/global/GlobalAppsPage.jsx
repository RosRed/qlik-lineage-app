import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { useGlobalContext } from '../../layouts/GlobalLayout.jsx';
import { PageBody, SearchInput, Select, Badge, EmptyState } from '../../components/ui/primitives';
import { RoleBadge } from '../../components/global/bits.jsx';

/*
 * Tableau des applications vues côté flux : rôle, QVD produits/consommés,
 * métadonnées QRS. Trié par nombre d'orphelins produits (le plus actionnable).
 */
export default function GlobalAppsPage() {
  const { data } = useGlobalContext();
  const [search, setSearch] = useState('');
  const [stream, setStream] = useState('');
  const [published, setPublished] = useState('');
  const [role, setRole] = useState('');

  const streams = useMemo(
    () => [...new Set(data.apps.map(a => a.stream || '(non publiée)'))].sort(),
    [data.apps]
  );

  const rows = useMemo(() => {
    const orphanNames = new Set(data.orphans.map(q => q.name));
    const q = search.trim().toLowerCase();
    return data.apps
      .filter(a => {
        if (q && !`${a.appName} ${a.owner || ''}`.toLowerCase().includes(q)) return false;
        if (stream && (a.stream || '(non publiée)') !== stream) return false;
        if (published === 'oui' && !a.published) return false;
        if (published === 'non' && a.published) return false;
        if (role && a.role !== role) return false;
        return true;
      })
      .map(a => ({ ...a, orphansProduced: a.producedQvds.filter(x => orphanNames.has(x)).length }))
      .sort((a, b) => b.orphansProduced - a.orphansProduced);
  }, [data.apps, data.orphans, search, stream, published, role]);

  return (
    <PageBody>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Chercher une app ou un propriétaire…"
          className="w-full max-w-xs"
        />
        <Select value={stream} onChange={setStream} aria-label="Filtrer par stream">
          <option value="">Tous les streams</option>
          {streams.map(st => <option key={st} value={st}>{st}</option>)}
        </Select>
        <Select value={published} onChange={setPublished} aria-label="Filtrer par publication">
          <option value="">Publiée ou non</option>
          <option value="oui">Publiées</option>
          <option value="non">Non publiées</option>
        </Select>
        <Select value={role} onChange={setRole} aria-label="Filtrer par rôle">
          <option value="">Tous les rôles</option>
          <option value="batch">batch</option>
          <option value="transform">transform</option>
          <option value="front">front</option>
          <option value="autonome">autonome</option>
        </Select>
        <span className="text-xs text-ink-faint tabular-nums">
          {rows.length} app{rows.length !== 1 ? 's' : ''} · triées par orphelins produits
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Aucune app ne correspond"
          description="Élargissez la recherche ou retirez un filtre."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                <th className="py-2 pr-3">Application</th>
                <th className="py-2 pr-3">Stream</th>
                <th className="py-2 pr-3">Publiée</th>
                <th className="py-2 pr-3">Rôle</th>
                <th className="py-2 pr-3">Propriétaire</th>
                <th className="py-2 pr-3">Dernier reload</th>
                <th className="py-2 pr-3 text-right">QVD gén.</th>
                <th className="py-2 pr-3 text-right">dont orphelins</th>
                <th className="py-2 pr-3 text-right">QVD cons.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(a => (
                <tr key={a.appId} className={`hover:bg-raised/60 ${!a.analyzed ? 'opacity-60' : ''}`}>
                  <td className="py-2 pr-3 max-w-[220px]">
                    {/* Passerelle vers la fiche de l'app — impossible avant le routeur */}
                    <Link
                      to={`/apps/${a.appId}`}
                      className="text-ink hover:text-accent-ink truncate block"
                      title={a.appName}
                    >
                      {a.appName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-ink-muted">{a.stream || '—'}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={a.published ? 'accent' : 'default'}>
                      {a.published ? 'publiée' : 'privée'}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3"><RoleBadge role={a.role} /></td>
                  <td className="py-2 pr-3 text-ink-muted text-xs max-w-[150px] truncate" title={a.owner || ''}>
                    {a.owner || '—'}
                  </td>
                  <td className="py-2 pr-3 text-ink-muted text-xs whitespace-nowrap">
                    {a.lastReload ? new Date(a.lastReload).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-violet tabular-nums">
                    {a.producedQvds.length || '—'}
                  </td>
                  <td className={`py-2 pr-3 text-right font-mono tabular-nums ${a.orphansProduced > 0 ? 'text-danger font-bold' : 'text-ink-faint'}`}>
                    {a.orphansProduced || '—'}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-accent-ink tabular-nums">
                    {a.consumedQvds.length || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageBody>
  );
}
