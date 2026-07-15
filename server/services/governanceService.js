'use strict';

/**
 * Gouvernance serveur Qlik (P3) — croise l'inventaire QRS avec le lineage local :
 *   - audit des apps serveur (jamais rechargée, ancienne, brouillon abandonné, sans tâche…)
 *   - audit des connexions de données (inutilisées, doublons, fantômes, personnelles)
 *   - propriétaires partis (users inactifs/supprimés de l'annuaire)
 *   - synthèse agrégée pour la vue « Gouvernance serveur »
 *
 * Tous les appels QRS passent par le client adapté au mode d'auth (certificats/proxy)
 * et sont mis en cache mémoire 10 min pour ne pas marteler le serveur.
 */

const db = require('../database');
const { buildGlobalLineage } = require('./globalLineage');
const certQrs = require('../lib/qrsClient').qrsRequest;
const proxyQrs = require('../lib/proxyClient').qrsRequest;

function qrsFor(config) {
  return config.auth_mode === 'forms' ? proxyQrs : certQrs;
}

// ─── Cache QRS (10 min, clé = host + endpoint) ────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000;
const qrsCache = new Map();

async function cachedQrs(config, endpoint) {
  const key = `${config.host}|${endpoint}`;
  const hit = qrsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await qrsFor(config)(config, endpoint);
  qrsCache.set(key, { data, at: Date.now() });
  return data;
}

function clearCache() {
  qrsCache.clear();
}

// ─── Utilisateurs (P3.4) ──────────────────────────────────────────────────────

/** Retourne un Set des "DIRECTORY\userId" partis (inactifs, supprimés, blacklistés) */
async function fetchGoneUsers(config) {
  const users = await cachedQrs(config, '/user/full');
  const gone = new Set();
  for (const u of users || []) {
    if (u.inactive || u.removedExternally || u.blacklisted) {
      gone.add(`${u.userDirectory}\\${u.userId}`.toLowerCase());
    }
  }
  return gone;
}

function ownerGone(owner, goneSet) {
  return !!owner && goneSet.has(String(owner).toLowerCase());
}

// ─── Audit des apps serveur (P3.2) ────────────────────────────────────────────

function normalizeAppName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '')          // "Ventes (2)"
    .replace(/^(copy of|copie de)\s+/i, '') // "Copy of Ventes"
    .replace(/\s*[-_]\s*(v\d+|copie|copy|old|backup|bak|test)\s*$/i, '')
    .trim();
}

async function auditApps(config, { staleDays = 90, sizeLimitMb = 500 } = {}) {
  const [apps, tasks] = await Promise.all([
    cachedQrs(config, '/app/full'),
    cachedQrs(config, '/reloadtask/full')
  ]);
  let goneUsers = new Set();
  try { goneUsers = await fetchGoneUsers(config); }
  catch (e) { console.error('[Governance] users indisponibles :', e.message); }

  const now = Date.now();
  const staleMs = staleDays * 86400000;
  const appIdsWithTask = new Set((tasks || []).map(t => t.app?.id).filter(Boolean));

  // Doublons de nom (normalisé)
  const byNormName = new Map();
  for (const a of apps || []) {
    const n = normalizeAppName(a.name);
    if (!byNormName.has(n)) byNormName.set(n, []);
    byNormName.get(n).push(a.id);
  }

  const audited = (apps || []).map(a => {
    const owner = a.owner ? `${a.owner.userDirectory}\\${a.owner.userId}` : null;
    const flags = [];
    if (!a.lastReloadTime) flags.push('jamais_rechargee');
    else if (now - Date.parse(a.lastReloadTime) > staleMs) flags.push('rechargement_ancien');
    if (!a.published && a.modifiedDate && now - Date.parse(a.modifiedDate) > staleMs) flags.push('non_publiee_ancienne');
    if (!appIdsWithTask.has(a.id)) flags.push('sans_tache');
    if ((a.fileSize || 0) > sizeLimitMb * 1024 * 1024) flags.push('volumineuse');
    if ((byNormName.get(normalizeAppName(a.name)) || []).length > 1) flags.push('doublon_nom');
    if (ownerGone(owner, goneUsers)) flags.push('proprietaire_parti');

    return {
      qlikAppId: a.id,
      name: a.name,
      stream: a.stream ? a.stream.name : null,
      published: !!a.published,
      owner,
      fileSizeMb: a.fileSize ? Math.round(a.fileSize / (1024 * 1024)) : null,
      lastReload: a.lastReloadTime || null,
      modifiedDate: a.modifiedDate || null,
      flags
    };
  }).sort((x, y) => y.flags.length - x.flags.length || x.name.localeCompare(y.name));

  const count = (f) => audited.filter(a => a.flags.includes(f)).length;
  return {
    generatedAt: new Date().toISOString(),
    params: { staleDays, sizeLimitMb },
    stats: {
      totalApps: audited.length,
      withFlags: audited.filter(a => a.flags.length > 0).length,
      neverReloaded: count('jamais_rechargee'),
      staleReload: count('rechargement_ancien'),
      abandonedDrafts: count('non_publiee_ancienne'),
      noTask: count('sans_tache'),
      oversized: count('volumineuse'),
      duplicateNames: count('doublon_nom'),
      ownerGone: count('proprietaire_parti')
    },
    apps: audited
  };
}

// ─── Audit des connexions de données (P3.3) ───────────────────────────────────

/** Extrait les noms de connexions référencés dans tous les scripts locaux */
function collectConnectionRefs() {
  const scripts = db.prepare(`
    SELECT s.content, a.id AS app_id, a.name AS app_name
    FROM scripts s JOIN apps a ON a.id = s.app_id
  `).all();

  // nom de connexion (minuscule) -> Set d'apps { id, name }
  const refs = new Map();
  const add = (connName, app) => {
    const key = connName.trim().toLowerCase();
    if (!key) return;
    if (!refs.has(key)) refs.set(key, { name: connName.trim(), apps: new Map() });
    refs.get(key).apps.set(app.app_id, app.app_name);
  };

  for (const s of scripts) {
    const content = s.content || '';
    let m;
    const connectRe = /LIB\s+CONNECT\s+TO\s+['"]([^'"]+)['"]/gi;
    while ((m = connectRe.exec(content)) !== null) add(m[1], s);
    // lib://NomConnexion/chemin — le nom s'arrête au premier / ou fin de crochet/quote
    const libRe = /lib:\/\/([^/\]'"\n;]+)/gi;
    while ((m = libRe.exec(content)) !== null) add(m[1], s);
  }
  return refs;
}

/** Normalise une connectionstring pour détecter les doublons */
function normalizeConnString(cs) {
  return String(cs || '')
    .toLowerCase()
    .replace(/\\+$/g, '')      // slash final
    .replace(/\/+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function auditConnections(config) {
  const conns = await cachedQrs(config, '/dataconnection/full');
  let goneUsers = new Set();
  try { goneUsers = await fetchGoneUsers(config); }
  catch (_) {}

  const refs = collectConnectionRefs();
  const analyzedApps = db.prepare('SELECT COUNT(*) AS n FROM scripts').get().n;

  // Doublons par connectionstring normalisée
  const byConnString = new Map();
  for (const c of conns || []) {
    const key = normalizeConnString(c.connectionstring);
    if (!key) continue;
    if (!byConnString.has(key)) byConnString.set(key, []);
    byConnString.get(key).push(c.name);
  }

  const serverNames = new Set((conns || []).map(c => String(c.name).toLowerCase()));

  const audited = (conns || []).map(c => {
    const owner = c.owner ? `${c.owner.userDirectory}\\${c.owner.userId}` : null;
    const ref = refs.get(String(c.name).toLowerCase());
    const usedByApps = ref ? [...ref.apps.values()] : [];
    const dupGroup = byConnString.get(normalizeConnString(c.connectionstring)) || [];

    const flags = [];
    if (usedByApps.length === 0) flags.push('inutilisee'); // sur le périmètre des apps analysées
    if (dupGroup.length > 1) flags.push('doublon');
    if (ownerGone(owner, goneUsers)) flags.push('proprietaire_parti');
    // "personnelle" : connexion dont le nom contient le suffixe utilisateur "(dir_user)"
    // (convention Qlik pour les connexions non partagées créées par un utilisateur)
    if (/\([^)]+_[^)]+\)\s*$/.test(c.name) && usedByApps.length > 0) flags.push('personnelle');

    return {
      id: c.id,
      name: c.name,
      type: c.type || null,
      connectionString: c.connectionstring || null,
      owner,
      flags,
      duplicateOf: dupGroup.length > 1 ? dupGroup.filter(n => n !== c.name) : [],
      usedByApps,
      usedByCount: usedByApps.length
    };
  }).sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));

  // Connexions fantômes : référencées dans un script mais absentes du serveur
  const ghosts = [...refs.values()]
    .filter(r => !serverNames.has(r.name.toLowerCase()))
    .map(r => ({ name: r.name, usedByApps: [...r.apps.values()] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const count = (f) => audited.filter(c => c.flags.includes(f)).length;
  return {
    generatedAt: new Date().toISOString(),
    coverage: { analyzedScripts: analyzedApps },
    stats: {
      totalConnections: audited.length,
      unused: count('inutilisee'),
      duplicates: count('doublon'),
      personal: count('personnelle'),
      ownerGone: count('proprietaire_parti'),
      ghosts: ghosts.length
    },
    connections: audited,
    ghosts
  };
}

// ─── Synthèse gouvernance (P3.6) ──────────────────────────────────────────────

async function buildGovernance(config) {
  const { analyzeTasks } = require('./taskService');

  const [appsAudit, connsAudit, tasksAudit] = await Promise.all([
    auditApps(config).catch(e => ({ error: e.message })),
    auditConnections(config).catch(e => ({ error: e.message })),
    analyzeTasks(config).catch(e => ({ error: e.message }))
  ]);
  const lineage = buildGlobalLineage();

  return {
    generatedAt: new Date().toISOString(),
    counters: {
      appsToClean: appsAudit.stats ? appsAudit.stats.withFlags : null,
      tasksToDelete: tasksAudit.stats ? tasksAudit.stats.toDelete : null,
      tasksToReview: tasksAudit.stats ? tasksAudit.stats.toReview : null,
      unusedConnections: connsAudit.stats ? connsAudit.stats.unused : null,
      duplicateConnections: connsAudit.stats ? connsAudit.stats.duplicates : null,
      ghostConnections: connsAudit.stats ? connsAudit.stats.ghosts : null,
      ownerGoneObjects: (appsAudit.stats?.ownerGone || 0) + (connsAudit.stats?.ownerGone || 0),
      orphanQvds: lineage.stats.orphanQvds
    },
    apps: appsAudit,
    connections: connsAudit,
    tasks: tasksAudit.stats ? { stats: tasksAudit.stats } : tasksAudit, // stats seules (détail via /qlik/tasks)
    lineage: { stats: lineage.stats, orphans: lineage.orphans }
  };
}

module.exports = { auditApps, auditConnections, buildGovernance, fetchGoneUsers, clearCache };
