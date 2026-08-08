import React from 'react';
import SourcesTab from '../../components/SourcesTab.jsx';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';

export default function SourcesPage() {
  const { analysis, analyzing, loading } = useAppContext();
  return (
    <div className="flex-1 min-h-0">
      <SourcesTab analysis={analysis} analyzing={analyzing || loading} />
    </div>
  );
}
