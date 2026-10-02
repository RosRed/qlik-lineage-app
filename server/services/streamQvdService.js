'use strict';

/**
 * Dépendance aux QVD, par stream.
 *
 * Objectif métier : réduire le nombre d'applications qui lisent des QVD. Pour
 * décider, il faut voir stream par stream qui en consomme, combien, et d'où
 * viennent ces QVD — une app qui lit 31 QVD ne se traite pas comme une app qui
 * en lit un seul, et un QVD sans producteur connu ne s'élimine pas de la même
 * façon qu'un QVD produit par un batch du même stream.
 *
 * Trois familles d'apps se dégagent :
 *   - `consommatrice` : lit au moins un QVD — la cible du chantier
 *   - `autonome`      : ne lit aucun QVD (sources directes SQL/fichiers)
 *   - `productrice`   : n'en lit aucun mais en écrit — les batchs, qu'on ne
 *                       veut PAS compter comme un problème à résoudre
 */

const { buildGlobalLineage } = require('./globalLineage');
const { fetchTasks } = require('./taskService');

const SANS_STREAM = '(sans stream)';

/** Nom court d'un QVD depuis sa clé (chemin normalisé). */
function shortName(key) {
  return String(key || '').split(/[/\\]/).pop() || key;
}

/**
 * Statut de rechargement par app. Sans ce filtre, un QVD paraît avoir 9
 * producteurs alors qu'un seul l'écrit vraiment — les 8 autres sont des copies
 * abandonnées (« OBJECTIF PDR Ancienne », « … test ») qui gardent leurs STORE
 * sans jamais être rechargées.
 *
 * Une tâche « activée » ne suffit pas : Qlik crée pour chaque app une tâche
 * « Manually triggered reload of … » qui est activée mais n'a AUCUN
 * déclencheur. Elle ne part que si quelqu'un clique. La compter comme une
 * planification faisait passer pour actives 70 apps qui ne tournent plus —
 * dont « Valorisation budgétaire des stocks » (LES ORIGINES), dernier
 * chargement en novembre 2022.
 *
 *   'declenchee' : au moins une tâche activée avec un déclencheur (planifié ou
 *                  chaîné) — l'app tourne toute seule.
 *   'manuelle'   : des tâches activées, mais aucune déclenchée.
 *   absente      : aucune tâche activée du tout.
 *
 * Retourne null si QRS est injoignable : mieux vaut ne pas filtrer que filtrer
 * à tort et faire disparaître de vrais producteurs.
 */
async function fetchAppReloadStatus(config) {
  if (!config || !config.host) return null;
  try {
    const tasks = await fetchTasks(config);
    const statuts = new Map();
    for (const t of tasks) {
      if (!t.enabled || !t.qlikAppId) continue;
      const cle = String(t.qlikAppId);
      // Un déclencheur désactivé ne déclenche rien : il ne rend pas l'app active.
      const declenchee = (t.triggers || []).some(tr => tr.enabled && (tr.type === 'schedule' || tr.type === 'chain'));
      if (declenchee) statuts.set(cle, 'declenchee');
      else if (!statuts.has(cle)) statuts.set(cle, 'manuelle');
    }
    return statuts;
  } catch (e) {
    console.warn('[Streams QVD] tâches indisponibles, pas de filtrage :', e.message);
    return null;
  }
}

async function buildStreamQvdUsage(config) {
  const lineage = buildGlobalLineage();
  const statuts = await fetchAppReloadStatus(config);
  const qvdByKey = new Map(lineage.qvds.map(q => [q.name, q]));
  const parStream = new Map();

  /** Statut de rechargement d'un producteur, ou null si le filtrage est inactif. */
  const statutDe = (p) => statuts && p.qlikAppId ? (statuts.get(String(p.qlikAppId)) || null) : null;
  /** Un producteur compte-t-il ? Oui s'il se recharge tout seul. */
  const tourne = (p) => !statuts || statutDe(p) === 'declenchee';

  for (const app of lineage.apps) {
    // Une app sans script ni analyse ne dit rien de sa consommation : la
    // compter comme « aucun QVD » serait une conclusion fausse.
    if (!app.analyzed) continue;

    const stream = app.stream || SANS_STREAM;
    if (!parStream.has(stream)) {
      parStream.set(stream, { stream, apps: [] });
    }

    const consumed = app.consumedQvds.map(key => {
      const q = qvdByKey.get(key);
      const ecrivains = q ? q.producers : [];
      // Une app qui relit un QVD qu'elle a elle-meme ecrit (chargement
      // incremental) ne depend de personne : on l'ecarte des producteurs, car
      // ce n'est pas un couplage a supprimer. Mais il faut s'en souvenir —
      // sinon, quand elle est le seul ecrivain, le QVD passait pour « externe »
      // et s'affichait « Producteur inconnu ». 315 liens etaient dans ce cas.
      const auto = ecrivains.some(p => String(p.appId) === String(app.appId));
      const tous = ecrivains.filter(p => String(p.appId) !== String(app.appId));
      const brut = (p) => ({ appId: p.appId, appName: p.appName, stream: p.stream || null });
      const producers = tous.filter(tourne).map(brut);
      // Producteurs écartés : ils écrivent bien le QVD mais aucune tâche active
      // ne les lance. On les garde à part plutôt que de les jeter — c'est la
      // preuve qu'un STORE dort quelque part.
      // La raison distingue deux situations tres differentes : une app qu'on
      // relance a la main de temps en temps, et une app que plus rien ne lance.
      const dormants = tous.filter(p => !tourne(p))
        .map(p => ({ ...brut(p), raison: statutDe(p) === 'manuelle' ? 'manuelle' : 'sans-tache' }));
      return {
        key,
        name: shortName(key),
        producers,
        dormants,
        // `auto`     : l'app ecrit elle-meme ce QVD et le relit.
        // `externe`  : personne ne l'écrit, il vient d'hors périmètre.
        // `figee`    : il est écrit, mais par des apps qui ne tournent plus →
        //              la donnée est figée, c'est un problème distinct.
        auto,
        externe: ecrivains.length === 0,
        figee: !auto && tous.length > 0 && producers.length === 0
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const famille = consumed.length > 0 ? 'consommatrice'
      : app.producedQvds.length > 0 ? 'productrice'
      : 'autonome';

    // Nombre d'apps distinctes dont celle-ci depend : c'est le couplage reel,
    // plus parlant que le nombre de QVD (31 QVD venant d'un seul batch se
    // traitent d'un coup, 5 QVD venant de 5 apps sont cinq chantiers).
    const producteurs = new Set();
    let inconnus = 0, figes = 0, autos = 0;
    for (const q of consumed) {
      if (q.externe) inconnus++;
      if (q.figee) figes++;
      if (q.auto) autos++;
      for (const p of q.producers) producteurs.add(String(p.appId));
    }

    parStream.get(stream).apps.push({
      appId: app.appId,
      appName: app.appName,
      qlikAppId: app.qlikAppId || null,
      published: !!app.published,
      owner: app.owner || null,
      lastReload: app.lastReload || null,
      role: app.role,
      famille,
      consumedCount: consumed.length,
      producerCount: producteurs.size,
      unknownProducerCount: inconnus,
      selfProducedCount: autos,
      frozenCount: figes,
      producedCount: app.producedQvds.length,
      consumed
    });
  }

  const streams = [...parStream.values()].map(s => {
    const consommatrices = s.apps.filter(a => a.famille === 'consommatrice');
    const productrices = s.apps.filter(a => a.famille === 'productrice');
    const autonomes = s.apps.filter(a => a.famille === 'autonome');
    return {
      stream: s.stream,
      total: s.apps.length,
      withQvd: consommatrices.length,
      producers: productrices.length,
      withoutQvd: autonomes.length,
      // Part des apps du stream qui dépendent d'un QVD — l'indicateur à faire baisser.
      ratio: s.apps.length ? consommatrices.length / s.apps.length : 0,
      qvdLinks: consommatrices.reduce((n, a) => n + a.consumedCount, 0),
      apps: s.apps.sort((a, b) =>
        b.consumedCount - a.consumedCount || a.appName.localeCompare(b.appName))
    };
  }).sort((a, b) => b.withQvd - a.withQvd || b.total - a.total);

  const toutes = streams.flatMap(s => s.apps);
  return {
    generatedAt: new Date().toISOString(),
    // L'UI doit pouvoir dire si le filtrage a pu s'appliquer.
    taskFilter: statuts ? {
      applied: true,
      scheduledApps: [...statuts.values()].filter(v => v === 'declenchee').length,
      manualApps: [...statuts.values()].filter(v => v === 'manuelle').length
    } : { applied: false, reason: 'tâches de reload indisponibles' },
    stats: {
      streams: streams.length,
      apps: toutes.length,
      withQvd: toutes.filter(a => a.famille === 'consommatrice').length,
      producers: toutes.filter(a => a.famille === 'productrice').length,
      withoutQvd: toutes.filter(a => a.famille === 'autonome').length,
      qvdLinks: toutes.reduce((n, a) => n + a.consumedCount, 0),
      frozen: toutes.reduce((n, a) => n + a.frozenCount, 0),
      totalQvds: lineage.stats.totalQvds
    },
    streams
  };
}

module.exports = { buildStreamQvdUsage };
