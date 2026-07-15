'use strict';

/**
 * Routes de connexion au serveur Qlik Sense (client-managed) :
 *   - configuration de la connexion (host, certificats QMC, compte)
 *   - test de connexion (QRS /about)
 *   - liste des apps du serveur (QRS /app/full)
 *   - import d'apps : récupère le script via Engine API, crée l'app locale,
 *     sauvegarde le script et lance l'analyse locale.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const certClient = { ...require('../lib/qrsClient'), getAppScript: require('../lib/engineClient').getAppScript };
const proxyClient = require('../lib/proxyClient');
const { runAnalysis } = require('../services/analyzeService');

function getConfig() {
  return db.prepare('SELECT * FROM qlik_config WHERE id = 1').get() || null;
}

/** Sélectionne le client selon le mode : 'certificate' (ports 4242/4747) ou 'forms' (proxy 443) */
function clientFor(config) {
  return config.auth_mode === 'forms' ? proxyClient : certClient;
}

// GET /api/qlik/config — le mot de passe n'est jamais renvoyé au client
router.get('/config', (req, res) => {
  const cfg = getConfig();
  if (!cfg) return res.json(null);
  const { proxy_password, cert_password, ...safe } = cfg;
  res.json({ ...safe, has_proxy_password: !!proxy_password, has_cert_password: !!cert_password });
});

// POST /api/qlik/config
router.post('/config', (req, res) => {
  const { host, qrs_port, engine_port, auth_mode, cert_dir, cert_password, proxy_password, user_directory, user_id, reject_unauthorized } = req.body;
  const mode = auth_mode === 'forms' ? 'forms' : 'certificate';
  if (!host) return res.status(400).json({ error: 'host est requis' });
  if (mode === 'certificate' && !cert_dir) return res.status(400).json({ error: 'cert_dir est requis en mode certificats' });
  if (mode === 'forms' && (!user_directory || !user_id)) return res.status(400).json({ error: 'compte (directory + user) requis en mode formulaire' });

  db.prepare(`
    INSERT INTO qlik_config (id, host, qrs_port, engine_port, auth_mode, cert_dir, cert_password, proxy_password, user_directory, user_id, reject_unauthorized, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      host = excluded.host,
      qrs_port = excluded.qrs_port,
      engine_port = excluded.engine_port,
      auth_mode = excluded.auth_mode,
      cert_dir = excluded.cert_dir,
      cert_password = excluded.cert_password,
      proxy_password = CASE WHEN excluded.proxy_password IS NOT NULL THEN excluded.proxy_password ELSE qlik_config.proxy_password END,
      user_directory = excluded.user_directory,
      user_id = excluded.user_id,
      reject_unauthorized = excluded.reject_unauthorized,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    host.trim(),
    qrs_port || 4242,
    engine_port || 4747,
    mode,
    cert_dir ? cert_dir.trim() : null,
    cert_password || null,
    proxy_password || null,
    user_directory || 'INTERNAL',
    user_id || 'sa_repository',
    reject_unauthorized ? 1 : 0
  );
  res.json(getConfig());
});

// POST /api/qlik/test
router.post('/test', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const result = await clientFor(config).testConnection(config);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/qlik/apps — liste les apps du serveur, avec indication de celles déjà importées
router.get('/apps', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const serverApps = await clientFor(config).listApps(config);
    const imported = new Set(
      db.prepare('SELECT qlik_app_id FROM apps WHERE qlik_app_id IS NOT NULL').all().map(r => r.qlik_app_id)
    );
    res.json(serverApps.map(a => ({ ...a, imported: imported.has(a.qlikAppId) })));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/qlik/tasks — analyse des tâches de reload et planifications
router.get('/tasks', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const { analyzeTasks } = require('../services/taskService');
    res.json(await analyzeTasks(config));
  } catch (e) {
    console.error('[Tasks]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/qlik/tasks/export — rapport de nettoyage CSV (livrable d'audit)
router.get('/tasks/export', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const { analyzeTasks } = require('../services/taskService');
    const data = await analyzeTasks(config);

    const esc = (v) => {
      let s = String(v ?? '');
      // Protection injection de formule Excel
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const TRIGGER_LABELS = { manual: 'Manuelle', schedule: 'Planifiee', chain: 'Chainee', mixte: 'Mixte' };
    const headers = ['Tache', 'Application', 'Stream', 'Active', 'Declenchement', 'Recommandation', 'Score',
      'Problemes', 'Dernier statut', 'Derniere execution', 'Duree (s)', 'QVD produits', 'QVD consommes', 'Details'];
    const rows = data.tasks.map(t => [
      t.name, t.appName, t.stream || '', t.enabled ? 'oui' : 'non',
      TRIGGER_LABELS[t.triggerType] || 'Manuelle',
      t.recommendation, t.cleanupScore,
      t.problems.join(' | '), t.lastStatusLabel, t.lastStart || '',
      t.durationMs ? Math.round(t.durationMs / 1000) : '',
      t.producedQvds.join(' | '), t.consumedQvds.join(' | '),
      [
        t.brokenBy?.length ? `Chaine cassee par: ${t.brokenBy.join(', ')}` : '',
        t.orderIssues?.length ? `Ordre incorrect: ${t.orderIssues.map(o => `${o.qvd} (produit par ${o.producers.join(', ')})`).join(' ; ')}` : '',
        t.staleQvds?.length ? `Sources figees: ${t.staleQvds.join(', ')}` : ''
      ].filter(Boolean).join(' — ')
    ].map(esc).join(','));

    const csv = [headers.map(esc).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport-nettoyage-taches.csv"');
    res.send('﻿' + csv);
  } catch (e) {
    console.error('[Tasks export]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Gouvernance serveur (P3) ──────────────────────────────────────────────────

// GET /api/qlik/apps/cleanup — audit des apps serveur (?staleDays=90&sizeLimitMb=500)
router.get('/apps/cleanup', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const { auditApps } = require('../services/governanceService');
    res.json(await auditApps(config, {
      staleDays: parseInt(req.query.staleDays, 10) || 90,
      sizeLimitMb: parseInt(req.query.sizeLimitMb, 10) || 500
    }));
  } catch (e) {
    console.error('[Governance/apps]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/qlik/connections — audit des connexions de données
router.get('/connections', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const { auditConnections } = require('../services/governanceService');
    res.json(await auditConnections(config));
  } catch (e) {
    console.error('[Governance/connections]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/qlik/governance — synthèse agrégée (?refresh=1 pour vider le cache QRS)
router.get('/governance', async (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  try {
    const { buildGovernance, clearCache } = require('../services/governanceService');
    if (req.query.refresh === '1') clearCache();
    res.json(await buildGovernance(config));
  } catch (e) {
    console.error('[Governance]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Import avec progression ───────────────────────────────────────────────────
// L'import tourne en tâche de fond ; le client suit l'avancement via GET /import/progress

const importJob = {
  running: false, total: 0, done: 0, currentApp: null,
  results: [], startedAt: null, finishedAt: null
};

async function importOne(config, target, analyzeMode) {
  const {
    qlikAppId, name, stream, published, owner, lastReloadTime,
    fileSize, createdDate, modifiedDate, publishTime, description, tags, customProperties
  } = target;
  console.log(`[Import] "${name}" (${qlikAppId}) — récupération du script...`);
  const script = await clientFor(config).getAppScript(config, qlikAppId);

  const meta = {
    file_size: fileSize ?? null,
    created_date: createdDate || null,
    modified_date: modifiedDate || null,
    publish_time: publishTime || null,
    description: description || null,
    tags: Array.isArray(tags) && tags.length ? tags.join('|') : null,
    custom_properties: Array.isArray(customProperties) && customProperties.length ? JSON.stringify(customProperties) : null
  };

  // App locale existante (même qlik_app_id) → mise à jour ; sinon création
  let local = db.prepare('SELECT * FROM apps WHERE qlik_app_id = ?').get(qlikAppId);
  if (local) {
    db.prepare(`UPDATE apps SET name = ?, stream = ?, published = ?, owner = ?, last_reload = ?,
        file_size = ?, created_date = ?, modified_date = ?, publish_time = ?, description = ?, tags = ?, custom_properties = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, stream || null, published ? 1 : 0, owner || null, lastReloadTime || null,
        meta.file_size, meta.created_date, meta.modified_date, meta.publish_time, meta.description, meta.tags, meta.custom_properties,
        local.id);
  } else {
    const r = db.prepare(`INSERT INTO apps
        (name, qlik_app_id, stream, origin, published, owner, last_reload,
         file_size, created_date, modified_date, publish_time, description, tags, custom_properties)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, qlikAppId, stream || null, 'qlik-server', published ? 1 : 0, owner || null, lastReloadTime || null,
        meta.file_size, meta.created_date, meta.modified_date, meta.publish_time, meta.description, meta.tags, meta.custom_properties);
    local = db.prepare('SELECT * FROM apps WHERE id = ?').get(r.lastInsertRowid);
  }

  db.prepare('DELETE FROM scripts WHERE app_id = ?').run(local.id);
  db.prepare('INSERT INTO scripts (app_id, content, filename) VALUES (?, ?, ?)')
    .run(local.id, script, `${name}.qvs`);

  let analyzed = false;
  try {
    await runAnalysis(local.id, analyzeMode);
    analyzed = true;
  } catch (e) {
    console.error(`[Import] analyse échouée pour "${name}" :`, e.message);
  }
  return { qlikAppId, name, appId: local.id, scriptChars: script.length, analyzed, ok: true };
}

async function runImportJob(config, apps, analyzeMode) {
  try {
    for (const target of apps) {
      importJob.currentApp = target.name;
      try {
        importJob.results.push(await importOne(config, target, analyzeMode));
      } catch (e) {
        console.error(`[Import] échec "${target.name}" :`, e.message);
        importJob.results.push({ qlikAppId: target.qlikAppId, name: target.name, ok: false, error: e.message });
      }
      importJob.done++;
    }
  } catch (e) {
    // Erreur inattendue hors du try interne (db, etc.) — ne jamais laisser le job bloqué
    console.error('[Import] erreur fatale du job :', e.message);
  } finally {
    importJob.running = false;
    importJob.currentApp = null;
    importJob.finishedAt = Date.now();
    console.log(`[Import] terminé : ${importJob.results.filter(r => r.ok).length}/${importJob.total} ok`);
  }
}

// POST /api/qlik/import — démarre le job et répond immédiatement
router.post('/import', (req, res) => {
  const config = getConfig();
  if (!config) return res.status(400).json({ error: 'Aucune configuration Qlik enregistrée' });
  if (importJob.running) return res.status(409).json({ error: 'Un import est déjà en cours' });

  const { apps, analyzeMode = 'local' } = req.body;
  if (!Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'Liste d\'apps à importer vide' });
  }

  Object.assign(importJob, {
    running: true, total: apps.length, done: 0, currentApp: apps[0].name,
    results: [], startedAt: Date.now(), finishedAt: null
  });
  runImportJob(config, apps, analyzeMode); // pas de await : tourne en fond

  res.json({ started: true, total: apps.length });
});

// GET /api/qlik/import/progress — état du job en cours (ou du dernier terminé)
router.get('/import/progress', (req, res) => {
  const ok = importJob.results.filter(r => r.ok).length;
  const failed = importJob.results.filter(r => !r.ok).length;
  res.json({
    running: importJob.running,
    total: importJob.total,
    done: importJob.done,
    currentApp: importJob.currentApp,
    imported: ok,
    failed,
    errors: importJob.results.filter(r => !r.ok).map(r => ({ name: r.name, error: r.error })),
    elapsedMs: importJob.startedAt ? (importJob.finishedAt || Date.now()) - importJob.startedAt : 0
  });
});

module.exports = router;
