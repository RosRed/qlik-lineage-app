import { parseJson } from './parseJson';
const BASE = '/api';

// Lecture tolerante partagee : `res.json()` direct plantait sur un corps vide
// (requete longue coupee, 5xx du proxy) avec un message incomprehensible.
const json = parseJson;

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
  // Croisement inter-apps des QVD lus/ecrits par cette app
  getQvdUsage: (id)         => fetch(`${BASE}/apps/${id}/qvd-usage`).then(json),
  // Export au format Gitoqlok dans un dossier serveur, pret a etre versionne
  exportGitoqlok: (id)      => post(`${BASE}/apps/${id}/export/gitoqlok`, {}),
  // Workflow dupliquer -> exporter -> editer -> reappliquer
  duplicate:     (id, name) => post(`${BASE}/apps/${id}/duplicate`, name ? { name } : {}),
  exportDiff:    (id)       => fetch(`${BASE}/apps/${id}/export/diff`).then(json),
  exportApply:   (id, portees, supprimerOrphelins = false) =>
    post(`${BASE}/apps/${id}/export/apply`, { portees, supprimerOrphelins }),

  getUsage:    ()           => fetch(`${BASE}/usage`).then(json),
};
