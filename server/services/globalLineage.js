'use strict';

/**
 * Lineage global multi-apps — croise les analyses de toutes les applications :
 *   - qui GÉNÈRE quel QVD (STORE ... INTO)
 *   - qui CONSOMME quel QVD (LOAD ... FROM ... (qvd))
 * Et en déduit : QVD orphelins, QVD manquants, doublons d'extraction, graphe global.
 */

const db = require('../database');
const { parseQlikScript } = require('./localParser');

/**
 * Identité d'un QVD : nom de fichier en minuscule (les chemins lib:// varient entre apps).
 * Les variables non résolues $(var) sont normalisées en wildcard * pour permettre le
 * rapprochement entre "ventes_$(annee).qvd" (STORE) et "ventes_*.qvd" (LOAD).
 */
function qvdKey(nameOrPath) {
  if (!nameOrPath) return null;
  let base = String(nameOrPath).split(/[/\\]/).pop().trim().toLowerCase();
  base = base.replace(/\$\([^)]*\)/g, '*').replace(/\*+/g, '*');
  return base.endsWith('.qvd') ? base : null;
}

function escapeRe(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fusionne les entrées wildcard (ventes_*.qvd) avec les QVD concrets qui matchent :
 * leurs producteurs/consommateurs sont rattachés aux QVD concrets correspondants.
 * Un wildcard sans correspondance concrète reste une entrée à part entière.
 */
function mergeWildcards(qvds) {
  const concreteKeys = [...qvds.keys()].filter(k => !k.includes('*'));
  for (const patKey of [...qvds.keys()].filter(k => k.includes('*'))) {
    // Motif trop générique (ex: "*.qvd") → matcherait tout ; on le laisse en entrée isolée
    const literalPart = patKey.replace(/\*/g, '').replace(/\.qvd$/, '');
    if (literalPart.length < 3) continue;
    const re = new RegExp('^' + patKey.split('*').map(escapeRe).join('.*') + '$');
    const matches = concreteKeys.filter(c => re.test(c));
    if (matches.length === 0) continue;
    const pat = qvds.get(patKey);
    for (const c of matches) {
      const q = qvds.get(c);
      q.producers.push(...pat.producers);
      q.consumers.push(...pat.consumers);
      pat.paths.forEach(p => q.paths.add(p));
    }
    qvds.delete(patKey);
  }
  // Dédoublonnage producteurs/consommateurs (une app peut arriver deux fois après fusion)
  for (const q of qvds.values()) {
    const seenP = new Set(), seenC = new Set();
    q.producers = q.producers.filter(p => {
      const k = `${p.appId}|${p.tableName || ''}`;
      if (seenP.has(k)) return false; seenP.add(k); return true;
    });
    q.consumers = q.consumers.filter(c => {
      const k = String(c.appId);
      if (seenC.has(k)) return false; seenC.add(k); return true;
    });
  }
}

/** Récupère l'analyse la plus récente de chaque app ; si absente, parse le script en local */
function getAllAnalyses() {
  const apps = db.prepare('SELECT * FROM apps ORDER BY name').all();
  const results = [];

  for (const app of apps) {
    let analysis = null;
    const row = db.prepare(
      'SELECT result FROM analyses WHERE app_id = ? ORDER BY analyzed_at DESC LIMIT 1'
    ).get(app.id);

    if (row) {
      try { analysis = JSON.parse(row.result); } catch (_) {}
    }

    const script = db.prepare(
      'SELECT content FROM scripts WHERE app_id = ? ORDER BY uploaded_at DESC LIMIT 1'
    ).get(app.id);

    // Le lineage global a besoin des stores/sources — le parser local les garantit,
    // une analyse Claude peut ne pas les contenir : on complète depuis le script.
    if (script?.content && (!analysis || !analysis.stores || !analysis.sourceMeta)) {
      const local = parseQlikScript(script.content, app.name);
      analysis = analysis
        ? { ...analysis, stores: analysis.stores || local.stores, sourceMeta: analysis.sourceMeta || local.sourceMeta, sources: analysis.sources || local.sources }
        : local;
    }

    if (analysis) {
      results.push({ app, analysis, hasScript: !!script?.content });
    } else {
      results.push({ app, analysis: null, hasScript: !!script?.content });
    }
  }
  return results;
}

function buildGlobalLineage() {
  const entries = getAllAnalyses();

  // qvd -> { producers: [{appId, appName, stream, tableName, path}], consumers: [...] }
  const qvds = new Map();
  const ensure = (key) => {
    if (!qvds.has(key)) qvds.set(key, { name: key, producers: [], consumers: [], paths: new Set() });
    return qvds.get(key);
  };

  // source SQL/connexion -> apps qui l'extraient (pour les doublons d'extraction)
  const sqlSources = new Map();

  const appsSummary = [];

  for (const { app, analysis, hasScript } of entries) {
    const summary = {
      appId: app.id,
      appName: app.name,
      qlikAppId: app.qlik_app_id || null,
      stream: app.stream || null,
      published: !!app.published,
      owner: app.owner || null,
      lastReload: app.last_reload || null,
      origin: app.origin || 'manual',
      hasScript,
      analyzed: !!analysis,
      producedQvds: [],
      consumedQvds: [],
      role: 'inconnu'
    };

    if (analysis) {
      // Production de QVD (STORE)
      for (const st of analysis.stores || []) {
        const key = qvdKey(st.outputName || st.outputPath);
        if (!key) continue;
        const q = ensure(key);
        q.producers.push({ appId: app.id, appName: app.name, stream: app.stream || null, tableName: st.tableName, path: st.outputPath });
        if (st.outputPath) q.paths.add(st.outputPath);
        summary.producedQvds.push(key);
      }

      // Consommation de QVD (LOAD FROM ... (qvd))
      const meta = analysis.sourceMeta || [];
      const qvdMeta = meta.filter(s => s.type === 'qvd');
      const consumedNames = qvdMeta.length
        ? qvdMeta.map(s => ({ name: s.name, path: s.path, usedBy: s.usedBy }))
        : (analysis.sources || []).filter(s => /\.qvd$/i.test(s)).map(s => ({ name: s, path: null, usedBy: [] }));

      for (const src of consumedNames) {
        const key = qvdKey(src.name || src.path);
        if (!key) continue;
        const q = ensure(key);
        q.consumers.push({ appId: app.id, appName: app.name, stream: app.stream || null, tables: src.usedBy || [], path: src.path });
        if (src.path) q.paths.add(src.path);
        summary.consumedQvds.push(key);
      }

      // Extractions SQL (pour détecter les doublons entre apps batch)
      for (const s of meta.filter(m => m.type === 'sql' && m.name && m.name !== 'SQL')) {
        const key = s.name.toLowerCase();
        if (!sqlSources.has(key)) sqlSources.set(key, { table: s.name, connections: new Set(), apps: [] });
        const entry = sqlSources.get(key);
        if (s.connection) entry.connections.add(s.connection);
        if (!entry.apps.find(a => a.appId === app.id)) {
          entry.apps.push({ appId: app.id, appName: app.name, stream: app.stream || null });
        }
      }
    }

    // Rôle de l'app dans l'architecture
    const produces = summary.producedQvds.length > 0;
    const consumes = summary.consumedQvds.length > 0;
    if (produces && consumes) summary.role = 'transform';       // lit des QVD et en écrit → couche transform
    else if (produces) summary.role = 'batch';                  // écrit des QVD → extracteur/batch
    else if (consumes) summary.role = 'front';                  // lit seulement → app de visualisation
    else if (analysis) summary.role = 'autonome';               // ni l'un ni l'autre (sources directes)

    summary.producedQvds = [...new Set(summary.producedQvds)];
    summary.consumedQvds = [...new Set(summary.consumedQvds)];
    appsSummary.push(summary);
  }

  // ── Rapprochement wildcards ↔ QVD concrets ─────────────────────────────────
  mergeWildcards(qvds);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  const qvdList = [...qvds.values()].map(q => ({
    name: q.name,
    paths: [...q.paths],
    producers: q.producers,
    consumers: q.consumers,
    status:
      q.producers.length > 0 && q.consumers.length === 0 ? 'orphelin' :
      q.producers.length === 0 && q.consumers.length > 0 ? 'externe'  :
      'ok'
  })).sort((a, b) => a.name.localeCompare(b.name));

  const orphans = qvdList.filter(q => q.status === 'orphelin');
  const externals = qvdList.filter(q => q.status === 'externe');
  const multiProduced = qvdList.filter(q => q.producers.length > 1);
  const duplicateExtractions = [...sqlSources.values()]
    .filter(s => s.apps.length > 1)
    .map(s => ({ table: s.table, connections: [...s.connections], apps: s.apps }));

  // ── Graphe (nœuds + arêtes) ────────────────────────────────────────────────
  const nodes = [];
  const edges = [];
  for (const s of appsSummary) {
    if (!s.analyzed && !s.hasScript) continue;
    nodes.push({ id: `app:${s.appId}`, type: 'app', label: s.appName, role: s.role, stream: s.stream });
  }
  for (const q of qvdList) {
    nodes.push({ id: `qvd:${q.name}`, type: 'qvd', label: q.name, status: q.status });
    for (const p of q.producers) edges.push({ from: `app:${p.appId}`, to: `qvd:${q.name}`, kind: 'store' });
    for (const c of q.consumers) edges.push({ from: `qvd:${q.name}`, to: `app:${c.appId}`, kind: 'load' });
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalApps: appsSummary.length,
      analyzedApps: appsSummary.filter(a => a.analyzed).length,
      totalQvds: qvdList.length,
      orphanQvds: orphans.length,
      externalQvds: externals.length,
      multiProducedQvds: multiProduced.length,
      duplicateExtractions: duplicateExtractions.length
    },
    apps: appsSummary,
    qvds: qvdList,
    orphans,
    externals,
    multiProduced,
    duplicateExtractions,
    graph: { nodes, edges }
  };
}

module.exports = { buildGlobalLineage };
