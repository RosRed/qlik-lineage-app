'use strict';

/**
 * Config GitLab (singleton) + statut Git par app.
 * Les synchros d'app elles-mêmes sont dans routes/apps.js (POST /:id/git/sync),
 * parce qu'elles s'appuient sur l'export Gitoqlok déjà monté là.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { getAppGitState } = require('../services/gitSyncService');

/** GET /api/git/config — masque le token au retour (comme qlik_config masque les mots de passe). */
router.get('/config', (req, res) => {
  const cfg = db.prepare('SELECT * FROM git_config WHERE id = 1').get();
  if (!cfg) return res.json(null);
  const { access_token, ...safe } = cfg;
  res.json({ ...safe, has_token: !!access_token });
});

/** POST /api/git/config — sauvegarde. Un token vide = on garde l'existant. */
router.post('/config', (req, res) => {
  const { base_url, namespace, access_token, default_branch, provider } = req.body || {};
  if (!base_url || !namespace) {
    return res.status(400).json({ error: 'base_url et namespace sont requis' });
  }
  if (provider && !['gitlab', 'github'].includes(provider)) {
    return res.status(400).json({ error: `provider invalide : ${provider}` });
  }
  const existing = db.prepare('SELECT * FROM git_config WHERE id = 1').get();
  const tokenFinal = access_token || existing?.access_token || null;
  const providerFinal = provider || existing?.provider || 'gitlab';

  db.prepare(`
    INSERT INTO git_config (id, base_url, namespace, access_token, default_branch, provider, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      base_url = excluded.base_url,
      namespace = excluded.namespace,
      access_token = excluded.access_token,
      default_branch = excluded.default_branch,
      provider = excluded.provider,
      updated_at = CURRENT_TIMESTAMP
  `).run(base_url, namespace, tokenFinal, default_branch || 'main', providerFinal);

  res.json({ saved: true });
});

/** POST /api/git/test — teste le token selon le provider. */
router.post('/test', async (req, res) => {
  const cfg = db.prepare('SELECT * FROM git_config WHERE id = 1').get();
  if (!cfg || !cfg.base_url || !cfg.access_token) {
    return res.status(400).json({ error: 'Configuration Git incomplète' });
  }
  try {
    const provider = cfg.provider || 'gitlab';
    if (provider === 'github') {
      // GitHub : /user avec Bearer token (api.github.com en public, /api/v3 en entreprise)
      const apiBase = cfg.base_url && cfg.base_url !== 'https://github.com'
        ? `${cfg.base_url.replace(/\/$/, '')}/api/v3`
        : 'https://api.github.com';
      const r = await fetch(`${apiBase}/user`, {
        headers: {
          Authorization: `Bearer ${cfg.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'qlik-lineage'
        }
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(502).json({ error: `GitHub a répondu ${r.status} : ${txt.slice(0, 200)}` });
      }
      const user = await r.json();
      return res.json({ ok: true, provider, username: user.login, name: user.name || user.login });
    }
    // GitLab par défaut
    const r = await fetch(`${cfg.base_url}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': cfg.access_token }
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: `GitLab a répondu ${r.status} : ${txt.slice(0, 200)}` });
    }
    const user = await r.json();
    res.json({ ok: true, provider, username: user.username, name: user.name });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/** GET /api/git/status/:appId — dernier commit + URL repo pour une app. */
router.get('/status/:appId', (req, res) => {
  const state = getAppGitState(parseInt(req.params.appId, 10));
  res.json(state || null);
});

module.exports = router;
