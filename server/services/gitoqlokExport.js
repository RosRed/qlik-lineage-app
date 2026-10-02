'use strict';

/**
 * Export d'une app Qlik au format Gitoqlok — l'arborescence que produisent déjà
 * les dépôts du groupe (BFR, OBJECTIF-PDR, Batch_Frequence_dwh…), pour que les
 * exports de cet outil soient interchangeables avec les leurs :
 *
 *   loadScript.qvs                  script complet
 *   data_load_script/
 *     <Section>.qvs                 une par onglet Qlik
 *     tab_order.txt                 ordre des onglets
 *   objects/
 *     appprops.json                 [{ qProperty, qChildren }]
 *     fields.json
 *     glossarylinks.json
 *     measures/<qId>.json           { qInfo, qMeasure, qMetaDef }
 *     dimensions/<qId>.json         { qInfo, qDim, qMetaDef }
 *     variables/<qId>.json          { qInfo, qMetaDef, qName, qDefinition, … }
 *     sheets/<qId>.json             { qProperty, qChildren }  (arbre complet)
 *
 * Vérifié contre le serveur : `GetProperties` sur une mesure rend exactement
 * {qInfo,qMeasure,qMetaDef}, et `GetFullPropertyTree` sur une feuille rend
 * {qProperty,qChildren} avec ses objets imbriqués. Aucune conversion n'est
 * nécessaire, on écrit ce que l'Engine renvoie.
 *
 * Lecture seule : `withDoc` ouvre le document en nodata, rien n'est écrit dans
 * l'app. Le dossier de sortie, lui, est remplacé à chaque export.
 */

const fs = require('fs');
const path = require('path');
const { withDoc } = require('../lib/proxyClient');

const TAB_DIVIDER = '%tab_file_order_divider%';

/** Caractères interdits dans un nom de fichier Windows/POSIX. */
function safeFileName(name) {
  return String(name || 'sans-nom')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+$/, '')
    .slice(0, 120) || 'sans-nom';
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Découpe le script sur les marqueurs d'onglet `///$tab Nom`.
 * Le contenu avant le premier marqueur (rare) est rattaché à un onglet « Main »
 * pour ne rien perdre.
 */
function splitTabs(script) {
  const parts = String(script || '').split(/^\/\/\/\$tab (.*)$/m);
  const tabs = [];
  if (parts[0] && parts[0].trim()) tabs.push({ name: 'Main', content: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    tabs.push({ name: parts[i].trim() || `Section ${(i + 1) / 2}`, content: parts[i + 1] || '' });
  }
  return tabs;
}

/** Liste d'objets de l'app via un session object, puis propriétés de chacun. */
async function fetchList(send, handle, { listDef, listKey, getMethod, tree }) {
  const so = await send('CreateSessionObject', handle, [listDef]);
  const layout = (await send('GetLayout', so.qReturn.qHandle, [])).qLayout || {};
  const items = (layout[listKey] || {}).qItems || [];

  const out = [];
  for (const item of items) {
    const id = item.qInfo && item.qInfo.qId;
    if (!id) continue;
    const ref = await send(getMethod, handle, [id]);
    const h = ref.qReturn && ref.qReturn.qHandle;
    if (h === undefined || h === null) continue;
    // Les feuilles et appprops portent des enfants : seul GetFullPropertyTree
    // les ramène. Les mesures/dimensions/variables n'en ont pas.
    const props = tree
      ? (await send('GetFullPropertyTree', h, [])).qPropEntry
      : (await send('GetProperties', h, [])).qProp;
    out.push({ id, props });
  }
  return out;
}

const DEFS = {
  measures: {
    listDef: { qInfo: { qType: 'MeasureList' }, qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title' } } },
    listKey: 'qMeasureList', getMethod: 'GetMeasure', tree: false
  },
  dimensions: {
    listDef: { qInfo: { qType: 'DimensionList' }, qDimensionListDef: { qType: 'dimension', qData: { title: '/qMetaDef/title' } } },
    listKey: 'qDimensionList', getMethod: 'GetDimension', tree: false
  },
  variables: {
    listDef: {
      qInfo: { qType: 'VariableList' },
      qVariableListDef: { qType: 'variable', qShowReserved: false, qShowConfig: false, qData: { tags: '/tags' } }
    },
    listKey: 'qVariableList', getMethod: 'GetVariableById', tree: false
  },
  sheets: {
    listDef: { qInfo: { qType: 'SheetList' }, qAppObjectListDef: { qType: 'sheet', qData: { title: '/qMetaDef/title' } } },
    listKey: 'qAppObjectList', getMethod: 'GetObject', tree: true
  },
};

/**
 * @param config    configuration Qlik (table qlik_config)
 * @param qlikAppId id de l'app côté serveur Qlik
 * @param outDir    dossier de destination — son contenu est remplacé
 */
/**
 * Lit l'état courant d'une app : script + tous les objets, sans rien écrire.
 * Extrait d'`exportApp` pour que la comparaison « fichiers ↔ app » puisse
 * réutiliser exactement la même lecture — sinon les deux finiraient par
 * diverger et le diff mentirait.
 */
async function collecter(config, qlikAppId, { timeoutMs = 120000 } = {}) {
  return withDoc(config, qlikAppId, async ({ send, handle }) => {
    const script = (await send('GetScript', handle, [])).qScript || '';

    const collectes = {};
    for (const [nom, def] of Object.entries(DEFS)) {
      collectes[nom] = await fetchList(send, handle, def);
    }

    // appprops est une liste d'arbres, écrite en tableau (format Gitoqlok)
    const appprops = await fetchList(send, handle, {
      listDef: { qInfo: { qType: 'AppPropsList' }, qAppObjectListDef: { qType: 'appprops', qData: {} } },
      listKey: 'qAppObjectList', getMethod: 'GetObject', tree: true
    });

    return { script, collectes, appprops };
  }, { timeoutMs });
}

async function exportApp(config, qlikAppId, outDir, { timeoutMs = 120000 } = {}) {
  const resume = await collecter(config, qlikAppId, { timeoutMs });

  // ── Écriture.
  //
  // On nettoie pour qu'une mesure supprimée côté Qlik se traduise par une
  // suppression de fichier, donc par un diff Git honnête — mais UNIQUEMENT les
  // chemins que cet export gère. Effacer tout le dossier détruirait le `.git`,
  // les README et le dossier `appcontent/` d'un dépôt existant : viser son
  // propre dépôt cloné avec EXPORT_DIR est justement l'usage attendu.
  fs.mkdirSync(outDir, { recursive: true });
  for (const gere of ['loadScript.qvs', 'data_load_script', 'objects']) {
    fs.rmSync(path.join(outDir, gere), { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(outDir, 'loadScript.qvs'), resume.script, 'utf8');

  const tabs = splitTabs(resume.script);
  const scriptDir = path.join(outDir, 'data_load_script');
  fs.mkdirSync(scriptDir, { recursive: true });
  const utilises = new Set();
  for (const tab of tabs) {
    let base = safeFileName(tab.name);
    // Deux onglets peuvent porter le même nom (« Section » revient souvent) :
    // on suffixe pour ne pas en perdre un à l'écriture.
    let nom = base, n = 1;
    while (utilises.has(nom.toLowerCase())) nom = `${base} (${++n})`;
    utilises.add(nom.toLowerCase());
    fs.writeFileSync(path.join(scriptDir, `${nom}.qvs`), tab.content, 'utf8');
  }
  fs.writeFileSync(path.join(scriptDir, 'tab_order.txt'),
    tabs.map(t => t.name).join(TAB_DIVIDER), 'utf8');

  const objectsDir = path.join(outDir, 'objects');
  fs.mkdirSync(objectsDir, { recursive: true });
  for (const [nom, items] of Object.entries(resume.collectes)) {
    for (const { id, props } of items) {
      writeJson(path.join(objectsDir, nom, `${safeFileName(id)}.json`), props);
    }
  }
  writeJson(path.join(objectsDir, 'appprops.json'), resume.appprops.map(a => a.props));
  // Présents dans les dépôts Gitoqlok et vides sur toutes les apps observées :
  // on les crée pour que l'arborescence reste comparable fichier à fichier.
  writeJson(path.join(objectsDir, 'fields.json'), []);
  writeJson(path.join(objectsDir, 'glossarylinks.json'), []);

  return {
    outDir,
    scriptChars: resume.script.length,
    tabs: tabs.length,
    counts: Object.fromEntries(
      Object.entries(resume.collectes).map(([k, v]) => [k, v.length])
    ),
    appprops: resume.appprops.length
  };
}

module.exports = { exportApp, collecter, splitTabs, safeFileName, TAB_DIVIDER };
