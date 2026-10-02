/**
 * Lecture tolérante d'une réponse HTTP.
 *
 * `res.json()` lève « Unexpected end of JSON input » dès que le corps est vide
 * — ce qui arrive plus souvent qu'on ne croit : 204 sans contenu, 5xx renvoyé
 * par un proxy, ou requête longue coupée en vol (l'export Git ouvre un
 * websocket vers Qlik et dure plusieurs secondes). L'utilisateur voyait alors
 * une erreur de parsing incompréhensible à la place du vrai problème.
 *
 * On lit donc le texte d'abord, et on renvoie toujours un objet exploitable :
 *   - corps JSON valide        → l'objet
 *   - corps texte (HTML, trace) → { error: <début du texte> }
 *   - corps vide               → { error: 'HTTP <code>' } ou null si 2xx
 */
export async function parseJson(res) {
  const text = await res.text();

  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = { error: text.slice(0, 500) };
    }
  }

  if (!res.ok) {
    return Promise.reject(body || { error: `HTTP ${res.status} ${res.statusText || ''}`.trim() });
  }

  if (body === null && text === '') {
    // 2xx sans corps : la requête a abouti mais n'a rien renvoyé. On le dit
    // plutôt que de laisser l'appelant déréférencer `undefined`.
    return Promise.reject({
      error: 'Réponse vide du serveur — la requête a probablement été interrompue. Réessayez.'
    });
  }

  return body;
}
