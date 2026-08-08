import React, { useMemo, useState } from 'react';
import { useGlobalContext } from '../../layouts/GlobalLayout.jsx';
import { PageBody, Select, Button } from '../../components/ui/primitives';
import GlobalGraph from '../../components/global/GlobalGraph.jsx';

/*
 * Graphe de flux global. Filtre par stream car un rendu ReactFlow > 150 nœuds
 * gèle l'interface — l'ancien seuil est conservé.
 */

const TOO_BIG = 150;

export default function GraphePage() {
  const { data } = useGlobalContext();
  const [stream, setStream] = useState('');
  const [force, setForce] = useState(false);

  const streams = useMemo(
    () => [...new Set(data.apps.map(a => a.stream || '(non publiée)'))].sort(),
    [data.apps]
  );

  // Filtre : apps du stream + leurs QVD + apps connectées à ces QVD.
  // Le calcul est identique à celui de l'ancien GlobalTab, à ceci près qu'il
  // ne s'exécute que quand on visite l'onglet Graphe.
  const filteredGraph = useMemo(() => {
    if (!stream) return data.graph;
    const streamApps = new Set(
      data.apps.filter(a => (a.stream || '(non publiée)') === stream).map(a => `app:${a.appId}`)
    );
    const qvdIds = new Set(
      data.graph.edges
        .filter(e => streamApps.has(e.from) || streamApps.has(e.to))
        .map(e => (e.from.startsWith('qvd:') ? e.from : e.to))
        .filter(id => id.startsWith('qvd:'))
    );
    const keep = new Set([...streamApps, ...qvdIds]);
    for (const e of data.graph.edges) {
      if (qvdIds.has(e.from) && e.to.startsWith('app:')) keep.add(e.to);
      if (qvdIds.has(e.to) && e.from.startsWith('app:')) keep.add(e.from);
    }
    return {
      nodes: data.graph.nodes.filter(n => keep.has(n.id)),
      edges: data.graph.edges.filter(e => keep.has(e.from) && keep.has(e.to))
    };
  }, [data, stream]);

  const tooBig = filteredGraph.nodes.length > TOO_BIG && !force;

  return (
    <PageBody>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <Select
          value={stream}
          onChange={v => { setStream(v); setForce(false); }}
          aria-label="Filtrer le graphe par stream"
        >
          <option value="">Tous les streams ({data.graph.nodes.length} nœuds)</option>
          {streams.map(st => <option key={st} value={st}>{st}</option>)}
        </Select>
        <span className="text-xs text-ink-faint tabular-nums">
          {filteredGraph.nodes.length} nœuds · {filteredGraph.edges.length} liens
        </span>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-ink-muted mb-3">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-violet/30 border border-violet" />
          App batch (génère des QVD)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-warn/30 border border-warn" />
          App transform (lit + écrit)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-accent/30 border border-accent" />
          App front (consomme)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border border-dashed border-danger" />
          QVD orphelin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border border-dashed border-warn" />
          QVD externe
        </span>
      </div>

      {tooBig ? (
        <div className="border border-line rounded-xl p-8 text-center space-y-3 bg-surface">
          <p className="text-sm text-ink-muted">
            {filteredGraph.nodes.length} nœuds — le rendu complet gèlerait l'interface.
            <br />
            Choisissez un stream ci-dessus pour un graphe lisible.
          </p>
          <Button onClick={() => setForce(true)}>Afficher quand même (peut être lent)</Button>
        </div>
      ) : (
        <GlobalGraph graph={filteredGraph} />
      )}
    </PageBody>
  );
}
