'use strict';

/**
 * Recherche d'impact : « une table de la base ne charge plus, quelles apps
 * sont touchées ? »
 *
 * Deux niveaux de réponse, parce que s'arrêter au premier serait trompeur :
 *
 *   1. IMPACT DIRECT — les apps dont le script lit la table (SQL) ou le fichier
 *      (Excel/CSV) recherché.
 *   2. IMPACT INDIRECT — une app touchée écrit des QVD ; toute app qui lit ces
 *      QVD est touchée à son tour, et ainsi de suite. C'est le cas courant :
 *      un batch extrait la table vers un QVD, et dix apps front lisent le QVD
 *      sans jamais voir la base.
 *
 * La propagation suit les arêtes du lineage global (STORE → LOAD) en largeur,
 * en mémorisant le chemin parcouru pour pouvoir l'expliquer dans l'UI.
 */

const { buildGlobalLineage, getAllAnalyses } = require('./globalLineage');

const MAX_DEPTH = 10;   // garde-fou : chaînes QVD anormalement profondes
const MAX_RESULTS = 500;

const norm = (s) => String(s || '').toLowerCase();

/** Types de sources sur lesquels la recherche porte. */
const SEARCHABLE = {
  sql: ['sql'],
  fichier: ['excel', 'csv', 'file', 'txt', 'tab'],
  qvd: ['qvd', 'qvd_read']
};

/**
 * Une source correspond-elle à la requête ? On teste le nom court ET le chemin
 * complet : chercher « HISTO_VENTES » doit trouver
 * `Groupe Premium.dbo.HISTO_VENTES`, et chercher « BUDGET_PDR_2026.xlsx »
 * doit trouver le fichier quel que soit son dossier lib://.
 */
function matches(src, q) {
  return norm(src.name).includes(q) || norm(src.path).includes(q);
}

/**
 * @param query  texte cherché (nom de table, de fichier, fragment de chemin)
 * @param kinds  sous-ensemble de SEARCHABLE ; par défaut sql + fichier
 */
function searchImpact(query, { kinds = ['sql', 'fichier'] } = {}) {
  const q = norm(query).trim();
  if (q.length < 2) {
    return { query, tooShort: true, sources: [], direct: [], indirect: [], stats: null };
  }

  const types = new Set(kinds.flatMap(k => SEARCHABLE[k] || []));
  const entries = getAllAnalyses();
  const lineage = buildGlobalLineage();

  // ── 1. Sources qui correspondent, et apps qui les lisent ───────────────────
  const sources = new Map();   // clé source -> { name, path, type, connection, apps: [] }
  const directByApp = new Map(); // appId -> { app, sources: [] }

  for (const { app, analysis } of entries) {
    if (!analysis) continue;
    for (const src of analysis.sourceMeta || []) {
      const type = norm(src.category || src.type);
      if (!types.has(type)) continue;
      if (!matches(src, q)) continue;

      const key = `${type}|${norm(src.path || src.name)}`;
      if (!sources.has(key)) {
        sources.set(key, {
          name: src.name, path: src.path || null, type,
          // La connexion distingue les deux bases : « PremiumDWH (…) » et
          // « MySQL_Enterprise_Edition… » portent des tables homonymes.
          connection: src.connection || null,
          joined: !!src.joined, apps: []
        });
      }
      const entry = sources.get(key);
      if (!entry.apps.find(a => a.appId === app.id)) {
        entry.apps.push({ appId: app.id, appName: app.name, stream: app.stream || null });
      }

      if (!directByApp.has(app.id)) {
        directByApp.set(app.id, {
          appId: app.id, appName: app.name, stream: app.stream || null,
          qlikAppId: app.qlik_app_id || null, sources: []
        });
      }
      const d = directByApp.get(app.id);
      if (!d.sources.find(x => x.name === src.name && x.path === src.path)) {
        d.sources.push({
          name: src.name, path: src.path || null, type,
          connection: src.connection || null, joined: !!src.joined,
          usedBy: src.usedBy || []
        });
      }
    }
  }

  // ── 2. Propagation par les QVD ─────────────────────────────────────────────
  const appById = new Map(lineage.apps.map(a => [a.appId, a]));
  const qvdByKey = new Map(lineage.qvds.map(qv => [qv.name, qv]));

  const seen = new Set([...directByApp.keys()]);
  const indirect = [];
  let frontier = [...directByApp.values()].map(d => ({ appId: d.appId, depth: 0, chain: [] }));

  for (let depth = 1; depth <= MAX_DEPTH && frontier.length && indirect.length < MAX_RESULTS; depth++) {
    const next = [];
    for (const node of frontier) {
      const summary = appById.get(node.appId);
      if (!summary) continue;

      for (const qvdKey of summary.producedQvds || []) {
        const qvd = qvdByKey.get(qvdKey);
        if (!qvd) continue;
        const qvdName = String(qvdKey).split(/[/\\]/).pop();

        for (const consumer of qvd.consumers) {
          if (seen.has(consumer.appId)) continue;
          seen.add(consumer.appId);
          const chain = [...node.chain, { qvd: qvdName, qvdPath: qvdKey, producedBy: summary.appName, producedByAppId: summary.appId }];
          indirect.push({
            appId: consumer.appId,
            appName: consumer.appName,
            stream: consumer.stream || null,
            qlikAppId: consumer.qlikAppId || null,
            depth,
            // Le maillon qui amène jusqu'à cette app : le QVD lu et son producteur.
            via: chain[chain.length - 1],
            chain,
            tables: consumer.tables || []
          });
          next.push({ appId: consumer.appId, depth, chain });
        }
      }
    }
    frontier = next;
  }

  const sourceList = [...sources.values()].sort((a, b) => a.name.localeCompare(b.name));
  const directList = [...directByApp.values()].sort((a, b) => a.appName.localeCompare(b.appName));
  indirect.sort((a, b) => a.depth - b.depth || a.appName.localeCompare(b.appName));

  // Connexions distinctes trouvées — répond à « de quelle base vient la table ? »
  const connections = [...new Set(sourceList.map(s => s.connection).filter(Boolean))];

  return {
    query,
    tooShort: false,
    sources: sourceList,
    connections,
    direct: directList,
    indirect,
    stats: {
      sources: sourceList.length,
      direct: directList.length,
      indirect: indirect.length,
      total: directList.length + indirect.length,
      analyzedApps: lineage.stats.analyzedApps,
      totalApps: lineage.stats.totalApps
    }
  };
}

module.exports = { searchImpact };
