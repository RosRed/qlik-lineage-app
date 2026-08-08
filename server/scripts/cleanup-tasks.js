'use strict';

/**
 * Script de nettoyage des tâches "chaîne sans client" — CLI autonome.
 *
 * NE FAIT PAS PARTIE DE L'APP WEB. Aucune modif côté routes/frontend.
 *
 * Règle unique de suppression :
 *   Une tâche est candidate à suppression SI :
 *     - elle est activée (enabled = true)
 *     - elle a un déclencheur schedule ou chain (les MANUELLES sont ignorées)
 *     - aucune tâche de sa chaîne descendante (elle comprise) ne reload
 *       une app dans un stream client
 *
 * Streams considérés comme "clients" : liste ci-dessous (à ajuster si besoin).
 *
 * Modes :
 *   node server/scripts/cleanup-tasks.js               → DRY-RUN (défaut)
 *   node server/scripts/cleanup-tasks.js --execute     → supprime avec confirmation
 *   node server/scripts/cleanup-tasks.js --execute --yes → sans confirmation (à éviter)
 *
 * Options :
 *   --limit=N          → n'agit que sur les N premières tâches à supprimer (test)
 *
 * Sorties : server/scripts/output/cleanup-tasks-*.csv + log horodaté
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.resolve(__dirname, '..', 'data', 'lineage.db');
}

const db = require('../database');
const certClient = require('../lib/qrsClient');
const proxyClient = require('../lib/proxyClient');

// ─── Streams "clients" — synchronisé avec taskService.js ─────────────────────
const CLIENT_STREAMS = new Set([
  'Contrôle de gestion',
  'DAF',
  'Data',
  'Location',
  'Machines',
  'Marketing',
  'Pièces de rechange',
  'SAV'
]);

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k) => {
  const a = args.find(x => x.startsWith(k + '='));
  return a ? a.slice(k.length + 1) : null;
};
const OPTS = {
  execute: has('--execute'),
  yes: has('--yes'),
  limit: val('--limit') ? parseInt(val('--limit'), 10) : null
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────
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
function loadConfig() {
  const cfg = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!cfg) { console.error('❌ Aucune configuration Qlik en base.'); process.exit(1); }
  return cfg;
}
function clientFor(config) {
  const c = config.auth_mode === 'forms' ? proxyClient : certClient;
  return { request: (endpoint, opts = {}) => c.qrsRequest(config, endpoint, opts) };
}

// ─── Construction du plan ────────────────────────────────────────────────────

function buildPlan(tasks, schemas, composites) {
  // Trigger type par tâche
  const scheduledTaskIds = new Set();
  for (const s of schemas || []) if (s.enabled && s.reloadTask?.id) scheduledTaskIds.add(s.reloadTask.id);
  const chainedTaskIds = new Set();
  for (const c of composites || []) if (c.enabled && c.reloadTask?.id) chainedTaskIds.add(c.reloadTask.id);

  // Reconstruction du graphe amont (upstream) → nous permet de calculer les ancêtres
  const upstreamOf = new Map(); // taskId -> [upstreamTaskId]
  for (const c of composites || []) {
    if (!c.reloadTask?.id) continue;
    for (const r of c.compositeRules || []) {
      if (r.reloadTask?.id) {
        if (!upstreamOf.has(c.reloadTask.id)) upstreamOf.set(c.reloadTask.id, []);
        upstreamOf.get(c.reloadTask.id).push(r.reloadTask.id);
      }
    }
  }

  const getAncestors = (id, memo = new Map()) => {
    if (memo.has(id)) return memo.get(id);
    const seen = new Set();
    const q = [...(upstreamOf.get(id) || [])];
    while (q.length) {
      const cur = q.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const u of upstreamOf.get(cur) || []) q.push(u);
    }
    memo.set(id, seen);
    return seen;
  };
  const ancMemo = new Map();

  // feedsClient = tâches qui reloadent une app dans un stream client + tous leurs ancêtres
  const feedsClient = new Set();
  for (const t of tasks || []) {
    const stream = t.app?.stream?.name || null;
    if (stream && CLIENT_STREAMS.has(stream)) {
      feedsClient.add(t.id);
      for (const a of getAncestors(t.id, ancMemo)) feedsClient.add(a);
    }
  }

  // Décisions
  const plan = (tasks || []).map(t => {
    const stream = t.app?.stream?.name || null;
    const appPublished = !!t.app?.published;
    const hasTrigger = scheduledTaskIds.has(t.id) || chainedTaskIds.has(t.id);
    const triggerType = scheduledTaskIds.has(t.id) && chainedTaskIds.has(t.id) ? 'mixte'
      : scheduledTaskIds.has(t.id) ? 'schedule'
      : chainedTaskIds.has(t.id) ? 'chain'
      : 'manual';

    let action = 'keep', reason;
    if (!t.enabled) reason = 'désactivée (ignorée)';
    else if (!hasTrigger) reason = 'manuelle (ignorée)';
    else if (feedsClient.has(t.id)) reason = `chaîne feed un stream client (${stream || 'via descendant'})`;
    else { action = 'delete'; reason = `aucun descendant ne feed un stream client (trigger ${triggerType})`; }

    return {
      taskId: t.id,
      name: t.name,
      enabled: !!t.enabled,
      triggerType,
      appName: t.app?.name || '(app supprimée)',
      appId: t.app?.id || null,
      appPublished,
      stream,
      lastStatus: t.operational?.lastExecutionResult?.status ?? null,
      lastStart: t.operational?.lastExecutionResult?.startTime && !String(t.operational.lastExecutionResult.startTime).startsWith('1753')
        ? t.operational.lastExecutionResult.startTime : null,
      action,
      reason
    };
  });

  return plan;
}

// ─── Rapport CSV ─────────────────────────────────────────────────────────────

function writeCsv(plan, outPath) {
  const headers = ['Action', 'Raison', 'Tâche', 'Trigger', 'Application', 'App publiée', 'Stream',
    'Enabled', 'Dernier statut', 'Dernier run', 'ID Tâche', 'ID App'];
  const rows = plan.map(p => [
    p.action, p.reason, p.name, p.triggerType, p.appName,
    p.appPublished ? 'oui' : 'non', p.stream || '',
    p.enabled ? 'oui' : 'non', p.lastStatus ?? '',
    p.lastStart ? p.lastStart.slice(0, 10) : '',
    p.taskId, p.appId || ''
  ].map(csvEscape).join(','));
  fs.writeFileSync(outPath, '﻿' + [headers.map(csvEscape).join(','), ...rows].join('\n'), 'utf8');
}

function appendLog(logPath, line) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
}

// ─── Suppression ─────────────────────────────────────────────────────────────

async function deleteTasks(client, toDelete, logPath) {
  let ok = 0, ko = 0;
  const total = toDelete.length;
  for (let i = 0; i < total; i++) {
    const t = toDelete[i];
    const prefix = `[${i + 1}/${total}]`;
    try {
      await client.request(`/reloadtask/${t.taskId}`, { method: 'DELETE' });
      ok++;
      const line = `OK   ${prefix} DELETE task ${t.taskId} "${t.name}" (${t.appName})`;
      console.log(line);
      appendLog(logPath, line);
    } catch (e) {
      ko++;
      const line = `FAIL ${prefix} DELETE task ${t.taskId} "${t.name}" — ${e.message}`;
      console.error(line);
      appendLog(logPath, line);
    }
  }
  return { ok, ko };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `cleanup-tasks-${stamp}.csv`);
  const logPath = path.join(outDir, `cleanup-tasks-log-${stamp}.log`);

  const cfg = loadConfig();
  const client = clientFor(cfg);
  console.log(`→ Connexion à ${cfg.host} (mode ${cfg.auth_mode})`);

  console.log('→ Chargement /qrs/reloadtask/full, /qrs/schemaevent/full, /qrs/compositeevent/full...');
  const [tasks, schemas, composites] = await Promise.all([
    client.request('/reloadtask/full'),
    client.request('/schemaevent/full'),
    client.request('/compositeevent/full')
  ]);
  console.log(`  ${tasks.length} tâches, ${schemas.length} schedules, ${composites.length} chaînes.`);

  console.log(`→ Streams clients : ${[...CLIENT_STREAMS].join(', ')}`);
  console.log('→ Construction du plan...');
  const plan = buildPlan(tasks, schemas, composites);

  const toDelete = plan.filter(p => p.action === 'delete');
  const toKeep = plan.filter(p => p.action === 'keep');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total tâches       : ${plan.length}`);
  console.log(`  À conserver        : ${toKeep.length}`);
  console.log(`  À SUPPRIMER        : ${toDelete.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const keepReasons = new Map();
  for (const p of toKeep) keepReasons.set(p.reason, (keepReasons.get(p.reason) || 0) + 1);
  console.log('\n  Détail "à conserver" :');
  for (const [r, n] of [...keepReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(6)}  ${r}`);
  }

  if (toDelete.length) {
    // Top des cibles
    const byTrigger = { schedule: 0, chain: 0, mixte: 0 };
    for (const p of toDelete) byTrigger[p.triggerType] = (byTrigger[p.triggerType] || 0) + 1;
    console.log('\n  Détail "à supprimer" par trigger :');
    for (const [k, v] of Object.entries(byTrigger)) if (v > 0) console.log(`    ${String(v).padStart(6)}  ${k}`);
  }

  writeCsv(plan, csvPath);
  console.log(`\n📄 Plan écrit dans : ${csvPath}`);
  appendLog(logPath, `Plan généré. total=${plan.length} keep=${toKeep.length} delete=${toDelete.length} limit=${OPTS.limit || '(aucun)'}`);

  if (!OPTS.execute) {
    console.log('\n(dry-run) Aucune suppression effectuée. Relancez avec --execute pour supprimer réellement.');
    return;
  }

  if (!toDelete.length) { console.log('\nRien à supprimer.'); return; }

  let deletionList = toDelete;
  if (OPTS.limit && OPTS.limit < toDelete.length) {
    deletionList = toDelete.slice(0, OPTS.limit);
    console.log(`\n⚠️  --limit=${OPTS.limit} : suppression limitée aux ${deletionList.length} premières.`);
  }

  if (!OPTS.yes) {
    console.log(`\n⚠️  MODE EXECUTE — ${deletionList.length} tâches vont être SUPPRIMÉES sur ${cfg.host}.`);
    const answer = await askConfirmation('   Tapez exactement "OUI SUPPRIMER" pour confirmer : ');
    if (answer !== 'OUI SUPPRIMER') { console.log('   → Annulé.'); return; }
  }

  console.log(`\n→ Suppression de ${deletionList.length} tâches...`);
  appendLog(logPath, `Début exécution. ${deletionList.length} tâches à supprimer.`);
  const { ok, ko } = await deleteTasks(client, deletionList, logPath);
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
