require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./database');
const authService = require('./auth/authService');
const { AUTH_DISABLED } = require('./auth/authMiddleware');

const app = express();
// trust proxy pour que req.ip reflète le client réel derrière nginx
app.set('trust proxy', 1);

// API_PORT en priorité — la variable PORT peut être injectée par l'outil de preview
// (elle vaut alors le port Vite 5173, ce qui casserait le proxy /api → 3001)
const PORT = process.env.API_PORT || (process.env.PORT !== '5173' ? process.env.PORT : null) || 3001;

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api', require('./routes'));

app.get('/api/health', (req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    authEnabled: !AUTH_DISABLED
  })
);

// En production, servir le build du client depuis Express.
// Le dossier client/dist est généré par `npm run build` côté client.
const clientDist = path.resolve(__dirname, '../client/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback : toute route non-/api renvoie index.html pour laisser React Router gérer.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[static] Serveur de fichiers statiques activé sur ${clientDist}`);
}

app.listen(PORT, async () => {
  console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   Health : http://localhost:${PORT}/api/health`);
  console.log(`   Auth   : ${AUTH_DISABLED ? '⚠️  DÉSACTIVÉE (AUTH_DISABLED=true)' : '✅ activée'}\n`);

  // Seed admin initial si aucun user en base
  try {
    await authService.ensureInitialAdmin();
  } catch (e) {
    console.error('[boot] Seed admin :', e.message);
  }

  // Nettoyage périodique des sessions expirées (toutes les 6 h)
  setInterval(() => {
    try {
      const removed = authService.cleanExpiredSessions();
      if (removed > 0) console.log(`[sessions] ${removed} sessions expirées supprimées`);
    } catch (e) {
      console.warn('[sessions] cleanup:', e.message);
    }
  }, 6 * 3600 * 1000);

  // Démarre le poller SSIS auto-snapshot s'il est activé en base
  try {
    const autoSnapshot = require('./services/ssisAutoSnapshot');
    autoSnapshot.start();
  } catch (e) {
    console.warn('[boot] auto-snapshot init:', e.message);
  }
});
