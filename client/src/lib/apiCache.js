/*
 * Cache mémoire pour les GET d'API. Résout le problème principal du site :
 * chaque navigation démonte le layout → useEffect refait un fetch → le
 * lineage global (3-5s) et les tâches (5-10s) rechargent à chaque
 * aller-retour.
 *
 * Stratégie : stale-while-revalidate.
 *  - Une entrée fraîche (< ttl) est renvoyée synchrone, aucune requête réseau.
 *  - Une entrée périmée mais présente est renvoyée immédiatement et un fetch
 *    en tâche de fond met à jour le cache pour la prochaine navigation.
 *  - Aucune entrée → fetch normal.
 *
 * TTL configuré par appelant. Bouton "Rafraîchir" → invalidate(prefix).
 */

const SS_KEY = 'apiCache.v1';
const SS_MAX_ENTRY_BYTES = 200_000; // évite de saturer sessionStorage (5-10 Mo total)

// Hydratation depuis sessionStorage au boot. Perdu si l'onglet est fermé,
// mais survit à F5 → plus de rechargement pénible.
function loadFromSession() {
  if (typeof sessionStorage === 'undefined') return new Map();
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    return new Map(arr.map(([k, v]) => [k, { at: v.at, data: v.data }]));
  } catch (_) { return new Map(); }
}

// Sauvegarde différée : batche les écritures pour ne pas serialiser à chaque hit.
let saveTimer = null;
function scheduleSave(store) {
  if (typeof sessionStorage === 'undefined') return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const arr = [];
      for (const [k, v] of store.entries()) {
        // Skip inflight (Promise) et entrées volumineuses
        if (!v.data || v.inflight) continue;
        const str = JSON.stringify(v.data);
        if (str.length > SS_MAX_ENTRY_BYTES) continue;
        arr.push([k, { at: v.at, data: v.data }]);
      }
      sessionStorage.setItem(SS_KEY, JSON.stringify(arr));
    } catch (_) {
      // QuotaExceededError etc. — on abandonne silencieusement, le cache mémoire suffit.
    }
  }, 1500);
}

const store = loadFromSession(); // key -> { at: number, data: any, inflight?: Promise }

/**
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.ttl  ms — entrée considérée fraîche (défaut 60s)
 * @param {number} opts.stale ms — entrée périmée mais utilisable en attendant le refresh (défaut 5 min)
 */
export function cachedGet(url, { ttl = 60_000, stale = 5 * 60_000, force = false } = {}) {
  const now = Date.now();
  const entry = store.get(url);

  const fetchAndStore = () => {
    if (entry?.inflight) return entry.inflight;
    const p = fetch(url)
      .then(async r => {
        const text = await r.text();
        let body = null;
        if (text) { try { body = JSON.parse(text); } catch (_) { body = { error: text.slice(0, 500) }; } }
        if (!r.ok) throw body || { error: `HTTP ${r.status}` };
        store.set(url, { at: Date.now(), data: body });
        scheduleSave(store);
        return body;
      })
      .catch(err => {
        // Ne pas polluer le cache avec l'erreur, mais libérer inflight
        if (store.has(url)) delete store.get(url).inflight;
        throw err;
      });
    if (!store.has(url)) store.set(url, { at: 0, data: null });
    store.get(url).inflight = p;
    return p;
  };

  // Force refresh (bouton "Rafraîchir")
  if (force) return fetchAndStore();

  // Aucune donnée en cache
  if (!entry || !entry.data) return fetchAndStore();

  const age = now - entry.at;

  // Frais → retour direct
  if (age < ttl) return Promise.resolve(entry.data);

  // Périmé mais utilisable → retour immédiat + refresh en tâche de fond
  if (age < stale) {
    // Lance sans await
    fetchAndStore().catch(() => {});
    return Promise.resolve(entry.data);
  }

  // Trop vieux → fetch bloquant
  return fetchAndStore();
}

/** Invalide toutes les entrées dont l'URL commence par `prefix` (ou tout si vide). */
export function invalidate(prefix = '') {
  for (const key of [...store.keys()]) {
    if (!prefix || key.startsWith(prefix)) store.delete(key);
  }
  scheduleSave(store);
}

/** Écrit directement dans le cache — utile pour préchauffer depuis un autre appel. */
export function seed(url, data) {
  store.set(url, { at: Date.now(), data });
  scheduleSave(store);
}
