import React, { useEffect, useState } from 'react';
import AppSidebar from './components/AppSidebar.jsx';
import ScriptEditor from './components/ScriptEditor.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import LineageTab from './components/LineageTab.jsx';
import ModelTab from './components/ModelTab.jsx';
import ChatTab from './components/ChatTab.jsx';
import { useApp } from './hooks/useApp.js';
import { LayoutGrid, GitBranch, Network, MessageSquare } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Vue d\'ensemble', icon: LayoutGrid },
  { id: 'lineage', label: 'Lineage', icon: GitBranch },
  { id: 'model', label: 'Modèle', icon: Network },
  { id: 'chat', label: 'SQL / Qlik', icon: MessageSquare }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const {
    apps, selectedApp, script, analysis, analyzing, loadingApps,
    setScript, loadApps, selectApp, createApp, renameApp, deleteApp, saveAndAnalyze
  } = useApp();

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <AppSidebar
        apps={apps}
        selectedApp={selectedApp}
        onSelect={selectApp}
        onCreate={createApp}
        onRename={renameApp}
        onDelete={deleteApp}
        loading={loadingApps}
      />

      {/* Script Editor */}
      <ScriptEditor
        app={selectedApp}
        script={script}
        onScriptChange={setScript}
        onAnalyze={saveAndAnalyze}
        analyzing={analyzing}
      />

      {/* Result Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedApp ? (
          <>
            {/* App header */}
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-white truncate">{selectedApp.name}</h2>
                {analysis && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {analysis.facts?.length || 0} faits · {analysis.dims?.length || 0} dims · {analysis.lineage?.length || 0} lignes de lineage
                  </p>
                )}
              </div>
              {analysis && (
                <span className="text-xs px-2 py-0.5 bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 rounded">
                  Analysé
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-800 px-4">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-emerald-500 text-emerald-400'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Icon size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden min-h-0">
              {activeTab === 'overview' && <OverviewTab analysis={analysis} analyzing={analyzing} />}
              {activeTab === 'lineage' && <LineageTab analysis={analysis} appName={selectedApp?.name} analyzing={analyzing} />}
              {activeTab === 'model' && <ModelTab analysis={analysis} analyzing={analyzing} />}
              {activeTab === 'chat' && <ChatTab app={selectedApp} analysis={analysis} />}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-700">
            <div className="text-center">
              <div className="text-6xl mb-4">🗂️</div>
              <h2 className="text-lg font-semibold text-gray-500 mb-2">Qlik Lineage Explorer</h2>
              <p className="text-sm text-gray-600">Créez ou sélectionnez une application dans la sidebar pour commencer</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
