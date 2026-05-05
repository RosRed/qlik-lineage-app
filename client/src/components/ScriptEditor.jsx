import React, { useRef } from 'react';
import { Upload, Play, FileCode, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ScriptEditor({ app, script, onScriptChange, onAnalyze, analyzing }) {
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ['.qvs', '.sql', '.txt'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      toast.error('Format non supporté. Utilisez .qvs, .sql ou .txt');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => onScriptChange(ev.target.result);
    reader.readAsText(file);
    toast.success(`Fichier "${file.name}" chargé`);
    e.target.value = '';
  };

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
        <p className="text-xs text-gray-600">Collez votre script ou uploadez un fichier .qvs, .sql, .txt</p>
      </div>

      <textarea
        className="flex-1 bg-transparent text-gray-200 text-xs font-mono p-4 resize-none outline-none border-none leading-relaxed placeholder-gray-700"
        placeholder={`// Collez votre script Qlik ici\n// Exemple :\n[FACT_VENTES]:\nNoConcatenate\nLOAD\n  ID_COMMANDE,\n  DATE_CMD,\n  MONTANT_HT\nFROM [lib://QVD/ventes.qvd] (qvd);\n\n[DIM_CLIENT]:\nNoConcatenate\nLOAD\n  ID_CLIENT,\n  NOM_CLIENT,\n  VILLE\nFROM [lib://QVD/clients.qvd] (qvd);`}
        value={script}
        onChange={e => onScriptChange(e.target.value)}
        spellCheck={false}
      />

      <div className="p-3 border-t border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-600">
            {script.length > 0 ? `${script.split('\n').length} lignes · ${script.length} car.` : 'Aucun script'}
          </span>
        </div>
        <button
          onClick={onAnalyze}
          disabled={analyzing || !script.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
        >
          {analyzing ? (
            <><Loader2 size={15} className="animate-spin" /> Analyse en cours...</>
          ) : (
            <><Play size={15} /> Analyser avec Claude</>
          )}
        </button>
      </div>
    </div>
  );
}
