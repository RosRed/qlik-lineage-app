'use strict';

/**
 * Snapshots nommés à la demande, granularité (table × société).
 *
 * Cas d'usage : capture avant un run SSIS, capture après, comparaison des deux
 * pour vérifier que le package a bien traité les données. Les snapshots sont
 * indépendants du poller auto-snapshot (grain table).
 *
 * Stratégie de capture :
 *   1. Introspecte INFORMATION_SCHEMA pour identifier les tables ayant
 *      une colonne REF_SOCIETE (breakdown possible).
 *   2. Pour chaque table :
 *      - Avec REF_SOCIETE : SELECT REF_SOCIETE, COUNT(*) FROM ... GROUP BY REF_SOCIETE
 *      - Sans REF_SOCIETE : COUNT(*) global (ref_societe = NULL en base)
 *   3. Insert bulk dans ssis_named_snapshot_rows sous une transaction.
 */

const ssisClient = require('../lib/ssisClient');

const NAME_RE = /^[A-Za-z0-9_\-\. ]+$/;

/** Colonnes des tables user d'une base (schema+table+column). */
async function inspectSchema(cfg, database) {
  if (!NAME_RE.test(database)) {
    throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  }
  const q = `
    USE [${database}];
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA');
  `;
  const pool = await ssisClient.getPool(cfg);
  const res = await pool.request().query(q);
  const byTable = new Map(); // "schema.table" -> Set(columns)
  for (const r of res.recordset) {
    const key = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`;
    if (!byTable.has(key)) byTable.set(key, new Set());
    byTable.get(key).add(r.COLUMN_NAME);
  }
  return byTable;
}

/**
 * Démarre une capture en background. Retourne immédiatement l'id + status.
 * Le vrai travail (potentiellement plusieurs minutes) s'exécute ensuite
 * sans bloquer la requête HTTP. Le client suit la progression via GET /:id.
 */
async function startNamedSnapshot(cfg, { database, label, description, db }) {
  if (!NAME_RE.test(database)) throw Object.assign(new Error('Nom de base invalide'), { status: 400 });
  if (!label || !label.trim()) throw Object.assign(new Error('label requis'), { status: 400 });

  // Introspection en amont — permet de connaître le progress_total dès le POST.
  // Si l'introspection elle-même échoue, on remonte l'erreur au client.
  const schema = await inspectSchema(cfg, database);

  const info = db.prepare(
    "INSERT INTO ssis_named_snapshots (label, description, server_key, database_name, status, progress_total) VALUES (?, ?, ?, ?, 'running', ?)"
  ).run(label.trim(), description || null, cfg.host, database, schema.size);
  const snapshotId = info.lastInsertRowid;

  // Lance le travail sans await — la requête HTTP retourne tout de suite.
  // Toute exception est captée pour mettre à jour le status en 'failed'.
  setImmediate(() => runCaptureInBackground(cfg, snapshotId, database, schema, db));

  return { snapshotId, status: 'running', tableCount: 0, totalRows: 0, progressTotal: schema.size };
}

/** Boucle de travail — un COUNT par table, insert au fil de l'eau. */
async function runCaptureInBackground(cfg, snapshotId, database, schema, db) {
  const t0 = Date.now();
  const insertRow = db.prepare(
    'INSERT INTO ssis_named_snapshot_rows (snapshot_id, schema_name, table_name, ref_societe, row_count) VALUES (?, ?, ?, ?, ?)'
  );
  const updateProgress = db.prepare(
    'UPDATE ssis_named_snapshots SET progress_current = ?, table_count = ?, row_count_total = ? WHERE id = ?'
  );

  let totalRows = 0;
  let tableCount = 0;
  let processed = 0;
  const errors = [];

  try {
    const pool = await ssisClient.getPool(cfg);

    for (const [key, cols] of schema.entries()) {
      const [tSchema, tName] = key.split('.');
      const hasRefSoc = [...cols].some(c => c.toLowerCase() === 'ref_societe');

      try {
        let rows;
        if (hasRefSoc) {
          const q = `
            USE [${database}];
            SELECT REF_SOCIETE AS ref, COUNT_BIG(*) AS n
            FROM [${tSchema}].[${tName}]
            GROUP BY REF_SOCIETE;
          `;
          const res = await pool.request().query(q);
          rows = res.recordset;
        } else {
          const q = `USE [${database}]; SELECT COUNT_BIG(*) AS n FROM [${tSchema}].[${tName}];`;
          const res = await pool.request().query(q);
          rows = res.recordset.map(r => ({ ref: null, n: r.n }));
        }

        db.exec('BEGIN');
        try {
          for (const r of rows) {
            const n = Number(r.n);
            insertRow.run(snapshotId, tSchema, tName, r.ref || null, n);
            totalRows += n;
          }
          db.exec('COMMIT');
          tableCount++;
        } catch (e) {
          try { db.exec('ROLLBACK'); } catch (_) {}
          throw e;
        }
      } catch (e) {
        errors.push({ table: key, error: e.message });
      }

      processed++;
      // Mise à jour progress toutes les 10 tables pour ne pas hammer SQLite
      if (processed % 10 === 0 || processed === schema.size) {
        updateProgress.run(processed, tableCount, totalRows, snapshotId);
      }
    }

    const durationMs = Date.now() - t0;
    const errorSummary = errors.length ? `${errors.length} erreur(s) : ${errors.slice(0, 3).map(e => e.table).join(', ')}${errors.length > 3 ? '…' : ''}` : null;
    db.prepare(`
      UPDATE ssis_named_snapshots
      SET status = 'succeeded', table_count = ?, row_count_total = ?, duration_ms = ?,
          progress_current = ?, error_message = ?
      WHERE id = ?
    `).run(tableCount, totalRows, durationMs, processed, errorSummary, snapshotId);
    console.log(`[NamedSnapshot #${snapshotId}] terminé — ${tableCount}/${schema.size} tables · ${totalRows} rows · ${durationMs}ms`);
  } catch (e) {
    // Erreur fatale (connexion perdue, pool down…) — on marque failed
    console.error(`[NamedSnapshot #${snapshotId}] échec :`, e.message);
    db.prepare(`
      UPDATE ssis_named_snapshots
      SET status = 'failed', error_message = ?, duration_ms = ?
      WHERE id = ?
    `).run(e.message, Date.now() - t0, snapshotId);
  }
}

/** Ancienne API synchrone — gardée pour compatibilité éventuelle. */
async function captureNamedSnapshot(cfg, opts) {
  return startNamedSnapshot(cfg, opts);
}

/** Liste des batches (méta seulement, pas les rows). */
function listSnapshots({ db, serverKey, database }) {
  const filters = [];
  const params = [];
  if (serverKey) { filters.push('server_key = ?'); params.push(serverKey); }
  if (database) { filters.push('database_name = ?'); params.push(database); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, label, description, server_key, database_name, captured_at,
           table_count, row_count_total, duration_ms,
           COALESCE(status, 'succeeded') AS status, error_message,
           progress_current, progress_total
    FROM ssis_named_snapshots
    ${where}
    ORDER BY captured_at DESC
  `).all(...params);
}

/** Status léger d'un snapshot (pour le polling client). */
function getSnapshotStatus({ db, id }) {
  const r = db.prepare(`
    SELECT id, label, COALESCE(status, 'succeeded') AS status,
           progress_current, progress_total,
           table_count, row_count_total, duration_ms, error_message, captured_at
    FROM ssis_named_snapshots WHERE id = ?
  `).get(id);
  if (!r) { const e = new Error('Snapshot non trouvé'); e.status = 404; throw e; }
  return r;
}

/** Détail d'un snapshot avec ses rows (agrégés par table + par société). */
function getSnapshot({ db, id }) {
  const meta = db.prepare('SELECT * FROM ssis_named_snapshots WHERE id = ?').get(id);
  if (!meta) { const e = new Error('Snapshot non trouvé'); e.status = 404; throw e; }
  const rows = db.prepare(`
    SELECT schema_name, table_name, ref_societe, row_count
    FROM ssis_named_snapshot_rows
    WHERE snapshot_id = ?
    ORDER BY schema_name, table_name, ref_societe
  `).all(id);
  return { ...meta, rows };
}

/** Supprime un snapshot (CASCADE supprime aussi ses rows). */
function deleteSnapshot({ db, id }) {
  const info = db.prepare('DELETE FROM ssis_named_snapshots WHERE id = ?').run(id);
  return { deleted: info.changes };
}

/** Wipe complet — snapshots nommés + snapshots par table (grain fin). */
function wipeAllSnapshots({ db }) {
  db.exec('DELETE FROM ssis_named_snapshot_rows;');
  db.exec('DELETE FROM ssis_named_snapshots;');
  const info = db.prepare('DELETE FROM ssis_table_snapshots').run();
  db.exec('VACUUM;');
  return { deletedTableSnapshots: info.changes, deletedNamed: true };
}

/**
 * Compare deux snapshots. Retourne, pour chaque (table, société) présent
 * dans A ou B, les compteurs et le delta. Trié par |delta| décroissant.
 */
function compareSnapshots({ db, aId, bId }) {
  const a = getSnapshot({ db, id: aId });
  const b = getSnapshot({ db, id: bId });

  const key = (r) => `${r.schema_name}|${r.table_name}|${r.ref_societe || ''}`;
  const mapA = new Map(a.rows.map(r => [key(r), r]));
  const mapB = new Map(b.rows.map(r => [key(r), r]));
  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

  const diffs = [];
  for (const k of allKeys) {
    const rA = mapA.get(k);
    const rB = mapB.get(k);
    const countA = rA ? Number(rA.row_count) : null;
    const countB = rB ? Number(rB.row_count) : null;
    const delta = (countA != null && countB != null) ? countB - countA : null;

    let status = 'unchanged';
    if (rA && !rB) status = 'removed';
    else if (!rA && rB) status = 'added';
    else if (delta !== null && delta !== 0) status = delta > 0 ? 'grew' : 'shrunk';

    const [schema, table, refSoc] = k.split('|');
    diffs.push({
      schema,
      table,
      refSociete: refSoc || null,
      countA,
      countB,
      delta,
      deltaPct: (countA && countA > 0 && delta != null) ? delta / countA : null,
      status
    });
  }

  diffs.sort((x, y) => Math.abs(y.delta || 0) - Math.abs(x.delta || 0));

  return {
    a: { id: a.id, label: a.label, captured_at: a.captured_at, table_count: a.table_count, row_count_total: a.row_count_total },
    b: { id: b.id, label: b.label, captured_at: b.captured_at, table_count: b.table_count, row_count_total: b.row_count_total },
    stats: {
      totalChanges: diffs.filter(d => d.status !== 'unchanged').length,
      grew: diffs.filter(d => d.status === 'grew').length,
      shrunk: diffs.filter(d => d.status === 'shrunk').length,
      added: diffs.filter(d => d.status === 'added').length,
      removed: diffs.filter(d => d.status === 'removed').length,
      unchanged: diffs.filter(d => d.status === 'unchanged').length,
      totalRowsA: a.row_count_total,
      totalRowsB: b.row_count_total,
      deltaTotal: b.row_count_total - a.row_count_total
    },
    diffs
  };
}

module.exports = {
  startNamedSnapshot, captureNamedSnapshot,
  listSnapshots, getSnapshot, getSnapshotStatus, deleteSnapshot,
  wipeAllSnapshots, compareSnapshots
};
