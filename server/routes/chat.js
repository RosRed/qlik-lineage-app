const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../database');
const { streamChat } = require('../services/chatService');

// GET /api/apps/:id/chat
router.get('/', (req, res) => {
  const messages = db.prepare('SELECT * FROM chat_messages WHERE app_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(messages);
});

// POST /api/apps/:id/chat
router.post('/', async (req, res) => {
  const { message, mode, forceClaude } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });
  try {
    await streamChat(req.params.id, message, mode, res, { forceClaude: !!forceClaude });
  } catch (err) {
    console.error('[Chat]', err.message);
    // Si les en-têtes SSE ne sont pas encore partis, répondre en JSON avec le bon status
    if (!res.headersSent) {
      return res.status(err.status || 500).json({ error: err.message });
    }
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
