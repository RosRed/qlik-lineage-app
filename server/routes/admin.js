'use strict';

/**
 * Routes d'administration de la base locale :
 *   - reset complet des apps (la config serveur Qlik est conservée)
 *   - une sauvegarde du fichier .db est faite avant chaque reset
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../database');

// POST /api/admin/reset — vide apps, scripts, analyses, chat (garde qlik_config et api_usage)
router.post('/reset', (req, res) => {
  try {
    // Sauvegarde du fichier avant purge
    const dbPath = process.env.DATABASE_PATH || './data/lineage.db';
    if (fs.existsSync(dbPath)) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const backup = path.join(path.dirname(dbPath), `lineage.backup-${stamp}.db`);
      fs.copyFileSync(dbPath, backup);
    }

    db.exec('DELETE FROM chat_messages');
    db.exec('DELETE FROM analyses');
    db.exec('DELETE FROM scripts');
    db.exec('DELETE FROM apps');
    db.exec('VACUUM');

    console.log('[Admin] Base réinitialisée (apps/scripts/analyses/chat vidés)');
    res.json({ success: true, message: 'Base vidée — la configuration serveur est conservée.' });
  } catch (e) {
    console.error('[Admin]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
