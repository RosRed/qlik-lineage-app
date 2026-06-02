'use strict';

const client = require('../lib/anthropic');
const { getChatSystemPrompt } = require('../prompts/chatPrompt');
const { localChatAnswer } = require('./localParser');
const db = require('../database');

// ─── Utils ────────────────────────────────────────────────────────────────────

function trackUsage(type, inputTokens = 0, outputTokens = 0, model = 'claude-sonnet-4-20250514') {
  const costCents = Math.round(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15) * 100);
  try {
    db.prepare(
      'INSERT INTO api_usage (type, model, input_tokens, output_tokens, estimated_cost_cents) VALUES (?, ?, ?, ?, ?)'
    ).run(type, model, inputTokens, outputTokens, costCents);
  } catch (e) {
    console.error('[Usage tracker]', e.message);
  }
}

function getAnalysis(appId) {
  const row = db.prepare('SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1').get(appId);
  return row ? JSON.parse(row.result) : null;
}

function getChatHistory(appId) {
  return db.prepare('SELECT role, content FROM chat_messages WHERE app_id = ? ORDER BY created_at ASC').all(appId);
}

function saveChatMessage(appId, role, content, mode, source) {
  db.prepare(
    'INSERT INTO chat_messages (app_id, role, content, mode, source) VALUES (?, ?, ?, ?, ?)'
  ).run(appId, role, content, mode || 'general', source || 'claude');
}

// ─── Détection : question locale ou Claude ? ──────────────────────────────────

// Note: pas de \b sur les mots accentués (é, è, etc.) — \b ne fonctionne pas avec les non-ASCII en JS
const LOCAL_PATTERNS = [
  /\b(source|sources|qvd|origin|fichier|fichiers)\b/i,
  /\b(fact|faits|table de fait)\b/i,
  /\b(dim|dims|dimension|dimensions)\b/i,
  /\b(table|tables|liste des tables|toutes les tables)\b/i,
  /(calcul|formule|formules|champ calcul)/i,
  /(synth|clé synth|risque)/i,
  /(résumé|resume|summary|overview|bilan|statistique|stats)/i,
  /\b(map|maps|mapping|mappings|applymap)\b/i,
  /(section access|sécurité|security)/i,
  /(modèle|model|étoile|star|flocon|snowflake)/i,
  /\b(lineage|lignage)\b/i,
  /(?:lineage|trace|d.où vient|origin|source)\s+(?:de\s+|du\s+|d'|of\s+)?[a-z0-9_]+/i,
];

function isLocalQuestion(message) {
  return LOCAL_PATTERNS.some(pat => pat.test(message));
}

// ─── Réponse locale via SSE ───────────────────────────────────────────────────

function sendLocalResponse(res, content) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
  res.write(`data: ${JSON.stringify({ done: true, source: 'local' })}\n\n`);
  res.end();
}

// ─── Réponse Claude via SSE (streaming) ──────────────────────────────────────

async function sendClaudeResponse(appId, message, mode, app, analysis, history, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: getChatSystemPrompt(app, analysis),
    messages: [...history, { role: 'user', content: message }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullResponse += chunk.delta.text;
      res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
    }
  }

  // Récupérer l'usage depuis le message final
  try {
    const finalMsg = await stream.finalMessage();
    trackUsage('chat', finalMsg.usage?.input_tokens || 0, finalMsg.usage?.output_tokens || 0);
  } catch (_) {}

  saveChatMessage(appId, 'assistant', fullResponse, mode, 'claude');
  res.write(`data: ${JSON.stringify({ done: true, source: 'claude' })}\n\n`);
  res.end();
}

// ─── Entrée principale ────────────────────────────────────────────────────────

async function streamChat(appId, message, mode, res) {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!app) throw Object.assign(new Error('App introuvable'), { status: 404 });

  const analysis = getAnalysis(appId);
  const history = getChatHistory(appId);

  // Sauvegarder le message utilisateur
  saveChatMessage(appId, 'user', message, mode, 'user');

  // Tenter une réponse locale si la question est simple
  if (isLocalQuestion(message)) {
    const localAnswer = localChatAnswer(message, analysis);
    if (localAnswer !== null) {
      console.log(`[Chat/Local] Réponse locale pour: "${message.slice(0, 60)}..."`);
      saveChatMessage(appId, 'assistant', localAnswer, mode, 'local');
      trackUsage('chat_local', 0, 0, 'none');
      sendLocalResponse(res, localAnswer);
      return;
    }
  }

  // Question complexe → Claude
  console.log(`[Chat/Claude] Appel API pour: "${message.slice(0, 60)}..."`);
  await sendClaudeResponse(appId, message, mode, app, analysis, history, res);
}

module.exports = { streamChat };
