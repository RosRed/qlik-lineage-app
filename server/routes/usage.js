const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/usage — statistiques d'utilisation de l'API Claude
router.get('/', (req, res) => {
  try {
    const byType = db.prepare(`
      SELECT
        type,
        COUNT(*) AS total_calls,
        COALESCE(SUM(input_tokens), 0)  AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
        COALESCE(SUM(estimated_cost_cents), 0) AS total_cost_cents
      FROM api_usage
      GROUP BY type
    `).all();

    const today = db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0)  AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(estimated_cost_cents), 0) AS cost_cents
      FROM api_usage
      WHERE date(created_at) = date('now')
    `).get();

    const totals = db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0)  AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(estimated_cost_cents), 0) AS cost_cents
      FROM api_usage
    `).get();

    const localSaved = db.prepare(`
      SELECT COUNT(*) AS count FROM api_usage WHERE type = 'cache_hit' OR type = 'local'
    `).get();

    res.json({ byType, today, totals, localSaved: localSaved?.count || 0 });
  } catch (err) {
    console.error('[Usage]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/usage — réinitialiser les stats
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM api_usage').run();
  res.json({ success: true });
});

module.exports = router;
