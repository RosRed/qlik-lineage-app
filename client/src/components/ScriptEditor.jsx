import React, { useRef } from 'react';
import { Upload, Play, FileCode, Loader2, Zap, Brain, HardDrive } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ScriptEditor({
  app, script, onScriptChange, onAnalyze, analyzing,
  analyzeMode, onModeChange, analysis
}) {
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.qvs', '.sql', '.txt'].includes(ext)) {
      toast.error('Format non supporté. Utilisez .qvs, .sql ou .txt');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => onScriptChange(ev.target.result);
    reader.readAsText(file);
    toast.success(`Fichier "${file.name}" chargé`);
    e.target.value = '';
  };

  const isLocal = analyzeMode === 'local';
  const isCached = analysis?._cached;
  const analysisMode = analysis?.metadata?.mode;

  if (!app) {
    return (
      <div className="w-[350px] min-w-[350px] bg-gray-900/50 border-r border-gray-800 flex items-center justify-center">
        <div className="text-center text-gray-600 p-6">
          <FileCode size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sélectionnez ou créez<br />une application</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[350px] min-w-[350px] bg-gray-900/50 border-r border-gray-800 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Script Qlik / SQL</h2>
          <button
            onClick={() => fileRef.current.click()}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-400 transition-colors"
          >
            <Upload size={12} />
            Upload
          </button>
          <input ref={fileRef} type="file" accept=".qvs,.sql,.txt" className="hidden" onChange={handleFile} />
        </div>

        {/* Toggle Local / Claude */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 mt-2">
          <button
            onClick={() => onModeChange('local')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors ${
              isLocal
                ? 'bg-yellow-600/20 text-yellow-400 border-r border-yellow-700/50'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300 border-r border-gray-700'
            }`}
          >
            <Zap size={11} />
            Local
          </button>
          <button
            onClick={() => onModeChange('claude')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium transition-colors ${
              !isLocal
                ? 'bg-violet-600/20 text-violet-400'
                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            <Brain size={11} />
            Claude IA
          </button>
        </div>

        {/* Description du mode */}
        <p className="text-xs text-gray-600 mt-1.5">
          {isLocal
            ? '⚡ Analyse instantanée, gratuite, par regex'
            : '🤖 Analyse sémantique profonde par IA'}
        </p>
      </div>

      {/* Zone de texte */}
      <textarea
        className="flex-1 bg-transparent text-gray-200 text-xs font-mono p-4 resize-none outline-none border-none leading-relaxed placeholder-gray-700"
        placeholder={`// Collez votre script Qlik ici\n// Exemple :\n[FACT_VENTES]:\nNoConcatenate\nLOAD\n  ID_COMMANDE,\n  DATE_CMD,\n  MONTANT_HT\nFROM [lib://QVD/ventes.qvd] (qvd);\n\n[DIM_CLIENT]:\nNoConcatenate\nLOAD\n  ID_CLIENT,\n  NOM_CLIENT,\n  VILLE\nFROM [lib://QVD/clients.qvd] (qvd);`}
        value={script}
        onChange={e => onScriptChange(e.target.value)}
        spellCheck={false}
      />

      {/* Footer */}
      <div className="p-3 border-t border-gray-800">
        {/* Stats script */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-600">
            {script.length > 0 ? `${script.split('\n').length} lignes · ${script.length} car.` : 'Aucun script'}
          </span>
          {/* Badge analyse existante */}
          {analysis && (
            <span className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
              isCached
                ? 'bg-blue-900/30 text-blue-400 border border-blue-700/40'
                : analysisMode === 'local'
                  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/40'
                  : 'bg-violet-900/30 text-violet-400 border border-violet-700/40'
            }`}>
              {isCached ? (
                <><HardDrive size={10} /> Cache</>
              ) : analysisMode === 'local' ? (
                <><Zap size={10} /> Local</>
              ) : (
                <><Brain size={10} /> Claude</>
              )}
            </span>
          )}
        </div>

        {/* Bouton analyser */}
        <button
          onClick={() => onAnalyze(analyzeMode)}
          disabled={analyzing || !script.trim()}
          className={`w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors ${
            isLocal
              ? 'bg-yellow-600 hover:bg-yellow-500'
              : 'bg-violet-600 hover:bg-violet-500'
          }`}
        >
          {analyzing ? (
            <><Loader2 size={15} className="animate-spin" />
              {isLocal ? 'Analyse locale...' : 'Analyse Claude...'}
            </>
          ) : (
            <>
              {isLocal ? <Zap size={15} /> : <Brain size={15} />}
              {isLocal ? 'Analyser en local' : 'Analyser avec Claude'}
            </>
          )}
        </button>

        {/* Info cache (Claude only) */}
        {!isLocal && (
          <p className="text-xs text-gray-700 mt-1.5 text-center">
            💾 Script inchangé → cache utilisé automatiquement
          </p>
        )}
      </div>
    </div>
  );
}
