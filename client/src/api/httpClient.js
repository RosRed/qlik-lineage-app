/**
 * Patch global de window.fetch — injecte automatiquement le header
 * Authorization: Bearer <token> sur toutes les requêtes /api/*.
 *
 * Avantage : aucun changement dans les 4 fichiers d'API existants ni dans
 * les composants qui appellent fetch() directement. Tout ce qui parle à
 * /api/* est authentifié transparemment.
 *
 * Si le serveur répond 401, on vide le token et on notifie l'AuthContext
 * via un CustomEvent — ce dernier redirige alors vers l'écran de login.
 */

const TOKEN_KEY = 'qlik_lineage_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* localStorage indisponible (mode privé) */ }
}

export function clearToken() { setToken(null); }

// Événement émis quand une requête /api/* renvoie 401 → l'AuthContext s'y abonne
export function onUnauthorized(handler) {
  window.addEventListener('auth:unauthorized', handler);
  return () => window.removeEventListener('auth:unauthorized', handler);
}

let patched = false;
export function installFetchInterceptor() {
  if (patched) return;
  patched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApi = url.startsWith('/api/') || url.includes('/api/');

    if (isApi) {
      const token = getToken();
      if (token) {
        const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        init = { ...init, headers };
      }
    }

    const res = await originalFetch(input, init);

    // Sur 401 des routes /api/* (sauf /auth/login qui gère ses propres 401),
    // on considère la session comme perdue.
    if (isApi && res.status === 401 && !url.includes('/api/auth/login')) {
      clearToken();
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }

    return res;
  };
}
