'use strict';

/**
 * Synchronisation Qlik ↔ base locale.
 *
 * Objectif : suivre l'état réel du serveur Qlik sans forcer l'utilisateur à
 * "tout supprimer + tout ré-importer". Compare la liste des apps du serveur
 * avec les apps déjà présentes en local (par `qlik_app_id`) et produit un plan
 * de trois catégories :
 *   - `newApps`      : côté serveur uniquement → à importer
 *   - `deletedApps`  : côté local uniquement (importée un jour) → soft delete
 *   - `updatedApps`  : présentes des deux côtés mais `last_reload` a changé
 *                       depuis le dernier import → à ré-analyser (flag `stale`)
 * Les apps `deleted_at IS NOT NULL` sont exclues de la comparaison — elles
 * restent "corbeille" jusqu'à réactivation manuelle ou re-création côté serveur.
 */

const db = require('../database');

/**
 * Calcule le diff sans rien modifier.
 * @param {Array} serverApps  résultat de `listApps` (déjà normalisé)
 * @returns {{newApps: Array, deletedApps: Array, updatedApps: Array, unchanged: number}}
 */
function computeDiff(serverApps) {
  const byServerId = new Map(serverApps.map(a => [a.qlikAppId, a]));
  // Apps locales importées (avec qlik_app_id), qu'elles soient déjà en corbeille ou non
  const localRows = db.prepare(`
    SELECT id, qlik_app_id, name, stream, published, owner, last_reload,
           last_synced_reload, stale, deleted_at
    FROM apps
    WHERE qlik_app_id IS NOT NULL
  `).all();
  const byLocalId = new Map(localRows.map(r => [r.qlik_app_id, r]));

  const newApps = [];
  const deletedApps = [];
  const updatedApps = [];
  let unchanged = 0;

  for (const s of serverApps) {
    const local = byLocalId.get(s.qlikAppId);
    if (!local) {
      newApps.push({
        qlikAppId: s.qlikAppId,
        name: s.name,
        stream: s.stream || null,
        published: !!s.published,
        owner: s.owner || null,
        lastReloadTime: s.lastReloadTime || null,
        fileSize: s.fileSize ?? null,
        createdDate: s.createdDate || null,
        modifiedDate: s.modifiedDate || null,
        publishTime: s.publishTime || null,
        description: s.description || null,
        tags: s.tags || null,
        customProperties: s.customProperties || null
      });
      continue;
    }
    if (local.deleted_at) {
      // Réactivation : présent en corbeille + réapparu côté serveur
      newApps.push({
        qlikAppId: s.qlikAppId,
        name: s.name,
        stream: s.stream || null,
        published: !!s.published,
        owner: s.owner || null,
        lastReloadTime: s.lastReloadTime || null,
        fileSize: s.fileSize ?? null,
        createdDate: s.createdDate || null,
        modifiedDate: s.modifiedDate || null,
        publishTime: s.publishTime || null,
        description: s.description || null,
        tags: s.tags || null,
        customProperties: s.customProperties || null,
        reactivate: true,
        localId: local.id
      });
      continue;
    }
    // Comparaison last_reload : si serveur > référence locale = modifiée
    const serverReload = s.lastReloadTime || null;
    const reference = local.last_synced_reload || local.last_reload || null;
    if (serverReload && serverReload !== reference) {
      updatedApps.push({
        localId: local.id,
        qlikAppId: s.qlikAppId,
        name: s.name,
        stream: s.stream || local.stream,
        previousReload: reference,
        currentReload: serverReload
      });
    } else {
      unchanged++;
    }
  }

  for (const local of localRows) {
    if (local.deleted_at) continue; // déjà en corbeille, on ignore
    if (!byServerId.has(local.qlik_app_id)) {
      deletedApps.push({
        localId: local.id,
        qlikAppId: local.qlik_app_id,
        name: local.name,
        stream: local.stream || null,
        lastReload: local.last_reload || null
      });
    }
  }

  return { newApps, deletedApps, updatedApps, unchanged };
}

/**
 * Applique le plan de sync :
 *   - `applyNew`      : apps du diff à effectivement importer (l'appelant importe ensuite)
 *   - `applyDeleted`  : ids locaux à marquer `deleted_at = NOW()`
 *   - `applyUpdated`  : ids locaux à flagger `stale = 1`
 * L'import réel des nouvelles apps est délégué au flow d'import existant ;
 * cette fonction ne fait QUE les mutations DB idempotentes (delete + stale).
 */
function applyPlan({ deletedLocalIds = [], updatedLocalIds = [], reactivateLocalIds = [] } = {}) {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    if (deletedLocalIds.length) {
      const stmt = db.prepare('UPDATE apps SET deleted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL');
      for (const id of deletedLocalIds) stmt.run(now, id);
    }
    if (updatedLocalIds.length) {
      const stmt = db.prepare('UPDATE apps SET stale = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const id of updatedLocalIds) stmt.run(id);
    }
    if (reactivateLocalIds.length) {
      const stmt = db.prepare('UPDATE apps SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const id of reactivateLocalIds) stmt.run(id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {
    deleted: deletedLocalIds.length,
    marked_stale: updatedLocalIds.length,
    reactivated: reactivateLocalIds.length
  };
}

/** Restaure une app en corbeille (annule le soft delete). */
function restoreApp(localId) {
  const info = db.prepare('UPDATE apps SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(localId);
  return info.changes > 0;
}

/** Purge définitive d'une app en corbeille. */
function purgeApp(localId) {
  const row = db.prepare('SELECT id FROM apps WHERE id = ? AND deleted_at IS NOT NULL').get(localId);
  if (!row) return false;
  db.prepare('DELETE FROM apps WHERE id = ?').run(localId);
  return true;
}

/** Marque une app comme "à jour" (utilisé après ré-analyse). */
function clearStale(localId, lastReload) {
  db.prepare('UPDATE apps SET stale = 0, last_synced_reload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(lastReload || null, localId);
}

module.exports = { computeDiff, applyPlan, restoreApp, purgeApp, clearStale };
