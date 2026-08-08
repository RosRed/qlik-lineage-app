'use strict';

/**
 * Poller : détecte les nouvelles exécutions SSIS terminées et déclenche un
 * snapshot des row counts de la base cible. Un seul timer global, réinitialisé
 * si la config change.
 *
 * État persistant dans ssis_config : autosnapshot_last_exec_id — évite les
 * doublons entre redémarrages.
 */

const db = require('../database');
const ssisClient = require('../lib/ssisClient');
const ssisService = require('./ssisService');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
let timer = null;
let running = false;
const listeners = new Set(); // subscribers pour la vue "logs" temps réel
const recentEvents = []; // dernières 50 lignes

function log(entry) {
  const e = { ...entry, at: new Date().toISOString() };
  recentEvents.push(e);
  if (recentEvents.length > 50) recentEvents.shift();
  for (const l of listeners) { try { l(e); } catch (_) {} }
  console.log(`[AutoSnapshot] ${e.type}${e.detail ? ` — ${e.detail}` : ''}`);
}

function getState() {
  return db.prepare('SELECT * FROM ssis_config WHERE id = 1').get() || null;
}

function saveLastExecId(id) {
  db.prepare('UPDATE ssis_config SET autosnapshot_last_exec_id = ? WHERE id = 1').run(id);
}

/**
 * Un tour de poll : lit les exécutions terminées depuis le dernier vu, puis
 * déclenche un snapshot par exécution (si la base cible est configurée).
 */
async function tick() {
  if (running) return; // évite les overlaps si un tick prend > 5 min
  const cfg = getState();
  if (!cfg || !cfg.autosnapshot_enabled || !cfg.autosnapshot_database) return;
  running = true;

  try {
    const pool = await ssisClient.getPool(cfg);
    // Statuts terminaux (succès, échec, ended unexpectedly, cancelled, completed)
    const rows = (await pool.request()
      .input('lastId', cfg.autosnapshot_last_exec_id || 0)
      .query(`
        SELECT TOP 20 execution_id, folder_name, project_name, package_name, status, end_time
        FROM SSISDB.catalog.executions
        WHERE execution_id > @lastId
          AND status IN (3, 4, 6, 7, 9)
          AND end_time IS NOT NULL
        ORDER BY execution_id ASC
      `)).recordset;

    if (rows.length === 0) return;

    log({ type: 'tick', detail: `${rows.length} nouvelle(s) exécution(s) détectée(s)` });

    for (const r of rows) {
      const execId = Number(r.execution_id);
      try {
        const res = await ssisService.snapshotDatabase(cfg, cfg.autosnapshot_database, { db });
        saveLastExecId(execId);
        log({
          type: 'snapshot',
          execId,
          package: r.package_name,
          folder: r.folder_name,
          status: r.status,
          tables: res.tables
        });
      } catch (e) {
        log({ type: 'error', execId, error: e.message });
        // on ne coince pas sur une erreur — on avance le curseur pour ne pas boucler
        saveLastExecId(execId);
      }
    }
  } catch (e) {
    log({ type: 'error', error: e.message });
  } finally {
    running = false;
  }
}

function start() {
  stop();
  const cfg = getState();
  if (!cfg?.autosnapshot_enabled) return false;
  log({ type: 'start', detail: `base = ${cfg.autosnapshot_database}, intervalle = ${POLL_INTERVAL_MS / 60000} min` });
  // Premier tick immédiat, puis intervalle
  setImmediate(tick);
  timer = setInterval(tick, POLL_INTERVAL_MS);
  return true;
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function status() {
  const cfg = getState();
  return {
    enabled: !!cfg?.autosnapshot_enabled,
    database: cfg?.autosnapshot_database || null,
    lastExecId: cfg?.autosnapshot_last_exec_id || null,
    running,
    intervalMs: POLL_INTERVAL_MS,
    recentEvents: recentEvents.slice().reverse()
  };
}

function triggerNow() {
  return tick();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { start, stop, status, triggerNow, subscribe };
