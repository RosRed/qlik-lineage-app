import { cachedGet, invalidate as cacheInvalidate } from '../lib/apiCache';

const BASE = '/api';

const json = async (res) => {
  // Certains endpoints peuvent renvoyer un 5xx sans corps JSON (proxy timeout,
  // socket coupée) — on lit le texte pour ne pas planter sur Unexpected end of JSON input.
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch (_) { body = { error: text.slice(0, 500) }; } }
  if (!res.ok) return Promise.reject(body || { error: `HTTP ${res.status}` });
  return body;
};

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

// Endpoints "chers" (>1s) cachés côté client avec stale-while-revalidate.
// TTL généreux (5-10 min) : ce sont des données peu volatiles (structure du
// serveur Qlik) qu'on ne veut pas ré-interroger à chaque navigation.
const CACHED = (ttl, stale) => ({ ttl, stale });
const CFG_HEAVY   = CACHED(5 * 60_000, 15 * 60_000);   // lineage global, tasks, governance
const CFG_LIGHT   = CACHED(60_000, 5 * 60_000);        // config, health

export const qlikApi = {
  getConfig:  ()      => cachedGet(`${BASE}/qlik/config`, CFG_LIGHT),
  saveConfig: (cfg)   => post(`${BASE}/qlik/config`, cfg).then(r => { cacheInvalidate(`${BASE}/qlik/config`); return r; }),
  test:       ()      => post(`${BASE}/qlik/test`, {}),
  listApps:   ()      => fetch(`${BASE}/qlik/apps`).then(json),
  import:     (apps, analyzeMode) => post(`${BASE}/qlik/import`, { apps, analyzeMode }),
  importProgress: () => fetch(`${BASE}/qlik/import/progress`).then(json),
  tasks:      (refresh) => refresh
    ? fetch(`${BASE}/qlik/tasks?refresh=1`).then(json).then(r => { cacheInvalidate(`${BASE}/qlik/tasks`); return r; })
    : cachedGet(`${BASE}/qlik/tasks`, CFG_HEAVY),
  tasksExportUrl: ()  => `${BASE}/qlik/tasks/export`,
  governance: (refresh) => refresh
    ? fetch(`${BASE}/qlik/governance?refresh=1`).then(json).then(r => { cacheInvalidate(`${BASE}/qlik/governance`); return r; })
    : cachedGet(`${BASE}/qlik/governance`, CFG_HEAVY),
  appsCleanup: (staleDays) => fetch(`${BASE}/qlik/apps/cleanup${staleDays ? `?staleDays=${staleDays}` : ''}`).then(json),
  appsCleanupExportUrl: (flaggedOnly) => `${BASE}/qlik/apps/cleanup/export${flaggedOnly ? '?flaggedOnly=1' : ''}`,
  connections: ()     => fetch(`${BASE}/qlik/connections`).then(json),
  // Synchronisation Qlik ↔ base locale (alternative au tout-supprimer/tout-réimporter)
  syncPreview: ()     => fetch(`${BASE}/qlik/sync/preview`).then(json),
  syncApply:   (plan) => post(`${BASE}/qlik/sync/apply`, plan),
  syncRestore: (id)   => post(`${BASE}/qlik/sync/restore/${id}`, {}),
  syncPurge:   (id)   => fetch(`${BASE}/qlik/sync/purge/${id}`, { method: 'DELETE' }).then(json),
  trash:       ()     => fetch(`${BASE}/apps/trash`).then(json),
};

export const globalApi = {
  getLineage:  (force) => force
    ? fetch(`${BASE}/global/lineage`).then(json).then(r => { cacheInvalidate(`${BASE}/global/lineage`); return r; })
    : cachedGet(`${BASE}/global/lineage`, CFG_HEAVY),
  duplicates:  () => cachedGet(`${BASE}/global/duplicates`, CFG_HEAVY),
  producers:   () => cachedGet(`${BASE}/global/producers`, CFG_HEAVY),
  exportUrl:            () => `${BASE}/global/export`,
  exportFamiliesUrl:    () => `${BASE}/global/duplicates/export/families`,
  exportTwinsUrl:       () => `${BASE}/global/duplicates/export/twins`,
  exportProducersUrl:   () => `${BASE}/global/producers/export`,
};

// Cache SSIS — 2 min sur les vues de monitoring (données SSISDB peu volatiles
// à l'échelle d'une navigation). Bouton "Rafraîchir" fait un force refresh.
const SSIS_TTL = { ttl: 2 * 60_000, stale: 10 * 60_000 };
const qs = (params) => new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined)
).toString();
const cachedSsis = (path, force) => force
  ? fetch(`${BASE}/ssis/${path}`).then(json).then(r => { cacheInvalidate(`${BASE}/ssis/${path.split('?')[0]}`); return r; })
  : cachedGet(`${BASE}/ssis/${path}`, SSIS_TTL);

export const ssisApi = {
  getConfig:  ()    => fetch(`${BASE}/ssis/config`).then(json),
  saveConfig: (cfg) => post(`${BASE}/ssis/config`, cfg),
  test:       (cfg = {}) => post(`${BASE}/ssis/test`, cfg),
  health:     ()    => fetch(`${BASE}/ssis/health`).then(json),
  dashboard:  (days = 7, force) => cachedSsis(`dashboard?days=${days}`, force),
  executions: (params = {}, force) => cachedSsis(`executions?${qs(params)}`, force),
  executionDetail: (id) => cachedGet(`${BASE}/ssis/executions/${encodeURIComponent(id)}`, SSIS_TTL),
  errors:     (days = 7, limit = 200, force) => cachedSsis(`errors?days=${days}&limit=${limit}`, force),
  folders:    () => cachedGet(`${BASE}/ssis/folders`, { ttl: 10 * 60_000, stale: 60 * 60_000 }),
  databases:  () => cachedGet(`${BASE}/ssis/databases`, { ttl: 10 * 60_000, stale: 60 * 60_000 }),
  tablesStatus: (database, force) => cachedSsis(`tables/status?database=${encodeURIComponent(database)}`, force),
  snapshot:   (database) => post(`${BASE}/ssis/tables/snapshot`, { database })
                             .then(r => { cacheInvalidate(`${BASE}/ssis/tables/status`); return r; }),
  tableHistory: (database, schema, table, limit = 100) =>
    cachedGet(`${BASE}/ssis/tables/history?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&limit=${limit}`, SSIS_TTL),
  autosnapshotStatus: () => fetch(`${BASE}/ssis/autosnapshot`).then(json), // léger, pas de cache — état temps réel
  autosnapshotSet: (enabled, database) => post(`${BASE}/ssis/autosnapshot`, { enabled, database }),
  autosnapshotTrigger: () => post(`${BASE}/ssis/autosnapshot/trigger`, {}),
  updateLogSchema: (database) => cachedGet(`${BASE}/ssis/update-log/schema?database=${encodeURIComponent(database)}`, { ttl: 10 * 60_000, stale: 60 * 60_000 }),
  updateLog: (params = {}, force) => cachedSsis(`update-log?${qs(params)}`, force),
  societes: (database) => cachedGet(`${BASE}/ssis/societes?database=${encodeURIComponent(database)}`, { ttl: 10 * 60_000, stale: 60 * 60_000 }),
  updateLogSummary: (params = {}, force) => cachedSsis(`update-log/summary?${qs(params)}`, force),
  updateLogRuns: (params = {}, force) => cachedSsis(`update-log/runs?${qs(params)}`, force),
  deleteSnapshots: (params) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return fetch(`${BASE}/ssis/tables/snapshots${q ? `?${q}` : ''}`, { method: 'DELETE' })
      .then(json).then(r => { cacheInvalidate(`${BASE}/ssis/tables`); return r; });
  },
  reconnect: () => post(`${BASE}/ssis/reconnect`, {}).then(r => { cacheInvalidate(`${BASE}/ssis`); return r; }),

  // Snapshots nommés à la demande (grain table × société)
  namedSnapshotList: (database) => cachedGet(`${BASE}/ssis/named-snapshots${database ? `?database=${encodeURIComponent(database)}` : ''}`, { ttl: 30_000, stale: 5 * 60_000 }),
  namedSnapshotCreate: (payload) => post(`${BASE}/ssis/named-snapshots`, payload).then(r => { cacheInvalidate(`${BASE}/ssis/named-snapshots`); return r; }),
  namedSnapshotStatus: (id) => fetch(`${BASE}/ssis/named-snapshots/${id}/status`).then(json), // pas de cache — polling temps réel
  namedSnapshotDetail: (id) => cachedGet(`${BASE}/ssis/named-snapshots/${id}`, { ttl: 5 * 60_000, stale: 60 * 60_000 }),
  namedSnapshotDelete: (id) => fetch(`${BASE}/ssis/named-snapshots/${id}`, { method: 'DELETE' }).then(json).then(r => { cacheInvalidate(`${BASE}/ssis/named-snapshots`); return r; }),
  namedSnapshotCompare: (aId, bId) => cachedGet(`${BASE}/ssis/named-snapshots/compare?a=${aId}&b=${bId}`, { ttl: 5 * 60_000, stale: 60 * 60_000 }),
  wipeAllSnapshots: () => post(`${BASE}/ssis/snapshots/wipe`, {}).then(r => { cacheInvalidate(`${BASE}/ssis`); return r; })
};

// Ré-export pour permettre à une page de vider un chemin précis (bouton Rafraîchir)
export { cacheInvalidate };

export const adminApi = {
  reset: () => post(`${BASE}/admin/reset`, {}),
};
