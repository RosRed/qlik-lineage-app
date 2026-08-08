'use strict';

/**
 * Vue simplifiée « qui produit ce QVD » : pour chaque QVD, la liste des batchs
 * qui l'écrivent, avec pour chacun son statut de publication et de planification.
 *
 * Trois sources sont croisées :
 *   - lineage global (buildGlobalLineage) → QVD + producteurs
 *   - table apps      → published, owner, last_reload, qlik_app_id
 *   - analyzeTasks    → planification des reloadtasks (schedule/chain/manuel)
 *
 * L'accès aux tâches passe par le cache 5 min de qrsCache : appeler cette
 * fonction deux fois d'affilée ne remartèle pas Qlik. Si la config Qlik est
 * absente ou l'API QRS injoignable, on renvoie quand même le résultat avec
 * `hasTaskData: false` — la vue reste utile (publication + producteur).
 */

const db = require('../database');
const { buildGlobalLineage } = require('./globalLineage');
const { analyzeTasks } = require('./taskService');

function readConfig() {
  return db.prepare('SELECT * FROM qlik_config WHERE id = 1').get() || null;
}

/**
 * Statut synthétique d'un producteur, calculé une fois pour tenir dans une
 * cellule. Priorité de gravité : orphelin > sans tâche > désactivé > manuel > actif.
 */
function summarize(prod) {
  if (!prod.hasTaskData) return { code: 'unknown', label: 'Tâches indisponibles' };
  if (prod.taskCount === 0) return { code: 'no_task', label: 'Aucune tâche de reload' };
  if (prod.enabledTaskCount === 0) return { code: 'disabled', label: 'Toutes tâches désactivées' };
  if (prod.scheduled) return { code: 'scheduled', label: 'Actif — planifié' };
  if (prod.chained) return { code: 'chained', label: 'Actif — déclenché par chaîne' };
  return { code: 'manual', label: 'Actif — lancé manuellement' };
}

async function analyzeQvdProducers() {
  const lineage = buildGlobalLineage();
  const config = readConfig();

  // Index des tâches par qlikAppId. Chaque app peut avoir plusieurs tâches ;
  // on agrège en un statut par app (scheduled | chained | manual | disabled).
  const tasksByQlikApp = new Map();
  let hasTaskData = false;
  let taskDataError = null;

  if (config) {
    try {
      const taskAnalysis = await analyzeTasks(config);
      hasTaskData = true;
      for (const t of taskAnalysis.tasks || []) {
        if (!t.qlikAppId) continue;
        if (!tasksByQlikApp.has(t.qlikAppId)) {
          tasksByQlikApp.set(t.qlikAppId, {
            tasks: [], enabled: 0, scheduled: false, chained: false, manual: false,
            lastRunAt: null
          });
        }
        const bucket = tasksByQlikApp.get(t.qlikAppId);
        bucket.tasks.push({ taskId: t.taskId, name: t.name, enabled: t.enabled, triggerType: t.triggerType });
        if (t.enabled) bucket.enabled++;
        if (t.triggerType === 'schedule' || t.triggerType === 'mixte') bucket.scheduled = true;
        if (t.triggerType === 'chain' || t.triggerType === 'mixte') bucket.chained = true;
        if (t.triggerType === 'manual') bucket.manual = true;
        // On garde le lastStart le plus récent parmi les tâches de l'app
        if (t.lastStart && (!bucket.lastRunAt || t.lastStart > bucket.lastRunAt)) {
          bucket.lastRunAt = t.lastStart;
        }
      }
    } catch (e) {
      taskDataError = e.message;
    }
  }

  // Index des méta-apps locales : on a besoin de qlik_app_id + last_reload
  // même quand la tâche Qlik n'existe pas (import ancien, script collé à la main).
  const localApps = db.prepare(
    'SELECT id, qlik_app_id, published, owner, last_reload, stream FROM apps'
  ).all();
  const localById = new Map(localApps.map(a => [a.id, a]));

  // Construction du résultat : une entrée par QVD, avec la liste enrichie
  // des producteurs. Un QVD sans producteur (externe) est exclu — c'est
  // l'objet d'un autre onglet.
  const rows = [];
  for (const qvd of lineage.qvds) {
    if (qvd.producers.length === 0) continue;
    const enrichedProducers = qvd.producers.map(p => {
      const local = localById.get(p.appId);
      const qlikAppId = local?.qlik_app_id || null;
      const bucket = qlikAppId ? tasksByQlikApp.get(qlikAppId) : null;
      const enrichedProd = {
        appId: p.appId,
        appName: p.appName,
        stream: p.stream,
        tableName: p.tableName,
        // Statut Qlik au niveau app (méta QRS synchronisées à l'import)
        published: !!local?.published,
        owner: local?.owner || null,
        lastReload: local?.last_reload || null,
        hasQlikApp: !!qlikAppId,
        // Statut de planification agrégé sur toutes les tâches de l'app
        hasTaskData,
        taskCount: bucket ? bucket.tasks.length : 0,
        enabledTaskCount: bucket ? bucket.enabled : 0,
        scheduled: !!bucket?.scheduled,
        chained: !!bucket?.chained,
        manual: !!bucket?.manual,
        // Dernière exécution QRS (peut être plus récent que app.last_reload)
        lastRunAt: bucket?.lastRunAt || local?.last_reload || null
      };
      enrichedProd.status = summarize(enrichedProd);
      return enrichedProd;
    });

    rows.push({
      qvd: qvd.name,
      qvdStatus: qvd.status,
      consumerCount: qvd.consumers.length,
      producers: enrichedProducers
    });
  }

  // Tri : QVD orphelins d'abord (les plus intéressants à nettoyer), puis alpha
  rows.sort((a, b) => {
    if (a.qvdStatus !== b.qvdStatus) {
      const order = { orphelin: 0, ok: 1, externe: 2 };
      return order[a.qvdStatus] - order[b.qvdStatus];
    }
    return a.qvd.localeCompare(b.qvd);
  });

  // Stats : combien de QVD à statut « inactif », combien de batchs distincts…
  const allProducers = rows.flatMap(r => r.producers);
  const distinctBatchIds = new Set(allProducers.map(p => p.appId));
  const publishedBatchIds = new Set(allProducers.filter(p => p.published).map(p => p.appId));
  const scheduledBatchIds = new Set(allProducers.filter(p => p.scheduled || p.chained).map(p => p.appId));

  return {
    generatedAt: new Date().toISOString(),
    hasTaskData,
    taskDataError,
    stats: {
      qvdCount: rows.length,
      qvdOrphan: rows.filter(r => r.qvdStatus === 'orphelin').length,
      producerBatchCount: distinctBatchIds.size,
      publishedBatchCount: publishedBatchIds.size,
      scheduledBatchCount: scheduledBatchIds.size,
      qvdWithoutSchedule: rows.filter(r =>
        r.producers.every(p => !p.scheduled && !p.chained)
      ).length
    },
    rows
  };
}

module.exports = { analyzeQvdProducers };
