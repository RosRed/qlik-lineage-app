'use strict';

/**
 * Parser local Qlik/SQL — analyse pure regex, zéro appel API
 * Extrait : tables, champs, sources QVD/SQL/Excel, méthodes de chargement,
 *           chemins complets, requêtes SQL, clés synthétiques, champs calculés
 */

// ─── Utils ────────────────────────────────────────────────────────────────────

function cleanName(s) {
  return (s || '').trim().replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').trim();
}

function removeComments(script) {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Ne supprime pas les :// (URLs lib://, http://, etc.)
    .replace(/(?<!:)\/\/[^\n]*/g, '');
}

const CONTROL_KEYWORDS = new Set([
  'IF','THEN','ELSE','ELSEIF','END','FOR','EACH','NEXT','DO','WHILE','LOOP',
  'SUB','EXIT','CALL','LET','SET','TRACE','REM','SWITCH','CASE','DEFAULT',
  'WHEN','STORE','LOAD','SQL','QUALIFY','UNQUALIFY','SECTION','DIRECTORY',
  'CONNECT','DISCONNECT','RENAME','DROP','CONCATENATE','NOCONCATENATE','JOIN',
  'KEEP','INNER','OUTER','LEFT','RIGHT','CROSS','WHERE','FROM','RESIDENT',
  'AUTOGENERATE','INLINE','SELECT','DISTINCT','AND','OR','NOT','IN','LIKE',
  'BETWEEN','IS','NULL','TRUE','FALSE','AS','BY','GROUP','ORDER','HAVING',
  'UNION','WITH','BEGIN','LIB','ON','MAPPING'
]);

// ─── Sources globales ─────────────────────────────────────────────────────────

function extractSources(script) {
  const sources = [];
  const seen = new Set();
  const add = (s) => { if (s && !seen.has(s)) { seen.add(s); sources.push(s); } };

  const qvdPat   = /FROM\s+\[?([^\]\n;,)]+\.qvd)\]?\s*\(qvd\)/gi;
  const sqlPat   = /\bSQL\b\s+SELECT[\s\S]+?\bFROM\b\s+([\w.[\]"]+)/gi;
  const filePat  = /FROM\s+\[?([^\]\n;)]+\.(xlsx?|csv|txt|qvo|tab))\]?/gi;
  const connPat  = /LIB\s+CONNECT\s+TO\s+['"]([^'"]+)['"]/gi;

  let m;
  while ((m = qvdPat.exec(script))  !== null) add(cleanName(m[1]).split(/[/\\]/).pop());
  while ((m = sqlPat.exec(script))  !== null) add(cleanName(m[1]));
  while ((m = filePat.exec(script)) !== null) add(cleanName(m[1]).split(/[/\\]/).pop());
  while ((m = connPat.exec(script)) !== null) add(m[1]);

  return sources;
}

// ─── Commandes STORE (QVD en sortie) ─────────────────────────────────────────

function extractStoreCommands(script) {
  const stores = [];
  const seen   = new Set();

  // Cas 1 : STORE [table] INTO [lib://...path/file.qvd] (qvd);
  // Cas 2 : STORE  table  INTO [lib://...path/file.qvd] (qvd);
  // Le chemin est toujours entre crochets (peut contenir espaces + parenthèses).
  const pattern = /\bSTORE\b\s+\[?([^\]\n;,]+?)\]?\s+\bINTO\b\s+\[([^\]]+)\]\s*(?:\(\s*qvd\s*\))?\s*;?/gi;
  let m;
  while ((m = pattern.exec(script)) !== null) {
    const tableName  = cleanName(m[1]);
    const outputPath = m[2].trim();
    const outputName = outputPath.split(/[/\\]/).pop();
    const key = `${tableName}→${outputName}`;
    if (!seen.has(key)) {
      seen.add(key);
      stores.push({ tableName, outputPath, outputName });
    }
  }
  return stores;
}

// ─── Métadonnées de chargement par bloc ──────────────────────────────────────

function extractBlockMetadata(content) {
  const c = content;

  // QVD
  const qvdM = c.match(/FROM\s+(\[?[^\]\n;]+\.qvd\]?)\s*\(qvd\)/i);
  if (qvdM) {
    const path = qvdM[1].replace(/^\[|\]$/g, '').trim();
    const name = path.split(/[/\\]/).pop();
    return { loadMethod: 'qvd', sourcePath: path, sourceName: name, connection: null, sqlQuery: null, residentTable: null };
  }

  // SQL embarqué — supporte "SQL SELECT …" (Qlik standard) et "select …" (Qlik classique)
  // On capture jusqu'au ; final (les lignes vides avant WHERE ne stoppent plus)
  const sqlBodyM = c.match(/(?:\bSQL\b\s+)?(SELECT[\s\S]+?)\s*;/i);
  const connM    = c.match(/LIB\s+CONNECT\s+TO\s+['"]([^'"]+)['"]/i);
  const hasSql   = /\bSQL\b\s+SELECT/i.test(c) || /^\s*select\b/im.test(c);
  if (hasSql) {
    const rawSql = sqlBodyM ? sqlBodyM[1].replace(/\s+/g, ' ').trim() : null;
    const fromM  = rawSql ? rawSql.match(/\bFROM\b\s+([\w.[\]"]+)/i) : null;
    return {
      loadMethod:   'sql',
      sourcePath:   fromM  ? fromM[1]  : null,
      sourceName:   fromM  ? cleanName(fromM[1]) : 'SQL',
      connection:   connM  ? connM[1]  : 'SQL Connection',
      sqlQuery:     rawSql || null,
      residentTable: null
    };
  }

  // Excel
  const xlsM = c.match(/FROM\s+(\[?[^\]\n;)]+\.xlsx?\]?)/i);
  if (xlsM) {
    const path = xlsM[1].replace(/^\[|\]$/g, '').trim();
    return { loadMethod: 'excel', sourcePath: path, sourceName: path.split(/[/\\]/).pop(), connection: null, sqlQuery: null, residentTable: null };
  }

  // CSV / TXT / TAB
  const csvM = c.match(/FROM\s+(\[?[^\]\n;)]+\.(?:csv|txt|tab)\]?)/i);
  if (csvM) {
    const path = csvM[1].replace(/^\[|\]$/g, '').trim();
    return { loadMethod: 'csv', sourcePath: path, sourceName: path.split(/[/\\]/).pop(), connection: null, sqlQuery: null, residentTable: null };
  }

  // RESIDENT
  const resM = c.match(/\bRESIDENT\b\s+\[?([^\]\n;]+)\]?/i);
  if (resM) {
    const tbl = cleanName(resM[1]);
    return { loadMethod: 'resident', sourcePath: null, sourceName: tbl, connection: null, sqlQuery: null, residentTable: tbl };
  }

  // INLINE
  if (/\bINLINE\b/i.test(c)) {
    return { loadMethod: 'inline', sourcePath: null, sourceName: 'Inline data', connection: null, sqlQuery: null, residentTable: null };
  }

  // AUTOGENERATE
  if (/\bAUTOGENERATE\b/i.test(c)) {
    return { loadMethod: 'autogenerate', sourcePath: null, sourceName: 'Autogenerate', connection: null, sqlQuery: null, residentTable: null };
  }

  return { loadMethod: 'unknown', sourcePath: null, sourceName: '—', connection: null, sqlQuery: null, residentTable: null };
}

// ─── Parsing de liste de champs ───────────────────────────────────────────────

function parseFieldList(fieldStr) {
  const fields = [];
  let depth = 0, inStr = false, strChar = '', current = '';
  for (const ch of fieldStr) {
    if (inStr) { current += ch; if (ch === strChar) inStr = false; }
    else if (ch === '"' || ch === "'") { inStr = true; strChar = ch; current += ch; }
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
  const asM = f.match(/^([\s\S]+?)\s+AS\s+(\[?[^\],\n]+?\]?)\s*$/i);
  if (asM) return { expression: asM[1].trim(), alias: cleanName(asM[2]) };
  return { expression: f, alias: cleanName(f) };
}

// ─── Classification des expressions ──────────────────────────────────────────

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
  if (/\b(Upper|Lower|Trim|Left|Right|Mid|Concat|SubField)\s*\(/i.test(expr) || up.includes('NOM') || up.includes('LIB') || up.includes('NAME') || up.includes('LABEL')) return 'string';
  return 'string';
}

// ─── Extraction des blocs de tables ──────────────────────────────────────────

function extractTableBlocks(script) {
  const cleaned = removeComments(script);
  const lines = cleaned.split('\n');
  const blocks = [];
  let currentName = null, currentStart = 0;

  const flush = (end) => {
    if (currentName === null) return;
    const content = lines.slice(currentStart, end).join('\n');
    if (/\bLOAD\b/i.test(content)) {
      blocks.push({ name: currentName, content, startLine: currentStart });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const decl = lines[i].match(/^[ \t]*(\[?([A-Za-z_][A-Za-z0-9_\- ]*?)\]?)\s*:\s*$/);
    if (decl) {
      const name = cleanName(decl[2]);
      if (name && name.length > 1 && !CONTROL_KEYWORDS.has(name.toUpperCase())) {
        flush(i);
        currentName = name;
        currentStart = i;
      }
    }
  }
  flush(lines.length);
  return blocks;
}

// ─── Classification des tables ────────────────────────────────────────────────

function classifyTable(name, content) {
  const up = name.toUpperCase();
  if (/\bMapping\s+LOAD\b/i.test(content) || up.startsWith('MAP_') || up.startsWith('MAPPING_') || up.startsWith('LKP_')) return 'mapping';
  if (up.startsWith('FACT_') || up.startsWith('F_') || up.startsWith('FCT_') || up.startsWith('FT_')) return 'fact';
  if (up.startsWith('DIM_') || up.startsWith('D_') || up.endsWith('_DIM')) return 'dim';
  if (up.startsWith('TMP_') || up.startsWith('TEMP_') || up.startsWith('INT_') || up.startsWith('BRIDGE_') || up.startsWith('INTER_')) return 'temp';
  // SQL source (avec ou sans le mot-clé SQL devant SELECT)
  if (/\bSQL\b/i.test(content) || /^\s*select\b/im.test(content)) return 'fact';
  return 'dim';
}

// ─── Extraction des champs ────────────────────────────────────────────────────

function extractFieldsFromBlock(block) {
  // Priorité au ; (terminateur explicite du LOAD) — évite d'avaler les SQL SELECT et JOIN suivants
  // Fallback sur les mots-clés source classiques si pas de ;
  const match = block.content.match(/\bLOAD\b([\s\S]+?)(?:;|\bFROM\b|\bSQL\b|\bRESIDENT\b|\bAUTOGENERATE\b|\bINLINE\b)/i);
  if (!match) return [];
  return parseFieldList(match[1]).map(parseField).filter(f => f.alias && f.alias.length > 0);
}

// ─── LEFT JOIN / JOIN avec source RESIDENT dans le même bloc ─────────────────

function extractJoinedLoadBlocks(content) {
  const joins = [];
  // Capture: (left|inner|…) join … load CHAMPS … Resident TABLE
  // Le mot-clé join peut être séparé par des lignes vides du load suivant
  const pat = /\bjoin\b[\s\S]*?\bload\b([\s\S]+?)\bRESIDENT\b\s+\[?([^\]\n;,]+)\]?/gi;
  let m;
  while ((m = pat.exec(content)) !== null) {
    const fieldsStr    = m[1].trim();
    const residentTable = cleanName(m[2]);
    if (!residentTable) continue;
    const fields = parseFieldList(fieldsStr).map(parseField).filter(f => f.alias && f.alias.length > 0);
    if (fields.length > 0) joins.push({ residentTable, fields });
  }
  return joins;
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

// ─── Détection du modèle ──────────────────────────────────────────────────────

function detectModel(facts, dims) {
  if (facts.length === 0 && dims.length === 0) return 'mixte';
  if (facts.length > 0 && dims.length > 0) return 'etoile';
  return 'mixte';
}

// ─── Résumé ───────────────────────────────────────────────────────────────────

function generateSummary(appName, facts, dims, sources, synthKeys, model, stores = []) {
  const parts = [`Application "${appName}" analysée localement (sans IA).`];
  if (facts.length + dims.length > 0) {
    parts.push(`${facts.length} table(s) de faits, ${dims.length} dimension(s) identifiées.`);
  }
  if (sources.length > 0) parts.push(`${sources.length} source(s) détectée(s).`);
  if (stores.length > 0)  parts.push(`💾 ${stores.length} QVD écrit(s) via STORE.`);
  if (synthKeys.length > 0) parts.push(`⚠️ ${synthKeys.length} clé(s) synthétique(s) détectée(s) — vérifiez les risques.`);
  parts.push(`Modèle: ${model === 'etoile' ? 'étoile ⭐' : model === 'flocon' ? 'flocon ❄️' : 'mixte'}.`);
  parts.push('Utilisez le mode Claude pour une analyse sémantique approfondie.');
  return parts.join(' ');
}

// ─── Entrée principale ────────────────────────────────────────────────────────

function parseQlikScript(scriptContent, appName = 'Application') {
  const script = scriptContent || '';
  const cleaned = removeComments(script);

  const sources = extractSources(cleaned);
  const stores  = extractStoreCommands(cleaned);
  const blocks  = extractTableBlocks(script);

  const facts    = [];
  const dims     = [];
  const mappings = [];
  const calcFields = [];
  const synthKeys  = [];
  const lineage    = [];

  // sourceMeta : métadonnées enrichies par source
  const sourceMetaMap = new Map();

  for (const block of blocks) {
    const type   = classifyTable(block.name, block.content);
    const fields = extractFieldsFromBlock(block);
    const meta   = extractBlockMetadata(block.content);
    const keys   = guessKeys(fields);

    const srcName = meta.sourceName || '—';

    // Enrichir sourceMeta (source principale)
    if (srcName !== '—') {
      if (!sourceMetaMap.has(srcName)) {
        sourceMetaMap.set(srcName, {
          name:       srcName,
          path:       meta.sourcePath,
          type:       meta.loadMethod,
          connection: meta.connection,
          usedBy:     [],
          fieldCount: 0
        });
      }
      const sm = sourceMetaMap.get(srcName);
      if (!sm.usedBy.includes(block.name)) sm.usedBy.push(block.name);
      sm.fieldCount += fields.length;
    }

    // Détails des champs principaux
    const fieldDetails = fields.map(f => ({
      alias:      f.alias,
      expression: f.expression,
      isKey:      keys.includes(f.alias),
      isCalc:     isCalcExpression(f.expression) && !isSyntheticKey(f.expression),
      isSynth:    isSyntheticKey(f.expression),
      dataType:   guessDataType(f.alias, f.expression),
      transformation: describeTransformation(f.expression, f.alias)
    }));

    const tableEntry = {
      name:        block.name,
      fields:      fields.map(f => f.alias),
      keys,
      fieldDetails,
      source:      srcName,
      sourcePath:  meta.sourcePath,
      loadMethod:  meta.loadMethod,
      connection:  meta.connection,
      sqlQuery:    meta.sqlQuery,
      residentTable: meta.residentTable
    };

    // ── LEFT JOIN / JOIN avec RESIDENT dans le même bloc ──────────────────────
    const joinedLoads = extractJoinedLoadBlocks(block.content);
    for (const jl of joinedLoads) {
      const jSrc = jl.residentTable;

      // sourceMeta pour la source jointe
      if (!sourceMetaMap.has(jSrc)) {
        sourceMetaMap.set(jSrc, {
          name: jSrc, path: null, type: 'resident',
          connection: null, usedBy: [], fieldCount: 0
        });
      }
      const jSm = sourceMetaMap.get(jSrc);
      if (!jSm.usedBy.includes(block.name)) jSm.usedBy.push(block.name);
      jSm.fieldCount += jl.fields.length;

      // Ajouter les champs joints à tableEntry (sans doublon)
      for (const jf of jl.fields) {
        if (!tableEntry.fields.includes(jf.alias)) {
          tableEntry.fields.push(jf.alias);
          tableEntry.fieldDetails.push({
            alias:      jf.alias,
            expression: jf.expression,
            isKey:      false,
            isCalc:     isCalcExpression(jf.expression) && !isSyntheticKey(jf.expression),
            isSynth:    isSyntheticKey(jf.expression),
            dataType:   guessDataType(jf.alias, jf.expression),
            transformation: describeTransformation(jf.expression, jf.alias)
          });
        }
      }
    }

    // Pousser la table dans le bon tableau
    if (type === 'fact')    facts.push(tableEntry);
    else if (type === 'dim') dims.push(tableEntry);
    else if (type === 'mapping') {
      mappings.push({ name: block.name, from: srcName, to: block.name, sourcePath: meta.sourcePath });
    }
    // Les tables TEMP ne sont pas ajoutées aux faits/dims mais leur lineage est quand même tracé

    // Lineage rows — source principale
    for (const field of fields) {
      if (!field.alias) continue;
      const isCalc  = isCalcExpression(field.expression) && !isSyntheticKey(field.expression);
      const isSynth = isSyntheticKey(field.expression);
      const transform = describeTransformation(field.expression, field.alias);

      lineage.push({
        fieldQlik:    field.alias,
        tableQlik:    block.name,
        fieldSource:  isSynth ? '—' : (field.expression !== field.alias ? cleanName(field.expression.split(/[\s(,]+/)[0]) : field.alias),
        tableSource:  srcName,
        sourcePath:   meta.sourcePath,
        loadMethod:   meta.loadMethod,
        connection:   meta.connection,
        transformation: transform,
        isCalculated: isCalc,
        isSynth:      isSynth,
        isKey:        keys.includes(field.alias),
        dataType:     guessDataType(field.alias, field.expression)
      });

      if (isCalc) {
        calcFields.push({ field: field.alias, table: block.name, formula: field.expression, type: 'formule' });
      }
      if (isSynth) {
        if (!synthKeys.find(k => k.field === field.alias)) {
          synthKeys.push({ field: field.alias, formula: field.expression, risk: synthKeyRisk(field.expression) });
        }
      }
    }

    // Lineage rows — sources jointes (LEFT JOIN RESIDENT)
    for (const jl of joinedLoads) {
      for (const jf of jl.fields) {
        if (!jf.alias) continue;
        const jIsCalc  = isCalcExpression(jf.expression) && !isSyntheticKey(jf.expression);
        const jIsSynth = isSyntheticKey(jf.expression);
        lineage.push({
          fieldQlik:    jf.alias,
          tableQlik:    block.name,
          fieldSource:  jf.expression !== jf.alias ? cleanName(jf.expression.split(/[\s(,]+/)[0]) : jf.alias,
          tableSource:  jl.residentTable,
          sourcePath:   null,
          loadMethod:   'resident',
          connection:   null,
          transformation: describeTransformation(jf.expression, jf.alias),
          isCalculated: jIsCalc,
          isSynth:      jIsSynth,
          isKey:        false,
          dataType:     guessDataType(jf.alias, jf.expression)
        });
        if (jIsCalc) {
          calcFields.push({ field: jf.alias, table: block.name, formula: jf.expression, type: 'formule' });
        }
      }
    }
  }

  const model = detectModel(facts, dims);
  const hasSectionAccess = /\bSection\s+Access\b/i.test(script);
  const sourceMeta = [...sourceMetaMap.values()];

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
    summary: generateSummary(appName, facts, dims, sources, synthKeys, model, stores),
    metadata: {
      analyzedAt: new Date().toISOString(),
      mode: 'local',
      totalFields: lineage.length,
      totalTables: facts.length + dims.length,
      hasSectionAccess,
      note: 'Analyse locale rapide. Utilisez Claude pour une analyse sémantique complète.'
    }
  };
}

// ─── Chat local : réponses aux questions simples ──────────────────────────────

function localChatAnswer(message, analysis) {
  if (!analysis) {
    return '⚠️ Aucune analyse disponible pour cette application. Analysez d\'abord les scripts (mode Local ou Claude).';
  }

  const msg = message.toLowerCase().trim();

  // Sources
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

  // Tables / Faits / Dimensions
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

  // Champs calculés
  if (/(calcul|formule|formules|champ calcul)/.test(msg)) {
    if (!analysis.calcFields?.length) return 'Aucun champ calculé détecté.';
    return `🧮 **Champs calculés (${analysis.calcFields.length}) :**\n\n${analysis.calcFields.map(f =>
      `• **${f.field}** *(${f.table})*\n  \`${f.formula}\``
    ).join('\n\n')}`;
  }

  // Clés synthétiques
  if (/(synth|clé synth|risque)/.test(msg)) {
    if (!analysis.synthKeys?.length) return '✅ Aucune clé synthétique détectée.';
    return `⚠️ **Clés synthétiques (${analysis.synthKeys.length}) :**\n\n${analysis.synthKeys.map(k =>
      `• **${k.field}** — Risque: \`${k.risk}\`\n  Formule: \`${k.formula}\``
    ).join('\n\n')}`;
  }

  // Lineage d'un champ spécifique
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

  // Lineage complet
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

  // Résumé
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

  // Mappings
  if (/\b(map|maps|mapping|mappings|applymap)\b/.test(msg)) {
    if (!analysis.mappings?.length) return 'Aucun mapping détecté.';
    return `🗺️ **Mappings (${analysis.mappings.length}) :**\n\n${analysis.mappings.map(m =>
      `• **${m.name}** : \`${m.from}\` → \`${m.to}\``
    ).join('\n')}`;
  }

  // Section Access
  if (/(section access|sécurité|security|access|accès)/.test(msg)) {
    const has = analysis.metadata?.hasSectionAccess;
    return has
      ? '🔐 **Section Access détectée** dans ce script. Des restrictions d\'accès sont définies.'
      : '✅ Aucune Section Access détectée dans ce script.';
  }

  // Modèle
  if (/(modèle|model|schéma|schema|étoile|star|flocon|snowflake)/.test(msg)) {
    const model = analysis.model;
    const icon = model === 'etoile' ? '⭐' : model === 'flocon' ? '❄️' : '🔀';
    return `${icon} **Modèle de données : ${model}**\n\n` +
      `Tables de faits : ${(analysis.facts || []).map(t => `\`${t.name}\``).join(', ') || '—'}\n` +
      `Dimensions : ${(analysis.dims || []).map(t => `\`${t.name}\``).join(', ') || '—'}`;
  }

  return null; // → Claude
}

module.exports = { parseQlikScript, localChatAnswer };
