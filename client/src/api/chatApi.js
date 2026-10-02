import { parseJson } from './parseJson';
const BASE = '/api';

export const chatApi = {
  getHistory:  (id)           => fetch(`${BASE}/apps/${id}/chat`).then(parseJson),
  clearHistory:(id)           => fetch(`${BASE}/apps/${id}/chat`, { method: 'DELETE' }).then(parseJson),
  sendMessage: (id, message, mode) =>
    fetch(`${BASE}/apps/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode })
    }),
};
