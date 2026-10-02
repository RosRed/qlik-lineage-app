'use strict';

/**
 * Vue « d'où vient / où va » pour UNE application, vue depuis le détail d'app :
 *   - pour chaque QVD consommé  → quelle(s) app(s) le produisent
 *   - pour chaque QVD produit   → quelle(s) app(s) le consomment
 *
 * S'appuie sur buildGlobalLineage : les clés de QVD (chemin normalisé, wildcards
 * rapprochés) y sont déjà calculées, inutile de les re-dériver ici au risque de
 * diverger.
 *
 * ⚠️ Le croisement ne connaît que les apps IMPORTÉES ET ANALYSÉES localement.
 * « Aucun producteur connu » ne signifie donc pas « ce QVD n'a pas de producteur »,
 * mais « aucune des apps analysées ne l'écrit » — d'où `analyzedApps` dans la
 * réponse, que l'UI affiche pour que la nuance reste visible.
 */

const { buildGlobalLineage } = require('./globalLineage');

/** Dernier segment d'un chemin de QVD, pour l'affichage. */
function shortName(key) {
  return String(key || '').split(/[/\\]/).pop() || key;
}

function buildAppQvdUsage(appId) {
  const lineage = buildGlobalLineage();
  const me = lineage.apps.find(a => String(a.appId) === String(appId));
  if (!me) return null;

  const byKey = new Map(lineage.qvds.map(q => [q.name, q]));
  const isMe = (x) => String(x.appId) === String(me.appId);

  const consumed = me.consumedQvds.map(key => {
    const q = byKey.get(key);
    const all = q ? q.producers : [];
    const producers = all.filter(p => !isMe(p));
    const selfProduced = all.some(isMe);
    return {
      key,
      name: shortName(key),
      paths: q ? q.paths : [],
      producers,
      selfProduced,
      // `externe` : personne ne l'écrit parmi les apps analysées — QVD produit
      // hors périmètre (autre app non importée, script externe, dépôt manuel).
      status: producers.length > 1 ? 'multi' : producers.length === 1 ? 'ok'
        : selfProduced ? 'self' : 'externe'
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const produced = me.producedQvds.map(key => {
    const q = byKey.get(key);
    const all = q ? q.consumers : [];
    const consumers = all.filter(c => !isMe(c));
    const selfConsumed = all.some(isMe);
    return {
      key,
      name: shortName(key),
      paths: q ? q.paths : [],
      consumers,
      selfConsumed,
      // `orphelin` : écrit mais lu par personne — candidat au nettoyage.
      status: consumers.length > 0 ? 'ok' : selfConsumed ? 'self' : 'orphelin'
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    appId: me.appId,
    appName: me.appName,
    role: me.role,
    analyzedApps: lineage.stats.analyzedApps,
    totalApps: lineage.stats.totalApps,
    consumed,
    produced,
    stats: {
      consumed: consumed.length,
      withoutProducer: consumed.filter(c => c.status === 'externe').length,
      multiProduced: consumed.filter(c => c.status === 'multi').length,
      produced: produced.length,
      orphans: produced.filter(p => p.status === 'orphelin').length
    }
  };
}

module.exports = { buildAppQvdUsage };
