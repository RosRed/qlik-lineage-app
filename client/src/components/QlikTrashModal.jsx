import React, { useEffect, useState } from 'react';
import { X, Trash2, Undo2, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { qlikApi } from '../api/qlikApi';

/**
 * Corbeille des apps soft-deleted par la synchro. Chaque ligne offre
 * "Restaurer" (annule le deleted_at) ou "Purger" (DELETE définitif — cascade
 * scripts/analyses/chat/snapshots). Un bouton "Tout purger" en bas pour vider
 * la corbeille en un clic.
 */
export default function QlikTrashModal({ onClose, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [purgingAll, setPurgingAll] = useState(false);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await qlikApi.trash();
      setItems(rows);
    } catch (e) {
      toast.error(e.error || e.message || 'Impossible de lire la corbeille');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const restore = async (id) => {
    setBusyId(id);
    try {
      await qlikApi.syncRestore(id);
      toast.success('App restaurée');
      setItems(items.filter(i => i.id !== id));
      onChanged?.();
    } catch (e) {
      toast.error(e.error || e.message || 'Échec restauration');
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (id) => {
    if (!window.confirm('Suppression définitive (scripts, analyses, chat, snapshots) — confirmer ?')) return;
    setBusyId(id);
    try {
      await qlikApi.syncPurge(id);
      toast.success('App purgée définitivement');
      setItems(items.filter(i => i.id !== id));
      onChanged?.();
    } catch (e) {
      toast.error(e.error || e.message || 'Échec purge');
    } finally {
      setBusyId(null);
    }
  };

  const purgeAll = async () => {
    setPurgingAll(true);
    try {
      // Purge séquentielle (transaction côté serveur item par item — safe)
      for (const item of items) {
        await qlikApi.syncPurge(item.id);
      }
      toast.success(`${items.length} apps purgées`);
      setItems([]);
      onChanged?.();
      setConfirmPurgeAll(false);
    } catch (e) {
      toast.error(e.error || e.message || 'Échec purge globale');
      await load();
    } finally {
      setPurgingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] rounded-lg border border-gray-700 bg-gray-950 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Trash2 size={16} className="text-rose-400" />
            <h2 className="text-sm font-semibold text-gray-100">Corbeille des apps</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-mono">
              {items.length}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-2 border-b border-gray-800 bg-amber-950/20 text-[11px] text-amber-300 flex items-start gap-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Ces apps ont été retirées de Qlik (dépubliées ou supprimées). Elles restent lisibles ici
            jusqu'à purge définitive. Une <b>restauration</b> les remet dans la liste — utile si l'app
            réapparaît côté Qlik (elle sera aussi automatiquement réactivée au prochain import).
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-xs">
              <Loader2 className="animate-spin mr-2" size={14} /> Chargement…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-xs text-gray-500 italic">
              Corbeille vide.
            </div>
          ) : (
            <div className="border border-gray-800 rounded divide-y divide-gray-800 overflow-hidden">
              {items.map(item => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-900/60">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-100 truncate">{item.name}</div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-3 mt-0.5">
                      <span>Stream: <span className="font-mono">{item.stream || '—'}</span></span>
                      {item.last_reload && (
                        <span>Dernier reload: {new Date(item.last_reload).toLocaleDateString('fr-FR')}</span>
                      )}
                      <span>Supprimée: {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString('fr-FR') : '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      disabled={busyId === item.id}
                      onClick={() => restore(item.id)}
                      className="text-[11px] px-2 py-1 rounded border border-emerald-800 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Undo2 size={11} /> Restaurer
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => purge(item.id)}
                      className="text-[11px] px-2 py-1 rounded border border-rose-800 text-rose-300 hover:bg-rose-900/30 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Trash2 size={11} /> Purger
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-gray-800 px-5 py-3 flex items-center justify-between bg-gray-900/40">
            <div className="text-xs text-gray-400">
              {items.length} app(s) en corbeille
            </div>
            {confirmPurgeAll ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-300">Confirmer la purge de toutes les {items.length} ?</span>
                <button
                  onClick={() => setConfirmPurgeAll(false)}
                  className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  Annuler
                </button>
                <button
                  disabled={purgingAll}
                  onClick={purgeAll}
                  className="text-xs px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {purgingAll ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  Oui, purger tout
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmPurgeAll(true)}
                className="text-xs px-3 py-1.5 rounded border border-rose-800 text-rose-300 hover:bg-rose-900/30 inline-flex items-center gap-1.5"
              >
                <Trash2 size={12} /> Vider la corbeille
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
