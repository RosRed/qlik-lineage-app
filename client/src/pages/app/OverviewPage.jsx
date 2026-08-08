import React from 'react';
import OverviewTab from '../../components/OverviewTab.jsx';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';

// Les composants d'onglet gèrent déjà leur propre scroll (h-full overflow-y-auto),
// on ne fournit donc qu'un conteneur de hauteur contrainte.
export default function OverviewPage() {
  const { analysis, analyzing, loading } = useAppContext();
  return (
    <div className="flex-1 min-h-0">
      <OverviewTab analysis={analysis} analyzing={analyzing || loading} />
    </div>
  );
}
