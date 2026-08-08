'use strict';

/**
 * Client SSISDB — connexion SQL Server en lecture seule pour lire les métadonnées
 * d'exécution des packages (catalog.executions, catalog.event_messages, etc.).
 * Un pool de connexion par empreinte de config, réutilisé jusqu'à changement.
 */

const sql = require('mssql');

const pools = new Map();

function fingerprint(cfg) {
  return [cfg.host, cfg.port || 1433, cfg.database || 'SSISDB', cfg.username || '(win)', cfg.encrypt ? 1 : 0].join('|');
}

function buildConfig(cfg) {
  return {
    server: cfg.host,
    port: cfg.port || 1433,
    database: cfg.database || 'SSISDB',
    user: cfg.username || undefined,
    password: cfg.password || undefined,
    options: {
      encrypt: !!cfg.encrypt,
      trustServerCertificate: !!cfg.trust_server_certificate,
      enableArithAbort: true
    },
    connectionTimeout: 15000,
    requestTimeout: 90000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 60000 }
  };
}

async function getPool(cfg) {
  const key = fingerprint(cfg);
  const existing = pools.get(key);
  if (existing && existing.connected) return existing;
  if (existing) { try { await existing.close(); } catch (_) {} }
  const pool = new sql.ConnectionPool(buildConfig(cfg));
  await pool.connect();
  pools.set(key, pool);
  return pool;
}

async function closeAllPools() {
  for (const [k, p] of pools) {
    try { await p.close(); } catch (_) {}
    pools.delete(k);
  }
}

/** Test de connexion + version SQL Server + présence de SSISDB */
async function testConnection(cfg) {
  const pool = await getPool(cfg);
  const versionRes = await pool.request().query('SELECT @@VERSION AS version, DB_NAME() AS current_db');
  const ssisRes = await pool.request().query(`
    SELECT COUNT(*) AS n
    FROM sys.databases
    WHERE name = 'SSISDB'
  `);
  return {
    ok: true,
    version: versionRes.recordset[0].version,
    currentDb: versionRes.recordset[0].current_db,
    hasSsisDb: ssisRes.recordset[0].n > 0
  };
}

async function query(cfg, sqlText, params = {}) {
  const pool = await getPool(cfg);
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) req.input(k, v);
  const res = await req.query(sqlText);
  return res.recordset;
}

module.exports = { getPool, closeAllPools, testConnection, query, sql };
