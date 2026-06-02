const express = require('express');
const router = express.Router();
const { runAnalysis } = require('../services/analyzeService');

// POST /api/apps/:id/analyze
router.post('/apps/:id/analyze', async (req, res) => {
  try {
    const analysis = await runAnalysis(req.params.id);
    res.json({ success: true, analysis });
  } catch (err) {
    console.error('[Analyze]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
