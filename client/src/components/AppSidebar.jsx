import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Database, Check, X } from 'lucide-react';

export default function AppSidebar({ apps, selectedApp, onSelect, onCreate, onRename, onDelete, loading }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const app = await onCreate(newName.trim());
    if (app) { setNewName(''); setCreating(false); onSelect(app); }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    await onRename(id, editName.trim());
    setEditingId(null);
  };

  return (
    <aside className="w-[250px] min-w-[250px] bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-emerald-500" />
          <h1 className="text-sm font-semibold text-white">Qlik Lineage</h1>
        </div>
        <p className="text-xs text-gray-500">Data Lineage Explorer</p>
      </div>

      <div className="p-3 border-b border-gray-800">
        {creating ? (
          <div className="flex gap-1">
            <input
              autoFocus
              className="flex-1 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 focus:border-emerald-500 outline-none"
              placeholder="Nom de l'application"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            />
            <button onClick={handleCreate} className="p-1.5 text-emerald-500 hover:text-emerald-400">
              <Check size={14} />
            </button>
            <button onClick={() => { setCreating(false); setNewName(''); }} className="p-1.5 text-gray-500 hover:text-gray-400">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition-colors"
          >
            <Plus size={14} />
            Nouvelle App
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map(i => <div key={i} className="skeleton h-9 w-full" />)}
          </div>
        )}
        {!loading && apps.length === 0 && (
          <div className="text-center text-gray-600 text-xs p-4 mt-4">
            Aucune application.<br />Créez-en une pour commencer.
          </div>
        )}
        {apps.map(app => (
          <div
            key={app.id}
            className={`group flex items-center gap-2 px-3 py-2 rounded cursor-pointer mb-1 transition-colors ${
              selectedApp?.id === app.id
                ? 'bg-emerald-900/40 border border-emerald-700/50'
                : 'hover:bg-gray-800 border border-transparent'
            }`}
            onClick={() => editingId !== app.id && onSelect(app)}
          >
            <Database size={13} className={selectedApp?.id === app.id ? 'text-emerald-400' : 'text-gray-500'} />
            {editingId === app.id ? (
              <div className="flex flex-1 gap-1" onClick={e => e.stopPropagation()}>
                <input
                  autoFocus
                  className="flex-1 bg-gray-700 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 focus:border-emerald-500 outline-none min-w-0"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(app.id); if (e.key === 'Escape') setEditingId(null); }}
                />
                <button onClick={() => handleRename(app.id)} className="text-emerald-500 hover:text-emerald-400"><Check size={12} /></button>
                <button onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-400"><X size={12} /></button>
              </div>
            ) : (
              <>
                <span className={`flex-1 text-xs truncate ${selectedApp?.id === app.id ? 'text-white' : 'text-gray-300'}`}>
                  {app.name}
                </span>
                <div className="hidden group-hover:flex gap-1">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingId(app.id); setEditName(app.name); }}
                    className="p-0.5 text-gray-500 hover:text-blue-400 transition-colors"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); if (confirm(`Supprimer "${app.name}" ?`)) onDelete(app.id); }}
                    className="p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-800 text-xs text-gray-600 text-center">
        {apps.length} application{apps.length !== 1 ? 's' : ''}
      </div>
    </aside>
  );
}
