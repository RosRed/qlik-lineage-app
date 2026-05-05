const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../database');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildChatSystemPrompt(app, analysis) {
  if (!analysis) {
    return `Tu es un agent Data Lineage Qlik pour l'application "${app.name}".
Aucune analyse n'a encore été faite. Demande à l'utilisateur d'analyser les scripts d'abord.`;
  }

  const a = analysis;
  return `Tu es un agent expert en Data Lineage, SQL et Qlik Sense/QlikView.
Tu travailles EXCLUSIVEMENT sur l'application "${a.appName}" — aucune donnée d'une autre app.

═══════════════════════════════════════════
CONTEXTE COMPLET DE L'APPLICATION
═══════════════════════════════════════════

MODÈLE : ${a.model}
SOURCES : ${(a.sources || []).join(' | ')}

TABLES DE FAITS (${(a.facts || []).length}) :
${(a.facts || []).map(f =>
    `  • ${f.name} [${(f.fields || []).length} champs] — PK: ${(f.keys || []).join(',')} — Source: ${f.source || '?'}`
  ).join('\n') || '  Aucune'}

DIMENSIONS (${(a.dims || []).length}) :
${(a.dims || []).map(d =>
    `  • ${d.name} [${(d.fields || []).length} champs] — PK: ${(d.keys || []).join(',')} — Source: ${d.source || '?'}`
  ).join('\n') || '  Aucune'}

MAPPINGS :
${(a.mappings || []).map(m => `  • ${m.name} : ${m.from} → ${m.applyMapUsage || m.to}`).join('\n') || '  Aucun'}

CHAMPS CALCULÉS (${(a.calcFields || []).length}) :
${(a.calcFields || []).map(c => `  • [${c.table}] ${c.field} = ${c.formula}`).join('\n') || '  Aucun'}

CLÉS SYNTHÉTIQUES DÉTECTÉES :
${(a.synthKeys || []).map(k => `  ⚠️ ${k.field} = ${k.formula} — Risque: ${k.risk}`).join('\n') || '  Aucune'}

LINEAGE COMPLET (${(a.lineage || []).length} champs tracés) :
${(a.lineage || []).slice(0, 50).map(l =>
    `  ${l.tableQlik}.${l.fieldQlik} ← ${l.tableSource}.${l.fieldSource} [${l.transformation}]`
  ).join('\n')}
${(a.lineage || []).length > 50 ? `  ... et ${a.lineage.length - 50} autres champs` : ''}

JOINTURES :
${(a.joinConditions || []).map(j => `  ${j.leftTable} ↔ ${j.rightTable} sur ${j.joinField} (${j.joinType})`).join('\n') || '  Non détectées'}

FILTRES :
${(a.filters || []).map(f => `  [${f.table}] WHERE ${f.condition} (appliqué: ${f.appliedAt})`).join('\n') || '  Aucun'}

═══════════════════════════════════════════
RÈGLES DE RÉPONSE
═══════════════════════════════════════════

Si question LINEAGE :
→ Trace le champ depuis Qlik jusqu'à la source physique
→ Mentionne chaque transformation appliquée
→ Indique si le champ est utilisé dans d'autres tables

Si question SQL :
→ Génère le SQL complet commenté
→ Inclure en commentaire : App, Objectif, Tables utilisées, Lineage
→ Inclure l'équivalent Qlik (expression + dimensions)
→ Mentionner les index recommandés

Si question QLIK SCRIPT :
→ Génère le script complet avec NoConcatenate
→ Respecte le modèle étoile de cette app
→ Inclure les mappings ApplyMap si pertinents
→ Signaler les risques de clés synthétiques
→ Structurer en sections commentées

Réponds toujours en FRANÇAIS. Code en anglais/technique.
Sois EXHAUSTIF et DÉTAILLÉ — pas de résumé partiel.`;
}

// GET /api/apps/:id/chat
router.get('/', (req, res) => {
  const messages = db.prepare('SELECT * FROM chat_messages WHERE app_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(messages);
});

// POST /api/apps/:id/chat (streaming SSE)
router.post('/', async (req, res) => {
  const { message, mode } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });

  const analysisRow = db.prepare('SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1')
    .get(req.params.id);
  const analysis = analysisRow ? JSON.parse(analysisRow.result) : null;

  const history = db.prepare('SELECT role, content FROM chat_messages WHERE app_id = ? ORDER BY created_at ASC')
    .all(req.params.id);

  db.prepare('INSERT INTO chat_messages (app_id, role, content, mode) VALUES (?, ?, ?, ?)')
    .run(req.params.id, 'user', message, mode || 'general');

  const messages = [...history, { role: 'user', content: message }];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: buildChatSystemPrompt(app, analysis),
      messages
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullResponse += chunk.delta.text;
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    db.prepare('INSERT INTO chat_messages (app_id, role, content, mode) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'assistant', fullResponse, mode || 'general');

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// DELETE /api/apps/:id/chat
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM chat_messages WHERE app_id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
