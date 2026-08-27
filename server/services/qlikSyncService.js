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
 * NE COMPARE QUE LES APPS PUBLIÉES : les brouillons (non publiés) côté Qlik
 * sont ignorés — ni proposés à l'import, ni comptés comme "à jour". Une app
 * locale déjà importée qui a été dépubliée côté Qlik apparaît en "disparue".
 * @param {Array} serverApps  résultat de `listApps` (déjà normalisé)
 * @returns {{newApps: Array, deletedApps: Array, updatedApps: Array, unchanged: number}}
 */
function computeDiff(serverAppsRaw) {
  const serverApps = (serverAppsRaw || []).filter(a => !!a.published);
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
  const metaChangedApps = [];
  let unchanged = 0;

  const differs = (a, b) => (a === undefined ? null : a) !== (b === undefined ? null : b);

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
    const reloadChanged = serverReload && serverReload !== reference;
    if (reloadChanged) {
      updatedApps.push({
        localId: local.id,
        qlikAppId: s.qlikAppId,
        name: s.name,
        stream: s.stream || local.stream,
        previousReload: reference,
        currentReload: serverReload
      });
    }

    // Comparaison métadonnées (stream, name, owner) — indépendant du reload
    const metaChanges = {};
    if (differs(local.name, s.name)) metaChanges.name = { from: local.name, to: s.name };
    if (differs(local.stream, s.stream || null)) metaChanges.stream = { from: local.stream, to: s.stream || null };
    if (differs(local.owner, s.owner || null)) metaChanges.owner = { from: local.owner, to: s.owner || null };
    if (Object.keys(metaChanges).length) {
      metaChangedApps.push({
        localId: local.id,
        qlikAppId: s.qlikAppId,
        name: local.name,
        changes: metaChanges,
        proposed: {
          name: s.name,
          stream: s.stream || null,
          owner: s.owner || null
        }
      });
    } else if (!reloadChanged) {
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

  return { newApps, deletedApps, updatedApps, metaChangedApps, unchanged };
}

/**
 * Applique le plan de sync :
 *   - `applyNew`      : apps du diff à effectivement importer (l'appelant importe ensuite)
 *   - `applyDeleted`  : ids locaux à marquer `deleted_at = NOW()`
 *   - `applyUpdated`  : ids locaux à flagger `stale = 1`
 * L'import réel des nouvelles apps est délégué au flow d'import existant ;
 * cette fonction ne fait QUE les mutations DB idempotentes (delete + stale).
 */
function applyPlan({ deletedLocalIds = [], updatedLocalIds = [], reactivateLocalIds = [], metaChanges = [] } = {}) {
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
    if (metaChanges.length) {
      const stmt = db.prepare(
        'UPDATE apps SET name = ?, stream = ?, owner = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      for (const m of metaChanges) {
        const p = m.proposed || {};
        stmt.run(p.name || null, p.stream || null, p.owner || null, m.localId);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {
    deleted: deletedLocalIds.length,
    marked_stale: updatedLocalIds.length,
    reactivated: reactivateLocalIds.length,
    meta_refreshed: metaChanges.length
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
