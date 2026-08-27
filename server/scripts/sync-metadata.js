#!/usr/bin/env node
'use strict';

/**
 * Sync one-shot des métadonnées apps depuis Qlik Sense.
 *
 * Aligne le local avec l'état actuel du serveur POUR LES CHAMPS DE MÉTADONNÉES
 * UNIQUEMENT (stream, name, published, owner, last_reload, description, tags,
 * file_size…) — sans re-fetcher le script ni ré-analyser. Ne touche pas les
 * apps `deleted_at IS NOT NULL` (corbeille).
 *
 * Usage :
 *   cd /opt/qlik-lineage/server
 *   DATABASE_PATH=/opt/qlik-lineage/data/lineage.db node scripts/sync-metadata.js
 *
 * Options :
 *   --dry              n'écrit rien, affiche juste ce qui changerait
 *   --field=stream     ne synchronise que ce champ (défaut: tous)
 */

const db = require('../database');

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const fieldArg = args.find(a => a.startsWith('--field='));
  const onlyField = fieldArg ? fieldArg.slice(8) : null;

  const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!config) {
    console.error('❌ Aucune configuration Qlik enregistrée.');
    process.exit(1);
  }

  const clientMod = config.auth_mode === 'forms'
    ? require('../lib/proxyClient')
    : require('../lib/qrsClient');
  const client = clientMod;

  console.log('→ récupération de la liste des apps depuis Qlik…');
  const serverApps = await client.listApps(config);
  const byServerId = new Map(serverApps.map(a => [a.qlikAppId, a]));
  console.log(`  ${serverApps.length} apps côté serveur`);

  const localRows = db.prepare(`
    SELECT id, qlik_app_id, name, stream, published, owner, last_reload,
           file_size, created_date, modified_date, publish_time, description, tags, custom_properties
    FROM apps
    WHERE qlik_app_id IS NOT NULL AND deleted_at IS NULL
  `).all();
  console.log(`  ${localRows.length} apps locales (hors corbeille)`);

  const norm = (v) => (v === undefined ? null : v);
  const differs = (a, b) => norm(a) !== norm(b);

  const changes = [];
  for (const local of localRows) {
    const s = byServerId.get(local.qlik_app_id);
    if (!s) continue; // couvert par le diff /sync (disparue → corbeille)

    const proposed = {
      name: s.name,
      stream: s.stream || null,
      published: s.published ? 1 : 0,
      owner: s.owner || null,
      last_reload: s.lastReloadTime || null,
      file_size: s.fileSize ?? null,
      created_date: s.createdDate || null,
      modified_date: s.modifiedDate || null,
      publish_time: s.publishTime || null,
      description: s.description || null,
      tags: Array.isArray(s.tags) && s.tags.length ? s.tags.join('|') : null,
      custom_properties: Array.isArray(s.customProperties) && s.customProperties.length
        ? JSON.stringify(s.customProperties) : null
    };

    const diff = {};
    for (const [k, v] of Object.entries(proposed)) {
      if (onlyField && k !== onlyField) continue;
      if (differs(local[k], v)) diff[k] = { from: local[k], to: v };
    }
    if (Object.keys(diff).length) {
      changes.push({ id: local.id, name: local.name, diff, proposed });
    }
  }

  if (changes.length === 0) {
    console.log('✅ tout est déjà aligné, rien à faire');
    return;
  }

  console.log(`\n=== ${changes.length} app(s) à mettre à jour ===`);
  const fieldCounts = {};
  for (const c of changes) {
    for (const f of Object.keys(c.diff)) {
      fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    }
  }
  console.log('champs impactés :');
  for (const [f, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  • ${f}: ${n}`);
  }

  console.log('\nexemples (10 premiers) :');
  for (const c of changes.slice(0, 10)) {
    console.log(`  • [${c.id}] ${c.name}`);
    for (const [k, v] of Object.entries(c.diff)) {
      const from = v.from === null || v.from === undefined ? '(null)' : String(v.from).slice(0, 50);
      const to = v.to === null || v.to === undefined ? '(null)' : String(v.to).slice(0, 50);
      console.log(`      ${k}: ${from}  →  ${to}`);
    }
  }

  if (dry) {
    console.log('\n(dry run) rien écrit — relancez sans --dry pour appliquer');
    return;
  }

  console.log('\n→ application des changements…');
  const stmt = db.prepare(`
    UPDATE apps SET
      name = ?, stream = ?, published = ?, owner = ?, last_reload = ?,
      file_size = ?, created_date = ?, modified_date = ?, publish_time = ?,
      description = ?, tags = ?, custom_properties = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  db.exec('BEGIN');
  try {
    for (const c of changes) {
      const p = c.proposed;
      stmt.run(
        p.name, p.stream, p.published, p.owner, p.last_reload,
        p.file_size, p.created_date, p.modified_date, p.publish_time,
        p.description, p.tags, p.custom_properties,
        c.id
      );
    }
    db.exec('COMMIT');
    console.log(`✅ ${changes.length} apps mises à jour`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('❌ échec, transaction annulée :', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('❌ erreur :', e.message);
  process.exit(1);
});
