const BASE = '/api';

const json = (res) => {
  if (!res.ok) return res.json().then(e => Promise.reject(e));
  return res.json();
};

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

const put = (url, body) =>
  fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

export const appsApi = {
  getAll:      ()           => fetch(`${BASE}/apps`).then(json),
  create:      (name)       => post(`${BASE}/apps`, { name }),
  rename:      (id, name)   => put(`${BASE}/apps/${id}`, { name }),
  remove:      (id)         => fetch(`${BASE}/apps/${id}`, { method: 'DELETE' }).then(json),

  saveScript:  (id, content, filename) => post(`${BASE}/apps/${id}/scripts`, { content, filename }),
  getScript:   (id)         => fetch(`${BASE}/apps/${id}/scripts`).then(json),

  analyze:     (id, mode)   => post(`${BASE}/apps/${id}/analyze`, { mode: mode || 'claude' }),
  getAnalysis: (id)         => fetch(`${BASE}/apps/${id}/analysis`).then(json),

  getUsage:    ()           => fetch(`${BASE}/usage`).then(json),
};
