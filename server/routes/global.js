'use strict';

/**
 * Routes du lineage global multi-apps : graphe QVD inter-apps,
 * QVD orphelins, extractions dupliquées, export CSV.
 */

const express = require('express');
const router = express.Router();
const { buildGlobalLineage } = require('../services/globalLineage');
const { analyzeDuplicates } = require('../services/duplicateService');
const { analyzeQvdProducers } = require('../services/qvdProducersService');
const { searchImpact } = require('../services/impactSearch');
const { buildStreamQvdUsage } = require('../services/streamQvdService');
const db = require('../database');

// GET /api/global/lineage
// GET /api/global/streams
// Dependance aux QVD par stream : qui en consomme, qui n'en consomme aucun.
// Sert le chantier de reduction du nombre d'apps dependantes de QVD.
router.get('/streams', async (req, res) => {
  try {
    // La config Qlik sert a ne compter que les producteurs qui tournent
    // vraiment (tache de reload active).
    const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
    res.json(await buildStreamQvdUsage(config));
  } catch (e) {
    console.error('[Streams QVD]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/global/impact?q=HISTO_VENTES&kinds=sql,fichier
// « Cette table ne charge plus — quelles apps sont touchées ? »
// Impact direct (apps qui lisent la source) + indirect (apps qui lisent les QVD
// produits par les précédentes, en cascade).
router.get('/impact', (req, res) => {
  try {
    const kinds = String(req.query.kinds || 'sql,fichier')
      .split(',').map(k => k.trim()).filter(Boolean);
    res.json(searchImpact(req.query.q || '', { kinds }));
  } catch (e) {
    console.error('[Impact]', e);
    res.status(500).json({ error: e.message });
  }
});

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

// GET /api/global/duplicates — familles de QVD versionnés + batchs jumeaux
// L'analyse ne dépend que du lineage local (SQLite), donc ~500 ms sur 400 apps :
// pas de cache dédié pour l'instant, mais on garde l'option ouverte via
// qrsCache.cachedAnalysis si le besoin devient visible.
router.get('/duplicates', (req, res) => {
  try {
    res.json(analyzeDuplicates());
  } catch (e) {
    console.error('[Duplicates]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Exports Excel/CSV ────────────────────────────────────────────────────────
//
// Excel considère les cellules qui commencent par =/+/-/@ comme des formules ;
// on préfixe par une apostrophe pour neutraliser l'injection (source Qlik
// non sûre = un nom d'app avec un signe = risque de code arbitraire à l'ouverture).

function csvEscape(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, headers, rows) {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map(r => r.map(csvEscape).join(','))
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM UTF-8 : garantit qu'Excel ouvre le fichier avec les accents corrects.
  res.send('﻿' + csv);
}

// GET /api/global/duplicates/export/families — CSV plat (une ligne par variante)
router.get('/duplicates/export/families', (req, res) => {
  try {
    const { families } = analyzeDuplicates();
    const rows = [];
    families.forEach((fam, famIndex) => {
      fam.variants.forEach((v, vIndex) => {
        rows.push([
          famIndex + 1,
          fam.root,
          fam.variantCount,
          fam.orphaned,
          vIndex + 1,
          v.name,
          v.status,
          v.producers.map(p => p.appName).join(' | '),
          v.consumerCount
        ]);
      });
    });
    sendCsv(res, 'doublons-familles-qvd.csv', [
      '#Famille', 'Racine', 'Total variantes', 'Orphelines',
      '#Variante', 'Nom QVD', 'Statut', 'Producteurs', 'Nb consommateurs'
    ], rows);
  } catch (e) {
    console.error('[Duplicates/families/export]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/global/duplicates/export/twins — CSV plat (une ligne par paire)
router.get('/duplicates/export/twins', (req, res) => {
  try {
    const { twins } = analyzeDuplicates();
    const rows = twins.map((t, i) => [
      i + 1,
      t.appA.appName,
      t.appA.stream || '',
      t.appA.published ? 'oui' : 'non',
      t.appA.owner || '',
      t.appB.appName,
      t.appB.stream || '',
      t.appB.published ? 'oui' : 'non',
      t.appB.owner || '',
      t.overlapPct,
      t.sharedCount,
      t.aOnly,
      t.bOnly,
      t.sharedRoots.join(' | ')
    ]);
    sendCsv(res, 'doublons-batchs-jumeaux.csv', [
      '#',
      'App A', 'Stream A', 'Publiée A', 'Propriétaire A',
      'App B', 'Stream B', 'Publiée B', 'Propriétaire B',
      'Recouvrement %', 'QVD partagés', 'Exclusifs A', 'Exclusifs B',
      'Racines partagées'
    ], rows);
  } catch (e) {
    console.error('[Duplicates/twins/export]', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── QVD → batchs producteurs (vue simplifiée) ────────────────────────────────

// GET /api/global/producers — pour chaque QVD, ses producteurs enrichis avec
// leur statut publié et planifié. Utilise le cache 5 min de analyzeTasks pour
// éviter les 9s de recalcul QRS à chaque visite.
router.get('/producers', async (req, res) => {
  try {
    res.json(await analyzeQvdProducers());
  } catch (e) {
    console.error('[Producers]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/global/producers/export — CSV plat pour Excel : 1 ligne par (QVD, batch)
router.get('/producers/export', async (req, res) => {
  try {
    const data = await analyzeQvdProducers();
    const rows = [];
    data.rows.forEach((r, qi) => {
      r.producers.forEach((p, pi) => {
        rows.push([
          qi + 1,
          r.qvd,
          r.qvdStatus,
          r.consumerCount,
          pi + 1,
          p.appName,
          p.stream || '',
          p.published ? 'oui' : 'non',
          p.owner || '',
          p.hasTaskData ? (p.scheduled ? 'oui (planifiée)' : p.chained ? 'oui (chaînée)' : p.manual ? 'non (manuel)' : 'non') : 'inconnu',
          p.taskCount,
          p.enabledTaskCount,
          p.lastRunAt || '',
          p.status.label
        ]);
      });
    });
    sendCsv(res, 'qvd-producteurs.csv', [
      '#QVD', 'Nom QVD', 'Statut QVD', 'Nb consommateurs',
      '#Batch', 'Batch producteur', 'Stream', 'Publié', 'Propriétaire',
      'Planifié', 'Nb tâches', 'Tâches actives', 'Dernier reload', 'Statut'
    ], rows);
  } catch (e) {
    console.error('[Producers/export]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
