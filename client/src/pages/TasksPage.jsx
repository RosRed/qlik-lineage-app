import React from 'react';
import { Clock } from 'lucide-react';
import TasksTab from '../components/TasksTab.jsx';
import { PageHeader, PageBody } from '../components/ui/primitives';

/*
 * Tâches de reload — auparavant enterrées comme sous-onglet de GlobalTab.
 * Une section entière (~463 lignes) qui devient enfin visible depuis le rail.
 */
export default function TasksPage() {
  return (
    <>
      <PageHeader
        icon={Clock}
        title="Tâches de reload"
        subtitle="Planification, chaînes, recommandations de nettoyage"
      />
      <PageBody>
        <TasksTab />
      </PageBody>
    </>
  );
}
