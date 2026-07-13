'use strict';

/**
 * Client Engine API (JSON-RPC sur websocket) — récupère le script de chargement
 * d'une app sans charger ses données (OpenDoc nodata + GetScript).
 * Auth par certificats QMC, comme le client QRS.
 */

const WebSocket = require('ws');
const { loadCerts } = require('./qrsClient');

function connect(config, qlikAppId) {
  const tlsOptions = loadCerts(config.cert_dir, config.cert_password);
  const host = config.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const url = `wss://${host}:${config.engine_port || 4747}/app/${qlikAppId}`;

  return new WebSocket(url, {
    ...tlsOptions,
    rejectUnauthorized: !!config.reject_unauthorized,
    headers: {
      'X-Qlik-User': `UserDirectory=${config.user_directory || 'INTERNAL'}; UserId=${config.user_id || 'sa_repository'}`
    }
  });
}

/**
 * Récupère le script d'une app. Ouvre le doc en mode "nodata" pour ne pas
 * charger les données en mémoire moteur.
 */
function getAppScript(config, qlikAppId, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = connect(config, qlikAppId); }
    catch (e) { return reject(e); }

    let msgId = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timeout Engine API pour l'app ${qlikAppId}`));
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
        // OpenDoc(appId, user, password, serial, noData=true)
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
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`Engine API: ${msg.error.message || JSON.stringify(msg.error)}`));
        else res(msg.result || {});
      }
      // Les notifications (OnConnected, etc.) sont ignorées
    });

    ws.on('error', (e) => finish(new Error(`Connexion Engine échouée : ${e.message}`)));
  });
}

module.exports = { getAppScript };
