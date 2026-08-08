import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Plus, Pencil, Trash2, Check, X, Database, Loader2 } from 'lucide-react';
import { useAppsList } from '../context/AppsContext';
import {
  PageHeader, PageBody, Button, SearchInput, Select, Badge, EmptyState
} from '../components/ui/primitives';

/* Normalisation accents/casse pour la recherche */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/*
 * Liste des applications, remontée depuis la sidebar en tableau plein écran.
 * L'ancienne sidebar de 250px imposait des lignes tronquées, aucune colonne
 * de contexte, et bloquait sa largeur en permanence.
 */
export default function AppsListPage() {
  const { apps, loading, createApp, renameApp, removeApp } = useAppsList();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const streams = useMemo(
    () => [...new Set(apps.map(a => a.stream).filter(Boolean))].sort(),
    [apps]
  );

  const filtered = useMemo(() => {
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
    const app = await createApp(newName.trim());
    if (app) {
      setNewName('');
      setCreating(false);
      navigate(`/apps/${app.id}`);
    }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    await renameApp(id, editName.trim());
    setEditingId(null);
  };

  const handleDelete = async (app) => {
    if (!window.confirm(`Supprimer « ${app.name} » ?`)) return;
    await removeApp(app.id);
  };

  return (
    <>
      <PageHeader
        icon={Boxes}
        title="Applications"
        subtitle={loading ? 'Chargement…' : `${apps.length} application${apps.length !== 1 ? 's' : ''}`}
        actions={
          !creating ? (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              Nouvelle app
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                }}
                placeholder="Nom de la nouvelle app"
                className="bg-canvas border border-line rounded-lg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
              <Button variant="primary" onClick={handleCreate}><Check size={14} /></Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setNewName(''); }}>
                <X size={14} />
              </Button>
            </div>
          )
        }
      />

      <div className="shrink-0 flex items-center gap-2 flex-wrap px-5 py-3 border-b border-line bg-surface">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Rechercher une application…"
          className="w-full max-w-xs"
        />
        {streams.length > 0 && (
          <Select value={streamFilter} onChange={setStreamFilter} aria-label="Filtrer par stream">
            <option value="">Tous les streams</option>
            {streams.map(st => <option key={st} value={st}>{st}</option>)}
          </Select>
        )}
        <Select value={stateFilter} onChange={setStateFilter} aria-label="Filtrer par état">
          <option value="">Toutes</option>
          <option value="analyzed">Analysées</option>
          <option value="not_analyzed">Non analysées</option>
        </Select>
        {filtered.length !== apps.length && (
          <span className="text-xs text-ink-faint tabular-nums">
            {filtered.length} / {apps.length} affichée{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <PageBody flush>
        {loading && apps.length === 0 ? (
          <div className="p-5 space-y-2">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-12" />)}
          </div>
        ) : apps.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Aucune application"
            description="Créez une app pour coller un script, ou importez depuis le serveur Qlik."
            action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Créer une app</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Aucune app ne correspond aux filtres"
            description="Élargissez la recherche ou retirez un filtre."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                  <th className="py-2 pl-5 pr-3">Nom</th>
                  <th className="py-2 pr-3">Stream</th>
                  <th className="py-2 pr-3">Propriétaire</th>
                  <th className="py-2 pr-3">Origine</th>
                  <th className="py-2 pr-3">État</th>
                  <th className="py-2 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(app => (
                  <tr
                    key={app.id}
                    className="hover:bg-raised/60 cursor-pointer group"
                    onClick={() => editingId !== app.id && navigate(`/apps/${app.id}`)}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      {editingId === app.id ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(app.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="bg-canvas border border-line rounded px-2 py-1 text-sm text-ink outline-none focus:border-accent"
                          />
                          <button onClick={() => handleRename(app.id)} className="text-accent-ink hover:opacity-80">
                            <Check size={14} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-ink-faint hover:text-ink">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Database size={14} className="text-accent shrink-0" />
                          <span className="text-ink font-medium">{app.name}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-muted">{app.stream || '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-muted max-w-[180px] truncate" title={app.owner || ''}>
                      {app.owner || '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      {app.origin === 'qlik-server'
                        ? <Badge tone="info">Qlik</Badge>
                        : <Badge>Local</Badge>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {app.analyzed
                        ? <Badge tone="accent">Analysée</Badge>
                        : <Badge>À analyser</Badge>}
                    </td>
                    <td className="py-2.5 pr-5 text-right">
                      <div
                        className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => { setEditingId(app.id); setEditName(app.name); }}
                          className="p-1.5 text-ink-faint hover:text-info transition-colors"
                          aria-label="Renommer"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(app)}
                          className="p-1.5 text-ink-faint hover:text-danger transition-colors"
                          aria-label="Supprimer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}
