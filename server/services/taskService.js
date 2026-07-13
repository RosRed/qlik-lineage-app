'use strict';

/**
 * Analyse des tâches de reload et de leur planification (QRS) :
 *   - récupère reloadtask + schemaevent (planifications) + compositeevent (chaînages)
 *   - croise avec le lineage global local pour détecter :
 *       tâches désactivées, en échec, jamais exécutées, sans déclencheur,
 *       tâches dont l'app génère des QVD que personne ne consomme (chaîne morte),
 *       QVD générés par les apps de plusieurs tâches (doublons de production).
 */

const { buildGlobalLineage } = require('./globalLineage');
const certQrs = require('../lib/qrsClient').qrsRequest;
const proxyQrs = require('../lib/proxyClient').qrsRequest;

function qrsFor(config) {
  return config.auth_mode === 'forms' ? proxyQrs : certQrs;
}

const EXEC_STATUS = {
  0: { code: 'never', label: 'Jamais lancée' },
  1: { code: 'triggered', label: 'Déclenchée' },
  2: { code: 'running', label: 'En cours' },
  3: { code: 'queued', label: 'En file' },
  4: { code: 'aborting', label: 'Abandon demandé' },
  5: { code: 'aborting', label: 'Abandon en cours' },
  6: { code: 'aborted', label: 'Abandonnée' },
  7: { code: 'success', label: 'Succès' },
  8: { code: 'fail', label: 'Échec' },
  9: { code: 'skipped', label: 'Ignorée' },
  10: { code: 'retry', label: 'Nouvelle tentative' },
  11: { code: 'error', label: 'Erreur' },
  12: { code: 'reset', label: 'Réinitialisée' }
};

/** Récupère toutes les tâches de reload avec leurs déclencheurs */
async function fetchTasks(config) {
  const qrs = qrsFor(config);
  const [tasks, schemas, composites] = await Promise.all([
    qrs(config, '/reloadtask/full'),
    qrs(config, '/schemaevent/full'),
    qrs(config, '/compositeevent/full')
  ]);

  // Déclencheurs par tâche
  const triggersByTask = new Map();
  const addTrigger = (taskId, trigger) => {
    if (!taskId) return;
    if (!triggersByTask.has(taskId)) triggersByTask.set(taskId, []);
    triggersByTask.get(taskId).push(trigger);
  };

  for (const s of schemas || []) {
    addTrigger(s.reloadTask?.id, {
      type: 'schedule',
      name: s.name,
      enabled: s.enabled,
      startDate: s.startDate || null,
      expiration: s.expirationDate && !String(s.expirationDate).startsWith('9999') ? s.expirationDate : null
    });
  }
  for (const c of composites || []) {
    addTrigger(c.reloadTask?.id, {
      type: 'chain',
      name: c.name,
      enabled: c.enabled,
      after: (c.compositeRules || []).map(r => r.reloadTask?.name).filter(Boolean)
    });
  }

  return (tasks || []).map(t => {
    const exec = t.operational?.lastExecutionResult || null;
    const status = EXEC_STATUS[exec?.status ?? 0] || EXEC_STATUS[0];
    return {
      taskId: t.id,
      name: t.name,
      enabled: !!t.enabled,
      qlikAppId: t.app?.id || null,
      appName: t.app?.name || '(app supprimée)',
      stream: t.app?.stream?.name || null,
      appPublished: !!t.app?.published,
      lastStatus: status.code,
      lastStatusLabel: status.label,
      lastStart: exec?.startTime && !String(exec.startTime).startsWith('1753') ? exec.startTime : null,
      lastStop: exec?.stopTime && !String(exec.stopTime).startsWith('1753') ? exec.stopTime : null,
      durationMs: exec?.duration || null,
      nextExecution: t.operational?.nextExecution && !String(t.operational.nextExecution).startsWith('1753')
        ? t.operational.nextExecution : null,
      triggers: triggersByTask.get(t.id) || []
    };
  });
}

/** Croisement tâches × lineage global → diagnostics de nettoyage */
async function analyzeTasks(config) {
  const tasks = await fetchTasks(config);
  const lineage = buildGlobalLineage();

  // Index des apps locales analysées par id Qlik
  const localByQlikId = new Map(
    lineage.apps.filter(a => a.qlikAppId && a.analyzed).map(a => [a.qlikAppId, a])
  );
  const orphanSet = new Set(lineage.orphans.map(q => q.name));

  const now = Date.now();
  const STALE_DAYS = 30;

  for (const t of tasks) {
    const local = t.qlikAppId ? localByQlikId.get(t.qlikAppId) : null;
    t.imported = !!local;
    t.producedQvds = local ? local.producedQvds : [];
    t.consumedQvds = local ? local.consumedQvds : [];
    t.appRole = local ? local.role : null;

    // Diagnostics unitaires
    const problems = [];
    if (!t.enabled) problems.push('desactivee');
    if (t.lastStatus === 'never') problems.push('jamais_executee');
    if (['fail', 'error', 'aborted'].includes(t.lastStatus)) problems.push('en_echec');
    if (t.triggers.length === 0) problems.push('sans_declencheur');
    if (t.triggers.length > 0 && t.triggers.every(tr => !tr.enabled)) problems.push('declencheurs_desactives');
    if (t.lastStart && (now - Date.parse(t.lastStart)) > STALE_DAYS * 86400000 && t.enabled) {
      problems.push('inactive_30j');
    }
    if (local && local.producedQvds.length > 0 && local.producedQvds.every(q => orphanSet.has(q))) {
      problems.push('chaine_morte'); // tout ce que produit son app est orphelin
    }
    t.problems = problems;
  }

  // QVD produits par les apps de plusieurs tâches distinctes (production dupliquée)
  const qvdToTasks = new Map();
  for (const t of tasks) {
    if (!t.enabled) continue;
    for (const q of t.producedQvds) {
      if (!qvdToTasks.has(q)) qvdToTasks.set(q, []);
      qvdToTasks.get(q).push({ taskId: t.taskId, taskName: t.name, appName: t.appName });
    }
  }
  const duplicateQvdProduction = [...qvdToTasks.entries()]
    .filter(([, ts]) => new Set(ts.map(x => x.taskId)).size > 1)
    .map(([qvd, ts]) => ({ qvd, tasks: ts }));

  const count = (p) => tasks.filter(t => t.problems.includes(p)).length;

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalTasks: tasks.length,
      enabled: tasks.filter(t => t.enabled).length,
      disabled: count('desactivee'),
      neverRun: count('jamais_executee'),
      failing: count('en_echec'),
      noTrigger: count('sans_declencheur'),
      stale: count('inactive_30j'),
      deadChains: count('chaine_morte'),
      duplicateQvdGroups: duplicateQvdProduction.length,
      coveredByImport: tasks.filter(t => t.imported).length
    },
    tasks: tasks.sort((a, b) => a.name.localeCompare(b.name)),
    duplicateQvdProduction
  };
}

module.exports = { fetchTasks, analyzeTasks };
