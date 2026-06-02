require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use('/api', require('./routes'));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.listen(PORT, () => {
  console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   Health : http://localhost:${PORT}/api/health\n`);
});
