import React from 'react';
import { ShieldCheck } from 'lucide-react';
import GovernanceTab from '../components/GovernanceTab.jsx';
import { PageHeader, PageBody } from '../components/ui/primitives';

/*
 * Gouvernance serveur — comme Tâches, remontée au 1er niveau.
 * Aucune UX ne justifie qu'un audit de gouvernance soit à deux clics d'un
 * sous-onglet.
 */
export default function GovernancePage() {
  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="Gouvernance"
        subtitle="Audits agrégés : apps, connexions, tâches"
      />
      <PageBody>
        <GovernanceTab />
      </PageBody>
    </>
  );
}
