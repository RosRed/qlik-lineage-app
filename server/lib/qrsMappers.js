'use strict';

/**
 * Mappers partagés pour les réponses QRS (utilisés par qrsClient et proxyClient).
 */

/** Transforme une app QRS (/app/full) en objet applicatif enrichi */
function mapQrsApp(a) {
  return {
    qlikAppId: a.id,
    name: a.name,
    stream: a.stream ? a.stream.name : null,
    published: a.published,
    owner: a.owner ? `${a.owner.userDirectory}\\${a.owner.userId}` : null,
    lastReloadTime: a.lastReloadTime || null,
    modifiedDate: a.modifiedDate || null,
    // Métadonnées enrichies (P3)
    fileSize: a.fileSize ?? null,
    createdDate: a.createdDate || null,
    publishTime: a.publishTime && !String(a.publishTime).startsWith('1753') ? a.publishTime : null,
    description: a.description || null,
    tags: (a.tags || []).map(t => t.name).filter(Boolean),
    customProperties: (a.customProperties || [])
      .map(cp => ({ name: cp.definition?.name || null, value: cp.value }))
      .filter(cp => cp.name)
  };
}

module.exports = { mapQrsApp };
