import React, { useState, useMemo } from 'react';
import {
  Database, HardDrive, FileSpreadsheet, Cog, Search, ChevronDown, ChevronRight, Info, Plug
} from 'lucide-react';

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
    <section className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-900/60">
        {open ? <ChevronDown size={13} className="text-gray-600" /> : <ChevronRight size={13} className="text-gray-600" />}
        <Icon size={14} className={color} />
        <span className="text-xs font-semibold text-gray-200">{title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded bg-gray-800 ${color}`}>{count}</span>
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
    <div className="font-mono text-[10px] text-gray-600 truncate" title={path}>{path}</div>
  );
}

function UsedBy({ usedBy, fieldCount }) {
  if (!usedBy?.length) return null;
  return (
    <div className="text-[10px] text-gray-500">
      → {usedBy.join(', ')}{fieldCount ? ` · ${fieldCount} champs` : ''}
    </div>
  );
}

function SourceRow({ s, badge, badgeColor, onClick, expanded, details }) {
  return (
    <div className="bg-gray-950/60 border border-gray-800/60 rounded px-2.5 py-2 space-y-0.5 cursor-pointer hover:border-gray-700"
      onClick={onClick}>
      <div className="flex items-center gap-2">
        <TypeBadge type={badge} color={badgeColor} />
        <span className="font-mono text-xs text-gray-200 truncate flex-1" title={s.name}>{s.name}</span>
        {s.sheet && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300" title="Feuille Excel">
            📄 {s.sheet}
          </span>
        )}
      </div>
      <PathLine path={s.path || s.sourcePath} />
      <UsedBy usedBy={s.usedBy} fieldCount={s.fieldCount} />
      {expanded && details}
    </div>
  );
}

export default function SourcesTab({ analysis, analyzing }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

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
      <div className="flex items-center justify-center h-64 text-gray-600">
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
          <Search size={12} className="absolute left-2.5 top-2 text-gray-600" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer les sources..."
            className="w-full bg-gray-900 border border-gray-800 rounded pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-600" />
        </div>
        <span className="text-[10px] text-gray-500">
          {sqlByConnection.length} connexion{sqlByConnection.length !== 1 ? 's' : ''} SQL
          · {qvd.length} QVD lu{qvd.length !== 1 ? 's' : ''}
          · {stores.length} QVD écrit{stores.length !== 1 ? 's' : ''}
          · {files.length} fichier{files.length !== 1 ? 's' : ''}
          · {internal.length} interne{internal.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* 1. Bases SQL */}
      <Section icon={Database} title="Bases SQL" count={sql.length} color="text-blue-400">
        {fSql.length === 0 && <p className="text-[11px] text-gray-600">Aucune source SQL{q ? ' correspondante' : ''}.</p>}
        {fSql.map(([conn, srcs]) => (
          <div key={conn} className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-blue-300 mt-1">
              <Plug size={11} /> <span className="font-semibold">{conn}</span>
              <span className="text-gray-600">— {srcs.length} table{srcs.length !== 1 ? 's' : ''}</span>
            </div>
            {srcs.map((s, i) => (
              <SourceRow key={conn + s.name + i} s={s} badge="SQL" badgeColor="bg-blue-900/40 text-blue-300"
                onClick={() => setExpanded(expanded === conn + s.name ? null : conn + s.name)}
                expanded={expanded === conn + s.name}
                details={s.sqlQuery ? (
                  <pre className="mt-1 text-[10px] text-gray-400 bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {s.sqlQuery}
                  </pre>
                ) : null}
              />
            ))}
          </div>
        ))}
      </Section>

      {/* 2. QVD */}
      <Section icon={HardDrive} title="QVD" count={qvd.length + stores.length} color="text-cyan-400">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Lus (LOAD FROM) — {fQvdRead.length}</div>
            {fQvdRead.length === 0 && <p className="text-[11px] text-gray-600">Aucun.</p>}
            {fQvdRead.map((s, i) => (
              <SourceRow key={'r' + s.name + i} s={s} badge="LU" badgeColor="bg-cyan-900/40 text-cyan-300"
                onClick={() => {}} expanded={false} details={null} />
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Écrits (STORE INTO) — {fStores.length}</div>
            {fStores.length === 0 && <p className="text-[11px] text-gray-600">Aucun.</p>}
            {fStores.map((st, i) => (
              <div key={'w' + st.outputName + i} className="bg-gray-950/60 border border-gray-800/60 rounded px-2.5 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <TypeBadge type="ÉCRIT" color="bg-violet-900/40 text-violet-300" />
                  <span className="font-mono text-xs text-gray-200 truncate flex-1" title={st.outputName}>{st.outputName}</span>
                </div>
                <PathLine path={st.outputPath} />
                <div className="text-[10px] text-gray-500">← table {st.tableName}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* 3. Fichiers plats */}
      <Section icon={FileSpreadsheet} title="Fichiers plats" count={files.length} color="text-emerald-400">
        {fFiles.length === 0 && <p className="text-[11px] text-gray-600">Aucun fichier{q ? ' correspondant' : ''}.</p>}
        {fFiles.map((s, i) => (
          <SourceRow key={'f' + s.name + i} s={s}
            badge={(s.type || 'FICHIER').toUpperCase()}
            badgeColor="bg-emerald-900/40 text-emerald-300"
            onClick={() => {}} expanded={false} details={null} />
        ))}
      </Section>

      {/* 4. Interne */}
      <Section icon={Cog} title="Interne (Resident / Inline / Autogenerate)" count={internal.length} color="text-gray-400" defaultOpen={false}>
        {fInternal.length === 0 && <p className="text-[11px] text-gray-600">Aucune source interne{q ? ' correspondante' : ''}.</p>}
        {fInternal.map((s, i) => (
          <SourceRow key={'i' + s.name + i} s={s}
            badge={(s.type || 'INTERNE').toUpperCase()}
            badgeColor="bg-gray-800 text-gray-400"
            onClick={() => {}} expanded={false} details={null} />
        ))}
      </Section>
    </div>
  );
}
