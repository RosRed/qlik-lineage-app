const client = require('../lib/anthropic');
const { repairJSON } = require('../lib/jsonRepair');
const { chunkScript, mergeAnalyses } = require('../lib/scriptChunker');
const { getAnalyzePrompt } = require('../prompts/analyzePrompt');
const db = require('../database');

async function analyzeChunk(chunk, appName, chunkIndex, totalChunks) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system: getAnalyzePrompt(appName, chunkIndex, totalChunks),
    messages: [{
      role: 'user',
      content: `Analyse ce script Qlik/SQL de manière EXHAUSTIVE. Chaque champ, chaque table, chaque transformation doit apparaître dans le JSON.\n\nSCRIPT :\n\`\`\`\n${chunk}\n\`\`\``
    }]
  });

  const text = response.content[0].text.trim();
  return repairJSON(text);
}

async function runAnalysis(appId) {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!app) throw Object.assign(new Error('Application non trouvée'), { status: 404 });

  const scripts = db.prepare('SELECT content FROM scripts WHERE app_id = ?').all(appId);
  if (!scripts.length) throw Object.assign(new Error('Aucun script trouvé pour cette application'), { status: 400 });

  const fullScript = scripts.map(s => s.content).join('\n\n// === SCRIPT SUIVANT ===\n\n');
  const totalChars = fullScript.length;
  const chunks = chunkScript(fullScript, 5000);

  console.log(`[Analyze] "${app.name}" — ${totalChars} chars, ${chunks.length} chunk(s)`);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Analyze] chunk ${i + 1}/${chunks.length}...`);
    results.push(await analyzeChunk(chunks[i], app.name, i, chunks.length));
  }

  const final = chunks.length === 1 ? results[0] : mergeAnalyses(results);
  final.metadata = {
    analyzedAt: new Date().toISOString(),
    totalChunks: chunks.length,
    totalChars,
    totalFields: (final.lineage || []).length,
    totalTables: (final.facts || []).length + (final.dims || []).length
  };

  const existing = db.prepare('SELECT id FROM analyses WHERE app_id = ?').get(appId);
  if (existing) {
    db.prepare('UPDATE analyses SET result = ?, analyzed_at = CURRENT_TIMESTAMP WHERE app_id = ?')
      .run(JSON.stringify(final), appId);
  } else {
    db.prepare('INSERT INTO analyses (app_id, result) VALUES (?, ?)').run(appId, JSON.stringify(final));
  }

  console.log(`[Analyze] done — ${(final.lineage || []).length} lineage rows`);
  return final;
}

module.exports = { runAnalysis };
