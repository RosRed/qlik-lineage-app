const BASE = '/api';

const json = (res) => {
  if (!res.ok) return res.json().then(e => Promise.reject(e));
  return res.json();
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
  tasks:      ()      => fetch(`${BASE}/qlik/tasks`).then(json),
};

export const globalApi = {
  getLineage: () => fetch(`${BASE}/global/lineage`).then(json),
  exportUrl:  () => `${BASE}/global/export`,
};

export const adminApi = {
  reset: () => post(`${BASE}/admin/reset`, {}),
};
