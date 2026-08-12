/*
 * Téléchargement authentifié.
 *
 * Les <a href="/api/..." download> classiques déclenchent une navigation
 * standard du navigateur, sans possibilité d'injecter le header Authorization.
 * Comme l'app utilise un JWT en localStorage (voir httpClient.js), l'URL
 * directe renvoie systématiquement 401.
 *
 * Ce helper fetch le fichier (le fetch interceptor ajoute le Bearer),
 * lit le blob, crée un <a> temporaire pointant vers un blob URL et clique
 * dessus programmatiquement. L'utilisateur voit un vrai téléchargement,
 * mais avec l'auth appliqué.
 *
 * Retourne la Promise ; en cas d'erreur elle rejette avec l'objet réponse.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

function guessFilename(url, response, fallback) {
  // Content-Disposition prioritaire
  const cd = response.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) return decodeURIComponent(m[1]);
  if (fallback) return fallback;
  // Dernier segment de l'URL
  try {
    const path = new URL(url, window.location.origin).pathname;
    const last = path.split('/').pop();
    return last || 'export.csv';
  } catch (_) { return 'export.csv'; }
}

export async function downloadAuthed(url, { filename, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Extrait le message d'erreur JSON si possible
    let errBody = null;
    try { errBody = await res.json(); } catch (_) {}
    const err = errBody || { error: `HTTP ${res.status}` };
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const name = guessFilename(url, res, filename);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Libère l'URL blob rapidement — le download est déjà lancé côté navigateur
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
