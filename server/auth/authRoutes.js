'use strict';

const express = require('express');
const router = express.Router();
const authService = require('./authService');
const { requireAuth, requireRole, loginRateLimit, AUTH_DISABLED } = require('./authMiddleware');

// ─── Endpoints publics ────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const userCount = require('../database').prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({
    authDisabled: AUTH_DISABLED,
    hasUsers: userCount > 0,
    userCount
  });
});

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username et password requis' });

    const result = await authService.login({
      username,
      password,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.socket?.remoteAddress
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ─── Endpoints authentifiés ───────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    apiKey: !!req.user.apiKeyId
  });
});

router.post('/logout', requireAuth, (req, res) => {
  authService.logout(req.sessionToken);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });

    // Vérifie l'ancien mot de passe
    const user = require('../database').prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await require('bcryptjs').compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe actuel invalide' });

    await authService.changePassword(req.user.id, newPassword);
    res.json({ ok: true, message: 'Mot de passe modifié. Reconnectez-vous.' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ─── Administration users (admin uniquement) ──────────────────────────────

router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json(authService.listUsers());
});

router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role, email } = req.body || {};
    const user = await authService.createUser({ username, password, role, email });
    res.status(201).json(user);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { role, email, is_active } = req.body || {};
    const user = authService.updateUser(parseInt(req.params.id, 10), { role, email, is_active });
    res.json(user);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword) return res.status(400).json({ error: 'newPassword requis' });
    await authService.changePassword(parseInt(req.params.id, 10), newPassword);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
    authService.deleteUser(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// ─── API Keys (admin) ─────────────────────────────────────────────────────

router.get('/api-keys', requireAuth, requireRole('admin'), (req, res) => {
  res.json(authService.listApiKeys());
});

router.post('/api-keys', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name requis' });
    const key = await authService.createApiKey({ name, userId: req.user.id, scopes });
    res.status(201).json(key); // La clé brute n'est renvoyée qu'ici, une seule fois.
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/api-keys/:id', requireAuth, requireRole('admin'), (req, res) => {
  authService.revokeApiKey(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;
