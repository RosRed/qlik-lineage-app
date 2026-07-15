require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

require('./database');

const app = express();
// API_PORT en priorité — la variable PORT peut être injectée par l'outil de preview
// (elle vaut alors le port Vite 5173, ce qui casserait le proxy /api → 3001)
const PORT = process.env.API_PORT || (process.env.PORT !== '5173' ? process.env.PORT : null) || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use('/api', require('./routes'));

app.get('/api/health', (req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasApiKey: !!process.env.ANTHROPIC_API_KEY
  })
);

app.listen(PORT, () => {
  console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   Health : http://localhost:${PORT}/api/health\n`);
});
