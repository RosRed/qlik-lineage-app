'use strict';

/**
 * Client Qlik via le virtual proxy (port 443) avec authentification par formulaire
 * ("internal_forms_authentication") — pour les serveurs dont les ports API 4242/4747
 * sont fermés depuis l'extérieur.
 *
 * Flux : GET /qrs/... → 302 vers le formulaire → POST identifiants → cookie de
 * session X-Qlik-Session → les appels QRS et Engine passent avec ce cookie.
 */

const https = require('https');
const WebSocket = require('ws');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) qlik-lineage-app';

function makeXrfKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 16; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

function hostOf(config) {
  return config.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// Cache de session par host+user (évite un login à chaque appel)
const sessionCache = new Map();

function rawRequest(url, { method = 'GET', headers = {}, body = null, rejectUnauthorized = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      rejectUnauthorized,
      headers: { 'User-Agent': UA, ...headers },
      timeout: 20000
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout sur ${u.hostname}${u.pathname}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function extractSessionCookie(setCookieHeaders) {
  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  for (const c of cookies) {
    const m = c.match(/^(X-Qlik-Session[^=]*)=([^;]+)/i);
    if (m) return `${m[1]}=${m[2]}`;
  }
  return null;
}

/** Login par formulaire : retourne le cookie de session */
async function formsLogin(config) {
  const host = hostOf(config);
  const xrf = makeXrfKey();
  const reject = !!config.reject_unauthorized;

  // 1. Requête initiale → 302 vers le formulaire avec un targetId
  const first = await rawRequest(`https://${host}/qrs/about?xrfkey=${xrf}`, {
    headers: { 'X-Qlik-Xrfkey': xrf },
    rejectUnauthorized: reject
  });

  if (first.status === 200) {
    // Pas de redirection : session anonyme ou déjà autorisé (rare)
    const cookie = extractSessionCookie(first.headers['set-cookie']);
    if (cookie) return cookie;
  }
  if (first.status !== 302 || !first.headers.location) {
    throw new Error(`Réponse inattendue du proxy (${first.status}) — attendu une redirection vers le formulaire de login.`);
  }

  const loginUrl = first.headers.location;
  if (!/forms_authentication/i.test(loginUrl)) {
    throw new Error(`Le virtual proxy n'utilise pas l'authentification par formulaire (redirigé vers ${loginUrl.slice(0, 120)}).`);
  }

  // 2. POST des identifiants sur l'URL du formulaire — form-encoded (le proxy
  //    renvoie 400 sur du JSON) ; en cas d'échec il re-sert la page de login (200)
  const username = `${config.user_directory}\\${config.user_id}`;
  const form = `username=${encodeURIComponent(username)}&pwd=${encodeURIComponent(config.proxy_password || '')}`;
  const login = await rawRequest(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    rejectUnauthorized: reject
  });

  let cookie = extractSessionCookie(login.headers['set-cookie']);

  // Succès = 302 vers l'URL d'origine (souvent avec un qlikTicket) ; le cookie de
  // session est posé en suivant cette redirection. On suit jusqu'à 3 sauts.
  let next = login.status >= 300 && login.status < 400 ? login.headers.location : null;
  let hops = 0;
  while (!cookie && next && hops < 3) {
    const url = next.startsWith('http') ? next : `https://${host}${next}`;
    const res = await rawRequest(url, {
      headers: { 'X-Qlik-Xrfkey': xrf },
      rejectUnauthorized: reject
    });
    cookie = extractSessionCookie(res.headers['set-cookie']);
    next = res.status >= 300 && res.status < 400 ? res.headers.location : null;
    hops++;
  }

  if (!cookie) {
    const backToLogin = /login-form|password-input/i.test(login.body || '');
    throw new Error(
      backToLogin
        ? `Identifiants refusés pour ${username} — vérifie le compte et le mot de passe (le proxy a re-servi la page de login).`
        : `Login échoué pour ${username} (HTTP ${login.status}) — pas de cookie de session reçu.`
    );
  }
  return cookie;
}

async function getSession(config, forceNew = false) {
  const key = `${hostOf(config)}|${config.user_directory}\\${config.user_id}`;
  if (!forceNew && sessionCache.has(key)) return sessionCache.get(key);
  const cookie = await formsLogin(config);
  sessionCache.set(key, cookie);
  return cookie;
}

/** Appel QRS à travers le proxy 443, avec re-login automatique si la session a expiré */
async function qrsRequest(config, endpoint, retry = true) {
  const host = hostOf(config);
  const xrf = makeXrfKey();
  const cookie = await getSession(config);
  const sep = endpoint.includes('?') ? '&' : '?';

  const res = await rawRequest(`https://${host}/qrs${endpoint}${sep}xrfkey=${xrf}`, {
    headers: { 'X-Qlik-Xrfkey': xrf, 'Cookie': cookie },
    rejectUnauthorized: !!config.reject_unauthorized
  });

  if ((res.status === 302 || res.status === 401) && retry) {
    // Session expirée → nouveau login puis nouvelle tentative
    await getSession(config, true);
    return qrsRequest(config, endpoint, false);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`QRS ${res.status} sur ${endpoint} : ${String(res.body).slice(0, 250)}`);
  }
  try { return JSON.parse(res.body); } catch { return res.body; }
}

async function testConnection(config) {
  const about = await qrsRequest(config, '/about');
  return { ok: true, buildVersion: about.buildVersion, productName: about.productName || 'Qlik Sense' };
}

async function listApps(config) {
  const { mapQrsApp } = require('./qrsMappers');
  const apps = await qrsRequest(config, '/app/full');
  return apps.map(mapQrsApp);
}

/** Script d'une app via l'Engine à travers le proxy (wss sur 443, cookie de session) */
function getAppScript(config, qlikAppId, { timeoutMs = 45000 } = {}) {
  return new Promise(async (resolve, reject) => {
    let cookie;
    try { cookie = await getSession(config); }
    catch (e) { return reject(e); }

    const host = hostOf(config);
    const ws = new WebSocket(`wss://${host}/app/${qlikAppId}`, {
      rejectUnauthorized: !!config.reject_unauthorized,
      headers: {
        'Cookie': cookie,
        'Origin': `https://${host}`,
        'User-Agent': UA
      }
    });

    let msgId = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timeout Engine (proxy) pour l'app ${qlikAppId}`));
    }, timeoutMs);

    const send = (method, handle, params) => new Promise((res, rej) => {
      const id = ++msgId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, handle, params }));
    });

    const finish = (err, script) => {
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      if (err) reject(err); else resolve(script);
    };

    ws.on('open', async () => {
      try {
        const doc = await send('OpenDoc', -1, [qlikAppId, '', '', '', true]);
        const handle = doc.qReturn && doc.qReturn.qHandle;
        if (handle === undefined || handle === null) {
          return finish(new Error(`OpenDoc a échoué pour ${qlikAppId}`));
        }
        const scriptRes = await send('GetScript', handle, []);
        finish(null, scriptRes.qScript || '');
      } catch (e) {
        finish(e);
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      // Le proxy envoie des notifications de session (OnAuthenticationInformation…)
      if (msg.method === 'OnAuthenticationInformation' && msg.params && msg.params.mustAuthenticate) {
        return finish(new Error('Session refusée par le proxy — identifiants invalides ou session expirée.'));
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`Engine API: ${msg.error.message || JSON.stringify(msg.error)}`));
        else res(msg.result || {});
      }
    });

    ws.on('error', (e) => finish(new Error(`Connexion Engine (proxy) échouée : ${e.message}`)));
  });
}

module.exports = { testConnection, listApps, getAppScript, qrsRequest };
