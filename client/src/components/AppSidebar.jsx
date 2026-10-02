import React, { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Database, Check, X, Search } from 'lucide-react';

// Normalisation accents/casse pour la recherche
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function AppSidebar({ apps, selectedApp, onSelect, onCreate, onRename, onDelete, loading }) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [search, setSearch] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [stateFilter, setStateFilter] = useState(''); // '' | 'analyzed' | 'not_analyzed'

  const streams = useMemo(
    () => [...new Set(apps.map(a => a.stream).filter(Boolean))].sort(),
    [apps]
  );

  const filteredApps = useMemo(() => {
    const q = norm(search.trim());
    return apps.filter(a => {
      if (q && !norm(a.name).includes(q)) return false;
      if (streamFilter && a.stream !== streamFilter) return false;
      if (stateFilter === 'analyzed' && !a.analyzed) return false;
      if (stateFilter === 'not_analyzed' && a.analyzed) return false;
      return true;
    });
  }, [apps, search, streamFilter, stateFilter]);

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
    <aside className="w-[250px] min-w-[250px] bg-surface border-r border-line flex flex-col h-full">
      <div className="p-4 border-b border-line">
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-accent-ink" />
          <h1 className="text-sm font-semibold text-ink">Qlik Lineage</h1>
        </div>
        <p className="text-xs text-ink-muted">Data Lineage Explorer</p>
      </div>

      <div className="p-3 border-b border-line">
        {creating ? (
          <div className="flex gap-1">
            <input
              autoFocus
              className="flex-1 bg-raised text-ink text-xs px-2 py-1.5 rounded border border-line focus:border-accent outline-none"
              placeholder="Nom de l'application"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            />
            <button onClick={handleCreate} className="p-1.5 text-accent-ink hover:text-accent-ink">
              <Check size={14} />
            </button>
            <button onClick={() => { setCreating(false); setNewName(''); }} className="p-1.5 text-ink-muted hover:text-ink-muted">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent text-white text-xs font-medium rounded transition-colors"
          >
            <Plus size={14} />
            Nouvelle App
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="p-3 border-b border-line space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-2 text-ink-faint" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une app..."
            className="w-full bg-raised text-xs text-ink border border-line rounded pl-8 pr-2 py-1.5 outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-1.5">
          {streams.length > 0 && (
            <select
              value={streamFilter}
              onChange={e => setStreamFilter(e.target.value)}
              className="flex-1 min-w-0 bg-raised text-[11px] text-ink border border-line rounded px-1.5 py-1 outline-none focus:border-accent"
            >
              <option value="">Streams</option>
              {streams.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          )}
          <select
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
            className="flex-1 min-w-0 bg-raised text-[11px] text-ink border border-line rounded px-1.5 py-1 outline-none focus:border-accent"
          >
            <option value="">Toutes</option>
            <option value="analyzed">Analysées</option>
            <option value="not_analyzed">Non analysées</option>
          </select>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map(i => <div key={i} className="skeleton h-9 w-full" />)}
          </div>
        )}
        {!loading && apps.length === 0 && (
          <div className="text-center text-ink-faint text-xs p-4 mt-4">
            Aucune application.<br />Créez-en une pour commencer.
          </div>
        )}
        {!loading && apps.length > 0 && filteredApps.length === 0 && (
          <div className="text-center text-ink-faint text-xs p-4 mt-4">
            Aucune app ne correspond aux filtres.
          </div>
        )}
        {filteredApps.map(app => (
          <div
            key={app.id}
            className={`group flex items-center gap-2 px-3 py-2 rounded cursor-pointer mb-1 transition-colors ${
              selectedApp?.id === app.id
                ? 'bg-accent-soft border border-accent'
                : 'hover:bg-raised border border-transparent'
            }`}
            onClick={() => editingId !== app.id && onSelect(app)}
          >
            <Database size={13} className={selectedApp?.id === app.id ? 'text-accent-ink' : 'text-ink-muted'} />
            {editingId === app.id ? (
              <div className="flex flex-1 gap-1" onClick={e => e.stopPropagation()}>
                <input
                  autoFocus
                  className="flex-1 bg-raised text-ink text-xs px-1.5 py-0.5 rounded border border-line focus:border-accent outline-none min-w-0"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(app.id); if (e.key === 'Escape') setEditingId(null); }}
                />
                <button onClick={() => handleRename(app.id)} className="text-accent-ink hover:text-accent-ink"><Check size={12} /></button>
                <button onClick={() => setEditingId(null)} className="text-ink-muted hover:text-ink-muted"><X size={12} /></button>
              </div>
            ) : (
              <>
                <span className={`flex-1 text-xs truncate ${selectedApp?.id === app.id ? 'text-accent-ink font-medium' : 'text-ink'}`}>
                  {app.name}
                </span>
                <div className="hidden group-hover:flex gap-1">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingId(app.id); setEditName(app.name); }}
                    className="p-0.5 text-ink-muted hover:text-info transition-colors"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); if (confirm(`Supprimer "${app.name}" ?`)) onDelete(app.id); }}
                    className="p-0.5 text-ink-muted hover:text-danger transition-colors"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-line text-xs text-ink-faint text-center">
        {filteredApps.length !== apps.length
          ? `${filteredApps.length} affichée${filteredApps.length !== 1 ? 's' : ''} / ${apps.length} au total`
          : `${apps.length} application${apps.length !== 1 ? 's' : ''}`}
      </div>
    </aside>
  );
}
