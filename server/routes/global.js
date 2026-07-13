'use strict';

/**
 * Routes du lineage global multi-apps : graphe QVD inter-apps,
 * QVD orphelins, extractions dupliquées, export CSV.
 */

const express = require('express');
const router = express.Router();
const { buildGlobalLineage } = require('../services/globalLineage');

// GET /api/global/lineage
router.get('/lineage', (req, res) => {
  try {
    res.json(buildGlobalLineage());
  } catch (e) {
    console.error('[Global]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/global/export — CSV du flux QVD inter-apps
router.get('/export', (req, res) => {
  const data = buildGlobalLineage();
  const headers = ['QVD', 'Statut', 'Générée par (apps)', 'Table stockée', 'Consommée par (apps)', 'Chemins'];
  const rows = data.qvds.map(q => [
    q.name,
    q.status,
    q.producers.map(p => p.appName).join(' | '),
    q.producers.map(p => p.tableName).join(' | '),
    q.consumers.map(c => c.appName).join(' | '),
    q.paths.join(' | ')
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lineage-global-qvd.csv"');
  res.send('﻿' + csv);
});

module.exports = router;
