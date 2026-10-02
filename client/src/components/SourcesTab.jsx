import React, { useState, useMemo, useEffect } from 'react';
import {
  Database, HardDrive, FileSpreadsheet, Cog, Search, ChevronDown, ChevronRight, Info, Plug,
  ArrowDownLeft, ArrowUpRight, AlertTriangle, RefreshCcw
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { appsApi } from '../api/appsApi';

/**
 * Onglet Sources — présente les sources de données groupées par type :
 *   1. Bases SQL (groupées par connexion)
 *   2. QVD (lus / écrits)
 *   3. Fichiers plats (Excel, CSV, TXT)
 *   4. Interne (Resident, Inline, Autogenerate)
 */

const norm = (s) => String(s || '').toLowerCase();

function categorize(sourceMeta) {
  const sql = [], qvd = [], files = [], internal = [];
  for (const s of sourceMeta || []) {
    const t = (s.category || s.type || '').toLowerCase();
    if (t === 'sql') sql.push(s);
    else if (t === 'qvd' || t === 'qvd_read') qvd.push(s);
    else if (['excel', 'csv', 'file', 'txt', 'tab'].includes(t)) files.push(s);
    else if (['resident', 'inline', 'autogenerate', 'internal'].includes(t)) internal.push(s);
    else if (t === 'include') files.push({ ...s, type: 'include' });
    else files.push(s);
  }
  return { sql, qvd, files, internal };
}

function Section({ icon: Icon, title, count, color, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-surface border border-line rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-raised">
        {open ? <ChevronDown size={13} className="text-ink-faint" /> : <ChevronRight size={13} className="text-ink-faint" />}
        <Icon size={14} className={color} />
        <span className="text-xs font-semibold text-ink">{title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded bg-raised ${color}`}>{count}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </section>
  );
}

function TypeBadge({ type, color }) {
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${color}`}>
      {type}
    </span>
  );
}

function PathLine({ path }) {
  if (!path) return null;
  return (
    <div className="font-mono text-[10px] text-ink-faint truncate" title={path}>{path}</div>
  );
}

function UsedBy({ usedBy, fieldCount }) {
  if (!usedBy?.length) return null;
  return (
    <div className="text-[10px] text-ink-muted">
      → {usedBy.join(', ')}{fieldCount ? ` · ${fieldCount} champs` : ''}
    </div>
  );
}

const USAGE_STATUS = {
  ok:       { cls: 'text-accent-ink' },
  multi:    { cls: 'text-warn' },
  self:     { cls: 'text-ink-muted' },
  externe:  { cls: 'text-warn' },
  orphelin: { cls: 'text-danger' },
};

/**
 * Ligne de croisement inter-apps sous un QVD : qui le produit (s'il est lu) ou
 * qui le consomme (s'il est ecrit). `apps` peut etre vide — c'est justement
 * l'information interessante, donc on affiche le motif plutot que rien.
 */
function CrossApp({ dir, entry }) {
  if (!entry) return null;
  const isRead = dir === 'read';
  const apps = isRead ? entry.producers : entry.consumers;
  const Icon = isRead ? ArrowDownLeft : ArrowUpRight;
  const tone = USAGE_STATUS[entry.status] || USAGE_STATUS.self;

  let vide = null;
  if (!apps.length) {
    if (entry.status === 'self') {
      vide = isRead ? 'produit par cette app elle-meme' : 'relu par cette app elle-meme';
    } else if (isRead) {
      vide = 'aucune app analysee ne le produit';
    } else {
      vide = 'aucune app analysee ne le lit — orphelin';
    }
  }

  return (
    <div className="flex items-start gap-1.5 text-[10px] mt-0.5">
      <Icon size={11} className={`${tone.cls} shrink-0 mt-px`} />
      <span className="text-ink-faint shrink-0">{isRead ? 'produit par' : 'lu par'}</span>
      {apps.length ? (
        <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
          {apps.map(a => (
            <Link key={a.appId} to={`/apps/${a.appId}`} onClick={e => e.stopPropagation()}
              className="text-accent-ink hover:underline"
              title={[a.stream && `stream ${a.stream}`, a.tableName && `table ${a.tableName}`,
                      a.tables?.length && `tables ${a.tables.join(', ')}`].filter(Boolean).join(' · ')}>
              {a.appName}
            </Link>
          ))}
          {entry.status === 'multi' && (
            <span className="text-warn" title="Plusieurs apps ecrivent ce meme QVD — production dupliquee">
              ⚠ {apps.length} producteurs
            </span>
          )}
        </span>
      ) : (
        <span className={tone.cls}>{vide}</span>
      )}
      {apps.length > 0 && entry.status === 'self' && (
        <span className="text-ink-faint">· et elle-meme</span>
      )}
    </div>
  );
}

/**
 * Carte d'une table SQL — en-tête coloré portant le nom, puis l'essentiel :
 * d'où elle vient et ce qu'elle alimente. Le détail des colonnes reste
 * accessible dans l'onglet Lineage ; l'afficher ici noyait la vue d'ensemble.
 * Le compteur vient du lineage (colonnes distinctes), pas de `fieldCount` qui
 * cumule les chargements successifs et compte deux fois un champ relu.
 */
function TableCard({ s, fields, open, onToggle }) {
  const jointe = s.joined;
  const border = jointe ? 'border-line' : 'border-info';
  const header = jointe ? 'bg-raised' : 'bg-info-soft';
  // Aplat plein pour la table principale (blanc lisible dessus), teinte
  // neutre pour une jointure — d'ou la couleur de texte differente.
  const badge = jointe ? 'bg-line-strong text-ink' : 'bg-info text-white';

  return (
    <div className={`bg-raised border ${border} rounded-lg overflow-hidden flex flex-col`}>
      <div className={`${header} px-3 py-2 flex items-center justify-between gap-2`}>
        <span className="font-mono text-xs font-semibold text-ink truncate" title={s.path || s.name}>
          {s.name}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${badge} font-medium shrink-0`}
          title={jointe ? 'Lue par une jointure SQL' : `${fields.length || s.fieldCount || 0} colonne(s) lue(s)`}>
          {jointe ? 'JOINTE' : `${fields.length || s.fieldCount || 0} COL.`}
        </span>
      </div>

      {s.path && s.path !== s.name && (
        <div className="px-3 pt-1.5 font-mono text-[9px] text-ink-faint truncate" title={s.path}>{s.path}</div>
      )}

      <div className="px-3 py-2 text-[10px] text-ink-muted min-h-[2.25rem]">
        {s.usedBy?.length > 0 ? (
          <span className="line-clamp-2" title={s.usedBy.join(', ')}>→ {s.usedBy.join(', ')}</span>
        ) : (
          <span className="text-ink-faint italic">
            {jointe ? 'Table de jointure — aucune colonne propre.' : 'Aucune table Qlik rattachée.'}
          </span>
        )}
      </div>

      {s.sqlQuery && (
        <>
          <button type="button" onClick={onToggle}
            className="px-3 py-1.5 text-[10px] text-left text-ink-muted hover:text-ink border-t border-line">
            {open ? '▾ masquer la requête' : '▸ voir la requête SQL'}
          </button>
          {open && (
            <pre className="text-[9px] text-ink-muted bg-canvas border-t border-line p-2 overflow-auto max-h-52 whitespace-pre-wrap">
              {s.sqlQuery}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function SourceRow({ s, badge, badgeColor, onClick, expanded, details, extra }) {
  return (
    <div className="bg-canvas border border-line rounded px-2.5 py-2 space-y-0.5 cursor-pointer hover:border-line"
      onClick={onClick}>
      <div className="flex items-center gap-2">
        <TypeBadge type={badge} color={badgeColor} />
        <span className="font-mono text-xs text-ink truncate flex-1" title={s.name}>{s.name}</span>
        {s.joined && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-raised text-ink-muted shrink-0"
            title="Table lue par une jointure SQL : elle alimente la table Qlik sans porter de champ propre">
            jointe
          </span>
        )}
        {s.sheet && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-warn-soft text-warn" title="Feuille Excel">
            📄 {s.sheet}
          </span>
        )}
      </div>
      <PathLine path={s.path || s.sourcePath} />
      <UsedBy usedBy={s.usedBy} fieldCount={s.fieldCount} />
      {extra}
      {expanded && details}
    </div>
  );
}

export default function SourcesTab({ analysis, analyzing, appId }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const [usage, setUsage] = useState(null);

  // Croisement inter-apps — rechargé après chaque analyse (le lineage global
  // change quand les STORE/LOAD de l'app changent).
  useEffect(() => {
    if (!appId || !analysis) { setUsage(null); return; }
    let annule = false;
    appsApi.getQvdUsage(appId)
      .then(u => { if (!annule) setUsage(u); })
      .catch(() => { if (!annule) setUsage(null); });
    return () => { annule = true; };
  }, [appId, analysis]);

  // Index par nom court de QVD : les clés du lineage global sont des chemins
  // normalisés, le sourceMeta local porte le nom de fichier.
  const usageByName = useMemo(() => {
    const read = new Map(), written = new Map();
    for (const c of usage?.consumed || []) read.set(c.name.toLowerCase(), c);
    for (const p of usage?.produced || []) written.set(p.name.toLowerCase(), p);
    return { read, written };
  }, [usage]);

  // Colonnes lues par table source. `sourceMeta` ne porte qu'un compteur ; le
  // détail est dans le lineage, où chaque ligne relie un champ source à son
  // champ Qlik. On indexe par nom de table source (`tableSource`).
  const fieldsBySource = useMemo(() => {
    const map = new Map();
    for (const l of analysis?.lineage || []) {
      const src = l.tableSource;
      if (!src) continue;
      const col = l.fieldSource && l.fieldSource !== '—' ? l.fieldSource : l.fieldQlik;
      if (!col || col === '*') continue;
      if (!map.has(src)) map.set(src, new Set());
      map.get(src).add(col);
    }
    return map;
  }, [analysis]);
  const colsOf = (name) => [...(fieldsBySource.get(name) || [])];

  const { sql, qvd, files, internal } = useMemo(
    () => categorize(analysis?.sourceMeta),
    [analysis]
  );

  const stores = analysis?.stores || [];

  // Regroupement SQL par connexion
  const sqlByConnection = useMemo(() => {
    const map = new Map();
    for (const s of sql) {
      const conn = s.connection || 'Connexion inconnue';
      if (!map.has(conn)) map.set(conn, []);
      map.get(conn).push(s);
    }
    return [...map.entries()];
  }, [sql]);

  // Filtre de recherche transverse
  const q = norm(search.trim());
  const match = (s) => !q ||
    norm(s.name).includes(q) || norm(s.path).includes(q) ||
    norm(s.connection).includes(q) || (s.usedBy || []).some(u => norm(u).includes(q));
  const matchStore = (st) => !q ||
    norm(st.outputName).includes(q) || norm(st.outputPath).includes(q) || norm(st.tableName).includes(q);

  if (analyzing) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-lg" />)}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-64 text-ink-faint">
        <div className="text-center">
          <Info size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Analysez un script pour voir les sources</p>
        </div>
      </div>
    );
  }

  const fSql = sqlByConnection.map(([conn, srcs]) => [conn, srcs.filter(match)]).filter(([, s]) => s.length);
  const fQvdRead = qvd.filter(match);
  const fStores = stores.filter(matchStore);
  const fFiles = files.filter(match);
  const fInternal = internal.filter(match);

  return (
    <div className="p-4 overflow-y-auto h-full space-y-3">
      {/* Synthèse + recherche */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer les sources..."
            className="w-full bg-surface border border-line rounded pl-8 pr-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent" />
        </div>
        <span className="text-[10px] text-ink-muted">
          {sqlByConnection.length} connexion{sqlByConnection.length !== 1 ? 's' : ''} SQL
          · {qvd.length} QVD lu{qvd.length !== 1 ? 's' : ''}
          · {stores.length} QVD écrit{stores.length !== 1 ? 's' : ''}
          · {files.length} fichier{files.length !== 1 ? 's' : ''}
          · {internal.length} interne{internal.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* 1. Bases SQL */}
      <Section icon={Database} title="Bases SQL" count={sql.length} color="text-info">
        {fSql.length === 0 && <p className="text-[11px] text-ink-faint">Aucune source SQL{q ? ' correspondante' : ''}.</p>}
        {fSql.map(([conn, srcs]) => {
          return (
            <div key={conn} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-info mt-1">
                <Plug size={11} /> <span className="font-semibold">{conn}</span>
                <span className="text-ink-faint">
                  — {srcs.length} table{srcs.length !== 1 ? 's' : ''}
                  {srcs.some(s => s.joined) && ` · ${srcs.filter(s => s.joined).length} jointe(s)`}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 items-start">
                {srcs.map((s, i) => (
                  <TableCard key={conn + s.name + i} s={s} fields={colsOf(s.name)}
                    open={expanded === conn + s.name + i}
                    onToggle={() => setExpanded(expanded === conn + s.name + i ? null : conn + s.name + i)} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      {/* 2. QVD */}
      <Section icon={HardDrive} title="QVD" count={qvd.length + stores.length} color="text-info">
        {usage && (
          <div className="text-[10px] text-ink-muted flex items-start gap-1.5 mb-1 pb-2 border-b border-line">
            <AlertTriangle size={11} className="text-ink-faint shrink-0 mt-px" />
            <span>
              Croisement calculé sur les <strong className="text-ink-muted">{usage.analyzedApps} app(s) analysées</strong>
              {' '}sur {usage.totalApps} importées : « aucune app analysée ne le produit » signifie que le producteur
              est hors périmètre, pas qu'il n'existe pas.
              {usage.stats.withoutProducer > 0 && (
                <span className="text-warn"> {usage.stats.withoutProducer} QVD lu(s) sans producteur connu.</span>
              )}
              {usage.stats.orphans > 0 && (
                <span className="text-danger"> {usage.stats.orphans} QVD écrit(s) que personne ne lit.</span>
              )}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">Lus (LOAD FROM) — {fQvdRead.length}</div>
            {fQvdRead.length === 0 && <p className="text-[11px] text-ink-faint">Aucun.</p>}
            {fQvdRead.map((s, i) => (
              <SourceRow key={'r' + s.name + i} s={s} badge="LU" badgeColor="bg-info-soft text-info"
                onClick={() => {}} expanded={false} details={null}
                extra={<CrossApp dir="read" entry={usageByName.read.get(String(s.name).toLowerCase())} />} />
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">Écrits (STORE INTO) — {fStores.length}</div>
            {fStores.length === 0 && <p className="text-[11px] text-ink-faint">Aucun.</p>}
            {fStores.map((st, i) => (
              <div key={'w' + st.outputName + i} className="bg-canvas border border-line rounded px-2.5 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <TypeBadge type="ÉCRIT" color="bg-violet-soft text-violet" />
                  <span className="font-mono text-xs text-ink truncate flex-1" title={st.outputName}>{st.outputName}</span>
                </div>
                <PathLine path={st.outputPath} />
                <div className="text-[10px] text-ink-muted">← table {st.tableName}</div>
                <CrossApp dir="write" entry={usageByName.written.get(String(st.outputName).toLowerCase())} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 3. Fichiers plats */}
      <Section icon={FileSpreadsheet} title="Fichiers plats" count={files.length} color="text-accent-ink">
        {fFiles.length === 0 && <p className="text-[11px] text-ink-faint">Aucun fichier{q ? ' correspondant' : ''}.</p>}
        {fFiles.map((s, i) => (
          <SourceRow key={'f' + s.name + i} s={s}
            badge={(s.type || 'FICHIER').toUpperCase()}
            badgeColor="bg-accent-soft text-accent-ink"
            onClick={() => {}} expanded={false} details={null} />
        ))}
      </Section>

      {/* 4. Interne */}
      <Section icon={Cog} title="Interne (Resident / Inline / Autogenerate)" count={internal.length} color="text-ink-muted" defaultOpen={false}>
        {fInternal.length === 0 && <p className="text-[11px] text-ink-faint">Aucune source interne{q ? ' correspondante' : ''}.</p>}
        {fInternal.map((s, i) => (
          <SourceRow key={'i' + s.name + i} s={s}
            badge={(s.type || 'INTERNE').toUpperCase()}
            badgeColor="bg-raised text-ink-muted"
            onClick={() => {}} expanded={false} details={null} />
        ))}
      </Section>
    </div>
  );
}
