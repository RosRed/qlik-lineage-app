const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tente de réparer un JSON tronqué en fermant les structures ouvertes
function repairJSON(raw) {
  let text = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  // Parse direct en premier
  try { return JSON.parse(text); } catch {}

  // Parcours caractère par caractère pour trouver le dernier objet complet
  const stack = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let lastSafeCut = -1; // position après la fermeture d'un élément à profondeur 1

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); depth++; }
    else if (c === '}' || c === ']') {
      stack.pop(); depth--;
      if (depth === 1) lastSafeCut = i; // vient de fermer un élément de tableau de premier niveau
    }
  }

  // Stratégie 1 : fermer la chaîne ouverte + fermer tous les crochets
  let repaired = inString ? text + '"' : text;
  repaired = repaired.replace(/,\s*$/, ''); // supprime virgule finale avant fermeture
  repaired += [...stack].reverse().join('');
  try { return JSON.parse(repaired); } catch {}

  // Stratégie 2 : tronquer au dernier élément complet et fermer
  if (lastSafeCut > 0) {
    let truncated = text.substring(0, lastSafeCut + 1).replace(/,\s*$/, '');
    // Recompte les crochets ouverts dans la partie tronquée
    const stack2 = [];
    let inStr2 = false, esc2 = false;
    for (const c of truncated) {
      if (esc2) { esc2 = false; continue; }
      if (c === '\\' && inStr2) { esc2 = true; continue; }
      if (c === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (c === '{' || c === '[') stack2.push(c === '{' ? '}' : ']');
      else if ((c === '}' || c === ']') && stack2.length) stack2.pop();
    }
    try { return JSON.parse(truncated + [...stack2].reverse().join('')); } catch {}
  }

  throw new SyntaxError('JSON non réparable après troncature');
}

// Chunking : découpe les scripts trop longs en blocs analysables
function chunkScript(script, maxChars = 5000) {
  if (script.length <= maxChars) return [script];
  const chunks = [];
  let current = '';
  const lines = script.split('\n');
  for (const line of lines) {
    if (current.length + line.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

// Fusionne les résultats de plusieurs chunks
function mergeAnalyses(analyses) {
  const base = analyses[0];
  base.facts      = base.facts      || [];
  base.dims       = base.dims       || [];
  base.mappings   = base.mappings   || [];
  base.calcFields = base.calcFields || [];
  base.synthKeys  = base.synthKeys  || [];
  base.sources    = base.sources    || [];
  base.lineage    = base.lineage    || [];
  base.joinConditions = base.joinConditions || [];
  base.filters    = base.filters    || [];

  for (let i = 1; i < analyses.length; i++) {
    const a = analyses[i];
    a.facts      = a.facts      || [];
    a.dims       = a.dims       || [];
    a.mappings   = a.mappings   || [];
    a.calcFields = a.calcFields || [];
    a.synthKeys  = a.synthKeys  || [];
    a.sources    = a.sources    || [];
    a.lineage    = a.lineage    || [];

    // Merge facts (évite doublons par name)
    a.facts.forEach(f => {
      const existing = base.facts.find(x => x.name === f.name);
      if (existing) {
        existing.fields = [...new Set([...existing.fields, ...f.fields])];
      } else {
        base.facts.push(f);
      }
    });
    // Merge dims
    a.dims.forEach(d => {
      const existing = base.dims.find(x => x.name === d.name);
      if (existing) {
        existing.fields = [...new Set([...existing.fields, ...d.fields])];
      } else {
        base.dims.push(d);
      }
    });
    // Merge mappings, calcFields, synthKeys, lineage, sources
    base.mappings   = [...new Map([...base.mappings,   ...a.mappings  ].map(x => [x.name, x])).values()];
    base.calcFields = [...new Map([...base.calcFields, ...a.calcFields].map(x => [x.field + '_' + x.table, x])).values()];
    base.synthKeys  = [...new Map([...base.synthKeys,  ...a.synthKeys ].map(x => [x.field, x])).values()];
    base.sources    = [...new Set([...base.sources,    ...a.sources   ])];
    // Merge lineage (dédoublonné sur fieldQlik+tableQlik)
    a.lineage.forEach(l => {
      const key = l.fieldQlik + '_' + l.tableQlik;
      if (!base.lineage.find(x => x.fieldQlik + '_' + x.tableQlik === key)) {
        base.lineage.push(l);
      }
    });
  }
  return base;
}

async function analyzeChunk(chunk, appName, chunkIndex, totalChunks) {
  const systemPrompt = `Tu es un expert Data Lineage Qlik.
Tu analyses le chunk ${chunkIndex + 1}/${totalChunks} des scripts de l'application "${appName}".

RÈGLES ABSOLUES :
- Analyse CHAQUE ligne du script, sans rien ignorer
- Pour CHAQUE champ dans chaque LOAD : crée une entrée lineage
- Pour CHAQUE champ calculé (formule, If, Date, Num, ApplyMap, &, *, /) : documente la formule exacte
- Pour CHAQUE clé synthétique (& entre champs) : signale le risque
- Identifie le type de chaque table : FACT_ = fait, DIM_ = dimension, MAP_ = mapping
- Pour les SQL embarqués : liste chaque champ SELECT comme source
- Ne tronque JAMAIS le JSON — produis un objet complet et valide

Réponds UNIQUEMENT avec ce JSON (aucun texte avant ou après) :
{
  "appName": "${appName}",
  "model": "etoile|flocon|mixte",
  "sources": ["LISTE EXHAUSTIVE : chaque QVD, chaque table SQL, chaque fichier Excel/CSV détecté"],
  "facts": [
    {
      "name": "NOM_TABLE_EXACTE",
      "fields": ["LISTE_COMPLETE_CHAMPS_QLIK"],
      "keys": ["CLE_PK"],
      "source": "QVD_ou_SQL_source",
      "rowCount": null
    }
  ],
  "dims": [
    {
      "name": "NOM_DIM_EXACTE",
      "fields": ["LISTE_COMPLETE_CHAMPS"],
      "keys": ["CLE_PK"],
      "source": "source"
    }
  ],
  "mappings": [
    {
      "name": "NOM_MAPPING",
      "from": "table_source",
      "to": "champ_applique_sur",
      "applyMapUsage": "ApplyMap('NOM', champ, defaut)"
    }
  ],
  "calcFields": [
    {
      "field": "NOM_CHAMP_CALCULE",
      "table": "TABLE_QLIK",
      "formula": "FORMULE_EXACTE_DU_SCRIPT",
      "type": "arithmetique|date|string|condition|mapping|concatenation"
    }
  ],
  "synthKeys": [
    {
      "field": "NOM_CLE_SYNTH",
      "formula": "CHAMP1 & delimiteur & CHAMP2",
      "tables": ["TABLE_A", "TABLE_B"],
      "risk": "haut|moyen|faible",
      "recommendation": "Utiliser AutoNumber() ou renommer"
    }
  ],
  "lineage": [
    {
      "fieldQlik": "NOM_CHAMP_DANS_QLIK",
      "tableQlik": "NOM_TABLE_QLIK",
      "fieldSource": "nom_champ_source_exact",
      "tableSource": "NOM_TABLE_SQL_ou_QVD",
      "transformation": "Direct|Renommage AS|Calculé: formule|ApplyMap|Date()|Upper()|If()|Concatenation",
      "isCalculated": false,
      "isKey": false,
      "dataType": "string|numeric|date|boolean"
    }
  ],
  "joinConditions": [
    {
      "leftTable": "TABLE_A",
      "rightTable": "TABLE_B",
      "joinField": "CLE_COMMUNE",
      "joinType": "inner|left|outer"
    }
  ],
  "filters": [
    {
      "table": "TABLE",
      "condition": "condition WHERE exacte",
      "appliedAt": "sql|qlik"
    }
  ],
  "summary": "Résumé détaillé : modèle de données, sources principales, transformations clés, risques identifiés"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Analyse ce script Qlik/SQL de manière EXHAUSTIVE.
Chaque champ, chaque table, chaque transformation doit apparaître dans le JSON.

SCRIPT :
\`\`\`
${chunk}
\`\`\``
      }
    ]
  });

  let text = response.content[0].text.trim();
  // Nettoie les éventuels backticks markdown
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return repairJSON(text);
}

// POST /api/apps/:id/analyze
router.post('/apps/:id/analyze', async (req, res) => {
  const appId = req.params.id;

  try {
    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
    if (!app) return res.status(404).json({ error: 'Application non trouvée' });

    const scripts = db.prepare('SELECT content FROM scripts WHERE app_id = ?').all(appId);
    if (!scripts.length) return res.status(400).json({ error: 'Aucun script trouvé pour cette application' });

    const fullScript = scripts.map(s => s.content).join('\n\n// === SCRIPT SUIVANT ===\n\n');
    const totalChars = fullScript.length;

    console.log(`[Analyze] App "${app.name}" — ${totalChars} caractères`);

    const chunks = chunkScript(fullScript, 5000);
    console.log(`[Analyze] Découpage en ${chunks.length} chunk(s)`);

    const analyses = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Analyze] Chunk ${i + 1}/${chunks.length}...`);
      const result = await analyzeChunk(chunks[i], app.name, i, chunks.length);
      analyses.push(result);
    }

    const finalAnalysis = chunks.length === 1 ? analyses[0] : mergeAnalyses(analyses);

    finalAnalysis.metadata = {
      analyzedAt: new Date().toISOString(),
      totalChunks: chunks.length,
      totalChars,
      totalFields: (finalAnalysis.lineage || []).length,
      totalTables: (finalAnalysis.facts || []).length + (finalAnalysis.dims || []).length
    };

    // Upsert : met à jour si une analyse existe déjà pour cette app
    const existing = db.prepare('SELECT id FROM analyses WHERE app_id = ?').get(appId);
    if (existing) {
      db.prepare('UPDATE analyses SET result = ?, analyzed_at = CURRENT_TIMESTAMP WHERE app_id = ?')
        .run(JSON.stringify(finalAnalysis), appId);
    } else {
      db.prepare('INSERT INTO analyses (app_id, result) VALUES (?, ?)')
        .run(appId, JSON.stringify(finalAnalysis));
    }

    console.log(`[Analyze] Terminé — ${(finalAnalysis.lineage || []).length} lignes de lineage`);
    res.json({ success: true, analysis: finalAnalysis });

  } catch (err) {
    console.error('[Analyze] Erreur:', err.message);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'Réponse Claude invalide (JSON mal formé)', detail: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
