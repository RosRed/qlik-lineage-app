'use strict';

/**
 * Reconstruction d'une app Qlik à partir d'un export au format Gitoqlok.
 *
 * L'Engine API est symétrique : chaque `Get` utilisé à l'export a son
 * `Create`/`Set` correspondant, et les fichiers JSON sont déjà exactement dans
 * la forme attendue — aucune conversion.
 *
 *   loadScript.qvs        → SetScript
 *   objects/dimensions/*  → CreateDimension
 *   objects/measures/*    → CreateMeasure
 *   objects/variables/*   → CreateVariableEx
 *   objects/sheets/*      → CreateObject puis SetFullPropertyTree (arbre complet)
 *   objects/appprops.json → SetFullPropertyTree sur l'objet appprops existant
 *
 * ⚠️ Règle de sûreté non négociable : on CRÉE toujours une app neuve, jamais on
 * n'écrit dans une app existante. Un import destructif sur une app de
 * production détruirait un travail irremplaçable.
 *
 * Les éléments maîtres sont créés AVANT les feuilles : un graphique qui utilise
 * une mesure maître la référence par `qLibraryId`, la cible doit exister.
 */

const fs = require('fs');
const path = require('path');
const { withDoc, withGlobal } = require('../lib/proxyClient');
const { collecter } = require('./gitoqlokExport');

/** Lit les fichiers JSON d'un sous-dossier d'objets, triés par nom. */
function lireDossier(dir, sous) {
  const d = path.join(dir, 'objects', sous);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({ fichier: f, contenu: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }));
}

/**
 * Inventaire d'un export + contrôle de forme. Chaque famille a une signature
 * attendue ; un fichier qui ne la respecte pas serait rejeté par l'Engine, on
 * préfère le dire avant d'ouvrir la moindre session.
 */
/**
 * Champs que l'Engine type en entier. Un fichier ecrit a la main (ou par un
 * assistant) y met facilement une chaine : `"qNoOfLeftDims": "-1"` au lieu de
 * `-1`. L'Engine repond alors « Invalid method parameter(s) » sans dire ou,
 * et l'arbre entier est rejete — diagnostique le 2026-09-20 sur les 3 feuilles
 * de GESTION DES INTERCOS (copie), ou 8 occurrences bloquaient tout.
 *
 * On corrige au lieu de refuser : la valeur voulue n'est pas ambigue.
 */
const CHAMPS_ENTIERS = new Set([
  'qNoOfLeftDims', 'qPseudoDimPos', 'qMaxStackedCells', 'qActiveField',
  'rank', 'columns', 'rows', 'gridResolution', 'col', 'row', 'colspan', 'rowspan',
]);

/** Convertit en nombre les entiers ecrits en chaine. Retourne les chemins corriges. */
function normaliserEntiers(valeur, corriges = [], chemin = '') {
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => normaliserEntiers(v, corriges, `${chemin}[${i}]`));
    return corriges;
  }
  if (!valeur || typeof valeur !== 'object') return corriges;
  for (const [cle, v] of Object.entries(valeur)) {
    if (CHAMPS_ENTIERS.has(cle) && typeof v === 'string' && /^-?\d+$/.test(v)) {
      valeur[cle] = parseInt(v, 10);
      corriges.push(`${chemin}/${cle}`);
    } else {
      normaliserEntiers(v, corriges, `${chemin}/${cle}`);
    }
  }
  return corriges;
}

function lireExport(dir) {
  if (!fs.existsSync(dir)) {
    throw Object.assign(new Error(`Dossier d'export introuvable : ${dir}`), { status: 404 });
  }

  const scriptPath = path.join(dir, 'loadScript.qvs');
  const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';

  const familles = {
    dimensions: { items: lireDossier(dir, 'dimensions'), cles: ['qInfo', 'qDim'] },
    measures:   { items: lireDossier(dir, 'measures'),   cles: ['qInfo', 'qMeasure'] },
    variables:  { items: lireDossier(dir, 'variables'),  cles: ['qInfo', 'qName'] },
    sheets:     { items: lireDossier(dir, 'sheets'),     cles: ['qProperty'] },
  };

  // Normalisation avant toute comparaison : sinon un entier ecrit en chaine
  // rendrait le fichier eternellement « different » de l'app, qui le stocke en
  // nombre — le diff mentirait a chaque passage.
  const normalises = [];
  for (const { fichier, contenu } of familles.sheets.items) {
    for (const chemin of normaliserEntiers(contenu)) normalises.push(`sheets/${fichier}${chemin}`);
  }

  const anomalies = [];
  for (const [nom, f] of Object.entries(familles)) {
    for (const { fichier, contenu } of f.items) {
      const manquantes = f.cles.filter(c => contenu[c] === undefined);
      if (manquantes.length) {
        anomalies.push(`${nom}/${fichier} : clés manquantes ${manquantes.join(', ')}`);
      }
    }
  }

  const appPropsPath = path.join(dir, 'objects', 'appprops.json');
  const appprops = fs.existsSync(appPropsPath)
    ? JSON.parse(fs.readFileSync(appPropsPath, 'utf8'))
    : [];

  // Objets d'image : sans le dossier appcontent, ils pointeront dans le vide.
  let imagesOrphelines = 0;
  const compterImages = (n) => {
    if (!n) return;
    const p = n.qProperty || n;
    if (p.qInfo && /text-image/i.test(p.qInfo.qType || '')) imagesOrphelines++;
    for (const c of (n.qChildren || [])) compterImages(c);
  };
  for (const s of familles.sheets.items) compterImages(s.contenu);
  const aAppContent = fs.existsSync(path.join(dir, 'appcontent'));

  const sections = fs.existsSync(path.join(dir, 'data_load_script'))
    ? fs.readdirSync(path.join(dir, 'data_load_script')).filter(f => f.endsWith('.qvs')).length
    : 0;

  return {
    dir,
    script,
    scriptChars: script.length,
    sections,
    dimensions: familles.dimensions.items,
    measures: familles.measures.items,
    variables: familles.variables.items,
    sheets: familles.sheets.items,
    normalises,
    appprops,
    anomalies,
    avertissements: [
      !script && 'loadScript.qvs absent ou vide — l\'app sera créée sans script',
      imagesOrphelines > 0 && !aAppContent &&
        `${imagesOrphelines} objet(s) text-image, mais aucun dossier appcontent dans l'export : les images seront manquantes`,
    ].filter(Boolean),
  };
}

/** Aperçu : ce qui serait créé, sans ouvrir la moindre session Qlik. */
function planifier(dir) {
  const e = lireExport(dir);
  return {
    dir: e.dir,
    scriptChars: e.scriptChars,
    sections: e.sections,
    compte: {
      dimensions: e.dimensions.length,
      measures: e.measures.length,
      variables: e.variables.length,
      sheets: e.sheets.length,
      appprops: e.appprops.length,
    },
    objetsDansFeuilles: e.sheets.reduce((n, s) => {
      const compter = (x) => 1 + (x.qChildren || []).reduce((m, c) => m + compter(c), 0);
      return n + compter(s.contenu) - 1;
    }, 0),
    anomalies: e.anomalies,
    avertissements: e.avertissements,
  };
}

/**
 * Crée une app neuve et y rejoue l'export.
 * @returns { appId, cree: {...}, erreurs: [] }
 */
async function reconstruire(config, dir, appName) {
  const e = lireExport(dir);
  if (e.anomalies.length) {
    throw Object.assign(
      new Error(`Export non conforme : ${e.anomalies.slice(0, 3).join(' | ')}`),
      { status: 400 }
    );
  }

  // 1. App neuve — jamais une app existante.
  const appId = await withGlobal(config, async ({ send }) => {
    const r = await send('CreateApp', -1, [appName]);
    if (!r.qSuccess) throw new Error(`CreateApp a échoué pour « ${appName} »`);
    return r.qAppId;
  });

  const cree = { dimensions: 0, measures: 0, variables: 0, sheets: 0, appprops: 0 };
  const erreurs = [];

  await withDoc(config, appId, async ({ send, handle }) => {
    // 2. Script, puis sauvegarde immédiate : si la suite échoue, le script est acquis.
    if (e.script) {
      await send('SetScript', handle, [e.script]);
      await send('DoSave', handle, []);
    }

    // 3. Éléments maîtres AVANT les feuilles (référencés par qLibraryId).
    const creerSimple = async (items, methode, famille) => {
      for (const { fichier, contenu } of items) {
        try {
          await send(methode, handle, [contenu]);
          cree[famille]++;
        } catch (err) {
          erreurs.push(`${famille}/${fichier} : ${err.message}`);
        }
      }
    };
    await creerSimple(e.dimensions, 'CreateDimension', 'dimensions');
    await creerSimple(e.measures, 'CreateMeasure', 'measures');
    await creerSimple(e.variables, 'CreateVariableEx', 'variables');

    // 4. Feuilles : l'objet d'abord, puis l'arbre complet de ses enfants.
    for (const { fichier, contenu } of e.sheets) {
      try {
        const r = await send('CreateObject', handle, [contenu.qProperty]);
        const h = r.qReturn && r.qReturn.qHandle;
        if (h === undefined || h === null) throw new Error('CreateObject sans handle');
        if ((contenu.qChildren || []).length) {
          await send('SetFullPropertyTree', h, [contenu]);
        }
        cree.sheets++;
      } catch (err) {
        erreurs.push(`sheets/${fichier} : ${err.message}`);
      }
    }

    // 5. Apparence : l'objet appprops existe déjà dans une app neuve, on le met à jour.
    for (const arbre of e.appprops) {
      try {
        const id = arbre.qProperty && arbre.qProperty.qInfo && arbre.qProperty.qInfo.qId;
        if (!id) continue;
        const r = await send('GetObject', handle, [id]).catch(() => null);
        const h = r && r.qReturn && r.qReturn.qHandle;
        if (h) { await send('SetFullPropertyTree', h, [arbre]); cree.appprops++; }
      } catch (err) {
        erreurs.push(`appprops : ${err.message}`);
      }
    }

    await send('DoSave', handle, []);
    // noData: false par cohérence — une app neuve n'a pas de données, mais la
    // règle « qui sauvegarde ouvre avec les données » ne souffre pas d'exception.
  }, { timeoutMs: 180000, noData: false });

  return { appId, appName, cree, erreurs };
}

/** Suppression d'une app — réservée au nettoyage des essais. */
async function supprimer(config, appId) {
  return withGlobal(config, async ({ send }) => {
    const r = await send('DeleteApp', -1, [appId]);
    return !!r.qSuccess;
  });
}


// ─── Réapplication dans une app existante ────────────────────────────────────

/** Champs que Qlik régénère : les ignorer évite un diff de bruit. */
const VOLATILS = new Set(['changeHash', 'modifiedDate', 'createdDate', 'qStateName']);

/**
 * L'ordre de `qChildren` n'a aucune portee : la disposition d'une feuille est
 * portee par `qProperty.cells`, pas par la position dans le tableau. Or Qlik
 * renvoie ses enfants dans son propre ordre (celui de creation), qui n'est pas
 * celui du fichier. Comparer positionnellement declarait donc la feuille
 * « a mettre a jour » indefiniment, meme apres une application reussie —
 * constate le 2026-09-21 sur Dashboard : 0 ecart une fois apparie par id.
 */
function trierEnfants(l) {
  return [...l].sort((x, y) => {
    const i = a => String((((a || {}).qProperty || {}).qInfo || {}).qId || '');
    return i(x) < i(y) ? -1 : i(x) > i(y) ? 1 : 0;
  });
}

function normaliser(o) {
  if (Array.isArray(o)) return o.map(normaliser);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o).sort()) {
      if (VOLATILS.has(k)) continue;
      out[k] = k === 'qChildren' && Array.isArray(o[k])
        ? trierEnfants(o[k]).map(normaliser)
        : normaliser(o[k]);
    }
    return out;
  }
  return o;
}

const memeContenu = (a, b) => JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b));

/** Identifiant d'un objet, quelle que soit sa famille. */
const idDe = (o) => {
  const p = o.qProperty || o;
  return p.qInfo && p.qInfo.qId;
};

/**
 * Compare un dossier d'export à l'état courant d'une app.
 *
 * Rien n'est écrit. Les orphelins — présents dans l'app mais absents des
 * fichiers — sont signalés SANS être supprimés : une suppression d'objet Qlik
 * est irréversible, elle doit rester un choix explicite.
 */
async function comparer(config, qlikAppId, dir) {
  const fichiers = lireExport(dir);
  const app = await collecter(config, qlikAppId);

  const plan = { script: null, familles: {} };

  const scriptApp = app.script || '';
  if (fichiers.script !== scriptApp) {
    plan.script = {
      action: 'remplacer',
      caracteresAvant: scriptApp.length,
      caracteresApres: fichiers.script.length,
    };
  }

  const familles = [
    ['dimensions', fichiers.dimensions, app.collectes.dimensions],
    ['measures', fichiers.measures, app.collectes.measures],
    ['variables', fichiers.variables, app.collectes.variables],
    ['sheets', fichiers.sheets, app.collectes.sheets],
  ];

  for (const [nom, cotesFichiers, cotesApp] of familles) {
    const parIdApp = new Map(cotesApp.map(x => [x.id, x.props]));
    const vus = new Set();
    const creer = [], majour = [], inchanges = [];

    for (const { fichier, contenu } of cotesFichiers) {
      const id = idDe(contenu);
      if (!id) { creer.push({ fichier, raison: 'sans identifiant' }); continue; }
      vus.add(id);
      const actuel = parIdApp.get(id);
      if (!actuel) creer.push({ fichier, id });
      else if (memeContenu(actuel, contenu)) inchanges.push({ fichier, id });
      else majour.push({ fichier, id });
    }

    const orphelins = cotesApp
      .filter(x => !vus.has(x.id))
      .map(x => ({ id: x.id, titre: ((x.props.qProperty || x.props).qMetaDef || {}).title || x.props.qName || x.id }));

    plan.familles[nom] = { creer, majour, inchanges: inchanges.length, orphelins };
  }

  return plan;
}

/**
 * Applique un dossier d'export sur une app EXISTANTE.
 *
 * @param portees  sous-ensemble de ['script','master','sheets'] — rien n'est
 *                 touché en dehors des portées demandées.
 * @param supprimerOrphelins  false par défaut : un objet présent dans l'app
 *                 mais absent des fichiers est conservé. Le passer à true
 *                 supprime définitivement — à n'utiliser qu'en connaissance.
 */
async function appliquer(config, qlikAppId, dir, { portees = ['script'], supprimerOrphelins = false } = {}) {
  const fichiers = lireExport(dir);
  if (fichiers.anomalies.length) {
    throw Object.assign(new Error(`Export non conforme : ${fichiers.anomalies.slice(0, 3).join(' | ')}`), { status: 400 });
  }

  for (const chemin of fichiers.normalises) console.warn(`[Apply] entier ecrit en chaine, corrige : ${chemin}`);

  const plan = await comparer(config, qlikAppId, dir);
  const fait = { script: false, crees: 0, majours: 0, supprimes: 0, normalises: fichiers.normalises.length };
  const erreurs = [];

  await withDoc(config, qlikAppId, async ({ send, handle }) => {
    if (portees.includes('script') && plan.script) {
      await send('SetScript', handle, [fichiers.script]);
      fait.script = true;
    }

    const familles = [];
    if (portees.includes('master')) {
      familles.push(
        ['dimensions', fichiers.dimensions, 'CreateDimension', 'GetDimension'],
        ['measures', fichiers.measures, 'CreateMeasure', 'GetMeasure'],
        ['variables', fichiers.variables, 'CreateVariableEx', 'GetVariableById'],
      );
    }
    if (portees.includes('sheets')) {
      familles.push(['sheets', fichiers.sheets, 'CreateObject', 'GetObject']);
    }

    for (const [nom, items, creerMethode, lireMethode] of familles) {
      const p = plan.familles[nom];
      const aCreer = new Set(p.creer.map(x => x.fichier));
      const aMajour = new Set(p.majour.map(x => x.fichier));

      for (const { fichier, contenu } of items) {
        try {
          if (aCreer.has(fichier)) {
            const charge = nom === 'sheets' ? contenu.qProperty : contenu;
            const r = await send(creerMethode, handle, [charge]);
            const h = r.qReturn && r.qReturn.qHandle;
            if (nom === 'sheets' && h != null && (contenu.qChildren || []).length) {
              await send('SetFullPropertyTree', h, [contenu]);
            }
            fait.crees++;
          } else if (aMajour.has(fichier)) {
            const r = await send(lireMethode, handle, [idDe(contenu)]);
            const h = r.qReturn && r.qReturn.qHandle;
            if (h == null) throw new Error("objet introuvable dans l'app");
            if (nom === 'sheets') await send('SetFullPropertyTree', h, [contenu]);
            else await send('SetProperties', h, [contenu]);
            fait.majours++;
          }
        } catch (err) {
          erreurs.push(`${nom}/${fichier} : ${err.message}`);
        }
      }

      if (supprimerOrphelins) {
        for (const o of p.orphelins) {
          try {
            const methode = nom === 'sheets' ? 'DestroyObject'
              : nom === 'measures' ? 'DestroyMeasure'
              : nom === 'dimensions' ? 'DestroyDimension' : 'DestroyVariableById';
            await send(methode, handle, [o.id]);
            fait.supprimes++;
          } catch (err) {
            erreurs.push(`${nom}/${o.titre} (suppression) : ${err.message}`);
          }
        }
      }
    }

    await send('DoSave', handle, []);
    // noData: false — sans cela, le DoSave ci-dessus viderait l'app de ses données.
  }, { timeoutMs: 180000, noData: false });

  return { plan, fait, erreurs };
}

module.exports = { planifier, reconstruire, supprimer, lireExport, comparer, appliquer };
