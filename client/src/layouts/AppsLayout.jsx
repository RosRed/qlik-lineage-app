import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Boxes, Plus, Check, X, Crosshair } from 'lucide-react';
import { useAppsList } from '../context/AppsContext';
import { PageHeader, Button, SubTabs } from '../components/ui/primitives';
import SubTabLink from '../components/ui/SubTabLink';

/*
 * Section Applications : la liste et la recherche d'impact partagent le même
 * en-tête et la même barre d'onglets, sur le modèle de la section Global.
 *
 * Le détail d'une app (/apps/:id) n'est PAS sous ce layout — il a sa propre
 * navigation (Vue d'ensemble, Sources, Lineage…), et empiler deux barres
 * d'onglets n'aurait servi à rien.
 */
export default function AppsLayout() {
  const { apps, loading, createApp } = useAppsList();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const app = await createApp(newName.trim());
    if (app) {
      setNewName('');
      setCreating(false);
      navigate(`/apps/${app.id}`);
    }
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
      >
        <SubTabs>
          <SubTabLink to="." end icon={Boxes} label="Applications" count={apps.length} />
          <SubTabLink to="impact" icon={Crosshair} label="Impact" />
        </SubTabs>
      </PageHeader>

      <Outlet />
    </>
  );
}
