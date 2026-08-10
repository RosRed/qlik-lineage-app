'use strict';

/**
 * Routes SSIS — vague 1 : config + test de connexion.
 * Vagues 2/3/4 (dashboard, exécutions, erreurs, deltas de rows, jobs Agent)
 * seront branchées ici dès que la connexion est validée.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const ssisClient = require('../lib/ssisClient');
const ssisService = require('../services/ssisService');
const autoSnapshot = require('../services/ssisAutoSnapshot');
const namedSnap = require('../services/ssisNamedSnapshot');
const localDb = db;

// Middleware — la config doit exister pour toutes les vues data
function requireConfig(req, res, next) {
  const cfg = getConfig();
  if (!cfg) return res.status(400).json({ error: 'Aucune configuration SSIS enregistrée' });
  if (!cfg.password) return res.status(400).json({ error: 'Mot de passe manquant' });
  req.ssisConfig = cfg;
  next();
}

function handle(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (err) {
      console.error('[SSIS]', err.message);
      res.status(err.status || 500).json({ error: err.message });
    }
  };
}

function getConfig() {
  return db.prepare('SELECT * FROM ssis_config WHERE id = 1').get() || null;
}

function safeConfig(cfg) {
  if (!cfg) return null;
  const { password, ...rest } = cfg;
  return { ...rest, has_password: !!password };
}

// GET /api/ssis/config
router.get('/config', (req, res) => {
  res.json(safeConfig(getConfig()));
});

// POST /api/ssis/config
router.post('/config', (req, res) => {
  const { host, port, database, username, password, encrypt, trust_server_certificate } = req.body || {};
  if (!host) return res.status(400).json({ error: 'host est requis' });
  if (!username) return res.status(400).json({ error: 'username est requis' });

  // Ne réécrit pas le mot de passe si non fourni (permet un update partiel)
  const existing = getConfig();
  const finalPassword = password !== undefined && password !== ''
    ? password
    : (existing ? existing.password : null);

  db.prepare(`
    INSERT INTO ssis_config (id, host, port, database, username, password, encrypt, trust_server_certificate, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      host = excluded.host,
      port = excluded.port,
      database = excluded.database,
      username = excluded.username,
      password = excluded.password,
      encrypt = excluded.encrypt,
      trust_server_certificate = excluded.trust_server_certificate,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    host.trim(),
    port || 1433,
    (database || 'SSISDB').trim(),
    username.trim(),
    finalPassword,
    encrypt === false ? 0 : 1,
    trust_server_certificate === false ? 0 : 1
  );
  res.json(safeConfig(getConfig()));
});

// POST /api/ssis/test
// Accepte une config en body pour tester sans enregistrer (utile depuis
// le formulaire). Le mot de passe stocké est réutilisé si absent du body.
router.post('/test', async (req, res) => {
  const stored = getConfig();
  const body = req.body || {};
  const useBody = body.host && body.username;
  const cfg = useBody
    ? {
        host: body.host,
        port: body.port || 1433,
        database: body.database || 'SSISDB',
        username: body.username,
        password: body.password || stored?.password || null,
        encrypt: body.encrypt === false ? 0 : 1,
        trust_server_certificate: body.trust_server_certificate === false ? 0 : 1
      }
    : stored;
  if (!cfg) return res.status(400).json({ error: 'Aucune configuration SSIS — remplissez le formulaire' });
  if (!cfg.password) return res.status(400).json({ error: 'Mot de passe manquant' });
  try {
    const result = await ssisClient.testConnection(cfg);
    res.json(result);
  } catch (err) {
    console.error('[SSIS test]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/ssis/health — santé rapide (sans charger de données)
router.get('/health', (req, res) => {
  const cfg = getConfig();
  res.json({ configured: !!cfg, host: cfg?.host || null });
});

// ── Vague 2 : Dashboard / Exécutions / Erreurs ─────────────────────────────

router.get('/dashboard', requireConfig, handle(req =>
  ssisService.getDashboard(req.ssisConfig, { days: parseInt(req.query.days, 10) || 7 })
));

router.get('/executions', requireConfig, handle(req =>
  ssisService.listExecutions(req.ssisConfig, {
    days: parseInt(req.query.days, 10) || 7,
    status: req.query.status || null,
    folder: req.query.folder || null,
    project: req.query.project || null,
    pkg: req.query.pkg || null,
    machine: req.query.machine || null,
    duration: req.query.duration || null,
    sort: req.query.sort || 'start_desc',
    limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
    offset: parseInt(req.query.offset, 10) || 0
  })
));

router.get('/executions/:id', requireConfig, handle(req =>
  ssisService.getExecutionDetail(req.ssisConfig, req.params.id)
));

router.get('/errors', requireConfig, handle(req =>
  ssisService.listErrors(req.ssisConfig, {
    days: parseInt(req.query.days, 10) || 7,
    limit: Math.min(parseInt(req.query.limit, 10) || 200, 500)
  })
));

router.get('/folders', requireConfig, handle(req =>
  ssisService.listFolders(req.ssisConfig)
));

// ── Vague 3 : Row counts & deltas ─────────────────────────────────────────

router.get('/databases', requireConfig, handle(req =>
  ssisService.listDatabases(req.ssisConfig)
));

router.get('/tables', requireConfig, handle(req =>
  ssisService.listTables(req.ssisConfig, {
    database: req.query.database,
    search: req.query.search || null
  })
));

router.get('/tables/status', requireConfig, handle(req =>
  ssisService.getTableStatus(req.ssisConfig, { database: req.query.database, db: localDb })
));

router.post('/tables/snapshot', requireConfig, handle(async (req) => {
  const database = req.body?.database || req.query.database;
  if (!database) throw Object.assign(new Error('database est requis'), { status: 400 });
  return ssisService.snapshotDatabase(req.ssisConfig, database, { db: localDb });
}));

router.get('/tables/history', requireConfig, handle(req => {
  const { database, schema, table } = req.query;
  if (!database || !schema || !table) {
    throw Object.assign(new Error('database, schema et table sont requis'), { status: 400 });
  }
  return ssisService.getTableHistory({
    db: localDb, serverKey: req.ssisConfig.host,
    database, schema, table,
    limit: Math.min(parseInt(req.query.limit, 10) || 100, 500)
  });
}));

// Rows par dataflow SSISDB (execution_data_statistics)
router.get('/dataflow-rows', requireConfig, handle(req =>
  ssisService.getDataflowRows(req.ssisConfig, {
    days: parseInt(req.query.days, 10) || 30,
    folder: req.query.folder || null,
    project: req.query.project || null,
    pkg: req.query.pkg || null
  })
));

router.get('/dataflow-rows/diagnose', requireConfig, handle(async req => {
  const [access, logging] = await Promise.all([
    ssisService.diagnoseDataflowAccess(req.ssisConfig),
    ssisService.getLoggingLevels(req.ssisConfig).catch(e => ({ error: e.message }))
  ]);
  return { ...access, loggingLevels: logging };
}));

// POST /api/ssis/reconnect — vide le pool mssql (utile après un changement de rôle)
router.post('/reconnect', handle(async () => {
  await ssisClient.closeAllPools();
  return { ok: true, message: 'Pool de connexion fermé — la prochaine requête ouvrira une session fraîche' };
}));

// ── Snapshots nommés (à la demande, granularité société) ──────────────────

router.get('/named-snapshots', handle(async (req) => {
  return namedSnap.listSnapshots({
    db: localDb,
    serverKey: req.query.server_key || null,
    database: req.query.database || null
  });
}));

router.post('/named-snapshots', requireConfig, handle(async (req) => {
  const { database, label, description } = req.body || {};
  return namedSnap.startNamedSnapshot(req.ssisConfig, {
    database, label, description, db: localDb
  });
}));

// Status léger (pour polling client pendant capture en background)
router.get('/named-snapshots/:id/status', handle(async (req) => {
  return namedSnap.getSnapshotStatus({ db: localDb, id: parseInt(req.params.id, 10) });
}));

router.get('/named-snapshots/compare', handle(async (req) => {
  const aId = parseInt(req.query.a, 10);
  const bId = parseInt(req.query.b, 10);
  if (!aId || !bId) throw Object.assign(new Error('paramètres a et b requis'), { status: 400 });
  return namedSnap.compareSnapshots({ db: localDb, aId, bId });
}));

router.get('/named-snapshots/:id', handle(async (req) => {
  return namedSnap.getSnapshot({ db: localDb, id: parseInt(req.params.id, 10) });
}));

router.delete('/named-snapshots/:id', handle(async (req) => {
  return namedSnap.deleteSnapshot({ db: localDb, id: parseInt(req.params.id, 10) });
}));

router.post('/snapshots/wipe', handle(async () => {
  return namedSnap.wipeAllSnapshots({ db: localDb });
}));

// ── TABLE_UPDATE_LOG (client-owned) ────────────────────────────────────────

router.get('/update-log/schema', requireConfig, handle(req =>
  ssisService.inspectUpdateLog(req.ssisConfig, req.query.database)
));

router.get('/update-log', requireConfig, handle(req =>
  ssisService.readUpdateLog(req.ssisConfig, {
    database: req.query.database,
    days: parseInt(req.query.days, 10) || 7,
    ref_societe: req.query.ref_societe || null,
    search: req.query.search || null,
    limit: Math.min(parseInt(req.query.limit, 10) || 500, 2000)
  })
));

router.get('/societes', requireConfig, handle(req =>
  ssisService.listSocietes(req.ssisConfig, req.query.database)
));

router.get('/update-log/summary', requireConfig, handle(req =>
  ssisService.getUpdateLogSummary(req.ssisConfig, {
    database: req.query.database,
    days: parseInt(req.query.days, 10) || 30,
    ref_societe: req.query.ref_societe || null
  })
));

router.get('/update-log/runs', requireConfig, handle(req =>
  ssisService.getUpdateLogRuns(req.ssisConfig, {
    database: req.query.database,
    days: parseInt(req.query.days, 10) || 7,
    ref_societe: req.query.ref_societe || null,
    gapMinutes: parseInt(req.query.gap, 10) || 10
  })
));

// ── Auto-snapshot après chaque exécution SSIS ─────────────────────────────

router.get('/autosnapshot', handle(async () => autoSnapshot.status()));

router.post('/autosnapshot', requireConfig, handle(async (req) => {
  const { enabled, database } = req.body || {};
  if (enabled && !database) throw Object.assign(new Error('database est requis pour activer'), { status: 400 });
  localDb.prepare('UPDATE ssis_config SET autosnapshot_enabled = ?, autosnapshot_database = ? WHERE id = 1')
    .run(enabled ? 1 : 0, database || null);
  autoSnapshot.stop();
  if (enabled) autoSnapshot.start();
  return autoSnapshot.status();
}));

router.post('/autosnapshot/trigger', requireConfig, handle(async () => {
  await autoSnapshot.triggerNow();
  return autoSnapshot.status();
}));

// SSE : diffuse les événements du poller en temps réel.
// L'UI TablesPage s'abonne pour voir apparaître les snapshots dès qu'ils tombent,
// sans polling. Le keep-alive envoie un commentaire toutes les 15 s pour
// éviter les timeouts des proxies (Vite/nginx/CloudFlare).
router.get('/autosnapshot/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // désactive le buffering nginx si présent
  });
  res.flushHeaders?.();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Envoie l'état actuel à la connexion pour synchroniser le client
  send({ type: 'hello', status: autoSnapshot.status() });

  const unsub = autoSnapshot.subscribe(send);
  const keepalive = setInterval(() => { try { res.write(':keepalive\n\n'); } catch (_) {} }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsub();
    try { res.end(); } catch (_) {}
  });
});

router.get('/dataflow-rows/history', requireConfig, handle(req => {
  const { folder, project, pkg, destination } = req.query;
  if (!folder || !project || !pkg || !destination) {
    throw Object.assign(new Error('folder, project, pkg et destination sont requis'), { status: 400 });
  }
  return ssisService.getDataflowHistory(req.ssisConfig, {
    folder, project, pkg, destination,
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 200)
  });
}));

// DELETE snapshots — nettoyage
router.delete('/tables/snapshots', requireConfig, handle(req => {
  const { database, schema, table } = req.query;
  const filters = ['server_key = ?'];
  const params = [req.ssisConfig.host];
  if (database) { filters.push('database_name = ?'); params.push(database); }
  if (schema)   { filters.push('schema_name = ?');    params.push(schema); }
  if (table)    { filters.push('table_name = ?');     params.push(table); }
  const info = localDb.prepare(`DELETE FROM ssis_table_snapshots WHERE ${filters.join(' AND ')}`).run(...params);
  return { deleted: info.changes };
}));

module.exports = router;
