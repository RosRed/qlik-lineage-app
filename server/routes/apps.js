const express = require('express');
const router = express.Router();
const db = require('../database');
const { buildAppQvdUsage } = require('../services/appQvdUsage');
const path = require('path');
const { exportApp } = require('../services/gitoqlokExport');
const { comparer, appliquer } = require('../services/gitoqlokImport');
const { qrsRequest } = require('../lib/proxyClient');

// GET /api/apps — avec indicateur d'analyse (pour les filtres de la sidebar)
// Les apps soft-deleted (`deleted_at IS NOT NULL`) sont exclues par défaut ;
// passer `?includeDeleted=1` pour voir la corbeille (page dédiée).
router.get('/', (req, res) => {
  const includeDeleted = req.query.includeDeleted === '1';
  const where = includeDeleted ? '' : 'WHERE a.deleted_at IS NULL';
  const apps = db.prepare(`
    SELECT a.*, CASE WHEN an.id IS NULL THEN 0 ELSE 1 END AS analyzed
    FROM apps a
    LEFT JOIN (SELECT DISTINCT app_id, MIN(id) AS id FROM analyses GROUP BY app_id) an ON an.app_id = a.id
    ${where}
    ORDER BY a.updated_at DESC
  `).all();
  res.json(apps);
});

// GET /api/apps/trash — liste des apps en corbeille uniquement
router.get('/trash', (req, res) => {
  const apps = db.prepare(`
    SELECT id, name, qlik_app_id, stream, last_reload, deleted_at
    FROM apps
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all();
  res.json(apps);
});

// POST /api/apps
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis' });
  }
  const result = db.prepare('INSERT INTO apps (name) VALUES (?)').run(name.trim());
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(app);
});

// PUT /api/apps/:id
router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom est requis' });
  }
  db.prepare('UPDATE apps SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name.trim(), req.params.id);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });
  res.json(app);
});

// DELETE /api/apps/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'App introuvable' });
  res.json({ success: true });
});

// POST /api/apps/:id/scripts
router.post('/:id/scripts', (req, res) => {
  const { content, filename } = req.body;
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App introuvable' });

  db.prepare('DELETE FROM scripts WHERE app_id = ?').run(req.params.id);
  const result = db.prepare('INSERT INTO scripts (app_id, content, filename) VALUES (?, ?, ?)')
    .run(req.params.id, content, filename || 'script.qvs');
  db.prepare('UPDATE apps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  res.status(201).json({ id: result.lastInsertRowid, content, filename });
});

// GET /api/apps/:id/scripts
router.get('/:id/scripts', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE app_id = ? ORDER BY uploaded_at DESC LIMIT 1')
    .get(req.params.id);
  res.json(script || null);
});

// GET /api/apps/:id/analysis
router.get('/:id/analysis', (req, res) => {
  const analysis = db.prepare('SELECT * FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1')
    .get(req.params.id);
  if (!analysis) return res.json(null);
  res.json({ ...analysis, result: JSON.parse(analysis.result) });
});

/** Dossier d'export d'une app — meme regle partout (route + comparaison). */
function dossierExport(app) {
  const base = process.env.EXPORT_DIR || './data/exports';
  const nom = String(app.name).replace(/[\\/:*?"<>|]/g, '_').trim() || `app-${app.id}`;
  return path.resolve(base, nom);
}

/**
 * Garde-fou : on refuse d'ecrire dans une app PUBLIEE.
 *
 * Une app publiee est dans un stream, donc en production : des utilisateurs
 * s'en servent, des taches la rechargent, et rejouer des fichiers dessus
 * ecraserait un travail qui n'est pas le notre. Le workflow prevu est
 * « dupliquer, modifier la copie » — et une copie fraiche est non publiee.
 *
 * L'etat est relu dans QRS au moment de l'ecriture, jamais dans la base
 * locale : celle-ci peut dater de plusieurs heures, et se tromper ici coute
 * cher. Le controle vit cote serveur, pas dans l'interface — masquer un
 * bouton n'empeche personne d'appeler la route.
 */
async function refuserSiProduction(config, app) {
  if (process.env.ALLOW_APPLY_PUBLISHED === 'true') return null;

  let publiee = !!app.published;   // repli si QRS ne repond pas
  let stream = app.stream || null;
  try {
    const live = (await qrsRequest(config, `/app/full?filter=id eq ${app.qlik_app_id}`))[0];
    if (live) {
      publiee = !!live.published;
      stream = live.stream ? live.stream.name : null;
    }
  } catch (e) {
    console.warn('[Apply] etat QRS indisponible, on se fie a la base locale :', e.message);
  }

  if (!publiee) return null;
  return {
    error: `« ${app.name} » est publiée${stream ? ` dans le stream « ${stream} »` : ''} : `
      + `l'application de modifications y est interdite. Dupliquez-la et travaillez sur la copie.`,
    published: true,
    stream
  };
}

// POST /api/apps/:id/duplicate
// Duplique l'app cote Qlik puis l'enregistre en base.
// On passe par la copie QRS et non par une reconstruction depuis l'export :
// elle embarque les donnees, les images et les stories (6 Mo contre 140 Ko),
// c'est-a-dire tout ce que l'export ne couvre pas.
router.post('/:id/duplicate', async (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application non trouvee' });
  if (!app.qlik_app_id) {
    return res.status(400).json({ error: "Cette app n'est pas liee au serveur Qlik" });
  }
  const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!config || !config.host) return res.status(400).json({ error: 'Connexion Qlik non configuree' });

  const nom = (req.body && req.body.name) || `${app.name} (copie)`;

  try {
    const copie = await qrsRequest(
      config,
      `/app/${app.qlik_app_id}/copy?name=${encodeURIComponent(nom)}`,
      { method: 'POST', body: {} }
    );

    const existe = db.prepare('SELECT id FROM apps WHERE qlik_app_id = ?').get(copie.id);
    let localId;
    if (existe) {
      localId = existe.id;
    } else {
      const r = db.prepare(`INSERT INTO apps
          (name, qlik_app_id, stream, origin, published, owner, file_size, created_date, modified_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(copie.name, copie.id, null, 'qlik-server', 0,
          copie.owner ? `${copie.owner.userDirectory}\\${copie.owner.userId}` : null,
          copie.fileSize || null, copie.createdDate || null, copie.modifiedDate || null);
      localId = r.lastInsertRowid;
    }

    res.json({
      appId: localId,
      qlikAppId: copie.id,
      name: copie.name,
      owner: copie.owner ? `${copie.owner.userDirectory}\\${copie.owner.userId}` : null,
      fileSize: copie.fileSize || null
    });
  } catch (e) {
    console.error('[Duplicate]', e);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/apps/:id/export/diff
// Apercu : ce que la reapplication changerait. N'ecrit rien.
router.get('/:id/export/diff', async (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application non trouvee' });
  if (!app.qlik_app_id) return res.status(400).json({ error: "Cette app n'est pas liee au serveur Qlik" });
  const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!config || !config.host) return res.status(400).json({ error: 'Connexion Qlik non configuree' });

  try {
    const dir = dossierExport(app);
    const plan = await comparer(config, app.qlik_app_id, dir);
    // L'apercu reste consultable sur une app publiee — c'est l'ECRITURE qui est
    // interdite. On annonce le verdict pour que l'interface le dise avant le clic.
    const refus = await refuserSiProduction(config, app);
    res.json({ dir, ...plan, verrouille: refus || null });
  } catch (e) {
    console.error('[Diff]', e);
    res.status(e.status || 502).json({ error: e.message });
  }
});

// POST /api/apps/:id/export/apply
// Rejoue le dossier d'export sur l'app. Les portees limitent ce qui est touche ;
// la suppression des orphelins est refusee par defaut (geste irreversible).
router.post('/:id/export/apply', async (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application non trouvee' });
  if (!app.qlik_app_id) return res.status(400).json({ error: "Cette app n'est pas liee au serveur Qlik" });
  const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!config || !config.host) return res.status(400).json({ error: 'Connexion Qlik non configuree' });

  const refus = await refuserSiProduction(config, app);
  if (refus) return res.status(403).json(refus);

  const AUTORISEES = ['script', 'master', 'sheets'];
  const portees = (Array.isArray(req.body && req.body.portees) ? req.body.portees : ['script'])
    .filter(p => AUTORISEES.includes(p));
  if (!portees.length) return res.status(400).json({ error: 'Aucune portee valide demandee' });

  try {
    const dir = dossierExport(app);
    const r = await appliquer(config, app.qlik_app_id, dir, {
      portees,
      supprimerOrphelins: !!(req.body && req.body.supprimerOrphelins)
    });
    // Les echecs par objet ne remontent pas comme exceptions : sans cette trace
    // le client affichait « voir les logs serveur » alors que rien n'y figurait.
    for (const msg of r.erreurs) console.error(`[Apply] ${app.name} : ${msg}`);
    res.json({ dir, portees, ...r });
  } catch (e) {
    console.error('[Apply]', e);
    res.status(e.status || 502).json({ error: e.message });
  }
});

// POST /api/apps/:id/export/gitoqlok
// Écrit l'app au format Gitoqlok dans un dossier serveur, prêt à être versionné.
// La destination est fixée par EXPORT_DIR (défaut ./data/exports) : le client ne
// choisit PAS le chemin, sinon la route deviendrait une écriture arbitraire sur
// le disque du serveur.
router.post('/:id/export/gitoqlok', async (req, res) => {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application non trouvée' });
  if (!app.qlik_app_id) {
    return res.status(400).json({ error: "Cette app n'est pas liée au serveur Qlik (aucun qlik_app_id)" });
  }
  const config = db.prepare('SELECT * FROM qlik_config WHERE id = 1').get();
  if (!config || !config.host) return res.status(400).json({ error: 'Connexion Qlik non configurée' });

  // Même calcul que le diff et l'application : un seul endroit, sinon
  // l'export écrirait dans un dossier et la comparaison lirait dans un autre.
  const outDir = dossierExport(app);

  try {
    const r = await exportApp(config, app.qlik_app_id, outDir);
    res.json({ ...r, appName: app.name });
  } catch (e) {
    console.error('[Export Gitoqlok]', e);
    res.status(502).json({ error: e.message });
  }
});

// GET /api/apps/:id/qvd-usage
// Croisement inter-apps : qui produit les QVD que cette app lit, qui consomme
// ceux qu'elle écrit. Renvoie 404 si l'app n'existe pas.
router.get('/:id/qvd-usage', (req, res) => {
  const usage = buildAppQvdUsage(req.params.id);
  if (!usage) return res.status(404).json({ error: 'Application non trouvée' });
  res.json(usage);
});

// GET /api/apps/:id/export/lineage
router.get('/:id/export/lineage', (req, res) => {
  const analysis = db.prepare('SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1')
    .get(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Aucune analyse disponible' });

  const data = JSON.parse(analysis.result);
  const lineage = data.lineage || [];

  const headers = ['Champ Qlik', 'Table Qlik', 'Champ Source', 'Table Source', 'Transformation'];
  const rows = lineage.map(l =>
    [l.fieldQlik, l.tableQlik, l.fieldSource, l.tableSource, l.transformation]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lineage-app-${req.params.id}.csv"`);
  res.send('﻿' + csv);
});

module.exports = router;
