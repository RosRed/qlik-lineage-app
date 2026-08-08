import React from 'react';
import ModelTab from '../../components/ModelTab.jsx';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';

export default function ModelPage() {
  const { analysis, analyzing, loading } = useAppContext();
  return (
    <div className="flex-1 min-h-0">
      <ModelTab analysis={analysis} analyzing={analyzing || loading} />
    </div>
  );
}
