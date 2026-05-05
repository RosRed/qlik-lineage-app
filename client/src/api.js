const BASE = '/api';

export const api = {
  // Apps
  getApps: () => fetch(`${BASE}/apps`).then(r => r.json()),
  createApp: (name) => fetch(`${BASE}/apps`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(r => r.json()),
  renameApp: (id, name) => fetch(`${BASE}/apps/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(r => r.json()),
  deleteApp: (id) => fetch(`${BASE}/apps/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // Scripts
  saveScript: (id, content, filename) => fetch(`${BASE}/apps/${id}/scripts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, filename })
  }).then(r => r.json()),
  getScript: (id) => fetch(`${BASE}/apps/${id}/scripts`).then(r => r.json()),

  // Analysis
  analyze: (id) => fetch(`${BASE}/apps/${id}/analyze`, { method: 'POST' }).then(r => r.json()),
  getAnalysis: (id) => fetch(`${BASE}/apps/${id}/analysis`).then(r => r.json()),

  // Chat
  getChat: (id) => fetch(`${BASE}/apps/${id}/chat`).then(r => r.json()),
  deleteChat: (id) => fetch(`${BASE}/apps/${id}/chat`, { method: 'DELETE' }).then(r => r.json()),

  // Export
  exportLineage: (id) => {
    window.open(`${BASE}/apps/${id}/export/lineage`, '_blank');
  }
};
