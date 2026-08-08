'use strict';

/**
 * Middleware Express :
 *   - requireAuth      : rejette 401 si pas de session valide
 *   - requireRole(r)   : rejette 403 si le user n'a pas le rôle (admin > user > viewer)
 *   - loginRateLimit   : bloque les IPs après 5 échecs / 15 min
 *
 * Bypass complet en dev via AUTH_DISABLED=true (met un faux user admin sur req).
 */

const authService = require('./authService');

const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';
const ROLE_LEVEL = { viewer: 1, user: 2, admin: 3 };

// Extrait le token de la requête (Authorization: Bearer, X-API-Key, ou query pour les exports)
function extractCredential(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return { type: 'session', value: auth.slice(7).trim() };
  }
  const apiKey = req.headers['x-api-key'];
  if (apiKey) return { type: 'apikey', value: apiKey.trim() };

  // Pour les exports CSV ouverts dans un nouvel onglet (impossible d'y injecter un header)
  if (req.query && req.query.token) {
    return { type: 'session', value: String(req.query.token) };
  }
  return null;
}

function requireAuth(req, res, next) {
  if (AUTH_DISABLED) {
    req.user = { id: 0, username: 'dev', role: 'admin' };
    return next();
  }

  const cred = extractCredential(req);
  if (!cred) return res.status(401).json({ error: 'Authentification requise' });

  const principal = cred.type === 'apikey'
    ? authService.verifyApiKey(cred.value)
    : authService.getSession(cred.value);

  if (!principal) return res.status(401).json({ error: 'Session expirée ou invalide' });

  req.user = {
    id: principal.userId,
    username: principal.username,
    role: principal.role,
    apiKeyId: principal.apiKeyId,
    scopes: principal.scopes
  };
  // Pratique pour /logout : le token brut n'est disponible qu'ici
  req.sessionToken = cred.type === 'session' ? cred.value : null;
  next();
}

function requireRole(minRole) {
  const minLevel = ROLE_LEVEL[minRole] || 999;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    const level = ROLE_LEVEL[req.user.role] || 0;
    if (level < minLevel) return res.status(403).json({ error: `Rôle "${minRole}" requis` });
    next();
  };
}

// Rate limit sur /login : 5 échecs / IP / 15 min
function loginRateLimit(req, res, next) {
  if (AUTH_DISABLED) return next();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const fails = authService.recentFailedAttempts(ip, 15);
  if (fails >= 5) {
    return res.status(429).json({
      error: 'Trop de tentatives échouées. Réessayez dans 15 minutes.'
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, loginRateLimit, AUTH_DISABLED };
