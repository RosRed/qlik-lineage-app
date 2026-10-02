'use strict';

/**
 * Requêtes SSISDB — dashboard, exécutions, erreurs.
 * Toutes les requêtes sont paramétrées (mssql.request().input) et restreintes
 * en lecture seule. La fenêtre temporelle est passée en jours (défaut 7).
 *
 * Statuts SSISDB (catalog.executions.status) :
 *   1 created · 2 running · 3 cancelled · 4 failed · 5 pending
 *   6 ended unexpectedly · 7 succeeded · 8 stopping · 9 completed
 */

const ssisClient = require('../lib/ssisClient');

const STATUS_LABELS = {
  1: 'created', 2: 'running', 3: 'cancelled', 4: 'failed',
  5: 'pending', 6: 'ended_unexpectedly', 7: 'succeeded', 8: 'stopping', 9: 'completed'
};

const STATUS_BUCKETS = {
  success: [7, 9],
  failed:  [4, 6],
  running: [2, 5, 8],
  other:   [1, 3]
};

function bucket(status) {
  for (const [k, ids] of Object.entries(STATUS_BUCKETS)) if (ids.includes(status)) return k;
  return 'other';
}

async function getDashboard(cfg, { days = 7 } = {}) {
  const q = `
    DECLARE @since DATETIMEOFFSET = DATEADD(DAY, -@days, SYSDATETIMEOFFSET());

    SELECT status, COUNT(*) AS n,
           AVG(DATEDIFF(SECOND, start_time, end_time)) AS avg_sec,
           MAX(DATEDIFF(SECOND, start_time, end_time)) AS max_sec
    FROM SSISDB.catalog.executions
    WHERE start_time >= @since
    GROUP BY status;

    SELECT TOP 5 folder_name, project_name, package_name, COUNT(*) AS failures
    FROM SSISDB.catalog.executions
    WHERE start_time >= @since AND status IN (4, 6)
    GROUP BY folder_name, project_name, package_name
    ORDER BY failures DESC;

    SELECT CAST(start_time AS DATE) AS day,
           SUM(CASE WHEN status IN (7, 9) THEN 1 ELSE 0 END) AS success,
           SUM(CASE WHEN status IN (4, 6) THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status IN (2, 5, 8) THEN 1 ELSE 0 END) AS running,
           COUNT(*) AS total
    FROM SSISDB.catalog.executions
    WHERE start_time >= @since
    GROUP BY CAST(start_time AS DATE)
    ORDER BY day;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request();
  req.input('days', days);
  const res = await req.query(q);
  const [byStatus, topFailures, perDay] = res.recordsets;

  const stats = { success: 0, failed: 0, running: 0, other: 0, total: 0, avgDurSec: 0 };
  let weighted = 0;
  for (const row of byStatus) {
    stats[bucket(row.status)] += row.n;
    stats.total += row.n;
    if (row.avg_sec) weighted += row.avg_sec * row.n;
  }
  stats.avgDurSec = stats.total > 0 ? Math.round(weighted / stats.total) : 0;
  stats.successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;

  return {
    days,
    stats,
    topFailures,
    perDay: perDay.map(d => ({ ...d, day: d.day.toISOString().slice(0, 10) }))
  };
}

const SORT_MAP = {
  'start_desc':    'start_time DESC',
  'start_asc':     'start_time ASC',
  'duration_desc': 'duration_sec DESC',
  'duration_asc':  'duration_sec ASC',
  'package_asc':   'package_name ASC, start_time DESC'
};

const DURATION_FILTERS = {
  'lt_1m':   'duration_sec < 60',
  '1_10m':   'duration_sec BETWEEN 60 AND 600',
  'gt_10m':  'duration_sec > 600',
  'gt_1h':   'duration_sec > 3600'
};

async function listExecutions(cfg, {
  days = 7, status = null, folder = null, project = null, pkg = null,
  machine = null, duration = null, sort = 'start_desc',
  limit = 100, offset = 0
} = {}) {
  const filters = ['start_time >= DATEADD(DAY, -@days, SYSDATETIMEOFFSET())'];
  if (status) filters.push('status = @status');
  if (folder) filters.push('folder_name = @folder');
  if (project) filters.push('project_name = @project');
  if (pkg) filters.push('package_name LIKE @pkg');
  if (machine) filters.push('machine_name = @machine');

  const where = filters.join(' AND ');
  const orderBy = SORT_MAP[sort] || SORT_MAP.start_desc;
  const durFilter = DURATION_FILTERS[duration];

  const q = `
    WITH e AS (
      SELECT execution_id, folder_name, project_name, package_name,
             start_time, end_time, status, environment_name, executed_as_name, machine_name,
             DATEDIFF(SECOND, start_time, ISNULL(end_time, SYSDATETIMEOFFSET())) AS duration_sec
      FROM SSISDB.catalog.executions
      WHERE ${where}
    )${durFilter ? `\n    , f AS (SELECT * FROM e WHERE ${durFilter})` : ''}
    SELECT COUNT(*) OVER() AS total_count, *
    FROM ${durFilter ? 'f' : 'e'}
    ORDER BY ${orderBy}
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request();
  req.input('days', days).input('limit', limit).input('offset', offset);
  if (status) req.input('status', parseInt(status, 10));
  if (folder) req.input('folder', folder);
  if (project) req.input('project', project);
  if (pkg) req.input('pkg', `%${pkg}%`);
  if (machine) req.input('machine', machine);
  const res = await req.query(q);
  const rows = res.recordset;
  const total = rows.length ? rows[0].total_count : 0;
  return {
    total,
    limit,
    offset,
    rows: rows.map(r => ({
      execution_id: r.execution_id,
      folder: r.folder_name,
      project: r.project_name,
      package: r.package_name,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] || String(r.status),
      bucket: bucket(r.status),
      durationSec: r.duration_sec,
      environment: r.environment_name,
      executedAs: r.executed_as_name,
      machine: r.machine_name
    }))
  };
}

async function getExecutionDetail(cfg, executionId) {
  const q = `
    SELECT execution_id, folder_name, project_name, package_name,
           start_time, end_time, status, environment_name, executed_as_name, machine_name,
           DATEDIFF(SECOND, start_time, ISNULL(end_time, SYSDATETIMEOFFSET())) AS duration_sec
    FROM SSISDB.catalog.executions
    WHERE execution_id = @id;

    SELECT TOP 200 event_message_id, message_time, message_type, message_source_type,
           message_source_name, subcomponent_name, message
    FROM SSISDB.catalog.event_messages
    WHERE operation_id = @id
      AND message_type IN (110, 120, 130)
    ORDER BY message_time DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request().input('id', executionId);
  const res = await req.query(q);
  const [exec] = res.recordsets[0];
  if (!exec) { const err = new Error('Exécution non trouvée'); err.status = 404; throw err; }
  return {
    execution: {
      execution_id: exec.execution_id,
      folder: exec.folder_name,
      project: exec.project_name,
      package: exec.package_name,
      startTime: exec.start_time,
      endTime: exec.end_time,
      status: exec.status,
      statusLabel: STATUS_LABELS[exec.status] || String(exec.status),
      bucket: bucket(exec.status),
      durationSec: exec.duration_sec,
      environment: exec.environment_name,
      executedAs: exec.executed_as_name,
      machine: exec.machine_name
    },
    messages: res.recordsets[1].map(m => ({
      id: m.event_message_id,
      time: m.message_time,
      type: m.message_type,
      typeLabel: m.message_type === 120 ? 'error' : m.message_type === 130 ? 'task_failed' : 'warning',
      source: m.message_source_name,
      subcomponent: m.subcomponent_name,
      message: m.message
    }))
  };
}

async function listErrors(cfg, { days = 7, limit = 200 } = {}) {
  const q = `
    SELECT TOP (@limit)
           em.event_message_id, em.operation_id AS execution_id,
           em.message_time, em.message_type,
           em.message_source_name, em.subcomponent_name, em.message,
           e.folder_name, e.project_name, e.package_name
    FROM SSISDB.catalog.event_messages em
    LEFT JOIN SSISDB.catalog.executions e ON e.execution_id = em.operation_id
    WHERE em.message_time >= DATEADD(DAY, -@days, SYSDATETIMEOFFSET())
      AND em.message_type IN (120, 130)
    ORDER BY em.message_time DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request()
    .input('days', days)
    .input('limit', limit)
    .query(q);

  const rows = res.recordset.map(r => ({
    id: r.event_message_id,
    executionId: r.execution_id,
    time: r.message_time,
    type: r.message_type,
    typeLabel: r.message_type === 130 ? 'task_failed' : 'error',
    folder: r.folder_name,
    project: r.project_name,
    package: r.package_name,
    source: r.message_source_name,
    subcomponent: r.subcomponent_name,
    message: r.message
  }));

  const grouped = {};
  for (const r of rows) {
    const key = `${r.folder}/${r.project}/${r.package}`;
    if (!grouped[key]) grouped[key] = { folder: r.folder, project: r.project, package: r.package, count: 0, lastError: null, items: [] };
    grouped[key].count++;
    if (!grouped[key].lastError || r.time > grouped[key].lastError) grouped[key].lastError = r.time;
    if (grouped[key].items.length < 5) grouped[key].items.push(r);
  }
  const groups = Object.values(grouped).sort((a, b) => b.count - a.count);
  return { rows, groups };
}

async function listFolders(cfg) {
  const q = `
    SELECT DISTINCT folder_name, project_name
    FROM SSISDB.catalog.executions
    WHERE start_time >= DATEADD(DAY, -30, SYSDATETIMEOFFSET())
    ORDER BY folder_name, project_name;

    SELECT DISTINCT machine_name
    FROM SSISDB.catalog.executions
    WHERE start_time >= DATEADD(DAY, -30, SYSDATETIMEOFFSET())
      AND machine_name IS NOT NULL
    ORDER BY machine_name;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  const [fp, mac] = res.recordsets;
  const byFolder = {};
  for (const r of fp) {
    if (!byFolder[r.folder_name]) byFolder[r.folder_name] = new Set();
    byFolder[r.folder_name].add(r.project_name);
  }
  return {
    folders: Object.entries(byFolder).map(([folder, projects]) => ({
      folder,
      projects: [...projects].sort()
    })),
    machines: mac.map(m => m.machine_name)
  };
}

// ─── Vague 3 : Row counts & deltas ────────────────────────────────────────

async function listDatabases(cfg) {
  const q = `
    SELECT name
    FROM sys.databases
    WHERE database_id > 4  -- exclut master/tempdb/model/msdb
      AND state = 0        -- online seulement
      AND name NOT IN ('SSISDB')
    ORDER BY name;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  return res.recordset.map(r => r.name);
}

/**
 * Liste les tables d'une base avec leur row count actuel (approximatif mais
 * O(1) via sys.dm_db_partition_stats). Filtre : SCHEMA/table_name optionnel.
 */
async function listTables(cfg, { database, search = null }) {
  if (!database) throw Object.assign(new Error('Database requis'), { status: 400 });
  // Injection : le nom de base ne peut pas être paramétré dans un USE, donc on
  // valide qu'il ne contient que des caractères sûrs.
  if (!/^[A-Za-z0-9_\-\. ]+$/.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  const q = `
    USE [${database}];
    SELECT SCHEMA_NAME(t.schema_id) AS schema_name,
           t.name AS table_name,
           COALESCE(SUM(p.row_count), 0) AS row_count,
           t.create_date, t.modify_date
    FROM sys.tables t
    LEFT JOIN sys.dm_db_partition_stats p
      ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    ${search ? "WHERE t.name LIKE @search OR SCHEMA_NAME(t.schema_id) LIKE @search" : ''}
    GROUP BY SCHEMA_NAME(t.schema_id), t.name, t.create_date, t.modify_date
    ORDER BY row_count DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request();
  if (search) req.input('search', `%${search}%`);
  const res = await req.query(q);
  return res.recordset.map(r => ({
    schema: r.schema_name,
    name: r.table_name,
    rowCount: Number(r.row_count),
    createdAt: r.create_date,
    modifiedAt: r.modify_date
  }));
}

/**
 * Capture un snapshot des row counts pour toutes les tables d'une base et
 * l'enregistre dans ssis_table_snapshots. Retourne le nombre de tables snapshotées.
 */
async function snapshotDatabase(cfg, database, { db }) {
  const tables = await listTables(cfg, { database });
  const serverKey = cfg.host;
  const insert = db.prepare(
    'INSERT INTO ssis_table_snapshots (server_key, database_name, schema_name, table_name, row_count) VALUES (?, ?, ?, ?, ?)'
  );
  // node:sqlite (DatabaseSync) n'expose pas .transaction() — BEGIN/COMMIT manuel.
  db.exec('BEGIN');
  try {
    for (const t of tables) insert.run(serverKey, database, t.schema, t.name, t.rowCount);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
  return { database, host: serverKey, tables: tables.length, at: new Date().toISOString() };
}

/**
 * État par table : row count actuel + delta vs dernier snapshot + timestamp
 * du dernier snapshot. Les tables sans historique apparaissent avec delta = null.
 */
async function getTableStatus(cfg, { database, db }) {
  const current = await listTables(cfg, { database });
  const serverKey = cfg.host;

  // Un seul aller-retour SQLite : on récupère le dernier row_count et la date
  // pour toutes les tables de cette base sur ce serveur.
  const lastRows = db.prepare(`
    SELECT s.schema_name, s.table_name, s.row_count, s.captured_at
    FROM ssis_table_snapshots s
    INNER JOIN (
      SELECT server_key, database_name, schema_name, table_name, MAX(id) AS max_id
      FROM ssis_table_snapshots
      WHERE server_key = ? AND database_name = ?
      GROUP BY server_key, database_name, schema_name, table_name
    ) m ON m.max_id = s.id
  `).all(serverKey, database);

  const lastMap = new Map();
  for (const r of lastRows) lastMap.set(`${r.schema_name}|${r.table_name}`, r);

  // Compte total de snapshots par table + delta moyen (variation moyenne
  // absolue entre snapshots successifs)
  const histRows = db.prepare(`
    SELECT schema_name, table_name, COUNT(*) AS n, MIN(captured_at) AS first_at
    FROM ssis_table_snapshots
    WHERE server_key = ? AND database_name = ?
    GROUP BY schema_name, table_name
  `).all(serverKey, database);
  const histMap = new Map();
  for (const r of histRows) histMap.set(`${r.schema_name}|${r.table_name}`, r);

  return current.map(t => {
    const key = `${t.schema}|${t.name}`;
    const last = lastMap.get(key);
    const hist = histMap.get(key);
    const lastCount = last ? Number(last.row_count) : null;
    return {
      schema: t.schema,
      name: t.name,
      rowCount: t.rowCount,
      lastSnapshotAt: last ? last.captured_at : null,
      lastSnapshotRowCount: lastCount,
      delta: lastCount !== null ? t.rowCount - lastCount : null,
      snapshotCount: hist ? hist.n : 0,
      firstSnapshotAt: hist ? hist.first_at : null,
      createdAt: t.createdAt,
      modifiedAt: t.modifiedAt
    };
  });
}

/**
 * Historique complet d'une table donnée : tous les snapshots chronologiques,
 * avec le delta calculé entre chaque paire consécutive.
 */
function getTableHistory({ db, serverKey, database, schema, table, limit = 100 }) {
  const rows = db.prepare(`
    SELECT id, row_count, captured_at
    FROM ssis_table_snapshots
    WHERE server_key = ? AND database_name = ? AND schema_name = ? AND table_name = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(serverKey, database, schema, table, limit);
  const chronological = rows.slice().reverse();
  const withDelta = chronological.map((r, i) => ({
    id: r.id,
    rowCount: Number(r.row_count),
    capturedAt: r.captured_at,
    delta: i > 0 ? Number(r.row_count) - Number(chronological[i - 1].row_count) : null
  }));
  return withDelta;
}

// ─── Vague 3 bis : Rows par dataflow (SSISDB execution_data_statistics) ────

/**
 * Résumé par (package, destination) : dernier rows_sent, précédent, moyenne
 * sur la fenêtre, delta vs préc., delta vs moyenne. Une seule requête agrégée.
 *
 * Prérequis : niveau de logging du package ≥ Basic (défaut à l'exécution).
 * Sinon execution_data_statistics est vide pour ces runs.
 */
async function getDataflowRows(cfg, { days = 30, folder = null, project = null, pkg = null } = {}) {
  const filters = ['e.start_time >= DATEADD(DAY, -@days, SYSDATETIMEOFFSET())'];
  if (folder)  filters.push('e.folder_name = @folder');
  if (project) filters.push('e.project_name = @project');
  if (pkg)     filters.push('e.package_name LIKE @pkg');
  const where = filters.join(' AND ');

  // Une CTE numérote les runs récent→ancien par (package, destination) pour
  // pouvoir isoler N (dernier) et N-1 (précédent) sans faire deux TOP 1.
  const q = `
    WITH runs AS (
      SELECT e.folder_name, e.project_name, e.package_name,
             s.destination_component_name AS destination,
             s.rows_sent, s.created_time, e.execution_id, e.status,
             ROW_NUMBER() OVER (
               PARTITION BY e.folder_name, e.project_name, e.package_name, s.destination_component_name
               ORDER BY s.created_time DESC
             ) AS rn
      FROM SSISDB.catalog.execution_data_statistics s
      INNER JOIN SSISDB.catalog.executions e ON e.execution_id = s.execution_id
      WHERE ${where}
        AND s.rows_sent IS NOT NULL
    ),
    agg AS (
      SELECT folder_name, project_name, package_name, destination,
             COUNT(*) AS run_count,
             AVG(CAST(rows_sent AS BIGINT)) AS avg_rows,
             MAX(CAST(rows_sent AS BIGINT)) AS max_rows,
             MIN(CAST(rows_sent AS BIGINT)) AS min_rows
      FROM runs
      GROUP BY folder_name, project_name, package_name, destination
    )
    SELECT a.folder_name AS folder, a.project_name AS project, a.package_name AS package,
           a.destination, a.run_count, a.avg_rows, a.max_rows, a.min_rows,
           r1.rows_sent AS last_rows, r1.created_time AS last_at, r1.execution_id AS last_execution_id, r1.status AS last_status,
           r2.rows_sent AS prev_rows, r2.created_time AS prev_at
    FROM agg a
    LEFT JOIN runs r1
      ON r1.folder_name = a.folder_name AND r1.project_name = a.project_name
     AND r1.package_name = a.package_name AND r1.destination = a.destination AND r1.rn = 1
    LEFT JOIN runs r2
      ON r2.folder_name = a.folder_name AND r2.project_name = a.project_name
     AND r2.package_name = a.package_name AND r2.destination = a.destination AND r2.rn = 2
    ORDER BY ABS(ISNULL(r1.rows_sent - r2.rows_sent, 0)) DESC, r1.created_time DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request().input('days', days);
  if (folder)  req.input('folder', folder);
  if (project) req.input('project', project);
  if (pkg)     req.input('pkg', `%${pkg}%`);
  const res = await req.query(q);
  return res.recordset.map(r => {
    const last = r.last_rows != null ? Number(r.last_rows) : null;
    const prev = r.prev_rows != null ? Number(r.prev_rows) : null;
    const avg = r.avg_rows != null ? Number(r.avg_rows) : null;
    return {
      folder: r.folder,
      project: r.project,
      package: r.package,
      destination: r.destination,
      runCount: r.run_count,
      lastRows: last,
      prevRows: prev,
      avgRows: avg,
      maxRows: r.max_rows != null ? Number(r.max_rows) : null,
      minRows: r.min_rows != null ? Number(r.min_rows) : null,
      delta: last != null && prev != null ? last - prev : null,
      deltaVsAvg: last != null && avg != null ? last - Math.round(avg) : null,
      lastAt: r.last_at,
      prevAt: r.prev_at,
      lastExecutionId: r.last_execution_id,
      lastStatus: r.last_status
    };
  });
}

/** Diagnostic — pourquoi la vue dataflow-rows serait vide ? Perms ou logging ? */
async function diagnoseDataflowAccess(cfg) {
  // IS_ROLEMEMBER(role) sans 2e paramètre = check le rôle pour l'utilisateur
  // COURANT dans la base COURANTE. Il faut donc USE SSISDB avant.
  const q = `
    USE SSISDB;
    SELECT
      (SELECT COUNT(*) FROM SSISDB.catalog.execution_data_statistics) AS total_stats,
      (SELECT COUNT(*) FROM SSISDB.catalog.executions
       WHERE start_time >= DATEADD(DAY, -30, SYSDATETIMEOFFSET())) AS recent_execs,
      SUSER_SNAME() AS caller_login,
      USER_NAME() AS db_user,
      IS_ROLEMEMBER('ssis_admin') AS is_ssis_admin,
      IS_ROLEMEMBER('ssis_logreader') AS is_ssis_logreader,
      IS_SRVROLEMEMBER('sysadmin') AS is_sysadmin;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  const r = res.recordset[0];
  return {
    totalStats: Number(r.total_stats),
    recentExecutions: Number(r.recent_execs),
    callerLogin: r.caller_login,
    dbUser: r.db_user,
    isSsisAdmin: r.is_ssis_admin === 1,
    isSsisLogreader: r.is_ssis_logreader === 1,
    isSysadmin: r.is_sysadmin === 1
  };
}

/** Répartition des niveaux de logging sur les 100 dernières exécutions. */
async function getLoggingLevels(cfg) {
  const q = `
    -- logging_level : 0 = None, 1 = Basic (défaut), 2 = Performance, 3 = Verbose, 4 = Runtime
    SELECT
      COALESCE(v.value_int, e.logging_level) AS logging_level,
      COUNT(*) AS n,
      MAX(e.start_time) AS last_at,
      COUNT(DISTINCT e.package_name) AS packages
    FROM (
      SELECT TOP 100 execution_id, package_name, start_time,
             (SELECT TOP 1 CAST(parameter_value AS INT)
              FROM SSISDB.catalog.execution_parameter_values epv
              WHERE epv.execution_id = ep.execution_id AND epv.parameter_name = 'LOGGING_LEVEL') AS logging_level
      FROM SSISDB.catalog.executions ep
      ORDER BY start_time DESC
    ) e
    LEFT JOIN (SELECT 0 AS k, 0 AS value_int) v ON 1 = 0
    GROUP BY COALESCE(v.value_int, e.logging_level)
    ORDER BY n DESC;
  `;
  try {
    const pool = await ssisClient.getPool(cfg);
    const res = await pool.request().query(q);
    const LABELS = { 0: 'None', 1: 'Basic', 2: 'Performance', 3: 'Verbose', 4: 'Runtime' };
    return res.recordset.map(r => ({
      level: r.logging_level,
      label: LABELS[r.logging_level] || `Level ${r.logging_level}`,
      count: Number(r.n),
      packages: Number(r.packages),
      lastAt: r.last_at
    }));
  } catch (e) {
    return { error: e.message };
  }
}

/** Historique complet d'un (package, destination) : chronologie des rows_sent. */
async function getDataflowHistory(cfg, { folder, project, pkg, destination, limit = 50 }) {
  const q = `
    SELECT TOP (@limit) s.rows_sent, s.created_time, e.execution_id, e.status
    FROM SSISDB.catalog.execution_data_statistics s
    INNER JOIN SSISDB.catalog.executions e ON e.execution_id = s.execution_id
    WHERE e.folder_name = @folder AND e.project_name = @project
      AND e.package_name = @package AND s.destination_component_name = @destination
      AND s.rows_sent IS NOT NULL
    ORDER BY s.created_time DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request()
    .input('folder', folder).input('project', project).input('package', pkg)
    .input('destination', destination).input('limit', limit)
    .query(q);
  const rows = res.recordset.slice().reverse(); // chronologique
  return rows.map((r, i) => ({
    executionId: r.execution_id,
    status: r.status,
    rowsSent: Number(r.rows_sent),
    createdAt: r.created_time,
    delta: i > 0 ? Number(r.rows_sent) - Number(rows[i - 1].rows_sent) : null
  }));
}

// ─── TABLE_UPDATE_LOG (client-owned) ──────────────────────────────────────

/** Retourne les colonnes des tables TABLE_UPDATE_LOG et SOCIETE (introspection). */
async function inspectUpdateLog(cfg, database) {
  if (!/^[A-Za-z0-9_\-\. ]+$/.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  const q = `
    USE [${database}];
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ('TABLE_UPDATE_LOG', 'SOCIETE')
    ORDER BY TABLE_NAME, ORDINAL_POSITION;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  const byTable = {};
  for (const r of res.recordset) {
    if (!byTable[r.TABLE_NAME]) byTable[r.TABLE_NAME] = [];
    byTable[r.TABLE_NAME].push({
      schema: r.TABLE_SCHEMA,
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === 'YES'
    });
  }
  return byTable;
}

/**
 * Lit TABLE_UPDATE_LOG avec jointure best-effort sur SOCIETE via `ref_societe`.
 * Applique les filtres days / societe / search sur les colonnes détectées.
 * Le SELECT est un `SELECT *` pour éviter l'hypothèse sur les noms de colonnes.
 */
async function readUpdateLog(cfg, { database, days = 7, ref_societe = null, search = null, limit = 500 } = {}) {
  const schema = await inspectUpdateLog(cfg, database);
  const cols = schema['TABLE_UPDATE_LOG'] || [];
  if (cols.length === 0) throw Object.assign(new Error('Table TABLE_UPDATE_LOG introuvable'), { status: 404 });

  const colNames = cols.map(c => c.name.toLowerCase());
  const has = (name) => colNames.includes(name.toLowerCase());

  // Détection auto des colonnes usuelles
  const dateCol =
    cols.find(c => /^(update|date|created|inserted)_?(date|time|at)?$/i.test(c.name))?.name
    || cols.find(c => c.type.match(/date|time/i))?.name;
  const refSocCol = has('ref_societe') ? 'ref_societe' : (cols.find(c => /soc/i.test(c.name))?.name);
  const tableCol =
    cols.find(c => /^(table|table_name|target_table|nom_table)$/i.test(c.name))?.name
    || cols.find(c => /table/i.test(c.name))?.name;
  const rowsCol =
    cols.find(c => /^(nb_?rows|row_count|rows|nb_lignes|lignes)$/i.test(c.name))?.name
    || cols.find(c => /rows|lignes|count/i.test(c.name) && !/table/i.test(c.name))?.name;

  // Jointure SOCIETE si possible
  const societeCols = schema['SOCIETE'] || [];
  const socRefCol = societeCols.find(c => c.name.toLowerCase() === 'ref_societe')?.name;
  const socNameCol = societeCols.find(c => /nom|name|libelle|denomination/i.test(c.name))?.name;
  const canJoinSoc = !!(refSocCol && socRefCol);

  const filters = [];
  if (dateCol && days) filters.push(`t.[${dateCol}] >= DATEADD(DAY, -@days, GETDATE())`);
  if (ref_societe && refSocCol) filters.push(`t.[${refSocCol}] = @refSoc`);
  if (search && tableCol) filters.push(`t.[${tableCol}] LIKE @search`);

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = dateCol ? `ORDER BY t.[${dateCol}] DESC` : '';

  const q = `
    USE [${database}];
    SELECT TOP (@limit) t.*
    ${canJoinSoc && socNameCol ? `, s.[${socNameCol}] AS __societe_name` : ''}
    FROM TABLE_UPDATE_LOG t
    ${canJoinSoc ? `LEFT JOIN SOCIETE s ON s.[${socRefCol}] = t.[${refSocCol}]` : ''}
    ${where}
    ${orderBy};
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request().input('limit', limit);
  if (dateCol && days) req.input('days', days);
  if (ref_societe && refSocCol) req.input('refSoc', ref_societe);
  if (search && tableCol) req.input('search', `%${search}%`);
  const res = await req.query(q);

  return {
    columns: cols,
    detected: { dateCol, refSocCol, tableCol, rowsCol, canJoinSoc, socNameCol },
    rows: res.recordset
  };
}

/**
 * Résumé par (table, société) : dernier COUNT, précédent, moyenne, écart-type,
 * delta vs préc et delta vs moyenne. Calcule un score d'anomalie côté JS.
 *
 * Anomalies détectées :
 *   - "collapsed" : dernier COUNT = 0 alors que précédent > 0
 *   - "big_drop"  : chute > 50% vs précédent
 *   - "big_jump"  : hausse > 200% vs précédent
 *   - "z_score"   : |last - avg| / std > 2 (aberration statistique)
 *   - "stalled"   : COUNT identique aux N dernières exécutions
 *
 * `baseline` (optionnel, 'YYYY-MM-DD') change la référence de comparaison :
 *   - absent  → le "précédent" est l'exécution qui précède immédiatement la
 *               dernière (comportement historique)
 *   - présent → le "précédent" est le dernier chargement enregistré AVANT la
 *               fin de cette journée, pour chaque couple (table, société).
 *               La recherche n'est pas bornée par `days` : une table rechargée
 *               hier peut ainsi être comparée à son état d'il y a six mois.
 *               La dernière exécution elle-même est toujours exclue de la
 *               référence (b.TIMESTAMP < r1.captured_at), sinon choisir la date
 *               du jour comparerait la ligne à elle-même.
 */
async function getUpdateLogSummary(cfg, { database, days = 30, ref_societe = null, baseline = null } = {}) {
  if (!/^[A-Za-z0-9_\-\. ]+$/.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  if (baseline && !/^\d{4}-\d{2}-\d{2}$/.test(baseline)) {
    throw Object.assign(new Error('Date de comparaison invalide (format attendu : AAAA-MM-JJ)'), { status: 400 });
  }
  const q = `
    USE [${database}];
    WITH ranked AS (
      SELECT TABLE_NAME, REF_SOCIETE, [COUNT] AS row_count, [TIMESTAMP] AS captured_at,
             ROW_NUMBER() OVER (PARTITION BY TABLE_NAME, REF_SOCIETE ORDER BY [TIMESTAMP] DESC) AS rn,
             CAST(AVG(CAST([COUNT] AS FLOAT)) OVER (PARTITION BY TABLE_NAME, REF_SOCIETE) AS BIGINT) AS avg_count,
             CAST(STDEV(CAST([COUNT] AS FLOAT)) OVER (PARTITION BY TABLE_NAME, REF_SOCIETE) AS FLOAT) AS std_count,
             CAST(MAX([COUNT]) OVER (PARTITION BY TABLE_NAME, REF_SOCIETE) AS BIGINT) AS max_count,
             CAST(MIN([COUNT]) OVER (PARTITION BY TABLE_NAME, REF_SOCIETE) AS BIGINT) AS min_count,
             CAST(COUNT(*) OVER (PARTITION BY TABLE_NAME, REF_SOCIETE) AS INT) AS run_count
      FROM TABLE_UPDATE_LOG
      WHERE [TIMESTAMP] >= DATEADD(DAY, -@days, GETDATE())
        ${ref_societe ? 'AND REF_SOCIETE = @refSoc' : ''}
    )
    SELECT r1.TABLE_NAME AS table_name, r1.REF_SOCIETE AS ref_societe,
           r1.row_count AS last_count, r1.captured_at AS last_at,
           r2.row_count AS prev_count, r2.captured_at AS prev_at,
           r1.avg_count, r1.std_count, r1.max_count, r1.min_count, r1.run_count,
           s.LIBELLE_SOCIETE AS societe_name
    FROM ranked r1
    ${baseline
      ? `OUTER APPLY (
          SELECT TOP 1 b.[COUNT] AS row_count, b.[TIMESTAMP] AS captured_at
          FROM TABLE_UPDATE_LOG b
          WHERE b.TABLE_NAME = r1.TABLE_NAME
            AND b.REF_SOCIETE = r1.REF_SOCIETE
            AND b.[TIMESTAMP] < DATEADD(DAY, 1, CAST(@baseline AS DATE))
            AND b.[TIMESTAMP] < r1.captured_at
          ORDER BY b.[TIMESTAMP] DESC
        ) r2`
      : 'LEFT JOIN ranked r2 ON r2.TABLE_NAME = r1.TABLE_NAME AND r2.REF_SOCIETE = r1.REF_SOCIETE AND r2.rn = 2'}
    LEFT JOIN SOCIETE s ON s.REF_SOCIETE = r1.REF_SOCIETE
    WHERE r1.rn = 1
    ORDER BY r1.TABLE_NAME, s.LIBELLE_SOCIETE;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request().input('days', days);
  if (ref_societe) req.input('refSoc', ref_societe);
  if (baseline) req.input('baseline', baseline);
  const res = await req.query(q);

  return res.recordset.map(r => {
    const last = Number(r.last_count);
    const prev = r.prev_count != null ? Number(r.prev_count) : null;
    const avg = r.avg_count != null ? Number(r.avg_count) : null;
    const std = r.std_count != null ? Number(r.std_count) : null;
    const delta = prev != null ? last - prev : null;
    const deltaPct = prev && prev > 0 ? delta / prev : null;
    const deltaVsAvg = avg != null ? last - avg : null;
    const zScore = std && std > 0 ? (last - avg) / std : null;

    const anomalies = [];
    if (prev != null && prev > 0 && last === 0) anomalies.push('collapsed');
    else if (deltaPct != null && deltaPct <= -0.5) anomalies.push('big_drop');
    else if (deltaPct != null && deltaPct >= 2.0) anomalies.push('big_jump');
    if (zScore != null && Math.abs(zScore) > 2 && r.run_count >= 3) anomalies.push('z_score');
    if (r.run_count >= 3 && std != null && std === 0 && last === prev) anomalies.push('stalled');

    // Sévérité globale
    let severity = 'ok';
    if (anomalies.includes('collapsed')) severity = 'critical';
    else if (anomalies.includes('big_drop') || anomalies.includes('big_jump')) severity = 'warning';
    else if (anomalies.length > 0) severity = 'info';

    return {
      table: r.table_name,
      refSociete: r.ref_societe,
      societeName: r.societe_name ? String(r.societe_name).trim() : null,
      lastCount: last,
      prevCount: prev,
      lastAt: r.last_at,
      prevAt: r.prev_at,
      avgCount: avg,
      stdCount: std,
      maxCount: r.max_count != null ? Number(r.max_count) : null,
      minCount: r.min_count != null ? Number(r.min_count) : null,
      runCount: r.run_count,
      delta,
      deltaPct,
      deltaVsAvg,
      zScore,
      anomalies,
      severity
    };
  });
}

/**
 * Regroupe les rechargements par proximité temporelle : deux lignes consécutives
 * (pour la même société) espacées de moins de gapMinutes appartiennent au même run.
 * Retourne un run = { société, plage horaire, tables incluses, total rows, anomalies }.
 */
async function getUpdateLogRuns(cfg, { database, days = 7, ref_societe = null, gapMinutes = 10 } = {}) {
  if (!/^[A-Za-z0-9_\-\. ]+$/.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  const q = `
    USE [${database}];
    WITH ordered AS (
      SELECT ID, TABLE_NAME, REF_SOCIETE, [COUNT] AS row_count, [TIMESTAMP] AS ts,
             LAG([TIMESTAMP]) OVER (PARTITION BY REF_SOCIETE ORDER BY [TIMESTAMP]) AS prev_ts
      FROM TABLE_UPDATE_LOG
      WHERE [TIMESTAMP] >= DATEADD(DAY, -@days, GETDATE())
        ${ref_societe ? 'AND REF_SOCIETE = @refSoc' : ''}
    ),
    marked AS (
      SELECT *, CASE WHEN prev_ts IS NULL OR DATEDIFF(MINUTE, prev_ts, ts) > @gap THEN 1 ELSE 0 END AS is_new_run
      FROM ordered
    ),
    grouped AS (
      SELECT *, SUM(is_new_run) OVER (PARTITION BY REF_SOCIETE ORDER BY ts ROWS UNBOUNDED PRECEDING) AS run_id
      FROM marked
    )
    SELECT g.REF_SOCIETE AS ref_societe, g.run_id,
           MIN(g.ts) AS started_at,
           MAX(g.ts) AS ended_at,
           COUNT(*) AS table_count,
           CAST(SUM(g.row_count) AS BIGINT) AS total_rows,
           s.LIBELLE_SOCIETE AS societe_name,
           -- On concatène les noms de tables pour lister (limité à 30 pour éviter la sur-charge)
           STUFF((
             SELECT ', ' + t2.TABLE_NAME + ':' + CAST(t2.row_count AS VARCHAR(20))
             FROM grouped t2
             WHERE t2.REF_SOCIETE = g.REF_SOCIETE AND t2.run_id = g.run_id
             ORDER BY t2.ts
             OFFSET 0 ROWS FETCH NEXT 30 ROWS ONLY
             FOR XML PATH(''), TYPE
           ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS tables_summary
    FROM grouped g
    LEFT JOIN SOCIETE s ON s.REF_SOCIETE = g.REF_SOCIETE
    GROUP BY g.REF_SOCIETE, g.run_id, s.LIBELLE_SOCIETE
    ORDER BY MIN(g.ts) DESC;
  `;
  const pool = await ssisClient.getPool(cfg);
  const req = pool.request().input('days', days).input('gap', gapMinutes);
  if (ref_societe) req.input('refSoc', ref_societe);
  const res = await req.query(q);

  return res.recordset.map(r => ({
    runId: `${r.ref_societe}-${r.run_id}`,
    refSociete: r.ref_societe,
    societeName: r.societe_name ? String(r.societe_name).trim() : null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMinutes: r.started_at && r.ended_at ? Math.round((new Date(r.ended_at) - new Date(r.started_at)) / 60000) : 0,
    tableCount: r.table_count,
    totalRows: Number(r.total_rows || 0),
    tablesSummary: r.tables_summary || ''
  }));
}

/** Liste des sociétés (pour dropdown filtre). */
async function listSocietes(cfg, database) {
  if (!/^[A-Za-z0-9_\-\. ]+$/.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  const schema = await inspectUpdateLog(cfg, database);
  const soc = schema['SOCIETE'];
  if (!soc || soc.length === 0) return [];
  const refCol = soc.find(c => c.name.toLowerCase() === 'ref_societe')?.name;
  const nameCol = soc.find(c => /nom|name|libelle|denomination/i.test(c.name))?.name;
  if (!refCol) return [];
  const q = `
    USE [${database}];
    SELECT [${refCol}] AS ref, ${nameCol ? `[${nameCol}]` : `[${refCol}]`} AS name
    FROM SOCIETE
    ORDER BY name;
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  return res.recordset;
}

module.exports = {
  getDashboard, listExecutions, getExecutionDetail, listErrors, listFolders,
  listDatabases, listTables, snapshotDatabase, getTableStatus, getTableHistory,
  getDataflowRows, getDataflowHistory, diagnoseDataflowAccess, getLoggingLevels,
  inspectUpdateLog, readUpdateLog, listSocietes, getUpdateLogSummary, getUpdateLogRuns,
  STATUS_LABELS
};
