const client = require('../lib/anthropic');
const { getChatSystemPrompt } = require('../prompts/chatPrompt');
const db = require('../database');

function getAnalysis(appId) {
  const row = db.prepare('SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1').get(appId);
  return row ? JSON.parse(row.result) : null;
}

function getChatHistory(appId) {
  return db.prepare('SELECT role, content FROM chat_messages WHERE app_id = ? ORDER BY created_at ASC').all(appId);
}

async function streamChat(appId, message, mode, res) {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!app) throw Object.assign(new Error('App introuvable'), { status: 404 });

  const analysis = getAnalysis(appId);
  const history = getChatHistory(appId);

  db.prepare('INSERT INTO chat_messages (app_id, role, content, mode) VALUES (?, ?, ?, ?)')
    .run(appId, 'user', message, mode || 'general');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';

  const stream = await client.messages.stream({
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

  db.prepare('INSERT INTO chat_messages (app_id, role, content, mode) VALUES (?, ?, ?, ?)')
    .run(appId, 'assistant', fullResponse, mode || 'general');

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}

module.exports = { streamChat };
