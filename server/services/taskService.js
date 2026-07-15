'use strict';

/**
 * Analyse des tâches de reload et de leur planification (QRS) :
 *   - récupère reloadtask + schemaevent (planifications) + compositeevent (chaînages)
 *   - reconstruit les CHAÎNES de tâches (task paths) par id de tâche amont
 *   - croise avec le lineage global local :
 *       ordre incorrect (consommateur non planifié après son producteur),
 *       QVD consommés sans producteur actif (données figées),
 *       chaînes mortes (tout ce que produit l'app est orphelin)
 *   - calcule un score de nettoyage + recommandation par tâche
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
      // id + nom de chaque tâche amont — le nom seul n'est pas fiable (non unique)
      after: (c.compositeRules || [])
        .filter(r => r.reloadTask?.id)
        .map(r => ({ taskId: r.reloadTask.id, name: r.reloadTask.name || '(tâche inconnue)' }))
    });
  }

  /** Type de déclenchement : manual (aucun déclencheur), schedule, chain ou mixte */
  const triggerTypeOf = (triggers) => {
    const hasSchedule = triggers.some(tr => tr.type === 'schedule');
    const hasChain = triggers.some(tr => tr.type === 'chain');
    if (hasSchedule && hasChain) return 'mixte';
    if (hasSchedule) return 'schedule';
    if (hasChain) return 'chain';
    return 'manual';
  };

  return (tasks || []).map(t => {
    const exec = t.operational?.lastExecutionResult || null;
    const status = EXEC_STATUS[exec?.status ?? 0] || EXEC_STATUS[0];
    const triggers = triggersByTask.get(t.id) || [];
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
      triggers,
      triggerType: triggerTypeOf(triggers)
    };
  });
}

// ─── Chaînes de tâches (task paths) ──────────────────────────────────────────

/**
 * Reconstruit le graphe des chaînes de tâches depuis les déclencheurs composites.
 * Retourne { chains, upstreamOf, downstreamOf, ancestorsOf, flags }.
 */
function buildTaskChains(tasks) {
  const byId = new Map(tasks.map(t => [t.taskId, t]));
  const upstreamOf = new Map();   // taskId -> [{taskId, name, exists}]
  const downstreamOf = new Map(); // taskId -> [taskId]
  const flags = new Map();        // taskId -> { orpheline_de_chaine, cycle, chaine_cassee, brokenBy: [] }
  const flag = (id) => {
    if (!flags.has(id)) flags.set(id, { orpheline_de_chaine: false, cycle: false, chaine_cassee: false, brokenBy: [] });
    return flags.get(id);
  };

  for (const t of tasks) {
    for (const tr of t.triggers.filter(x => x.type === 'chain')) {
      for (const up of tr.after || []) {
        const exists = byId.has(up.taskId);
        if (!upstreamOf.has(t.taskId)) upstreamOf.set(t.taskId, []);
        upstreamOf.get(t.taskId).push({ ...up, exists, triggerEnabled: tr.enabled });
        if (exists) {
          if (!downstreamOf.has(up.taskId)) downstreamOf.set(up.taskId, []);
          downstreamOf.get(up.taskId).push(t.taskId);
        } else {
          flag(t.taskId).orpheline_de_chaine = true; // la tâche amont n'existe plus
        }
      }
    }
  }

  // Ancêtres transitifs (BFS remontant) — sert au contrôle d'ordre QVD
  const ancestorsOf = new Map();
  const getAncestors = (id) => {
    if (ancestorsOf.has(id)) return ancestorsOf.get(id);
    const seen = new Set();
    const queue = (upstreamOf.get(id) || []).filter(u => u.exists).map(u => u.taskId);
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const u of (upstreamOf.get(cur) || []).filter(x => x.exists)) queue.push(u.taskId);
    }
    ancestorsOf.set(id, seen);
    return seen;
  };
  for (const t of tasks) getAncestors(t.taskId);

  // Cycles : une tâche est dans un cycle si elle est son propre ancêtre
  for (const t of tasks) {
    if (getAncestors(t.taskId).has(t.taskId)) flag(t.taskId).cycle = true;
  }

  // Chaîne cassée : un ancêtre désactivé, en échec, ou déclencheur désactivé → l'aval ne tournera pas
  for (const t of tasks) {
    if (!t.enabled) continue;
    const broken = [];
    for (const ancId of getAncestors(t.taskId)) {
      const anc = byId.get(ancId);
      if (!anc) continue;
      if (!anc.enabled) broken.push(`${anc.name} (désactivée)`);
      else if (['fail', 'error', 'aborted'].includes(anc.lastStatus)) broken.push(`${anc.name} (en échec)`);
    }
    const ups = upstreamOf.get(t.taskId) || [];
    if (ups.length > 0 && ups.every(u => !u.triggerEnabled)) broken.push('déclencheur de chaîne désactivé');
    if (broken.length) {
      const f = flag(t.taskId);
      f.chaine_cassee = true;
      f.brokenBy = broken.slice(0, 5);
    }
  }

  // Racines : planifiées (schedule) ou têtes de chaîne manuelles (aval existant, pas d'amont)
  const roots = tasks.filter(t => {
    const hasSchedule = t.triggers.some(tr => tr.type === 'schedule');
    const hasUpstream = (upstreamOf.get(t.taskId) || []).some(u => u.exists);
    const hasDownstream = (downstreamOf.get(t.taskId) || []).length > 0;
    return hasSchedule || (!hasUpstream && hasDownstream);
  });

  // Parcours en profondeur → arbre de chaîne par racine (protection cycle par pile)
  const buildNode = (id, stack) => {
    const t = byId.get(id);
    if (!t) return null;
    if (stack.has(id)) return { taskId: id, name: t.name, cycle: true, children: [] };
    stack.add(id);
    const children = (downstreamOf.get(id) || []).map(c => buildNode(c, stack)).filter(Boolean);
    stack.delete(id);
    return {
      taskId: id,
      name: t.name,
      appName: t.appName,
      enabled: t.enabled,
      lastStatus: t.lastStatus,
      lastStatusLabel: t.lastStatusLabel,
      durationMs: t.durationMs,
      broken: flags.get(id)?.chaine_cassee || false,
      children
    };
  };

  const sumDuration = (node) =>
    (node.durationMs || 0) + node.children.reduce((acc, c) => acc + sumDuration(c), 0);

  // Statistiques d'un arbre de chaîne (pour la synthèse "santé")
  const treeStats = (node, acc = { count: 0, broken: 0, disabled: 0, failing: 0 }) => {
    acc.count++;
    if (node.broken || node.cycle) acc.broken++;
    if (!node.enabled) acc.disabled++;
    if (['fail', 'error', 'aborted'].includes(node.lastStatus)) acc.failing++;
    for (const c of node.children || []) treeStats(c, acc);
    return acc;
  };

  const chains = roots.map(r => {
    const schedule = t => t.triggers.filter(tr => tr.type === 'schedule').map(tr => tr.name).join(', ');
    const tree = buildNode(r.taskId, new Set());
    const st = tree ? treeStats(tree) : { count: 0, broken: 0, disabled: 0, failing: 0 };
    const scheduleEnabled = r.triggers.some(tr => tr.type === 'schedule' && tr.enabled);
    // Santé globale de la chaîne, du pire au meilleur
    let health = 'ok';
    if (!r.enabled || (schedule(r) && !scheduleEnabled)) health = 'inactive';   // la racine ne tournera pas
    else if (st.broken > 0 || st.failing > 0) health = 'cassee';                // un maillon bloque l'aval
    else if (st.disabled > 0) health = 'partielle';                             // des maillons désactivés
    return {
      rootTaskId: r.taskId,
      rootName: r.name,
      schedule: schedule(r) || null,
      scheduleEnabled,
      rootNextExecution: r.nextExecution || null,
      taskCount: st.count,
      brokenCount: st.broken,
      disabledCount: st.disabled,
      failingCount: st.failing,
      health,
      totalDurationMs: tree ? sumDuration(tree) : 0,
      tree
    };
  }).sort((a, b) => {
    // Chaînes en difficulté d'abord, puis par nom
    const order = { cassee: 0, inactive: 1, partielle: 2, ok: 3 };
    return (order[a.health] - order[b.health]) || a.rootName.localeCompare(b.rootName);
  });

  return { chains, upstreamOf, downstreamOf, ancestorsOf, flags };
}

// ─── Score de nettoyage ───────────────────────────────────────────────────────

const PROBLEM_WEIGHTS = {
  app_supprimee: 100,
  orpheline_de_chaine: 70,
  cycle: 40,
  desactivee: 40,
  jamais_executee: 35,
  en_echec: 35,
  chaine_morte: 35,
  sans_declencheur: 30,
  declencheurs_desactives: 30,
  inactive_30j: 25,
  source_figee: 20,
  chaine_cassee: 20,
  ordre_incorrect: 15
};

function scoreTask(t) {
  const score = Math.min(100, t.problems.reduce((acc, p) => acc + (PROBLEM_WEIGHTS[p] || 10), 0));
  let recommendation = 'conserver';
  if (
    t.problems.includes('app_supprimee') ||
    t.problems.includes('orpheline_de_chaine') ||
    (t.problems.includes('desactivee') && t.problems.includes('jamais_executee'))
  ) recommendation = 'supprimer';
  else if (t.problems.length > 0) recommendation = 'verifier';
  return { score, recommendation };
}

// ─── Croisement tâches × lineage global → diagnostics de nettoyage ───────────

async function analyzeTasks(config) {
  const tasks = await fetchTasks(config);
  const lineage = buildGlobalLineage();
  const chainData = buildTaskChains(tasks);

  // Index des apps locales analysées par id Qlik
  const localByQlikId = new Map(
    lineage.apps.filter(a => a.qlikAppId && a.analyzed).map(a => [a.qlikAppId, a])
  );
  const orphanSet = new Set(lineage.orphans.map(q => q.name));

  const now = Date.now();
  const STALE_DAYS = 30;

  // Producteurs actifs par QVD (tâches actives dont l'app produit ce QVD)
  const producersByQvd = new Map();
  for (const t of tasks) {
    if (!t.enabled || !t.qlikAppId) continue;
    const local = localByQlikId.get(t.qlikAppId);
    if (!local) continue;
    for (const q of local.producedQvds) {
      if (!producersByQvd.has(q)) producersByQvd.set(q, []);
      producersByQvd.get(q).push(t);
    }
  }

  for (const t of tasks) {
    const local = t.qlikAppId ? localByQlikId.get(t.qlikAppId) : null;
    t.imported = !!local;
    t.producedQvds = local ? local.producedQvds : [];
    t.consumedQvds = local ? local.consumedQvds : [];
    t.appRole = local ? local.role : null;

    // Diagnostics unitaires
    const problems = [];
    if (!t.qlikAppId) problems.push('app_supprimee');
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

    // Diagnostics de chaîne
    const cf = chainData.flags.get(t.taskId);
    if (cf?.orpheline_de_chaine) problems.push('orpheline_de_chaine');
    if (cf?.cycle) problems.push('cycle');
    if (cf?.chaine_cassee) { problems.push('chaine_cassee'); t.brokenBy = cf.brokenBy; }

    // Croisement chaînes × QVD : ordre correct ? producteur actif ?
    t.orderIssues = [];
    t.staleQvds = [];
    if (t.enabled && local) {
      const ancestors = chainData.ancestorsOf.get(t.taskId) || new Set();
      for (const q of t.consumedQvds) {
        const producers = (producersByQvd.get(q) || []).filter(p => p.taskId !== t.taskId);
        // le QVD est aussi produit par la même app (self-consumed) → pas un problème d'ordre
        if (t.producedQvds.includes(q)) continue;
        if (producers.length === 0) {
          // consommé mais aucun producteur actif connu ; on ne signale que si un producteur
          // existe dans le lineage (sinon c'est un QVD externe, déjà signalé ailleurs)
          const qvdInfo = lineage.qvds.find(x => x.name === q);
          if (qvdInfo && qvdInfo.producers.length > 0) t.staleQvds.push(q);
        } else if (!producers.some(p => ancestors.has(p.taskId))) {
          t.orderIssues.push({ qvd: q, producers: producers.map(p => p.name) });
        }
      }
      if (t.staleQvds.length) problems.push('source_figee');
      if (t.orderIssues.length) problems.push('ordre_incorrect');
    }

    t.problems = problems;
    const { score, recommendation } = scoreTask(t);
    t.cleanupScore = score;
    t.recommendation = recommendation;
  }

  // QVD produits par les apps de plusieurs tâches distinctes (production dupliquée)
  const duplicateQvdProduction = [...producersByQvd.entries()]
    .filter(([, ts]) => new Set(ts.map(x => x.taskId)).size > 1)
    .map(([qvd, ts]) => ({ qvd, tasks: ts.map(t => ({ taskId: t.taskId, taskName: t.name, appName: t.appName })) }));

  const count = (p) => tasks.filter(t => t.problems.includes(p)).length;
  const byReco = (r) => tasks.filter(t => t.recommendation === r).length;

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
      brokenChains: count('chaine_cassee'),
      orderIssues: count('ordre_incorrect'),
      staleSources: count('source_figee'),
      orphanedFromChain: count('orpheline_de_chaine'),
      cycles: count('cycle'),
      duplicateQvdGroups: duplicateQvdProduction.length,
      coveredByImport: tasks.filter(t => t.imported).length,
      // Répartition par type de déclenchement
      byTriggerType: {
        manual: tasks.filter(t => t.triggerType === 'manual').length,
        schedule: tasks.filter(t => t.triggerType === 'schedule').length,
        chain: tasks.filter(t => t.triggerType === 'chain').length,
        mixte: tasks.filter(t => t.triggerType === 'mixte').length
      },
      // Synthèse nettoyage
      toDelete: byReco('supprimer'),
      toReview: byReco('verifier'),
      toKeep: byReco('conserver')
    },
    tasks: tasks.sort((a, b) => b.cleanupScore - a.cleanupScore || a.name.localeCompare(b.name)),
    chains: chainData.chains,
    duplicateQvdProduction
  };
}

module.exports = { fetchTasks, analyzeTasks, buildTaskChains };
