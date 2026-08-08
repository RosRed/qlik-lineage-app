import React from 'react';
import { Boxes, GitBranch, Database, FileWarning, Copy, AlertTriangle } from 'lucide-react';
import SyntheseTab from '../../components/SyntheseTab.jsx';
import { useGlobalContext } from '../../layouts/GlobalLayout.jsx';
import { PageBody, StatCard } from '../../components/ui/primitives';

/*
 * Vue d'entrée du lineage global : les chiffres clés, puis les classements.
 * Les cartes de stats ne sont affichées qu'ici — les répéter au-dessus de
 * chaque tableau mangeait 180px de hauteur sur tous les écrans.
 */
export default function SynthesePage() {
  const { data } = useGlobalContext();
  const s = data.stats;

  return (
    <PageBody>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard icon={Boxes} label="Apps" value={s.totalApps} />
        <StatCard icon={GitBranch} label="Analysées" value={s.analyzedApps} tone="accent" />
        <StatCard icon={Database} label="QVD" value={s.totalQvds} />
        <StatCard icon={FileWarning} label="Orphelins" value={s.orphanQvds} tone="danger" />
        <StatCard icon={Copy} label="Doublons extract." value={s.duplicateExtractions} tone="danger" />
        <StatCard icon={AlertTriangle} label="QVD externes" value={s.externalQvds} tone="warn" />
      </div>

      <SyntheseTab data={data} />
    </PageBody>
  );
}
