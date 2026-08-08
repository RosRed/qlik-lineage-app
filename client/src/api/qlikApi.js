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

export const qlikApi = {
  getConfig:  ()      => fetch(`${BASE}/qlik/config`).then(json),
  saveConfig: (cfg)   => post(`${BASE}/qlik/config`, cfg),
  test:       ()      => post(`${BASE}/qlik/test`, {}),
  listApps:   ()      => fetch(`${BASE}/qlik/apps`).then(json),
  import:     (apps, analyzeMode) => post(`${BASE}/qlik/import`, { apps, analyzeMode }),
  importProgress: () => fetch(`${BASE}/qlik/import/progress`).then(json),
  tasks:      (refresh) => fetch(`${BASE}/qlik/tasks${refresh ? '?refresh=1' : ''}`).then(json),
  tasksExportUrl: ()  => `${BASE}/qlik/tasks/export`,
  governance: (refresh) => fetch(`${BASE}/qlik/governance${refresh ? '?refresh=1' : ''}`).then(json),
  appsCleanup: (staleDays) => fetch(`${BASE}/qlik/apps/cleanup${staleDays ? `?staleDays=${staleDays}` : ''}`).then(json),
  appsCleanupExportUrl: (flaggedOnly) => `${BASE}/qlik/apps/cleanup/export${flaggedOnly ? '?flaggedOnly=1' : ''}`,
  connections: ()     => fetch(`${BASE}/qlik/connections`).then(json),
};

export const globalApi = {
  getLineage:  () => fetch(`${BASE}/global/lineage`).then(json),
  duplicates:  () => fetch(`${BASE}/global/duplicates`).then(json),
  producers:   () => fetch(`${BASE}/global/producers`).then(json),
  exportUrl:            () => `${BASE}/global/export`,
  exportFamiliesUrl:    () => `${BASE}/global/duplicates/export/families`,
  exportTwinsUrl:       () => `${BASE}/global/duplicates/export/twins`,
  exportProducersUrl:   () => `${BASE}/global/producers/export`,
};

export const ssisApi = {
  getConfig:  ()    => fetch(`${BASE}/ssis/config`).then(json),
  saveConfig: (cfg) => post(`${BASE}/ssis/config`, cfg),
  test:       (cfg = {}) => post(`${BASE}/ssis/test`, cfg),
  health:     ()    => fetch(`${BASE}/ssis/health`).then(json),
  dashboard:  (days = 7) => fetch(`${BASE}/ssis/dashboard?days=${days}`).then(json),
  executions: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined)).toString();
    return fetch(`${BASE}/ssis/executions${qs ? `?${qs}` : ''}`).then(json);
  },
  executionDetail: (id) => fetch(`${BASE}/ssis/executions/${encodeURIComponent(id)}`).then(json),
  errors:     (days = 7, limit = 200) => fetch(`${BASE}/ssis/errors?days=${days}&limit=${limit}`).then(json),
  folders:    () => fetch(`${BASE}/ssis/folders`).then(json),
  databases:  () => fetch(`${BASE}/ssis/databases`).then(json),
  tablesStatus: (database) => fetch(`${BASE}/ssis/tables/status?database=${encodeURIComponent(database)}`).then(json),
  snapshot:   (database) => post(`${BASE}/ssis/tables/snapshot`, { database }),
  tableHistory: (database, schema, table, limit = 100) =>
    fetch(`${BASE}/ssis/tables/history?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&limit=${limit}`).then(json),
  autosnapshotStatus: () => fetch(`${BASE}/ssis/autosnapshot`).then(json),
  autosnapshotSet: (enabled, database) => post(`${BASE}/ssis/autosnapshot`, { enabled, database }),
  autosnapshotTrigger: () => post(`${BASE}/ssis/autosnapshot/trigger`, {}),
  updateLogSchema: (database) => fetch(`${BASE}/ssis/update-log/schema?database=${encodeURIComponent(database)}`).then(json),
  updateLog: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined)).toString();
    return fetch(`${BASE}/ssis/update-log${qs ? `?${qs}` : ''}`).then(json);
  },
  societes: (database) => fetch(`${BASE}/ssis/societes?database=${encodeURIComponent(database)}`).then(json),
  updateLogSummary: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined)).toString();
    return fetch(`${BASE}/ssis/update-log/summary${qs ? `?${qs}` : ''}`).then(json);
  },
  updateLogRuns: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== '' && v !== undefined)).toString();
    return fetch(`${BASE}/ssis/update-log/runs${qs ? `?${qs}` : ''}`).then(json);
  },
  deleteSnapshots: (params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return fetch(`${BASE}/ssis/tables/snapshots${qs ? `?${qs}` : ''}`, { method: 'DELETE' }).then(json);
  },
};

export const adminApi = {
  reset: () => post(`${BASE}/admin/reset`, {}),
};
