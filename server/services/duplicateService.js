'use strict';

/**
 * Détection de doublons dans le lineage global :
 *   1. Familles de QVD versionnés (action1v1.qvd, action1v2.qvd → même racine)
 *   2. Batchs jumeaux (apps qui produisent des QVD dans les mêmes familles)
 *
 * S'appuie sur le résultat de buildGlobalLineage — pas d'accès direct à la
 * base ou à Qlik. Peut donc être mis en cache indépendamment.
 */

const { buildGlobalLineage } = require('./globalLineage');

// ─── Normalisation des noms de QVD ────────────────────────────────────────────

/**
 * Suffixes considérés comme des variantes de la même famille.
 * Les patterns sont testés dans l'ordre et cumulés (un nom peut avoir plusieurs
 * suffixes empilés : `ventes_2024_final_v3.qvd`).
 *
 * Chaque motif est ancré à la FIN du nom, entre `_` (ou `-`, ` `, `.`) et le
 * `.qvd` final. Le trim des suffixes se fait en boucle jusqu'à stabilité.
 */
const VERSION_SUFFIX_RE = [
  /[_\-\s.]v\d+$/i,                 // _v1, -v12, .v3
  /[_\-\s.]?\d+$/,                  // _2, -12, ' 3' — attention : glouton, appliqué en DERNIER
  /[_\-\s.](\d{6,8})$/,             // _20231201, _202312
  /[_\-\s.](19|20)\d{2}(-?\d{2})?$/,// _2023, _2023-12
  /[_\-\s.](final|new|old|latest|backup|save|copy|copie|bkp|bak|temp|tmp|test|prod|dev|preprod)$/i,
  /\(\d+\)$/,                       // (1), (2)
  /[_\-\s.](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|fev|mars|avr|mai|juin|juil|aout|sept|oct|nov|dec)$/i
];

/**
 * Retire itérativement les suffixes de version pour trouver la « racine » du
 * QVD. `ventes_2024_v3.qvd` → `ventes`. La chaîne finale est renvoyée sans le
 * `.qvd` — ce qui rend les racines lisibles à l'affichage.
 *
 * On empile les patterns du plus spécifique au plus glouton, et on ne prend
 * le pattern `\d+$` (numérique nu) qu'en dernier recours, pour ne pas manger
 * un identifiant qui ferait vraiment partie du nom.
 */
function rootOf(qvdName) {
  if (!qvdName) return null;
  let base = qvdName.toLowerCase().replace(/\.qvd$/, '');

  let changed = true;
  while (changed) {
    changed = false;
    // Patterns « qualitatifs » d'abord (date, mois, mot-clé)
    for (const re of VERSION_SUFFIX_RE.slice(0, -1)) {
      if (re.test(base)) {
        const stripped = base.replace(re, '');
        // Ne pas tomber sous 2 caractères — sinon on obtient des racines
        // vides ou des collisions absurdes (« a » regrouperait tout).
        if (stripped.length >= 2 && stripped !== base) {
          base = stripped;
          changed = true;
        }
      }
    }
  }

  // Dernier passage : numérique en fin (v3, _12, ' 4'…). Une seule fois pour
  // ne pas dévorer les identifiants légitimes.
  const numericTail = /[_\-\s.]?(\d+)$/.exec(base);
  if (numericTail && base.length - numericTail[0].length >= 3) {
    base = base.slice(0, base.length - numericTail[0].length);
  }

  // Nettoie les séparateurs qui pendent (`ventes_` → `ventes`)
  base = base.replace(/[_\-\s.]+$/, '');
  return base.length >= 2 ? base : qvdName.toLowerCase().replace(/\.qvd$/, '');
}

// ─── Familles de QVD ──────────────────────────────────────────────────────────

/**
 * Regroupe les QVD par racine. Ne renvoie que les familles à ≥2 variantes.
 * Pour chaque variante : statut (orphelin / ok / externe) et compteurs
 * producteurs/consommateurs, pour repérer d'un coup d'œil la variante à
 * supprimer.
 */
function detectQvdFamilies(qvds) {
  const byRoot = new Map();

  for (const q of qvds) {
    const root = rootOf(q.name);
    if (!root) continue;
    if (!byRoot.has(root)) byRoot.set(root, { root, variants: [] });
    byRoot.get(root).variants.push({
      name: q.name,
      status: q.status,
      producers: q.producers.map(p => ({ appId: p.appId, appName: p.appName, stream: p.stream, tableName: p.tableName })),
      consumers: q.consumers.map(c => ({ appId: c.appId, appName: c.appName, stream: c.stream })),
      producerCount: q.producers.length,
      consumerCount: q.consumers.length
    });
  }

  const families = [];
  for (const fam of byRoot.values()) {
    if (fam.variants.length < 2) continue;

    // Tri : les orphelines en tête, puis par ordre alpha — les candidats à la
    // suppression sont ainsi visibles immédiatement.
    fam.variants.sort((a, b) => {
      const order = { orphelin: 0, externe: 1, ok: 2 };
      return (order[a.status] - order[b.status]) || a.name.localeCompare(b.name);
    });

    const orphaned = fam.variants.filter(v => v.status === 'orphelin').length;
    const active = fam.variants.filter(v => v.consumerCount > 0).length;

    families.push({
      root: fam.root,
      variantCount: fam.variants.length,
      orphaned,
      active,
      // Score de priorité : plus il y a de versions orphelines dans la
      // famille, plus le nettoyage est rentable.
      cleanupScore: orphaned * 3 + fam.variants.length,
      variants: fam.variants
    });
  }

  // Familles les plus rentables à nettoyer en premier
  families.sort((a, b) => b.cleanupScore - a.cleanupScore || a.root.localeCompare(b.root));
  return families;
}

// ─── Batchs jumeaux ───────────────────────────────────────────────────────────

/**
 * Deux apps sont candidates si elles écrivent dans les mêmes racines de QVD.
 * Similarité de Jaccard sur les racines produites — pas sur les noms bruts,
 * ce qui repère aussi les batchs qui ne diffèrent que par leur versionning.
 *
 * Seuils : au moins 2 racines partagées ET ≥50% de recouvrement, pour éviter
 * les paires triviales du type « deux apps qui écrivent chacune un QVD
 * commun ». Configurables si besoin.
 */
function detectTwinBatches(apps, qvds, { minShared = 2, minJaccard = 0.5 } = {}) {
  const qvdToRoot = new Map();
  for (const q of qvds) {
    const r = rootOf(q.name);
    if (r) qvdToRoot.set(q.name, r);
  }

  // Ensemble des racines produites par chaque app batch/transform
  const rootsByApp = new Map();
  for (const a of apps) {
    if (a.role !== 'batch' && a.role !== 'transform') continue;
    const roots = new Set();
    for (const q of a.producedQvds) {
      const r = qvdToRoot.get(q);
      if (r) roots.add(r);
    }
    if (roots.size > 0) rootsByApp.set(a.appId, { app: a, roots });
  }

  const twins = [];
  const entries = [...rootsByApp.entries()];
  // Comparaison paire à paire — O(n²) sur les apps productrices seulement,
  // donc largement soutenable même sur ~400 apps (≤100 batchs en pratique).
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i][1];
      const b = entries[j][1];
      const shared = [...a.roots].filter(r => b.roots.has(r));
      if (shared.length < minShared) continue;
      const union = new Set([...a.roots, ...b.roots]).size;
      const jaccard = shared.length / union;
      if (jaccard < minJaccard) continue;
      twins.push({
        appA: pickApp(a.app),
        appB: pickApp(b.app),
        sharedRoots: shared.sort(),
        sharedCount: shared.length,
        aOnly: a.roots.size - shared.length,
        bOnly: b.roots.size - shared.length,
        jaccard: Math.round(jaccard * 100) / 100,
        overlapPct: Math.round(jaccard * 100)
      });
    }
  }

  twins.sort((x, y) => y.jaccard - x.jaccard || y.sharedCount - x.sharedCount);
  return twins;
}

function pickApp(a) {
  return {
    appId: a.appId, appName: a.appName, stream: a.stream, role: a.role,
    published: a.published, owner: a.owner, lastReload: a.lastReload,
    producedCount: a.producedQvds.length
  };
}

// ─── API publique ─────────────────────────────────────────────────────────────

function analyzeDuplicates() {
  const lineage = buildGlobalLineage();
  const families = detectQvdFamilies(lineage.qvds);
  const twins = detectTwinBatches(lineage.apps, lineage.qvds);

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      familyCount: families.length,
      redundantVariants: families.reduce((acc, f) => acc + (f.variantCount - 1), 0),
      orphanVariants: families.reduce((acc, f) => acc + f.orphaned, 0),
      twinCount: twins.length,
      // Recouvrement fort (≥80%) = quasi-clones à mutualiser en priorité
      strongTwinCount: twins.filter(t => t.overlapPct >= 80).length
    },
    families,
    twins
  };
}

module.exports = { analyzeDuplicates, rootOf, detectQvdFamilies, detectTwinBatches };
