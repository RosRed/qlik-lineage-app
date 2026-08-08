const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/apps — avec indicateur d'analyse (pour les filtres de la sidebar)
router.get('/', (req, res) => {
  const apps = db.prepare(`
    SELECT a.*, CASE WHEN an.id IS NULL THEN 0 ELSE 1 END AS analyzed
    FROM apps a
    LEFT JOIN (SELECT DISTINCT app_id, MIN(id) AS id FROM analyses GROUP BY app_id) an ON an.app_id = a.id
    ORDER BY a.updated_at DESC
  `).all();
  res.json(apps);
});

// POST /api/apps
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis' });
  }
  const result = db.prepare('INSERT INTO apps (name) VALUES (?)').run(name.trim());
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(app);
});

// PUT /api/apps/:id
router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis' });
  }
  db.prepare('UPDATE apps SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name.trim(), req.params.id);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  res.json(app);
});

// DELETE /api/apps/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'App introuvable' });
  res.json({ success: true });
});

// POST /api/apps/:id/scripts
router.post('/:id/scripts', (req, res) => {
  const { content, filename } = req.body;
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });

  db.prepare('DELETE FROM scripts WHERE app_id = ?').run(req.params.id);
  const result = db.prepare('INSERT INTO scripts (app_id, content, filename) VALUES (?, ?, ?)')
    .run(req.params.id, content, filename || 'script.qvs');
  db.prepare('UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  res.status(201).json({ id: result.lastInsertRowid, content, filename });
});

// GET /api/apps/:id/scripts
router.get('/:id/scripts', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE app_id = ? ORDER BY uploaded_at DESC LIMIT 1')
    .get(req.params.id);
  res.json(script || null);
});

// GET /api/apps/:id/analysis
router.get('/:id/analysis', (req, res) => {
  const analysis = db.prepare('SELECT * FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1')
    .get(req.params.id);
  if (!analysis) return res.json(null);
  res.json({ ...analysis, result: JSON.parse(analysis.result) });
});

// GET /api/apps/:id/export/lineage
router.get('/:id/export/lineage', (req, res) => {
  const analysis = db.prepare('SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1')
    .get(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Aucune analyse disponible' });

  const data = JSON.parse(analysis.result);
  const lineage = data.lineage || [];

  const headers = ['Champ Qlik', 'Table Qlik', 'Champ Source', 'Table Source', 'Transformation'];
  const rows = lineage.map(l =>
    [l.fieldQlik, l.tableQlik, l.fieldSource, l.tableSource, l.transformation]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lineage-app-${req.params.id}.csv"`);
  res.send('﻿' + csv);
});

module.exports = router;
