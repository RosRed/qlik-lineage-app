import React from 'react';
import LineageTab from '../../components/LineageTab.jsx';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';

export default function LineagePage() {
  const { app, analysis, analyzing, loading } = useAppContext();
  return (
    <div className="flex-1 min-h-0">
      <LineageTab analysis={analysis} appName={app?.name} analyzing={analyzing || loading} />
    </div>
  );
}
