'use strict';

const crypto = require('crypto');
const client = require('../lib/anthropic');
const { repairJSON } = require('../lib/jsonRepair');
const { chunkScript, mergeAnalyses } = require('../lib/scriptChunker');
const { getAnalyzePrompt } = require('../prompts/analyzePrompt');
const { parseQlikScript } = require('./localParser');
const db = require('../database');

// ─── Utils ────────────────────────────────────────────────────────────────────

function scriptHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function trackUsage(type, inputTokens = 0, outputTokens = 0, model = 'claude-sonnet-4-20250514') {
  // Tarifs claude-sonnet-4-20250514 : $3/MTok input, $15/MTok output
  const costCents = Math.round(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15) * 100);
  try {
    db.prepare(
      'INSERT INTO api_usage (type, model, input_tokens, output_tokens, estimated_cost_cents) VALUES (?, ?, ?, ?, ?)'
    ).run(type, model, inputTokens, outputTokens, costCents);
  } catch (e) {
    console.error('[Usage tracker]', e.message);
  }
}

function saveAnalysis(appId, result, hash, mode) {
  const existing = db.prepare('SELECT id FROM analyses WHERE app_id = ?').get(appId);
  if (existing) {
    db.prepare(
      'UPDATE analyses SET result = ?, script_hash = ?, analyze_mode = ?, analyzed_at = CURRENT_TIMESTAMP WHERE app_id = ?'
    ).run(JSON.stringify(result), hash, mode, appId);
  } else {
    db.prepare(
      'INSERT INTO analyses (app_id, result, script_hash, analyze_mode) VALUES (?, ?, ?, ?)'
    ).run(appId, JSON.stringify(result), hash, mode);
  }
}

// ─── Analyse Claude ───────────────────────────────────────────────────────────

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

  // Track usage
  trackUsage('analyze', response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);

  const text = response.content[0].text.trim();
  return repairJSON(text);
}

async function runClaudeAnalysis(app, fullScript, hash) {
  const chunks = chunkScript(fullScript, 5000);
  console.log(`[Analyze/Claude] "${app.name}" — ${fullScript.length} chars, ${chunks.length} chunk(s)`);

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Analyze/Claude] chunk ${i + 1}/${chunks.length}...`);
    results.push(await analyzeChunk(chunks[i], app.name, i, chunks.length));
  }

  const final = chunks.length === 1 ? results[0] : mergeAnalyses(results);
  final.metadata = {
    analyzedAt: new Date().toISOString(),
    mode: 'claude',
    totalChunks: chunks.length,
    totalChars: fullScript.length,
    totalFields: (final.lineage || []).length,
    totalTables: (final.facts || []).length + (final.dims || []).length
  };

  saveAnalysis(app.id, final, hash, 'claude');
  console.log(`[Analyze/Claude] done — ${(final.lineage || []).length} lignes de lineage`);
  return final;
}

// ─── Analyse locale ───────────────────────────────────────────────────────────

function runLocalAnalysis(app, fullScript, hash) {
  console.log(`[Analyze/Local] "${app.name}" — ${fullScript.length} chars`);
  const result = parseQlikScript(fullScript, app.name);
  saveAnalysis(app.id, result, hash, 'local');
  trackUsage('local', 0, 0, 'none');
  console.log(`[Analyze/Local] done — ${(result.lineage || []).length} lignes de lineage`);
  return result;
}

// ─── Entrée principale ────────────────────────────────────────────────────────

async function runAnalysis(appId, mode = 'claude') {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!app) throw Object.assign(new Error('Application non trouvée'), { status: 404 });

  const scripts = db.prepare('SELECT content FROM scripts WHERE app_id = ?').all(appId);
  if (!scripts.length) throw Object.assign(new Error('Aucun script trouvé pour cette application'), { status: 400 });

  const fullScript = scripts.map(s => s.content).join('\n\n// === SCRIPT SUIVANT ===\n\n');
  const hash = scriptHash(fullScript);

  // Vérification du cache (pour le mode Claude uniquement)
  if (mode === 'claude') {
    const existing = db.prepare(
      'SELECT result, script_hash, analyze_mode FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1'
    ).get(appId);

    if (existing && existing.script_hash === hash) {
      console.log(`[Analyze] ✅ Cache hit — "${app.name}" (script inchangé)`);
      trackUsage('cache_hit', 0, 0, 'none');
      const cached = JSON.parse(existing.result);
      cached._cached = true;
      cached._cachedMode = existing.analyze_mode || 'claude';
      return cached;
    }
  }

  if (mode === 'local') {
    return runLocalAnalysis(app, fullScript, hash);
  }

  return runClaudeAnalysis(app, fullScript, hash);
}

module.exports = { runAnalysis };
