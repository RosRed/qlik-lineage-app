'use strict';

/**
 * Cache mémoire des réponses QRS et des résultats d'analyse.
 *
 * Deux caches partagés par les services qui parlent au serveur Qlik :
 *
 *   1. `cachedQrs(config, endpoint)` — les appels bruts /reloadtask, /app, etc.
 *      sont mis en cache 10 min par (host + endpoint). Chargement de
 *      /governance suivi de /tasks ⇒ /reloadtask/full est lu une seule fois.
 *
 *   2. `analysisCache` — un cache par nom d'analyse (ex. « tasks »,
 *      « governance ») avec un TTL de 5 min. C'est lui qui règle le problème
 *      remonté : `analyzeTasks` recalculait à chaque visite de /tasks.
 *
 * Un appel avec `?refresh=1` doit d'abord invoquer `clearAll()` puis relancer
 * le calcul — voir les routes /qlik/tasks et /qlik/governance.
 */

const QRS_TTL_MS = 10 * 60 * 1000;   // 10 min — appels QRS bruts
const ANALYSIS_TTL_MS = 5 * 60 * 1000; // 5 min  — analyses agrégées (tasks, governance)

const qrsCache = new Map();
const analysisCache = new Map();

/** Choisit le client QRS selon le mode d'authentification configuré. */
function qrsFor(config) {
  // Import paresseux pour casser la boucle : ../services/* importent qrsCache
  // au chargement, avant que ces libs ne finissent d'être définies.
  const cert = require('./qrsClient').qrsRequest;
  const proxy = require('./proxyClient').qrsRequest;
  return config.auth_mode === 'forms' ? proxy : cert;
}

/**
 * Récupère un endpoint QRS avec mise en cache.
 * La clé inclut le host pour rester valide si l'utilisateur change de serveur.
 */
async function cachedQrs(config, endpoint) {
  const key = `${config.host}|${endpoint}`;
  const hit = qrsCache.get(key);
  if (hit && Date.now() - hit.at < QRS_TTL_MS) return hit.data;
  const data = await qrsFor(config)(config, endpoint);
  qrsCache.set(key, { data, at: Date.now() });
  return data;
}

/**
 * Retourne le résultat mis en cache pour `name` s'il est encore frais, sinon
 * exécute `build()` et met en cache. La clé inclut le host — bascule d'un
 * environnement à l'autre = pas de fuite de résultat d'un serveur sur l'autre.
 */
async function cachedAnalysis(name, config, build) {
  const key = `${config.host}|${name}`;
  const hit = analysisCache.get(key);
  if (hit && Date.now() - hit.at < ANALYSIS_TTL_MS) {
    // On expose `cachedAt` : le client peut afficher « données de HH:mm ».
    return { ...hit.data, cachedAt: new Date(hit.at).toISOString() };
  }
  const data = await build();
  analysisCache.set(key, { data, at: Date.now() });
  return { ...data, cachedAt: new Date().toISOString() };
}

/** Vide les deux caches — à appeler sur `?refresh=1`. */
function clearAll() {
  qrsCache.clear();
  analysisCache.clear();
}

/** Invalide une analyse ciblée (tous les hosts confondus). */
function invalidateAnalysis(name) {
  for (const key of analysisCache.keys()) {
    if (key.endsWith(`|${name}`)) analysisCache.delete(key);
  }
}

module.exports = {
  QRS_TTL_MS,
  ANALYSIS_TTL_MS,
  cachedQrs,
  cachedAnalysis,
  clearAll,
  invalidateAnalysis
};
