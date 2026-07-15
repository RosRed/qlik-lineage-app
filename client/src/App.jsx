import React, { useEffect, useState } from 'react';
import AppSidebar from './components/AppSidebar.jsx';
import ScriptEditor from './components/ScriptEditor.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import LineageTab from './components/LineageTab.jsx';
import ModelTab from './components/ModelTab.jsx';
import ChatTab from './components/ChatTab.jsx';
import GlobalTab from './components/GlobalTab.jsx';
import SourcesTab from './components/SourcesTab.jsx';
import ApiUsageWidget from './components/ApiUsageWidget.jsx';
import { useApp } from './hooks/useApp.js';
import { LayoutGrid, GitBranch, Network, MessageSquare, Globe, Database } from 'lucide-react';

const APP_TABS = [
  { id: 'overview', label: 'Vue d\'ensemble', icon: LayoutGrid },
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'lineage', label: 'Lineage', icon: GitBranch },
  { id: 'model', label: 'Modèle', icon: Network },
  { id: 'chat', label: 'SQL / Qlik', icon: MessageSquare }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const {
    apps, selectedApp, script, analysis, analyzing, loadingApps,
    analyzeMode, setAnalyzeMode,
    setScript, loadApps, selectApp, createApp, renameApp, deleteApp, saveAndAnalyze
  } = useApp();

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const isGlobal = activeTab === 'global';

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar + widget usage */}
      <div className="flex flex-col" style={{ width: 250, minWidth: 250 }}>
        <div className="flex-1 overflow-hidden">
          <AppSidebar
            apps={apps}
            selectedApp={selectedApp}
            onSelect={(app) => { if (isGlobal) setActiveTab('overview'); selectApp(app); }}
            onCreate={createApp}
            onRename={renameApp}
            onDelete={deleteApp}
            loading={loadingApps}
          />
        </div>
        {/* Widget statistiques API en bas de sidebar */}
        <ApiUsageWidget />
      </div>

      {/* Script Editor */}
      <ScriptEditor
        app={selectedApp}
        script={script}
        onScriptChange={setScript}
        onAnalyze={saveAndAnalyze}
        analyzing={analyzing}
        analyzeMode={analyzeMode}
        onModeChange={setAnalyzeMode}
        analysis={analysis}
      />

      {/* Result Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* App header */}
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              {isGlobal ? '🌐 Vue globale — lineage inter-applications' : (selectedApp?.name || 'Qlik Lineage Explorer')}
            </h2>
            {!isGlobal && analysis && (
              <p className="text-xs text-gray-500 mt-0.5">
                {analysis.facts?.length || 0} faits · {analysis.dims?.length || 0} dims · {analysis.lineage?.length || 0} lignes de lineage
                {analysis?.metadata?.mode && (
                  <span className={`ml-2 ${analysis.metadata.mode === 'local' ? 'text-yellow-600' : 'text-violet-600'}`}>
                    · {analysis.metadata.mode === 'local' ? '⚡ local' : '🤖 claude'}
                    {analysis._cached && ' · 💾 cache'}
                  </span>
                )}
              </p>
            )}
          </div>
          {!isGlobal && analysis && (
            <span className="text-xs px-2 py-0.5 bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 rounded">
              Analysé
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 px-4">
          {APP_TABS.map(tab => {
            const Icon = tab.icon;
            const disabled = !selectedApp;
            return (
              <button
                key={tab.id}
                onClick={() => !disabled && setActiveTab(tab.id)}
                disabled={disabled}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : disabled
                      ? 'border-transparent text-gray-700 cursor-not-allowed'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
          {/* Vue globale — toujours accessible, indépendante de l'app sélectionnée */}
          <button
            onClick={() => setActiveTab('global')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ml-auto ${
              isGlobal
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Globe size={13} />
            Vue globale
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {isGlobal ? (
            <GlobalTab onAppsChanged={loadApps} />
          ) : selectedApp ? (
            <>
              {activeTab === 'overview' && <OverviewTab analysis={analysis} analyzing={analyzing} />}
              {activeTab === 'sources' && <SourcesTab analysis={analysis} analyzing={analyzing} />}
              {activeTab === 'lineage' && <LineageTab analysis={analysis} appName={selectedApp?.name} analyzing={analyzing} />}
              {activeTab === 'model' && <ModelTab analysis={analysis} analyzing={analyzing} />}
              {activeTab === 'chat' && <ChatTab app={selectedApp} analysis={analysis} />}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-700">
              <div className="text-center">
                <div className="text-6xl mb-4">🗂️</div>
                <h2 className="text-lg font-semibold text-gray-500 mb-2">Qlik Lineage Explorer</h2>
                <p className="text-sm text-gray-600">Sélectionnez une application, ou ouvrez la <span className="text-cyan-500">Vue globale</span> pour le lineage inter-apps</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
