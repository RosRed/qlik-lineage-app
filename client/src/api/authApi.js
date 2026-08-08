const BASE = '/api/auth';

const json = async (res) => {
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch (_) { body = { error: text.slice(0, 500) }; } }
  if (!res.ok) return Promise.reject(body || { error: `HTTP ${res.status}` });
  return body;
};

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

const put = (url, body) =>
  fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

const del = (url) => fetch(url, { method: 'DELETE' }).then(json);

export const authApi = {
  status:         ()                        => fetch(`${BASE}/status`).then(json),
  login:          (username, password)      => post(`${BASE}/login`, { username, password }),
  logout:         ()                        => post(`${BASE}/logout`, {}),
  me:             ()                        => fetch(`${BASE}/me`).then(json),
  changePassword: (currentPassword, newPassword) => post(`${BASE}/change-password`, { currentPassword, newPassword }),

  listUsers:      ()                        => fetch(`${BASE}/users`).then(json),
  createUser:     (data)                    => post(`${BASE}/users`, data),
  updateUser:     (id, data)                => put(`${BASE}/users/${id}`, data),
  resetPassword:  (id, newPassword)         => post(`${BASE}/users/${id}/reset-password`, { newPassword }),
  deleteUser:     (id)                      => del(`${BASE}/users/${id}`),

  listApiKeys:    ()                        => fetch(`${BASE}/api-keys`).then(json),
  createApiKey:   (name, scopes)            => post(`${BASE}/api-keys`, { name, scopes }),
  revokeApiKey:   (id)                      => del(`${BASE}/api-keys/${id}`),
};
