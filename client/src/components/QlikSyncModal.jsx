import React, { useEffect, useState, useMemo } from 'react';
import { X, RefreshCw, Loader2, Plus, Trash2, AlertTriangle, Undo2, CheckCircle2, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import { qlikApi } from '../api/qlikApi';

/**
 * Synchronise la base locale avec le serveur Qlik SANS le tout-supprimer /
 * tout-réimporter. Calcule un diff (nouvelles apps / apps supprimées côté serveur
 * / apps modifiées depuis le dernier import) et laisse l'utilisateur choisir
 * quoi appliquer. Les nouvelles apps déclenchent ensuite l'import normal ;
 * les supprimées passent en corbeille (soft delete) ; les modifiées sont
 * simplement flaggées `stale = 1` (l'utilisateur clique "Ré-analyser" quand il
 * veut).
 */
export default function QlikSyncModal({ onClose, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [diff, setDiff] = useState(null);
  const [selectedNew, setSelectedNew] = useState(new Set());
  const [selectedDel, setSelectedDel] = useState(new Set());
  const [selectedUpd, setSelectedUpd] = useState(new Set());
  const [selectedMeta, setSelectedMeta] = useState(new Set());
  const [applying, setApplying] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState('local');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await qlikApi.syncPreview();
      setDiff(d);
      // tout coché par défaut — l'utilisateur décoche ce qu'il refuse
      setSelectedNew(new Set(d.newApps.map(a => a.qlikAppId)));
      setSelectedDel(new Set(d.deletedApps.map(a => a.localId)));
      setSelectedUpd(new Set(d.updatedApps.map(a => a.localId)));
      setSelectedMeta(new Set((d.metaChangedApps || []).map(a => a.localId)));
    } catch (e) {
      setError(e.error || e.message || 'Impossible de calculer le diff');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totalActions = selectedNew.size + selectedDel.size + selectedUpd.size + selectedMeta.size;

  const toggle = (set, setter, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const apply = async () => {
    if (!diff) return;
    setApplying(true);
    try {
      // 1) Mutations DB (soft delete + stale + réactivations)
      const reactivateLocalIds = diff.newApps
        .filter(a => a.reactivate && selectedNew.has(a.qlikAppId))
        .map(a => a.localId);
      const metaChanges = (diff.metaChangedApps || [])
        .filter(a => selectedMeta.has(a.localId))
        .map(a => ({ localId: a.localId, proposed: a.proposed }));
      const applied = await qlikApi.syncApply({
        deletedLocalIds: [...selectedDel],
        updatedLocalIds: [...selectedUpd],
        reactivateLocalIds,
        metaChanges
      });

      // 2) Import des nouvelles apps sélectionnées (le flow existant s'occupe du reste)
      const toImport = diff.newApps.filter(a => selectedNew.has(a.qlikAppId));
      if (toImport.length) {
        await qlikApi.import(toImport, analyzeMode);
      }
      toast.success(
        `Sync appliquée — ${toImport.length} import(s), ${applied.deleted} corbeille, ${applied.marked_stale} à ré-analyser, ${applied.meta_refreshed || 0} méta MAJ`
      );
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e.error || e.message || 'Échec de la synchronisation');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl max-h-[92vh] rounded-lg border border-gray-700 bg-gray-950 flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-100">Synchroniser avec le serveur Qlik</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800">
              Apps publiées uniquement
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center py-16 text-gray-400 text-xs">
            <Loader2 className="animate-spin mr-2" size={14} /> Calcul du diff serveur ↔ local…
          </div>
        )}

        {error && !loading && (
          <div className="p-5">
            <div className="text-xs text-red-400 border border-red-900 bg-red-950/40 rounded px-3 py-2">
              {error}
            </div>
            <button onClick={load} className="mt-3 text-xs text-emerald-400 hover:text-emerald-300 underline">
              Réessayer
            </button>
          </div>
        )}

        {diff && !loading && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* résumé */}
              <div className="grid grid-cols-5 gap-3 text-xs">
                <StatTile icon={Plus}          color="emerald" label="Nouvelles"    value={diff.newApps.length} />
                <StatTile icon={Tag}           color="sky"     label="Métadonnées"  value={(diff.metaChangedApps || []).length} />
                <StatTile icon={AlertTriangle} color="amber"   label="Modifiées"    value={diff.updatedApps.length} />
                <StatTile icon={Trash2}        color="rose"    label="Supprimées"   value={diff.deletedApps.length} />
                <StatTile icon={CheckCircle2}  color="gray"    label="À jour"       value={diff.unchanged} />
              </div>

              {/* Nouvelles */}
              <Section
                title="Nouvelles apps à importer"
                subtitle="Publiées sur Qlik, pas encore en local."
                icon={Plus} color="emerald"
                items={diff.newApps}
                empty="Aucune nouvelle app côté Qlik."
                allSelected={selectedNew.size === diff.newApps.length}
                onToggleAll={() => setSelectedNew(
                  selectedNew.size === diff.newApps.length ? new Set() : new Set(diff.newApps.map(a => a.qlikAppId))
                )}
                render={(a) => (
                  <Row
                    key={a.qlikAppId}
                    checked={selectedNew.has(a.qlikAppId)}
                    onToggle={() => toggle(selectedNew, setSelectedNew, a.qlikAppId)}
                    left={<>
                      <div className="font-medium text-gray-100 text-xs flex items-center gap-2">
                        {a.name}
                        {a.reactivate && <span className="px-1.5 py-0.5 text-[10px] bg-blue-900/40 text-blue-300 rounded">Réactivation</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">{a.stream || '—'}</div>
                    </>}
                    right={a.lastReloadTime ? new Date(a.lastReloadTime).toLocaleDateString('fr-FR') : '—'}
                  />
                )}
              />

              {/* Métadonnées à rafraîchir */}
              <Section
                title="Métadonnées à mettre à jour"
                subtitle="Stream, nom ou propriétaire ont changé côté Qlik — MAJ locale sans re-fetch du script."
                icon={Tag} color="sky"
                items={diff.metaChangedApps || []}
                empty="Toutes les métadonnées sont alignées."
                allSelected={selectedMeta.size === (diff.metaChangedApps || []).length}
                onToggleAll={() => setSelectedMeta(
                  selectedMeta.size === (diff.metaChangedApps || []).length
                    ? new Set()
                    : new Set((diff.metaChangedApps || []).map(a => a.localId))
                )}
                render={(a) => (
                  <Row
                    key={a.localId}
                    checked={selectedMeta.has(a.localId)}
                    onToggle={() => toggle(selectedMeta, setSelectedMeta, a.localId)}
                    left={<>
                      <div className="font-medium text-gray-100 text-xs">{a.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {Object.entries(a.changes).map(([field, v]) => (
                          <span key={field} className="inline-block mr-3">
                            <span className="text-gray-600">{field}:</span>{' '}
                            <span className="text-rose-400 line-through">{v.from || '—'}</span>
                            {' → '}
                            <span className="text-emerald-400">{v.to || '—'}</span>
                          </span>
                        ))}
                      </div>
                    </>}
                    right={null}
                  />
                )}
              />

              {/* Modifiées */}
              <Section
                title="Apps modifiées à ré-analyser"
                subtitle="Rechargées côté Qlik depuis le dernier import — flaguées 'à ré-analyser' (script non re-fetché)."
                icon={AlertTriangle} color="amber"
                items={diff.updatedApps}
                empty="Aucune app modifiée."
                allSelected={selectedUpd.size === diff.updatedApps.length}
                onToggleAll={() => setSelectedUpd(
                  selectedUpd.size === diff.updatedApps.length ? new Set() : new Set(diff.updatedApps.map(a => a.localId))
                )}
                render={(a) => (
                  <Row
                    key={a.localId}
                    checked={selectedUpd.has(a.localId)}
                    onToggle={() => toggle(selectedUpd, setSelectedUpd, a.localId)}
                    left={<>
                      <div className="font-medium text-gray-100 text-xs">{a.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {a.previousReload ? new Date(a.previousReload).toLocaleString('fr-FR') : '—'}
                        {' → '}
                        {a.currentReload ? new Date(a.currentReload).toLocaleString('fr-FR') : '—'}
                      </div>
                    </>}
                    right={a.stream || '—'}
                  />
                )}
              />

              {/* Supprimées */}
              <Section
                title="Apps disparues du serveur"
                subtitle="Passent en corbeille (soft delete) — restaurables si l'app réapparaît côté Qlik."
                icon={Trash2} color="rose"
                items={diff.deletedApps}
                empty="Aucune app disparue."
                allSelected={selectedDel.size === diff.deletedApps.length}
                onToggleAll={() => setSelectedDel(
                  selectedDel.size === diff.deletedApps.length ? new Set() : new Set(diff.deletedApps.map(a => a.localId))
                )}
                render={(a) => (
                  <Row
                    key={a.localId}
                    checked={selectedDel.has(a.localId)}
                    onToggle={() => toggle(selectedDel, setSelectedDel, a.localId)}
                    left={<>
                      <div className="font-medium text-gray-100 text-xs">{a.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{a.stream || '—'}</div>
                    </>}
                    right={a.lastReload ? new Date(a.lastReload).toLocaleDateString('fr-FR') : '—'}
                  />
                )}
              />
            </div>

            {/* footer */}
            <div className="border-t border-gray-800 px-5 py-3 flex items-center justify-between bg-gray-900/40">
              <div className="text-xs text-gray-400">
                {totalActions === 0 ? 'Rien à appliquer' : `${totalActions} action(s) sélectionnée(s)`}
              </div>
              <div className="flex items-center gap-2">
                {selectedNew.size > 0 && (
                  <select
                    value={analyzeMode}
                    onChange={e => setAnalyzeMode(e.target.value)}
                    className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-200"
                    title="Mode d'analyse à l'import"
                  >
                    <option value="local">Analyse locale</option>
                    <option value="claude">Analyse Claude</option>
                    <option value="none">Sans analyse</option>
                  </select>
                )}
                <button
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  Annuler
                </button>
                <button
                  disabled={applying || totalActions === 0}
                  onClick={apply}
                  className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {applying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Appliquer
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── petits composants internes ─────────────────────────────────────────── */

function StatTile({ icon: Icon, color, label, value }) {
  const bg = {
    emerald: 'bg-emerald-900/30 border-emerald-800 text-emerald-300',
    amber:   'bg-amber-900/30 border-amber-800 text-amber-300',
    rose:    'bg-rose-900/30 border-rose-800 text-rose-300',
    sky:     'bg-sky-900/30 border-sky-800 text-sky-300',
    gray:    'bg-gray-900/30 border-gray-800 text-gray-300'
  }[color];
  return (
    <div className={`border rounded px-3 py-2 flex items-center gap-3 ${bg}`}>
      <Icon size={16} />
      <div>
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="text-[10px] opacity-80 mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, icon: Icon, color, items, empty, render, allSelected, onToggleAll }) {
  const badge = {
    emerald: 'text-emerald-400 border-emerald-900',
    amber:   'text-amber-400 border-amber-900',
    rose:    'text-rose-400 border-rose-900',
    sky:     'text-sky-400 border-sky-900'
  }[color];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className={`text-xs font-semibold inline-flex items-center gap-1.5 ${badge?.split(' ')[0] || ''}`}>
            <Icon size={13} /> {title}
            <span className="ml-1 text-[10px] font-mono opacity-70">({items.length})</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>
        </div>
        {items.length > 0 && (
          <button
            onClick={onToggleAll}
            className="text-[11px] text-gray-400 hover:text-gray-200 underline"
          >
            {allSelected ? 'Tout décocher' : 'Tout cocher'}
          </button>
        )}
      </div>
      {items.length === 0
        ? <div className="text-[11px] text-gray-600 italic px-2 py-1.5">{empty}</div>
        : <div className="border border-gray-800 rounded divide-y divide-gray-800 overflow-hidden">{items.map(render)}</div>
      }
    </div>
  );
}

function Row({ checked, onToggle, left, right }) {
  return (
    <label className="flex items-center gap-3 px-3 py-2 hover:bg-gray-900/60 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="accent-emerald-500"
      />
      <div className="flex-1 min-w-0">{left}</div>
      <div className="text-[11px] text-gray-500 shrink-0">{right}</div>
    </label>
  );
}
