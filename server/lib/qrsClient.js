'use strict';

/**
 * Client QRS (Qlik Sense Repository Service) — auth par certificats QMC.
 * Les certificats sont exportés depuis QMC → Certificats (client.pem, client_key.pem, root.pem)
 * et placés dans un dossier local dont le chemin est configuré dans l'app.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function makeXrfKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = '';
  for (let i = 0; i < 16; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

/**
 * Charge les certificats depuis le dossier, dans les deux formats d'export QMC :
 *   - PEM (client.pem + client_key.pem + root.pem)
 *   - Windows (client.pfx + root.cer) — passphrase optionnelle définie à l'export
 * Retourne un objet d'options TLS à passer tel quel à https/ws.
 */
function loadCerts(certDir, certPassword = null) {
  const read = (names) => {
    for (const n of names) {
      const p = path.join(certDir, n);
      if (fs.existsSync(p)) return fs.readFileSync(p);
    }
    return null;
  };

  // Format PEM
  const cert = read(['client.pem']);
  const key  = read(['client_key.pem', 'client_key_nopass.pem']);
  if (cert && key) {
    const ca = read(['root.pem']);
    return { cert, key, ca: ca || undefined };
  }

  // Format Windows (.pfx)
  const pfx = read(['client.pfx']);
  if (pfx) {
    return { pfx, passphrase: certPassword || undefined };
  }

  throw new Error(
    `Certificats introuvables dans "${certDir}" — il faut soit client.pem + client_key.pem (export PEM), soit client.pfx (export Windows).`
  );
}

function qrsRequest(config, endpoint, { method = 'GET', body = null } = {}) {
  const tlsOptions = loadCerts(config.cert_dir, config.cert_password);
  const xrfkey = makeXrfKey();
  const sep = endpoint.includes('?') ? '&' : '?';
  const pathWithKey = `/qrs${endpoint}${sep}xrfkey=${xrfkey}`;

  const options = {
    hostname: config.host.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    port: config.qrs_port || 4242,
    path: pathWithKey,
    method,
    ...tlsOptions,
    rejectUnauthorized: !!config.reject_unauthorized,
    headers: {
      'X-Qlik-Xrfkey': xrfkey,
      'X-Qlik-User': `UserDirectory=${config.user_directory || 'INTERNAL'}; UserId=${config.user_id || 'sa_repository'}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : null); }
          catch { resolve(data); }
        } else {
          reject(new Error(`QRS ${res.statusCode} sur ${endpoint} : ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout QRS (${options.hostname}:${options.port})`)); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Test de connexion : GET /qrs/about */
async function testConnection(config) {
  const about = await qrsRequest(config, '/about');
  return { ok: true, buildVersion: about.buildVersion, productName: about.productName || 'Qlik Sense' };
}

/** Liste toutes les apps du serveur avec leur stream et métadonnées enrichies */
async function listApps(config) {
  const { mapQrsApp } = require('./qrsMappers');
  const apps = await qrsRequest(config, '/app/full');
  return apps.map(mapQrsApp);
}

module.exports = { testConnection, listApps, qrsRequest, loadCerts };
