'use strict';

/**
 * Parser local Qlik/SQL v2 — moteur par INSTRUCTIONS (zéro appel API).
 *
 * Contrairement à la v1 (découpage par lignes), le script est découpé en
 * instructions terminées par ';' (en respectant chaînes, crochets et
 * parenthèses), puis chaque instruction est classifiée et parsée :
 *   - labels de table ("Table:" — y compris sur la même ligne que LOAD)
 *   - préfixes : Mapping, (No)Concatenate[(cible)], [Left|Inner|…] Join[(cible)], Keep, Buffer…
 *   - sources : QVD, SQL (avec appariement LOAD précédent ; SELECT), Excel, CSV,
 *     RESIDENT, INLINE (avec extraction des en-têtes), AUTOGENERATE
 *   - STORE, DROP TABLE, LIB CONNECT TO (connexion contextuelle), includes
 * Produit le même format de sortie que la v1 (compatibilité client), avec
 * un indicateur de couverture précis par instruction.
 */

// ─── Utils ────────────────────────────────────────────────────────────────────

function cleanName(s) {
  return (s || '').trim().replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').trim();
}

/**
 * Supprime les commentaires (bloc et ligne + REM) en préservant les sauts de
 * ligne (pour garder les numéros de ligne exacts) et sans toucher aux chaînes,
 * crochets ni URLs (lib://, http://).
 */
function stripComments(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  let inStr = false, strCh = '', inBracket = false;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (inStr) { out += c; if (c === strCh) inStr = false; i++; continue; }
    if (inBracket) { out += c; if (c === ']') inBracket = false; i++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; out += c; i++; continue; }
    if (c === '[') { inBracket = true; out += c; i++; continue; }
    if (c === '/' && d === '*') {
      const end = s.indexOf('*/', i + 2);
      const chunk = end === -1 ? s.slice(i) : s.slice(i, end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '/' && d === '/' && s[i - 1] !== ':') {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    out += c; i++;
  }
  // Commentaires REM ... ; (instruction entière)
  return out.replace(/^([ \t]*)REM\b[^;]*;/gim, (m) => m.replace(/[^\n]/g, ' '));
}

/** Résout les variables SET/LET (littéraux uniquement, passes imbriquées) */
function resolveVariables(script) {
  const vars = new Map();
  const defRe = /^[ \t]*(SET|LET)\s+([\w.]+)\s*=\s*(.+?);\s*$/gim;
  let m;
  while ((m = defRe.exec(script)) !== null) {
    const kind = m[1].toUpperCase();
    let val = m[3].trim();
    const quoted = /^'(.*)'$/.exec(val) || /^"(.*)"$/.exec(val);
    if (quoted) val = quoted[1];
    else if (kind === 'LET' && /\w+\s*\(/.test(val)) continue;
    if (val.length > 0 && val.length < 500) vars.set(m[2], val);
  }
  if (vars.size === 0) return script;
  let out = script;
  for (let i = 0; i < 3; i++) {
    let changed = false;
    out = out.replace(/\$\(([\w.]+)\)/g, (all, name) => {
      if (vars.has(name)) { changed = true; return vars.get(name); }
      return all;
    });
    if (!changed) break;
  }
  return out;
}

// ─── Découpage en instructions ───────────────────────────────────────────────

/** Découpe le script en instructions terminées par ';' (hors chaînes/crochets) */
function splitStatements(script) {
  const stmts = [];
  let start = 0, line = 1, startLine = 1;
  let inStr = false, strCh = '', inBracket = false;
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (c === '\n') line++;
    if (inStr) { if (c === strCh) inStr = false; continue; }
    if (inBracket) { if (c === ']') inBracket = false; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
    if (c === '[') { inBracket = true; continue; }
    if (c === ';') {
      const text = script.slice(start, i);
      if (text.trim()) stmts.push({ text, line: startLine });
      start = i + 1;
      startLine = line;
    }
  }
  const rest = script.slice(start);
  if (rest.trim()) stmts.push({ text: rest, line: startLine });
  return stmts;
}

/** Masque des positions "top-level" (hors chaînes, crochets, parenthèses) */
function buildMask(text) {
  const mask = new Array(text.length).fill(true);
  let inStr = false, strCh = '', inBracket = false, paren = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { mask[i] = false; if (c === strCh) inStr = false; continue; }
    if (inBracket) { mask[i] = false; if (c === ']') inBracket = false; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; mask[i] = false; continue; }
    if (c === '[') { inBracket = true; mask[i] = false; continue; }
    if (c === '(') { mask[i] = paren === 0; paren++; continue; }
    if (c === ')') { paren = Math.max(0, paren - 1); mask[i] = false; continue; }
    if (paren > 0) mask[i] = false;
  }
  return mask;
}

/** Premier index top-level d'un mot-clé (insensible à la casse) */
function findKw(text, mask, word, from = 0) {
  const re = new RegExp(`\\b${word}\\b`, 'ig');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (mask[m.index]) return m.index;
  }
  return -1;
}

// ─── Parsing des listes de champs ────────────────────────────────────────────

function parseFieldList(fieldStr) {
  const fields = [];
  let depth = 0, inStr = false, strChar = '', inBracket = false, current = '';
  for (const ch of fieldStr) {
    if (inStr) { current += ch; if (ch === strChar) inStr = false; }
    else if (inBracket) { current += ch; if (ch === ']') inBracket = false; }
    else if (ch === '"' || ch === "'") { inStr = true; strChar = ch; current += ch; }
    else if (ch === '[') { inBracket = true; current += ch; }
    else if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { if (current.trim()) fields.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  if (current.trim()) fields.push(current.trim());
  return fields;
}

function parseField(rawField) {
  const f = rawField.trim();
  const asM = f.match(/^([\s\S]+?)\s+AS\s+(\[[^\]]+\]|[^\s,]+)\s*$/i);
  if (asM) return { expression: asM[1].trim(), alias: cleanName(asM[2]) };
  return { expression: f, alias: cleanName(f) };
}

// ─── Classification des expressions (identique v1) ───────────────────────────

function isCalcExpression(expr) {
  return /\b(If|Date|Num|Text|Len|Left|Right|Mid|Upper|Lower|Trim|ApplyMap|AutoNumber|Hash128|Dual|Year|Month|Quarter|Week|Day|Hour|Minute|Second|Floor|Ceil|Round|Fabs|Mod|Concat|Pick|Replace|Match|WildMatch|Interval|Timestamp|Now|Today|SubField|Evaluate|Coalesce|Alt|IsNull|IsNum|IsText|Date#|Num#|Time#|Timestamp#|Interval#|GetFieldSelections|Aggr|RangeSum|RangeMax|RangeMin|RangeAvg)\s*\(/i.test(expr);
}

function isSyntheticKey(expr) {
  return (expr.match(/&/g) || []).length >= 1 || /\bAutoNumber\s*\(/i.test(expr);
}

function synthKeyRisk(expr) {
  const n = (expr.match(/&/g) || []).length;
  if (n >= 3 || /\bAutoNumber\s*\(/i.test(expr)) return 'haut';
  if (n >= 2) return 'moyen';
  return 'faible';
}

function describeTransformation(expr, alias) {
  if (expr === alias || expr === `[${alias}]` || `[${expr}]` === `[${alias}]`) return 'Direct';
  if (/\bApplyMap\s*\(/i.test(expr)) {
    const mm = expr.match(/ApplyMap\s*\(\s*'([^']+)'/i);
    return mm ? `ApplyMap('${mm[1]}')` : 'ApplyMap';
  }
  if (isSyntheticKey(expr)) return `Clé synthétique: ${expr.replace(/\s+/g, ' ').slice(0, 80)}`;
  if (/\bIf\s*\(/i.test(expr)) return 'Expression conditionnelle (If)';
  if (/\b(Date|Timestamp|Interval)\s*\(/i.test(expr)) return 'Formatage date';
  if (/\b(Upper|Lower|Trim|Left|Right|Mid|SubField|Replace|Concat)\s*\(/i.test(expr)) return 'Transformation texte';
  if (/\b(Num|Round|Floor|Ceil|Fabs|Mod)\s*\(/i.test(expr)) return 'Transformation numérique';
  if (/\b(Year|Month|Quarter|Week|Day|Hour|Minute|Second)\s*\(/i.test(expr)) return 'Extraction composant date';
  if (/\b(AutoNumber|Hash128)\s*\(/i.test(expr)) return 'Clé technique générée';
  if (isCalcExpression(expr)) return `Formule: ${expr.slice(0, 70)}`;
  if (expr !== alias) return `Renommé depuis: ${cleanName(expr)}`;
  return 'Direct';
}

function guessDataType(alias, expr) {
  const up = alias.toUpperCase();
  if (/\b(Date|Timestamp|Interval)\s*\(/i.test(expr) || up.includes('DATE') || up.includes('DAY') || up.includes('MOIS')) return 'date';
  if (/\b(Num|Round|Floor|Ceil|Fabs|Mod|Sum|Count|Avg|Min|Max)\s*\(/i.test(expr) || up.includes('MONTANT') || up.includes('PRIX') || up.includes('QTE') || up.includes('AMOUNT')) return 'numeric';
  return 'string';
}

function guessKeys(fields) {
  return fields
    .filter(f => {
      const up = f.alias.toUpperCase();
      return up.startsWith('ID_') || up.endsWith('_ID') || up.startsWith('CLE_') ||
             up.startsWith('KEY_') || up.endsWith('_KEY') || up.startsWith('PK_') ||
             up.endsWith('_PK') || up.endsWith('_FK') || up.startsWith('FK_');
    })
    .map(f => f.alias);
}

// ─── Classification des tables ───────────────────────────────────────────────

function classifyTable(name, { isMapping = false, loadMethod = null } = {}) {
  const up = String(name).toUpperCase();
  if (isMapping || up.startsWith('MAP_') || up.startsWith('MAPPING_') || up.startsWith('LKP_')) return 'mapping';
  if (up.startsWith('FACT_') || up.startsWith('F_') || up.startsWith('FCT_') || up.startsWith('FT_')) return 'fact';
  if (up.startsWith('DIM_') || up.startsWith('D_') || up.endsWith('_DIM')) return 'dim';
  if (up.startsWith('TMP_') || up.startsWith('TEMP_') || up.startsWith('INT_') || up.startsWith('BRIDGE_') || up.startsWith('INTER_')) return 'temp';
  if (loadMethod === 'sql') return 'fact';
  return 'dim';
}

function detectModel(facts, dims) {
  if (facts.length > 0 && dims.length > 0) return 'etoile';
  return 'mixte';
}

// ─── Analyse d'une instruction LOAD/SELECT ───────────────────────────────────

const CONTROL_LABELS = new Set([
  'IF', 'THEN', 'ELSE', 'ELSEIF', 'END', 'FOR', 'NEXT', 'DO', 'LOOP', 'SUB',
  'EXIT', 'CALL', 'LET', 'SET', 'TRACE', 'REM', 'SWITCH', 'CASE', 'DEFAULT',
  'WHEN', 'STORE', 'LOAD', 'SQL', 'QUALIFY', 'UNQUALIFY', 'SECTION', 'DIRECTORY',
  'CONNECT', 'DISCONNECT', 'RENAME', 'DROP', 'CONCATENATE', 'NOCONCATENATE',
  'JOIN', 'KEEP', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'CROSS', 'SELECT',
  'DEFAULT', 'ELSE', 'BINARY', 'SLEEP', 'EXECUTE'
]);

/** Extrait le label "Nom:" en tête d'instruction (même ligne que LOAD acceptée) */
function extractLabel(text) {
  const m = text.match(/^\s*(\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9._ -]{0,80}?))\s*:(?![=\\/])/);
  if (!m) return { label: null, rest: text };
  const name = cleanName(m[2] || m[3]);
  if (!name || CONTROL_LABELS.has(name.toUpperCase())) return { label: null, rest: text };
  return { label: name, rest: text.slice(m[0].length) };
}

/** Extrait les préfixes avant LOAD/SELECT : mapping, concatenate, join, keep… */
function extractPrefixes(text) {
  let rest = text;
  const p = { isMapping: false, concat: null, concatTarget: null, join: null, joinTarget: null, noconcat: false };
  let changed = true;
  while (changed) {
    changed = false;
    let m;
    if ((m = rest.match(/^\s*(BUFFER)\s*(\([^)]*\))?/i))) { rest = rest.slice(m[0].length); changed = true; continue; }
    if ((m = rest.match(/^\s*(ADD|REPLACE|ONLY)\b/i))) { rest = rest.slice(m[0].length); changed = true; continue; }
    if ((m = rest.match(/^\s*MAPPING\b/i))) { p.isMapping = true; rest = rest.slice(m[0].length); changed = true; continue; }
    if ((m = rest.match(/^\s*NOCONCATENATE\b/i))) { p.noconcat = true; rest = rest.slice(m[0].length); changed = true; continue; }
    if ((m = rest.match(/^\s*CONCATENATE\s*(\(\s*(\[[^\]]+\]|[^)\s]+)\s*\))?/i))) {
      p.concat = true;
      p.concatTarget = m[2] ? cleanName(m[2]) : null;
      rest = rest.slice(m[0].length); changed = true; continue;
    }
    if ((m = rest.match(/^\s*(LEFT|RIGHT|INNER|OUTER|CROSS)?\s*(JOIN|KEEP)\s*(\(\s*(\[[^\]]+\]|[^)\s]+)\s*\))?/i))) {
      if (m[2].toUpperCase() === 'JOIN' || m[2].toUpperCase() === 'KEEP') {
        p.join = (m[1] || 'LEFT').toUpperCase();
        p.joinTarget = m[4] ? cleanName(m[4]) : null;
        rest = rest.slice(m[0].length); changed = true; continue;
      }
    }
    if ((m = rest.match(/^\s*(SAMPLE|FIRST)\s+[\w$()]+/i))) { rest = rest.slice(m[0].length); changed = true; continue; }
  }
  return { prefixes: p, rest };
}

const FORMAT_TO_METHOD = { qvd: 'qvd', txt: 'csv', ooxml: 'excel', biff: 'excel', xml: 'file', json: 'file', parquet: 'file' };

function methodFromPath(path, formatSpec) {
  const p = String(path || '').toLowerCase();
  if (/\.qvd$/.test(p)) return 'qvd';
  if (/\.(xlsx?|xlsm)$/.test(p)) return 'excel';
  if (/\.(csv|txt|tab|skv)$/.test(p)) return 'csv';
  if (formatSpec) {
    const f = formatSpec.toLowerCase();
    for (const [k, v] of Object.entries(FORMAT_TO_METHOD)) if (f.includes(k)) return v;
  }
  return 'file';
}

/**
 * Parse une instruction contenant LOAD (et/ou SELECT).
 * Retourne { fields, source: {loadMethod, sourcePath, sourceName, residentTable, sqlQuery}, pending }
 * pending = true si LOAD "précédent" sans source (attend un SQL SELECT).
 */
function parseLoadStatement(text) {
  const mask = buildMask(text);
  const loadIdx = findKw(text, mask, 'LOAD');
  const selectIdx = findKw(text, mask, 'SELECT');

  // Instruction SQL pure (SELECT sans LOAD) — souvent appariée à un LOAD précédent
  if (loadIdx === -1 && selectIdx !== -1) {
    const rawSql = text.slice(selectIdx).replace(/\s+/g, ' ').trim();
    const fromM = rawSql.match(/\bFROM\b\s+((?:\[[^\]]+\]|[\w."])+)/i);
    const srcTable = fromM ? cleanName(fromM[1]) : null;
    const sqlFields = parseFieldList(rawSql.replace(/^SELECT\s+(DISTINCT\s+)?/i, '').split(/\bFROM\b/i)[0])
      .map(parseField).filter(f => f.alias);
    return {
      isSqlOnly: true,
      fields: sqlFields,
      source: {
        loadMethod: 'sql', sourcePath: fromM ? fromM[1] : null,
        sourceName: srcTable || 'SQL', residentTable: null, sqlQuery: rawSql
      }
    };
  }
  if (loadIdx === -1) return null;

  // Bornes des champs : de LOAD à FROM/RESIDENT/INLINE/AUTOGENERATE top-level
  let fieldsEnd = text.length;
  let sourceKind = null, sourceIdx = -1;
  for (const kw of ['FROM', 'RESIDENT', 'INLINE', 'AUTOGENERATE']) {
    const idx = findKw(text, mask, kw, loadIdx + 4);
    if (idx !== -1 && idx < fieldsEnd) { fieldsEnd = idx; sourceKind = kw; sourceIdx = idx; }
  }

  let fieldsStr = text.slice(loadIdx + 4, fieldsEnd).replace(/^\s*DISTINCT\b/i, '');
  let fields = parseFieldList(fieldsStr).map(parseField).filter(f => f.alias);

  const source = { loadMethod: 'unknown', sourcePath: null, sourceName: '—', residentTable: null, sqlQuery: null, sheet: null };
  let pending = false;

  if (sourceKind === 'FROM') {
    const after = text.slice(sourceIdx + 4);
    const pm = after.match(/^\s*(\[[^\]]+\]|[^\s(;]+)/);
    const path = pm ? cleanName(pm[1]) : null;
    const fm = after.slice(pm ? pm[0].length : 0).match(/^\s*\(([^)]*)\)/);
    const formatSpec = fm ? fm[1] : null;
    source.loadMethod = methodFromPath(path, formatSpec);
    source.sourcePath = path;
    source.sourceName = path ? path.split(/[/\\]/).pop() : '—';
    // Feuille Excel : (ooxml, embedded labels, table is [Feuil1])
    if (formatSpec) {
      const sm = formatSpec.match(/table\s+is\s+(\[[^\]]+\]|[^\s,)]+)/i);
      if (sm) source.sheet = cleanName(sm[1]);
      const hm = formatSpec.match(/header\s+is\s+(\d+)/i);
      if (hm) source.headerRows = parseInt(hm[1], 10);
    }
  } else if (sourceKind === 'RESIDENT') {
    const rm = text.slice(sourceIdx + 8).match(/^\s*(\[[^\]]+\]|[^\s;]+)/);
    const tbl = rm ? cleanName(rm[1]) : null;
    source.loadMethod = 'resident';
    source.sourceName = tbl || '—';
    source.residentTable = tbl;
  } else if (sourceKind === 'INLINE') {
    source.loadMethod = 'inline';
    source.sourceName = 'Inline data';
    // En-têtes du bloc inline (première ligne entre crochets)
    const im = text.slice(sourceIdx).match(/INLINE\s*\[([\s\S]*?)\]/i);
    if (im) {
      const header = (im[1].split('\n').find(l => l.trim()) || '');
      const headers = header.split(/[,;\t]/).map(h => cleanName(h)).filter(Boolean);
      if (headers.length && (fields.length === 0 || (fields.length === 1 && fields[0].alias === '*'))) {
        fields = headers.map(h => ({ expression: h, alias: h }));
      }
    }
  } else if (sourceKind === 'AUTOGENERATE') {
    source.loadMethod = 'autogenerate';
    source.sourceName = 'Autogenerate';
  } else {
    pending = true; // LOAD précédent — la source arrive avec le SQL SELECT suivant
  }

  return { isSqlOnly: false, fields, source, pending };
}

// ─── Includes ────────────────────────────────────────────────────────────────

function extractIncludes(script) {
  const includes = [];
  const seen = new Set();
  const re = /\$\((?:Must_)?Include\s*=\s*([^)]+)\)/gi;
  let m;
  while ((m = re.exec(script)) !== null) {
    const p = m[1].trim();
    if (!seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); includes.push(p); }
  }
  return includes;
}

// ─── Résumé ──────────────────────────────────────────────────────────────────

function generateSummary(appName, facts, dims, sources, synthKeys, model, stores = []) {
  const parts = [`Application "${appName}" analysée localement (sans IA).`];
  if (facts.length + dims.length > 0) {
    parts.push(`${facts.length} table(s) de faits, ${dims.length} dimension(s) identifiées.`);
  }
  if (sources.length > 0) parts.push(`${sources.length} source(s) détectée(s).`);
  if (stores.length > 0) parts.push(`💾 ${stores.length} QVD écrit(s) via STORE.`);
  if (synthKeys.length > 0) parts.push(`⚠️ ${synthKeys.length} clé(s) synthétique(s) détectée(s) — vérifiez les risques.`);
  parts.push(`Modèle: ${model === 'etoile' ? 'étoile ⭐' : 'mixte'}.`);
  return parts.join(' ');
}

// ─── Entrée principale ───────────────────────────────────────────────────────

function parseQlikScript(scriptContent, appName = 'Application') {
  const resolved = resolveVariables(scriptContent || '');
  const script = stripComments(resolved);
  const statements = splitStatements(script);
  const includes = extractIncludes(scriptContent || '');

  // ── État du parcours ──
  const tables = new Map();      // nom -> entrée table
  const mappings = [];
  const stores = [];
  const droppedTables = new Set();
  const lineage = [];
  const calcFields = [];
  const synthKeys = [];
  const sources = [];
  const seenSources = new Set();
  const sourceMetaMap = new Map();
  let currentConnection = null;
  let lastTable = null;          // dernière table chargée (cible des concatenate/join sans cible)
  let pendingLoad = null;        // LOAD précédent en attente de son SQL SELECT
  let hasSectionAccess = false;
  let inAccessSection = false;

  const coverage = { loadStatements: 0, parsedBlocks: 0, unparsed: [], unresolvedVariables: [] };
  const flagUnparsed = (line, reason) => { if (coverage.unparsed.length < 30) coverage.unparsed.push({ line, reason }); };

  const addSource = (name) => {
    if (name && name !== '—' && !seenSources.has(name)) { seenSources.add(name); sources.push(name); }
  };

  const ensureSourceMeta = (name, meta) => {
    if (!name || name === '—') return null;
    // Deux feuilles du même Excel = deux sources distinctes
    const key = meta.sheet ? `${name}#${meta.sheet}` : name;
    if (!sourceMetaMap.has(key)) {
      sourceMetaMap.set(key, {
        name, path: meta.sourcePath || null, type: meta.loadMethod,
        sheet: meta.sheet || null,
        connection: meta.connection || null, usedBy: [], fieldCount: 0
      });
    }
    return sourceMetaMap.get(key);
  };

  const ensureTable = (name, meta, isMapping) => {
    if (!tables.has(name)) {
      tables.set(name, {
        name,
        fields: [], keys: [], fieldDetails: [],
        source: meta.sourceName || '—',
        sourcePath: meta.sourcePath || null,
        loadMethod: meta.loadMethod || 'unknown',
        connection: meta.connection || null,
        sqlQuery: meta.sqlQuery || null,
        residentTable: meta.residentTable || null,
        sheet: meta.sheet || null,
        isDropped: false,
        isMapping: !!isMapping
      });
    }
    return tables.get(name);
  };

  /** Intègre un chargement (champs + source) dans une table cible */
  const applyLoad = (tableName, fields, meta, { fromJoin = false } = {}) => {
    const entry = ensureTable(tableName, meta, meta.isMapping);
    const keys = guessKeys(fields);
    for (const k of keys) if (!entry.keys.includes(k)) entry.keys.push(k);

    const srcName = meta.sourceName || '—';
    const sm = ensureSourceMeta(srcName, meta);
    if (sm) {
      if (!sm.usedBy.includes(tableName)) sm.usedBy.push(tableName);
      sm.fieldCount += fields.length;
    }
    if (meta.loadMethod === 'qvd' || meta.loadMethod === 'excel' || meta.loadMethod === 'csv' || meta.loadMethod === 'file') {
      addSource(srcName);
    } else if (meta.loadMethod === 'sql') {
      addSource(srcName);
      if (meta.connection) addSource(meta.connection);
    }

    for (const f of fields) {
      if (!f.alias) continue;
      if (f.alias === '*') {
        lineage.push({
          fieldQlik: '*', tableQlik: tableName, fieldSource: '*',
          tableSource: srcName, sourcePath: meta.sourcePath || null,
          loadMethod: meta.loadMethod, connection: meta.connection || null,
          transformation: 'Tous les champs de la source (LOAD *)',
          isCalculated: false, isSynth: false, isKey: false, dataType: 'inconnu'
        });
        if (!entry.fields.includes('*')) entry.fields.push('*');
        continue;
      }
      const isSynth = isSyntheticKey(f.expression);
      const isCalc = isCalcExpression(f.expression) && !isSynth;
      const transform = describeTransformation(f.expression, f.alias);

      if (!entry.fields.includes(f.alias)) {
        entry.fields.push(f.alias);
        entry.fieldDetails.push({
          alias: f.alias, expression: f.expression,
          isKey: keys.includes(f.alias), isCalc, isSynth,
          dataType: guessDataType(f.alias, f.expression),
          transformation: transform
        });
      }

      lineage.push({
        fieldQlik: f.alias,
        tableQlik: tableName,
        fieldSource: isSynth ? '—' : (f.expression !== f.alias ? cleanName(f.expression.split(/[\s(,]+/)[0]) : f.alias),
        tableSource: srcName,
        sourcePath: meta.sourcePath || null,
        sheet: meta.sheet || null,
        loadMethod: meta.loadMethod,
        connection: meta.connection || null,
        transformation: transform,
        isCalculated: isCalc,
        isSynth,
        isKey: !fromJoin && keys.includes(f.alias),
        dataType: guessDataType(f.alias, f.expression)
      });

      if (isCalc) calcFields.push({ field: f.alias, table: tableName, formula: f.expression, type: 'formule' });
      if (isSynth && !synthKeys.find(k => k.field === f.alias)) {
        synthKeys.push({ field: f.alias, formula: f.expression, risk: synthKeyRisk(f.expression) });
      }
    }
  };

  // ── Parcours des instructions ──
  for (const stmt of statements) {
    const text = stmt.text;
    const trimmed = text.trim();
    if (!trimmed) continue;

    // Sections
    const secM = trimmed.match(/^SECTION\s+(ACCESS|APPLICATION)/i);
    if (secM) {
      inAccessSection = secM[1].toUpperCase() === 'ACCESS';
      if (inAccessSection) hasSectionAccess = true;
      continue;
    }

    // Connexions
    let m;
    if ((m = trimmed.match(/^LIB\s+CONNECT\s+TO\s+['"]([^'"]+)['"]/i)) ||
        (m = trimmed.match(/^(?:ODBC|OLEDB)?\s*CONNECT(?:32|64)?\s+TO\s+['"]([^'"]+)['"]/i))) {
      currentConnection = m[1];
      addSource(m[1]);
      continue;
    }
    if (/^DISCONNECT\b/i.test(trimmed)) { currentConnection = null; continue; }

    // SET/LET / contrôle / divers
    if (/^(SET|LET|TRACE|SLEEP|CALL|EXIT|QUALIFY|UNQUALIFY|SEARCH|EXECUTE|DIRECTORY|BINARY)\b/i.test(trimmed)) continue;
    if (/^(IF|ELSEIF|ELSE|END\s*IF|FOR|NEXT|DO|LOOP|SUB|END\s*SUB|SWITCH|CASE|END\s*SWITCH|WHEN)\b/i.test(trimmed)) {
      // Les LOAD à l'intérieur des structures sont des instructions séparées (déjà gérées)
      if (!/\bLOAD\b/i.test(trimmed)) continue;
    }

    // STORE
    if ((m = trimmed.match(/^STORE\b\s+\[?([^\]\n;,]+?)\]?\s+INTO\s+(\[[^\]]+\]|[^\s(;]+)\s*(?:\(\s*\w+\s*\))?$/i))) {
      const tableName = cleanName(m[1].replace(/^\*\s+FROM\s+/i, ''));
      const outputPath = cleanName(m[2]);
      const outputName = outputPath.split(/[/\\]/).pop();
      if (!stores.find(s => s.tableName === tableName && s.outputName === outputName)) {
        stores.push({ tableName, outputPath, outputName });
      }
      continue;
    }

    // DROP TABLE
    if ((m = trimmed.match(/^DROP\s+TABLES?\s+(.+)$/is))) {
      for (const name of m[1].split(',')) {
        const n = cleanName(name);
        if (n) {
          droppedTables.add(n);
          if (tables.has(n)) tables.get(n).isDropped = true;
        }
      }
      continue;
    }

    // RENAME TABLE
    if ((m = trimmed.match(/^RENAME\s+TABLES?\s+\[?([^\]\s]+)\]?\s+TO\s+\[?([^\]\s]+)\]?/i))) {
      const oldN = cleanName(m[1]), newN = cleanName(m[2]);
      if (tables.has(oldN)) {
        const e = tables.get(oldN);
        e.name = newN;
        tables.delete(oldN);
        tables.set(newN, e);
        for (const l of lineage) if (l.tableQlik === oldN) l.tableQlik = newN;
        if (lastTable === oldN) lastTable = newN;
      }
      continue;
    }

    // ── Instructions de chargement ──
    const hasLoad = /\bLOAD\b/i.test(trimmed) || /\bSELECT\b/i.test(trimmed);
    if (!hasLoad) continue;
    if (inAccessSection) continue; // ne pas polluer le modèle avec la section access

    const { label, rest: afterLabel } = extractLabel(text);
    const { prefixes, rest: body } = extractPrefixes(afterLabel);
    const parsed = parseLoadStatement(body);
    if (!parsed) continue;

    coverage.loadStatements++;

    // SQL pur → appariement avec le LOAD précédent
    if (parsed.isSqlOnly) {
      const meta = { ...parsed.source, connection: currentConnection || 'SQL Connection', isMapping: prefixes.isMapping };
      if (pendingLoad) {
        // Le LOAD précédent définit les alias ; le SELECT définit la source
        const fields = pendingLoad.fields.length ? pendingLoad.fields : parsed.fields;
        applyLoad(pendingLoad.tableName, fields, { ...meta, isMapping: pendingLoad.isMapping });
        lastTable = pendingLoad.tableName;
        coverage.parsedBlocks += 2; // le couple LOAD+SELECT compte pour ses 2 instructions
        pendingLoad = null;
      } else if (label) {
        applyLoad(label, parsed.fields, meta);
        lastTable = label;
        coverage.parsedBlocks++;
      } else if (lastTable && prefixes.concat) {
        applyLoad(prefixes.concatTarget || lastTable, parsed.fields, meta);
        coverage.parsedBlocks++;
      } else {
        flagUnparsed(stmt.line, 'SELECT sans LOAD précédent ni label de table');
      }
      continue;
    }

    // Cible du chargement
    let target = label;
    let viaJoin = false;
    if (!target && prefixes.join) { target = prefixes.joinTarget || lastTable; viaJoin = true; }
    if (!target && prefixes.concat) { target = prefixes.concatTarget || lastTable; }
    if (!target && parsed.pending) {
      // LOAD précédent : la table sera nommée par le label déjà lu (aucun) → mémoriser
      pendingLoad = { tableName: `(sans nom L${stmt.line})`, fields: parsed.fields, isMapping: prefixes.isMapping };
      continue;
    }
    if (label && parsed.pending) {
      pendingLoad = { tableName: label, fields: parsed.fields, isMapping: prefixes.isMapping };
      continue;
    }
    if (!target) {
      flagUnparsed(stmt.line, /\*\s*$/.test(body.trim()) || parsed.fields.some(f => f.alias === '*')
        ? 'LOAD * sans table nommée'
        : 'LOAD sans label de table (concaténation implicite — rattaché impossible)');
      continue;
    }

    const meta = {
      ...parsed.source,
      connection: parsed.source.loadMethod === 'sql' ? (currentConnection || 'SQL Connection') : null,
      isMapping: prefixes.isMapping
    };
    applyLoad(target, parsed.fields, meta, { fromJoin: viaJoin });
    if (!viaJoin) lastTable = target;
    coverage.parsedBlocks++;
  }

  // LOAD précédent jamais apparié (script tronqué ou SELECT manquant)
  if (pendingLoad) {
    applyLoad(pendingLoad.tableName, pendingLoad.fields, { loadMethod: 'sql', sourceName: 'SQL', sourcePath: null, connection: currentConnection, sqlQuery: null, residentTable: null });
  }

  // ── Classement des tables ──
  const facts = [], dims = [];
  for (const t of tables.values()) {
    const type = classifyTable(t.name, { isMapping: t.isMapping, loadMethod: t.loadMethod });
    if (type === 'mapping') {
      mappings.push({ name: t.name, from: t.source, to: t.name, sourcePath: t.sourcePath });
    } else if (type === 'fact') {
      facts.push(t);
    } else if (type === 'dim') {
      dims.push(t);
    }
    // 'temp' : lineage tracé mais table hors modèle
  }

  // ── Sources enrichies ──
  for (const inc of includes) {
    const name = inc.split(/[/\\]/).pop();
    if (!sourceMetaMap.has(name)) {
      sourceMetaMap.set(name, { name, path: inc, type: 'include', connection: null, usedBy: [], fieldCount: 0 });
    }
  }
  const CATEGORY_BY_TYPE = {
    qvd: 'qvd_read', sql: 'sql', excel: 'file', csv: 'file', file: 'file',
    resident: 'internal', inline: 'internal', autogenerate: 'internal', include: 'include'
  };
  const envHint = (p) => {
    const mm = String(p || '').match(/\b(dev|test|qa|preprod|prod)\b/i);
    return mm ? mm[1].toLowerCase() : null;
  };
  const storedNames = new Set(stores.map(s => (s.outputName || '').toLowerCase()));
  const sourceMeta = [...sourceMetaMap.values()].map(s => ({
    ...s,
    category: CATEGORY_BY_TYPE[s.type] || 'file',
    environmentHint: envHint(s.path),
    selfConsumed: s.type === 'qvd' && storedNames.has(String(s.name).toLowerCase())
  }));

  // Variables non résolues
  coverage.unresolvedVariables = [...new Set(
    (script.match(/\$\(([\w.]+)\)/g) || [])
      .map(v => v.slice(2, -1))
      .filter(v => !/^(must_)?include$/i.test(v))
  )];
  coverage.score = coverage.loadStatements > 0
    ? Math.min(100, Math.round((coverage.parsedBlocks / coverage.loadStatements) * 100))
    : 100;

  const model = detectModel(facts, dims);

  return {
    appName,
    model,
    sources,
    sourceMeta,
    facts,
    dims,
    mappings,
    calcFields,
    synthKeys,
    lineage,
    stores,
    includes,
    droppedTables: [...droppedTables],
    summary: generateSummary(appName, facts, dims, sources, synthKeys, model, stores),
    metadata: {
      analyzedAt: new Date().toISOString(),
      mode: 'local',
      parserVersion: 2,
      totalFields: lineage.length,
      totalTables: facts.length + dims.length,
      hasSectionAccess,
      coverage,
      note: 'Analyse locale rapide (parser v2 par instructions). Utilisez Claude pour une analyse sémantique complète.'
    }
  };
}

// ─── Chat local : réponses aux questions simples (inchangé) ───────────────────

function localChatAnswer(message, analysis) {
  if (!analysis) {
    return '⚠️ Aucune analyse disponible pour cette application. Analysez d\'abord les scripts (mode Local ou Claude).';
  }

  const msg = message.toLowerCase().trim();

  if (/\b(source|sources|qvd|origin|fichier|fichiers|base|bases)\b/.test(msg)) {
    if (!analysis.sources?.length) return 'Aucune source détectée dans l\'analyse.';
    const meta = analysis.sourceMeta || [];
    if (meta.length > 0) {
      return `📥 **Sources identifiées (${meta.length}) :**\n\n${meta.map(s =>
        `• \`${s.name}\`  [${s.type?.toUpperCase() || 'QVD'}]${s.path ? `  *${s.path}*` : ''}${s.connection ? `  🔌 ${s.connection}` : ''}` +
        `\n  → utilisée par: ${s.usedBy.join(', ')} (${s.fieldCount} champs)`
      ).join('\n\n')}`;
    }
    return `📥 **Sources identifiées (${analysis.sources.length}) :**\n\n${analysis.sources.map(s => `• \`${s}\``).join('\n')}`;
  }

  if (/\b(fact|faits|table de fait|tables de fait)\b/.test(msg)) {
    if (!analysis.facts?.length) return 'Aucune table de faits identifiée.';
    return `🏭 **Tables de faits (${analysis.facts.length}) :**\n\n${analysis.facts.map(t =>
      `**${t.name}** — ${t.fields.length} champs${t.keys.length ? ` | Clés: ${t.keys.join(', ')}` : ''}` +
      (t.loadMethod ? `\n  Chargement: FROM ${t.loadMethod.toUpperCase()}${t.sourcePath ? ` → \`${t.sourcePath}\`` : ''}` : '')
    ).join('\n\n')}`;
  }

  if (/\b(dim|dims|dimension|dimensions)\b/.test(msg)) {
    if (!analysis.dims?.length) return 'Aucune dimension identifiée.';
    return `📐 **Dimensions (${analysis.dims.length}) :**\n\n${analysis.dims.map(t =>
      `**${t.name}** — ${t.fields.length} champs` +
      (t.loadMethod ? `  [${t.loadMethod.toUpperCase()}]` : '')
    ).join('\n')}`;
  }

  if (/\b(table|tables|liste des tables|toutes les tables)\b/.test(msg)) {
    const all = [
      ...(analysis.facts || []).map(t => `🏭 \`${t.name}\` — FACT  [${t.loadMethod || '?'}]  ${t.fields.length} champs`),
      ...(analysis.dims  || []).map(t => `📐 \`${t.name}\` — DIM   [${t.loadMethod || '?'}]  ${t.fields.length} champs`),
      ...(analysis.mappings || []).map(t => `🗺️ \`${t.name}\` — MAP`)
    ];
    if (!all.length) return 'Aucune table identifiée dans l\'analyse.';
    return `📋 **Tables de l'application (${all.length}) :**\n\n${all.join('\n')}`;
  }

  if (/(calcul|formule|formules|champ calcul)/.test(msg)) {
    if (!analysis.calcFields?.length) return 'Aucun champ calculé détecté.';
    return `🧮 **Champs calculés (${analysis.calcFields.length}) :**\n\n${analysis.calcFields.map(f =>
      `• **${f.field}** *(${f.table})*\n  \`${f.formula}\``
    ).join('\n\n')}`;
  }

  if (/(synth|clé synth|risque)/.test(msg)) {
    if (!analysis.synthKeys?.length) return '✅ Aucune clé synthétique détectée.';
    return `⚠️ **Clés synthétiques (${analysis.synthKeys.length}) :**\n\n${analysis.synthKeys.map(k =>
      `• **${k.field}** — Risque: \`${k.risk}\`\n  Formule: \`${k.formula}\``
    ).join('\n\n')}`;
  }

  const fieldMatch = msg.match(/(?:lineage|lignage|trace|d.où vient|origin|source)\s+(?:de\s+|du\s+|d'|of\s+)?["`']?([a-z0-9_]+)["`']?/i);
  if (fieldMatch) {
    const fieldName = fieldMatch[1].toUpperCase();
    const rows = (analysis.lineage || []).filter(r =>
      r.fieldQlik?.toUpperCase().includes(fieldName) || r.tableQlik?.toUpperCase().includes(fieldName)
    );
    if (!rows.length) return `Aucun lineage trouvé pour "${fieldMatch[1]}". Vérifiez le nom du champ.`;
    return `🔍 **Lineage pour "${fieldMatch[1]}" (${rows.length} résultat(s)) :**\n\n${rows.map(r =>
      `• \`${r.fieldQlik}\` dans **${r.tableQlik}**\n` +
      `  ← \`${r.fieldSource}\` depuis *${r.tableSource}*\n` +
      (r.sourcePath ? `  📂 \`${r.sourcePath}\`\n` : '') +
      (r.loadMethod ? `  🔄 via ${r.loadMethod.toUpperCase()}\n` : '') +
      `  Transformation: ${r.transformation}`
    ).join('\n\n')}`;
  }

  if (/\b(lineage|lignage)\b/.test(msg)) {
    const rows = analysis.lineage || [];
    if (!rows.length) return 'Aucune donnée de lineage disponible.';
    const byTable = {};
    for (const r of rows) {
      if (!byTable[r.tableQlik]) byTable[r.tableQlik] = [];
      byTable[r.tableQlik].push(r);
    }
    const parts = Object.entries(byTable).map(([table, fields]) =>
      `**${table}** (${fields.length} champs) :\n${fields.slice(0, 10).map(f =>
        `  • \`${f.fieldQlik}\` ← ${f.tableSource} | ${f.transformation}`
      ).join('\n')}${fields.length > 10 ? `\n  … et ${fields.length - 10} autres` : ''}`
    );
    return `📊 **Lineage complet — ${rows.length} champs :**\n\n${parts.join('\n\n')}`;
  }

  if (/(résumé|resume|summary|overview|bilan|statistique|stats)/.test(msg)) {
    const m = analysis;
    const loadMethods = [...new Set((m.facts || []).concat(m.dims || []).map(t => t.loadMethod).filter(Boolean))];
    return `📱 **${m.appName || 'Application'}**\n\n` +
      `• Modèle : **${m.model || '—'}**\n` +
      `• Sources : **${(m.sources || []).length}** — ${(m.sources || []).slice(0, 3).join(', ')}${(m.sources || []).length > 3 ? '…' : ''}\n` +
      `• Tables de faits : **${(m.facts || []).length}**\n` +
      `• Dimensions : **${(m.dims || []).length}**\n` +
      `• Méthodes de chargement : ${loadMethods.map(l => `\`${l.toUpperCase()}\``).join(', ') || '—'}\n` +
      `• Champs trackés : **${(m.lineage || []).length}**\n` +
      `• Champs calculés : **${(m.calcFields || []).length}**\n` +
      `• Clés synthétiques : **${(m.synthKeys || []).length}**${(m.synthKeys || []).length > 0 ? ' ⚠️' : ' ✅'}\n` +
      `\n${m.summary || ''}`;
  }

  if (/\b(map|maps|mapping|mappings|applymap)\b/.test(msg)) {
    if (!analysis.mappings?.length) return 'Aucun mapping détecté.';
    return `🗺️ **Mappings (${analysis.mappings.length}) :**\n\n${analysis.mappings.map(m =>
      `• **${m.name}** : \`${m.from}\` → \`${m.to}\``
    ).join('\n')}`;
  }

  if (/(section access|sécurité|security|access|accès)/.test(msg)) {
    const has = analysis.metadata?.hasSectionAccess;
    return has
      ? '🔐 **Section Access détectée** dans ce script. Des restrictions d\'accès sont définies.'
      : '✅ Aucune Section Access détectée dans ce script.';
  }

  if (/(modèle|model|schéma|schema|étoile|star|flocon|snowflake)/.test(msg)) {
    const model = analysis.model;
    const icon = model === 'etoile' ? '⭐' : '🔀';
    return `${icon} **Modèle de données : ${model}**\n\n` +
      `Tables de faits : ${(analysis.facts || []).map(t => `\`${t.name}\``).join(', ') || '—'}\n` +
      `Dimensions : ${(analysis.dims || []).map(t => `\`${t.name}\``).join(', ') || '—'}`;
  }

  return null; // → Claude
}

module.exports = { parseQlikScript, localChatAnswer };
