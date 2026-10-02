import React, { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Loader2, Database, FileSpreadsheet, HardDrive, AlertTriangle
} from 'lucide-react';
import { globalApi } from '../api/qlikApi';
import { PageBody } from '../components/ui/primitives';

/*
 * Recherche d'impact — « la table X ne charge plus, quelles apps sont touchées ? »
 *
 * Une app est touchée de deux façons, réunies dans un seul tableau (une ligne
 * = une app) mais distinguées par la colonne Impact :
 *   - DIRECT   : son script lit la source cherchée
 *   - VIA QVD  : elle lit un QVD produit par une app touchée, en cascade
 */

const KIND_META = {
  sql:     { label: 'Tables SQL', icon: Database, color: 'text-violet' },
  fichier: { label: 'Fichiers (Excel, CSV)', icon: FileSpreadsheet, color: 'text-warn' },
  qvd:     { label: 'QVD', icon: HardDrive, color: 'text-info' },
};

/**
 * Libellé court d'origine : la connexion Qlik porte le nom du serveur et du
 * compte (« PremiumDWH (srvdb2_qsservices) »), illisible en colonne. On garde
 * la partie discriminante — c'est elle qui dit de quelle base vient la table.
 */
function shortConnection(conn) {
  if (!conn) return null;
  return String(conn).replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Mêmes tons que <Badge> dans primitives : adossés aux variables CSS du
// thème, donc lisibles en clair comme en sombre. Les gray-* en dur restaient
// sombres sur fond clair.
const SOURCE_TONE = {
  qvd:     'bg-raised text-info border-info',
  sql:     'bg-raised text-violet border-violet',
  fichier: 'bg-warn-soft text-warn border-warn',
};

function SourceBadge({ kind, label, title }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-block max-w-[160px] truncate align-middle
                      ${SOURCE_TONE[kind] || SOURCE_TONE.sql}`}
      title={title || label}>
      {label}
    </span>
  );
}

export default function ImpactPage() {
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState({ sql: true, fichier: true, qvd: false });
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback((e) => {
    e?.preventDefault();
    const actifs = Object.entries(kinds).filter(([, v]) => v).map(([k]) => k);
    if (q.trim().length < 2 || !actifs.length) return;
    setLoading(true); setError(null);
    globalApi.impact(q.trim(), actifs)
      .then(setRes)
      .catch(err => setError(err.error || err.message))
      .finally(() => setLoading(false));
  }, [q, kinds]);

  // Une ligne par app : le direct et l'indirect fusionnent, la colonne Impact
  // les distingue. Le direct d'abord, c'est là qu'on intervient en premier.
  const lignes = useMemo(() => {
    if (!res || res.tooShort) return [];
    const direct = res.direct.map(d => {
      const bases = [...new Set(d.sources.map(s => shortConnection(s.connection)).filter(Boolean))];
      const fichiers = d.sources.filter(s => s.type !== 'sql');
      return {
        key: 'd' + d.appId,
        appId: d.appId, appName: d.appName, stream: d.stream,
        type: 'direct', depth: 0,
        sourceKind: d.sources.every(s => s.type !== 'sql') ? 'fichier' : 'sql',
        sourceLabels: bases.length ? bases : (fichiers.length ? ['Fichier'] : ['Source']),
        sourceTitles: [...new Set(d.sources.map(s => s.connection).filter(Boolean))],
        objets: d.sources.map(s => ({ name: s.name, title: s.path || s.name, joined: s.joined })),
        origine: null
      };
    });
    const indirect = res.indirect.map(i => ({
      key: 'i' + i.appId,
      appId: i.appId, appName: i.appName, stream: i.stream,
      type: 'qvd', depth: i.depth,
      sourceKind: 'qvd',
      sourceLabels: ['QVD'],
      objets: [{ name: i.via.qvd, title: i.via.qvdPath }],
      origine: { appId: i.via.producedByAppId, appName: i.via.producedBy }
    }));
    return [...direct, ...indirect];
  }, [res]);

  return (
    <>
      <PageBody>
        <form onSubmit={run} className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative flex-1 min-w-[240px] max-w-lg">
            <Search size={13} className="absolute left-2.5 top-2.5 text-ink-faint" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Nom de table, de fichier ou de QVD — ex. HISTO_VENTES"
              className="w-full bg-canvas border border-line rounded-lg pl-8 pr-3 py-2 text-sm text-ink
                         placeholder-ink-faint outline-none focus:border-accent transition-colors"
            />
          </div>
          <button type="submit" disabled={loading || q.trim().length < 2}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-accent text-white border border-transparent
                       hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            {loading ? <Loader2 size={13} className="animate-spin" /> : 'Chercher'}
          </button>
          {Object.entries(KIND_META).map(([k, m]) => (
            <label key={k} className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer">
              <input type="checkbox" checked={kinds[k]}
                onChange={e => setKinds({ ...kinds, [k]: e.target.checked })} />
              <m.icon size={11} className={m.color} /> {m.label}
            </label>
          ))}
        </form>

        {error && (
          <div className="text-xs text-danger bg-danger-soft border border-danger rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        {res?.tooShort && <p className="text-xs text-ink-faint">Saisissez au moins 2 caractères.</p>}

        {res && !res.tooShort && (
          <>
            <div className="flex items-center gap-3 flex-wrap text-[11px] mb-2">
              <span className="text-ink-muted">
                <strong className="text-ink">{lignes.length}</strong> app(s) touchée(s) —
                {' '}{res.stats.direct} directe(s), {res.stats.indirect} via QVD
              </span>
              {res.connections.length > 0 && (
                <span className="text-ink-muted">
                  Base(s) : {res.connections.map((c, i) => (
                    <span key={c} className="text-violet" title={c}>
                      {i > 0 && <span className="text-ink-faint"> · </span>}{shortConnection(c)}
                    </span>
                  ))}
                </span>
              )}
              <span className="ml-auto text-ink-faint">
                périmètre : {res.stats.analyzedApps} app(s) analysée(s) sur {res.stats.totalApps}
              </span>
            </div>

            {lignes.length === 0 ? (
              <div className="text-xs text-ink-muted flex items-start gap-2 bg-raised border border-line rounded-lg px-3 py-3">
                <AlertTriangle size={13} className="text-ink-faint shrink-0 mt-px" />
                <span>
                  Aucune application analysée ne dépend de « {res.query} ». Élargissez les types cochés, ou
                  importez et analysez davantage d'apps — une app non importée reste invisible pour cette recherche.
                </span>
              </div>
            ) : (
              <div className="border border-line rounded-lg overflow-hidden bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted bg-raised border-b border-line">
                        <th className="py-2 px-3">Application</th>
                        <th className="py-2 px-3">Stream</th>
                        <th className="py-2 px-3">Source</th>
                        <th className="py-2 px-3">Objet</th>
                        <th className="py-2 px-3">Impact</th>
                        <th className="py-2 px-3">Produit par</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {lignes.map(l => (
                        <tr key={l.key} className="hover:bg-raised">
                          <td className="py-2 px-3">
                            <Link to={`/apps/${l.appId}`}
                              className="text-ink hover:text-accent-ink hover:underline font-medium">
                              {l.appName}
                            </Link>
                          </td>
                          <td className="py-2 px-3 text-ink-muted">{l.stream || '—'}</td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {l.sourceLabels.map((lab, i) => (
                                <SourceBadge key={lab} kind={l.sourceKind} label={lab}
                                  title={l.sourceTitles?.[i]} />
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1">
                              {l.objets.map((o, i) => (
                                <span key={i} title={o.title}
                                  className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-raised border border-line text-ink-muted">
                                  {o.name}{o.joined && <span className="text-ink-faint"> jointe</span>}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            {l.type === 'direct' ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-accent-soft text-accent-ink border-accent">
                                Direct
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-raised text-info border-info"
                                title="Nombre de QVD traversés depuis la source">
                                via QVD · niv. {l.depth}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {l.origine ? (
                              <Link to={`/apps/${l.origine.appId}`}
                                className="text-accent-ink hover:underline">
                                {l.origine.appName}
                              </Link>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!res && !loading && (
          <p className="text-xs text-ink-muted max-w-2xl">
            Cherchez une table de base de données, un fichier Excel ou un QVD pour savoir quelles applications
            en dépendent. La recherche remonte aussi les dépendances <strong className="text-ink">indirectes</strong> :
            si un batch extrait la table vers un QVD, les apps qui lisent ce QVD sont également listées.
          </p>
        )}
      </PageBody>
    </>
  );
}
