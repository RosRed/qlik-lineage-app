'use strict';

/**
 * Script de nettoyage chirurgical des apps Qlik Sense — CLI autonome.
 *
 * NE FAIT PAS PARTIE DE L'APP WEB. Ne modifie ni /routes/ ni le frontend.
 * Réutilise uniquement `qrsRequest` (lecture + suppression) et la config Qlik en base.
 *
 * Règles de rétention :
 *   1. On NE supprime JAMAIS une app publiée.
 *   2. On NE supprime JAMAIS une app avec une tâche de reload ACTIVE ET DÉCLENCHÉE
 *      (schedule ou chain). Les tâches purement MANUELLES (sans schemaevent ni
 *      compositeevent) ne protègent PAS l'app — elle rejoint le pool des copies.
 *   3. Pour toutes les autres (non publiées + sans tâche schedule/chain active) :
 *        - Grouper par (propriétaire, famille d'app, année de createdDate)
 *        - Famille = nom du parent publié probable, sinon nom normalisé
 *        - Dans chaque groupe : garder la plus ancienne + la plus récente de l'année,
 *          supprimer tout ce qui est entre les deux (les "versions intermédiaires").
 *
 * Modes :
 *   node server/scripts/cleanup-apps.js               → DRY-RUN (défaut) : produit un CSV, ne supprime rien.
 *   node server/scripts/cleanup-apps.js --execute     → Supprime réellement, avec confirmation tapée "OUI".
 *   node server/scripts/cleanup-apps.js --execute --yes → Supprime sans confirmation (à éviter).
 *
 * Options :
 *   --owner=DIR\user   → limite le nettoyage à un seul propriétaire
 *   --limit=N          → n'agit que sur les N premières apps à supprimer (utile pour un essai)
 *
 * Sorties : dans server/scripts/output/ (CSV + log).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Résout la base SQLite indépendamment du CWD (server/data/lineage.db)
if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.resolve(__dirname, '..', 'data', 'lineage.db');
}

const db = require('../database');
const certClient = require('../lib/qrsClient');
const proxyClient = require('../lib/proxyClient');

// ─── Arguments CLI ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (key) => {
  const a = args.find(x => x.startsWith(key + '='));
  return a ? a.slice(key.length + 1) : null;
};
const OPTS = {
  execute: has('--execute'),
  yes: has('--yes'),
  owner: val('--owner'),
  limit: val('--limit') ? parseInt(val('--limit'), 10) : null
};

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function normalizeAppName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/^(copy of|copie de)\s+/i, '')
    .replace(/\s*[-_]\s*(v\d+|copie|copy|old|backup|bak|test)\s*$/i, '')
    .trim();
}

function findProbableParent(app, normName, publishedByNormName, publishedList) {
  if (app.published || !normName) return null;
  const exact = publishedByNormName.get(normName);
  if (exact && exact.length > 0) {
    const copyCreated = Date.parse(app.createdDate) || Infinity;
    const sorted = [...exact].sort((a, b) => (Date.parse(a.createdDate) || 0) - (Date.parse(b.createdDate) || 0));
    const best = sorted.find(p => (Date.parse(p.createdDate) || 0) <= copyCreated) || sorted[0];
    return { name: best.name, matchMethod: 'exact_normalized' };
  }
  if (normName.length < 10) return null;
  for (const p of publishedList) {
    const shorter = p.normName.length <= normName.length ? p.normName : normName;
    const longer = shorter === p.normName ? normName : p.normName;
    if (shorter.length >= 10 && longer.includes(shorter)) {
      return { name: p.name, matchMethod: 'substring' };
    }
  }
  return null;
}

function csvEscape(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function askConfirmation(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function ownerKey(a) {
  return a.owner ? `${a.owner.userDirectory}\\${a.owner.userId}` : '__no_owner__';
}

// ─── Chargement config ────────────────────────────────────────────────────────

function loadConfig() {
  const cfg = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!cfg) {
    console.error('❌ Aucune configuration Qlik en base. Configurez la connexion via l\'app web d\'abord.');
    process.exit(1);
  }
  return cfg;
}

/** Sélectionne le client selon le mode ; expose une signature { method, body } uniforme */
function clientFor(config) {
  const c = config.auth_mode === 'forms' ? proxyClient : certClient;
  return {
    request: (endpoint, opts = {}) => c.qrsRequest(config, endpoint, opts)
  };
}

// ─── Construction du plan ────────────────────────────────────────────────────

function buildPlan(apps, tasks, schemas, composites) {
  // Index parents publiés (pour détection famille)
  const publishedByNormName = new Map();
  const publishedList = [];
  for (const a of apps) {
    if (!a.published) continue;
    const n = normalizeAppName(a.name);
    if (!publishedByNormName.has(n)) publishedByNormName.set(n, []);
    publishedByNormName.get(n).push({ name: a.name, createdDate: a.createdDate });
    publishedList.push({ name: a.name, normName: n });
  }

  // Ensembles des taskIds ayant un déclencheur schedule ou chain ACTIF
  const scheduledTaskIds = new Set();
  for (const s of schemas || []) {
    if (s.enabled && s.reloadTask?.id) scheduledTaskIds.add(s.reloadTask.id);
  }
  const chainedTaskIds = new Set();
  for (const c of composites || []) {
    if (c.enabled && c.reloadTask?.id) chainedTaskIds.add(c.reloadTask.id);
  }

  // Set des appIds protégés = task enabled ET (schedule OU chain enabled)
  // Une tâche purement MANUELLE (sans schemaevent/compositeevent actif) NE protège PAS l'app.
  const enabledTaskAppIds = new Set();
  for (const t of tasks || []) {
    if (!t.enabled || !t.app?.id) continue;
    if (scheduledTaskIds.has(t.id) || chainedTaskIds.has(t.id)) {
      enabledTaskAppIds.add(t.app.id);
    }
  }

  // Décision pour chaque app
  const enriched = apps.map(a => {
    const normName = normalizeAppName(a.name);
    const parent = findProbableParent(a, normName, publishedByNormName, publishedList);
    const familyKey = parent?.name ? parent.name.toLowerCase() : normName;
    const year = a.createdDate ? new Date(a.createdDate).getFullYear() : null;
    return {
      qlikAppId: a.id,
      name: a.name,
      owner: ownerKey(a),
      published: !!a.published,
      hasEnabledTask: enabledTaskAppIds.has(a.id),
      stream: a.stream ? a.stream.name : null,
      fileSizeMb: a.fileSize ? Math.round(a.fileSize / (1024 * 1024)) : null,
      createdDate: a.createdDate || null,
      modifiedDate: a.modifiedDate || null,
      lastReload: a.lastReloadTime || null,
      familyKey,
      familyName: parent?.name || normName || '(sans famille)',
      year
    };
  });

  // Décisions rapides pour les protégées
  const decisions = new Map(); // qlikAppId -> { action, reason }
  const candidates = []; // apps eligibles au groupement

  for (const e of enriched) {
    if (e.published) {
      decisions.set(e.qlikAppId, { action: 'keep', reason: 'publiée' });
    } else if (e.hasEnabledTask) {
      decisions.set(e.qlikAppId, { action: 'keep', reason: 'tâche schedule/chain active attachée' });
    } else if (e.year == null) {
      decisions.set(e.qlikAppId, { action: 'keep', reason: 'createdDate absente (sécurité)' });
    } else {
      candidates.push(e);
    }
  }

  // Filtre optionnel --owner
  const filteredCandidates = OPTS.owner
    ? candidates.filter(e => e.owner === OPTS.owner)
    : candidates;

  // Les candidates hors filtre --owner sont keep (n'entrent pas dans le scope demandé)
  if (OPTS.owner) {
    for (const e of candidates) {
      if (e.owner !== OPTS.owner) {
        decisions.set(e.qlikAppId, { action: 'keep', reason: `hors périmètre --owner=${OPTS.owner}` });
      }
    }
  }

  // Groupement (owner, familyKey, year) et décision
  const groups = new Map();
  for (const e of filteredCandidates) {
    const key = `${e.owner}||${e.familyKey}||${e.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  for (const [key, group] of groups) {
    group.sort((a, b) => new Date(a.createdDate) - new Date(b.createdDate));
    if (group.length <= 2) {
      for (const e of group) decisions.set(e.qlikAppId, { action: 'keep', reason: `groupe ≤ 2 (owner+famille+année)` });
    } else {
      const first = group[0], last = group[group.length - 1];
      decisions.set(first.qlikAppId, { action: 'keep', reason: 'plus ancienne de l\'année (extrême)' });
      decisions.set(last.qlikAppId, { action: 'keep', reason: 'plus récente de l\'année (extrême)' });
      for (let i = 1; i < group.length - 1; i++) {
        decisions.set(group[i].qlikAppId, {
          action: 'delete',
          reason: `intermédiaire ${i}/${group.length - 2} du groupe ${group[0].familyName} — ${group[0].year} (${group.length} versions)`
        });
      }
    }
  }

  // Fusion
  return enriched.map(e => ({ ...e, ...(decisions.get(e.qlikAppId) || { action: 'keep', reason: 'défaut' }) }));
}

// ─── Rapport CSV ──────────────────────────────────────────────────────────────

function writeCsv(plan, outPath) {
  const headers = ['Action', 'Raison', 'Application', 'Publiée', 'Owner', 'Famille', 'Année création',
    'Créée le', 'Modifiée le', 'Dernier reload', 'Tâche active', 'Stream', 'Taille (Mo)', 'ID Qlik'];
  const rows = plan.map(p => [
    p.action, p.reason, p.name, p.published ? 'oui' : 'non', p.owner, p.familyName, p.year ?? '',
    p.createdDate ? p.createdDate.slice(0, 10) : '',
    p.modifiedDate ? p.modifiedDate.slice(0, 10) : '',
    p.lastReload ? p.lastReload.slice(0, 10) : '',
    p.hasEnabledTask ? 'oui' : 'non',
    p.stream || '', p.fileSizeMb ?? '', p.qlikAppId
  ].map(csvEscape).join(','));
  const csv = [headers.map(csvEscape).join(','), ...rows].join('\n');
  fs.writeFileSync(outPath, '﻿' + csv, 'utf8');
}

function appendLog(logPath, line) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
}

// ─── Suppression ──────────────────────────────────────────────────────────────

async function deleteApps(client, toDelete, logPath) {
  let ok = 0, ko = 0;
  const total = toDelete.length;
  for (let i = 0; i < total; i++) {
    const a = toDelete[i];
    const prefix = `[${i + 1}/${total}]`;
    try {
      await client.request(`/app/${a.qlikAppId}`, { method: 'DELETE' });
      ok++;
      const line = `OK   ${prefix} DELETE ${a.qlikAppId} "${a.name}" (${a.familyName} — ${a.year})`;
      console.log(line);
      appendLog(logPath, line);
    } catch (e) {
      ko++;
      const line = `FAIL ${prefix} DELETE ${a.qlikAppId} "${a.name}" — ${e.message}`;
      console.error(line);
      appendLog(logPath, line);
    }
  }
  return { ok, ko };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `cleanup-plan-${stamp}.csv`);
  const logPath = path.join(outDir, `cleanup-log-${stamp}.log`);

  const cfg = loadConfig();
  const client = clientFor(cfg);
  console.log(`→ Connexion à ${cfg.host} (mode ${cfg.auth_mode})`);
  console.log('→ Chargement des apps (/qrs/app/full)...');
  const apps = await client.request('/app/full');
  console.log(`  ${apps.length} apps.`);
  console.log('→ Chargement des tâches + déclencheurs (/qrs/reloadtask, /schemaevent, /compositeevent)...');
  const [tasks, schemas, composites] = await Promise.all([
    client.request('/reloadtask/full'),
    client.request('/schemaevent/full'),
    client.request('/compositeevent/full')
  ]);
  const scheduledIds = new Set((schemas || []).filter(s => s.enabled && s.reloadTask?.id).map(s => s.reloadTask.id));
  const chainedIds   = new Set((composites || []).filter(c => c.enabled && c.reloadTask?.id).map(c => c.reloadTask.id));
  const nonManualActive = (tasks || []).filter(t => t.enabled && (scheduledIds.has(t.id) || chainedIds.has(t.id))).length;
  console.log(`  ${tasks.length} tâches (${tasks.filter(t => t.enabled).length} actives, dont ${nonManualActive} avec schedule/chain — les tâches purement MANUELLES ne protègent pas).`);

  console.log('→ Construction du plan de nettoyage...');
  const plan = buildPlan(apps, tasks, schemas, composites);

  const toDelete = plan.filter(p => p.action === 'delete');
  const toKeep = plan.filter(p => p.action === 'keep');

  const bytesFreed = toDelete.reduce((s, p) => s + (p.fileSizeMb || 0), 0);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total apps analysées : ${plan.length}`);
  console.log(`  À conserver          : ${toKeep.length}`);
  console.log(`  À SUPPRIMER          : ${toDelete.length}  (~${bytesFreed} Mo libérables)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Répartition raisons "keep"
  const keepReasons = new Map();
  for (const p of toKeep) keepReasons.set(p.reason, (keepReasons.get(p.reason) || 0) + 1);
  console.log('\n  Détail "à conserver" :');
  for (const [r, n] of [...keepReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(6)}  ${r}`);
  }

  writeCsv(plan, csvPath);
  console.log(`\n📄 Plan écrit dans : ${csvPath}`);

  // Écriture d'un résumé initial dans le log
  appendLog(logPath, `Plan généré. total=${plan.length} keep=${toKeep.length} delete=${toDelete.length} owner=${OPTS.owner || '(tous)'} limit=${OPTS.limit || '(aucun)'}`);

  if (!OPTS.execute) {
    console.log('\n(dry-run) Aucune suppression effectuée. Relancez avec --execute pour supprimer réellement.');
    return;
  }

  if (toDelete.length === 0) {
    console.log('\nRien à supprimer.');
    return;
  }

  let deletionList = toDelete;
  if (OPTS.limit && OPTS.limit < toDelete.length) {
    deletionList = toDelete.slice(0, OPTS.limit);
    console.log(`\n⚠️  --limit=${OPTS.limit} : suppression limitée aux ${deletionList.length} premières apps de la liste.`);
  }

  if (!OPTS.yes) {
    console.log(`\n⚠️  MODE EXECUTE — ${deletionList.length} apps vont être SUPPRIMÉES DE MANIÈRE IRRÉVERSIBLE depuis ${cfg.host}.`);
    console.log(`   (Vous supposez que l'infra Qlik dispose d'un backup.)`);
    const answer = await askConfirmation('   Tapez exactement "OUI SUPPRIMER" pour confirmer : ');
    if (answer !== 'OUI SUPPRIMER') {
      console.log('   → Annulé (confirmation non valide).');
      return;
    }
  }

  console.log(`\n→ Suppression de ${deletionList.length} apps...`);
  appendLog(logPath, `Début exécution. ${deletionList.length} apps à supprimer.`);
  const { ok, ko } = await deleteApps(client, deletionList, logPath);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Supprimées : ${ok}`);
  console.log(`  Échecs     : ${ko}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n📄 Log détaillé : ${logPath}`);
  appendLog(logPath, `Fin exécution. ok=${ok} ko=${ko}`);
}

main().catch(e => {
  console.error('❌ Erreur fatale :', e.message);
  console.error(e.stack);
  process.exit(1);
});
