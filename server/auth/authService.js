'use strict';

/**
 * Service d'authentification — bcrypt pour les mots de passe, tokens crypto
 * random stockés en base pour permettre la révocation.
 *
 * Aucune dépendance externe hors bcryptjs (pas de JWT, pas de session middleware).
 * Les tokens sont des chaînes hex 64 chars — opaques côté client.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_DAYS = 7;
const TOKEN_BYTES = 32;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Users ────────────────────────────────────────────────────────────────

async function createUser({ username, password, role = 'user', email = null }) {
  if (!username || !password) throw new Error('username et password requis');
  if (password.length < 8) throw new Error('Mot de passe : 8 caractères minimum');
  if (!/^(admin|user|viewer)$/.test(role)) throw new Error(`Rôle invalide : ${role}`);

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)'
    ).run(username.trim().toLowerCase(), password_hash, role, email);
    return getUserById(result.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const err = new Error(`Utilisateur "${username}" existe déjà`);
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

function getUserById(id) {
  const row = db.prepare('SELECT id, username, role, email, is_active, last_login_at, created_at FROM users WHERE id = ?').get(id);
  return row || null;
}

function getUserByUsername(username) {
  if (!username) return null;
  return db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username.trim().toLowerCase()) || null;
}

function listUsers() {
  return db.prepare('SELECT id, username, role, email, is_active, last_login_at, created_at FROM users ORDER BY created_at DESC').all();
}

function updateUser(id, { role, email, is_active }) {
  const user = getUserById(id);
  if (!user) { const e = new Error('Utilisateur introuvable'); e.status = 404; throw e; }
  if (role && !/^(admin|user|viewer)$/.test(role)) throw new Error(`Rôle invalide : ${role}`);
  db.prepare(`
    UPDATE users SET
      role = COALESCE(?, role),
      email = COALESCE(?, email),
      is_active = COALESCE(?, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(role || null, email !== undefined ? email : null, is_active !== undefined ? (is_active ? 1 : 0) : null, id);
  return getUserById(id);
}

async function changePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('Mot de passe : 8 caractères minimum');
  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(password_hash, userId);
  // Invalide toutes les sessions existantes de cet utilisateur — sauf celle qui
  // change le mot de passe (l'appelant remet une nouvelle session au besoin).
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function deleteUser(id) {
  const user = getUserById(id);
  if (!user) { const e = new Error('Utilisateur introuvable'); e.status = 404; throw e; }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ─── Login / Sessions ─────────────────────────────────────────────────────

async function verifyPassword(user, password) {
  if (!user || !user.password_hash) return false;
  return bcrypt.compare(password, user.password_hash);
}

async function login({ username, password, userAgent, ip }) {
  const user = getUserByUsername(username);
  const ok = user ? await verifyPassword(user, password) : false;

  // Log de la tentative (utilisé par le rate limiter)
  db.prepare('INSERT INTO login_attempts (ip, username, success) VALUES (?, ?, ?)')
    .run(ip || null, username || null, ok ? 1 : 0);

  if (!ok) {
    // Timing : bcrypt.compare met déjà ~100ms — pas besoin d'ajouter un délai
    const err = new Error('Identifiants invalides');
    err.status = 401;
    throw err;
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (token, user_id, user_agent, ip, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenHash, user.id, userAgent || null, ip || null, expiresAt);

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  // Le token brut est renvoyé une seule fois — c'est celui-ci que le client stocke.
  return {
    token,
    expiresAt,
    user: { id: user.id, username: user.username, role: user.role, email: user.email }
  };
}

function getSession(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT s.*, u.username, u.role, u.email, u.is_active
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(tokenHash);

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
    return null;
  }
  if (!row.is_active) return null;

  db.prepare('UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token = ?').run(tokenHash);

  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    email: row.email,
    expiresAt: row.expires_at
  };
}

function logout(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
}

function logoutAll(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function cleanExpiredSessions() {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP').run();
  return result.changes;
}

// ─── Rate limiting ────────────────────────────────────────────────────────

function recentFailedAttempts(ip, windowMinutes = 15) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM login_attempts
    WHERE ip = ? AND success = 0
      AND attempted_at >= datetime('now', ?)
  `).get(ip || '', `-${windowMinutes} minutes`);
  return row?.n || 0;
}

// ─── API Keys (programmatique — activable plus tard) ──────────────────────

async function createApiKey({ name, userId, scopes = 'read' }) {
  const raw = generateToken();
  const key_hash = hashToken(raw);
  const result = db.prepare(
    'INSERT INTO api_keys (name, key_hash, user_id, scopes) VALUES (?, ?, ?, ?)'
  ).run(name, key_hash, userId, scopes);
  // La clé brute n'est jamais restockée — retournée une seule fois.
  return { id: result.lastInsertRowid, name, key: raw, scopes };
}

function verifyApiKey(key) {
  if (!key) return null;
  const key_hash = hashToken(key);
  const row = db.prepare(`
    SELECT k.*, u.username, u.role, u.is_active
    FROM api_keys k
    LEFT JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = ? AND k.revoked_at IS NULL
  `).get(key_hash);
  if (!row) return null;
  if (row.user_id && !row.is_active) return null;
  db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return {
    apiKeyId: row.id,
    userId: row.user_id,
    username: row.username || 'api-key',
    role: row.role || 'user',
    scopes: (row.scopes || '').split(',').map(s => s.trim())
  };
}

function listApiKeys() {
  return db.prepare(`
    SELECT k.id, k.name, k.user_id, k.scopes, k.last_used_at, k.revoked_at, k.created_at,
           u.username
    FROM api_keys k
    LEFT JOIN users u ON u.id = k.user_id
    ORDER BY k.created_at DESC
  `).all();
}

function revokeApiKey(id) {
  db.prepare('UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

// ─── Seed initial ─────────────────────────────────────────────────────────

async function ensureInitialAdmin() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (existing.n > 0) return null;

  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.warn('\n⚠️  Aucun utilisateur en base et ADMIN_PASSWORD non défini dans .env');
    console.warn('   Définissez ADMIN_USERNAME et ADMIN_PASSWORD puis redémarrez.');
    console.warn('   L\'API refusera toutes les requêtes tant qu\'aucun user n\'existe.\n');
    return null;
  }
  if (password.length < 8) {
    console.warn('\n⚠️  ADMIN_PASSWORD trop court (< 8 caractères) — admin non créé.\n');
    return null;
  }

  const user = await createUser({ username, password, role: 'admin' });
  console.log(`\n✅ Admin initial créé : "${username}" (à changer après le 1er login)\n`);
  return user;
}

module.exports = {
  createUser, getUserById, getUserByUsername, listUsers, updateUser, deleteUser, changePassword,
  login, logout, logoutAll, getSession, cleanExpiredSessions, recentFailedAttempts,
  createApiKey, verifyApiKey, listApiKeys, revokeApiKey,
  ensureInitialAdmin
};
