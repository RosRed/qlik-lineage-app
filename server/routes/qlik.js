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

// ── Import avec progression ───────────────────────────────────────────────────
// L'import tourne en tâche de fond ; le client suit l'avancement via GET /import/progress

const importJob = {
  running: false, total: 0, done: 0, currentApp: null,
  results: [], startedAt: null, finishedAt: null
};

async function importOne(config, target, analyzeMode) {
  const { qlikAppId, name, stream, published, owner, lastReloadTime } = target;
  console.log(`[Import] "${name}" (${qlikAppId}) — récupération du script...`);
  const script = await clientFor(config).getAppScript(config, qlikAppId);

  // App locale existante (même qlik_app_id) → mise à jour ; sinon création
  let local = db.prepare('SELECT * FROM apps WHERE qlik_app_id = ?').get(qlikAppId);
  if (local) {
    db.prepare('UPDATE apps SET name = ?, stream = ?, published = ?, owner = ?, last_reload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, stream || null, published ? 1 : 0, owner || null, lastReloadTime || null, local.id);
  } else {
    const r = db.prepare('INSERT INTO apps (name, qlik_app_id, stream, origin, published, owner, last_reload) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, qlikAppId, stream || null, 'qlik-server', published ? 1 : 0, owner || null, lastReloadTime || null);
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
  importJob.running = false;
  importJob.currentApp = null;
  importJob.finishedAt = Date.now();
  console.log(`[Import] terminé : ${importJob.results.filter(r => r.ok).length}/${importJob.total} ok`);
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
