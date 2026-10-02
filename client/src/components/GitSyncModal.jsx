import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertTriangle, X, Check, FolderGit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { appsApi } from '../api/appsApi';
import { Button } from './ui/primitives';

/*
 * Réapplication d'un export sur l'app : aperçu du diff, puis application.
 *
 * L'aperçu n'est pas décoratif. Rejouer des fichiers sur une app écrase du
 * travail ; on montre d'abord exactement ce qui va changer, et on n'applique
 * que les portées cochées.
 *
 * Les orphelins — objets présents dans l'app mais absents des fichiers — sont
 * affichés mais jamais supprimés sans que l'utilisateur le demande
 * explicitement : une suppression d'objet Qlik est irréversible.
 */

const PORTEES = [
  { cle: 'script', label: 'Script de chargement' },
  { cle: 'master', label: 'Éléments maîtres (mesures, dimensions, variables)' },
  { cle: 'sheets', label: 'Feuilles et leurs objets' },
];

const FAMILLES = {
  dimensions: 'Dimensions',
  measures: 'Mesures',
  variables: 'Variables',
  sheets: 'Feuilles',
};

/** Une famille est-elle concernée par les portées cochées ? */
const famillePortee = (famille, portees) =>
  famille === 'sheets' ? portees.includes('sheets') : portees.includes('master');

export default function GitSyncModal({ app, onClose, onApplied }) {
  const [diff, setDiff] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [portees, setPortees] = useState(['script']);
  const [supprimer, setSupprimer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreurs, setErreurs] = useState([]);

  const charger = useCallback(() => {
    setChargement(true); setErreur(null); setErreurs([]);
    appsApi.exportDiff(app.id)
      .then(setDiff)
      .catch(e => setErreur(e.error || e.message))
      .finally(() => setChargement(false));
  }, [app.id]);

  useEffect(charger, [charger]);

  const basculer = (cle) =>
    setPortees(p => p.includes(cle) ? p.filter(x => x !== cle) : [...p, cle]);

  const appliquer = async () => {
    setEnvoi(true);
    setErreurs([]);
    try {
      const r = await appsApi.exportApply(app.id, portees, supprimer);
      const { script, crees, majours, supprimes, normalises } = r.fait;
      toast.success(
        [script && 'script remplacé', crees && `${crees} créé(s)`,
         majours && `${majours} mis à jour`, supprimes && `${supprimes} supprimé(s)`,
         normalises && `${normalises} entier(s) corrigé(s)`]
          .filter(Boolean).join(' · ') || 'Rien à appliquer'
      );
      setErreurs(r.erreurs || []);
      if (r.erreurs.length) toast.error(`${r.erreurs.length} objet(s) en échec`);
      onApplied?.();
      charger();
    } catch (e) {
      toast.error(e.error || e.message || "Échec de l'application");
    } finally {
      setEnvoi(false);
    }
  };

  // Rien à faire si aucune portée cochée ne présente de changement.
  const changements = diff ? (
    (portees.includes('script') && diff.script ? 1 : 0) +
    Object.entries(diff.familles || {}).reduce((n, [fam, v]) =>
      n + (famillePortee(fam, portees) ? v.creer.length + v.majour.length : 0), 0)
  ) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}>
      <div className="bg-surface border border-line rounded-xl shadow-pop w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <FolderGit2 size={16} className="text-accent-ink" />
          <h2 className="text-sm font-semibold text-ink flex-1">
            Appliquer les modifications — {app.name}
          </h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {chargement && (
            <div className="text-xs text-ink-muted flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Comparaison des fichiers avec l'app…
            </div>
          )}

          {erreur && (
            <div className="text-xs text-danger bg-danger-soft border border-danger rounded-lg px-3 py-2">
              {erreur}
            </div>
          )}

          {erreurs.length > 0 && (
            <div className="text-xs text-danger bg-danger-soft border border-danger rounded-lg px-3 py-2
                            space-y-1">
              <div className="font-medium flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                {erreurs.length} objet(s) n'ont pas pu être appliqués
              </div>
              <ul className="space-y-0.5 font-mono text-[10px] break-all">
                {erreurs.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {diff && diff.verrouille && (
            <div className="text-xs text-danger bg-danger-soft border border-danger rounded-lg px-3 py-2
                            flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Écriture interdite — application en production</div>
                <div className="mt-0.5">{diff.verrouille.error}</div>
              </div>
            </div>
          )}

          {diff && (
            <>
              <div className="font-mono text-[10px] text-ink-faint break-all">{diff.dir}</div>

              <div className="border border-line rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted bg-raised border-b border-line">
                      <th className="py-2 px-3">Élément</th>
                      <th className="py-2 pr-3 text-right">À créer</th>
                      <th className="py-2 pr-3 text-right">À mettre à jour</th>
                      <th className="py-2 pr-3 text-right">Inchangés</th>
                      <th className="py-2 pr-3 text-right">Orphelins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr className={portees.includes('script') ? '' : 'opacity-40'}>
                      <td className="py-1.5 px-3 text-ink">Script</td>
                      <td className="py-1.5 pr-3 text-right text-ink-faint">—</td>
                      <td className="py-1.5 pr-3 text-right">
                        {diff.script
                          ? <span className="text-warn">{diff.script.caracteresAvant} → {diff.script.caracteresApres} car.</span>
                          : <span className="text-ink-faint">identique</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-ink-faint">—</td>
                      <td className="py-1.5 pr-3 text-right text-ink-faint">—</td>
                    </tr>
                    {Object.entries(diff.familles || {}).map(([fam, v]) => (
                      <tr key={fam} className={famillePortee(fam, portees) ? '' : 'opacity-40'}>
                        <td className="py-1.5 px-3 text-ink">{FAMILLES[fam] || fam}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-accent-ink">{v.creer.length || '—'}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-warn">{v.majour.length || '—'}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink-faint">{v.inchanges}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {v.orphelins.length
                            ? <span className="text-danger" title={v.orphelins.map(o => o.titre).join('\n')}>
                                {v.orphelins.length}
                              </span>
                            : <span className="text-ink-faint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-ink-muted">Ce qui sera appliqué</div>
                {PORTEES.map(p => (
                  <label key={p.cle} className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                    <input type="checkbox" checked={portees.includes(p.cle)}
                      onChange={() => basculer(p.cle)} />
                    {p.label}
                  </label>
                ))}
              </div>

              {Object.values(diff.familles || {}).some(v => v.orphelins.length > 0) && (
                <label className="flex items-start gap-2 text-xs text-danger cursor-pointer
                                  bg-danger-soft border border-danger rounded-lg px-3 py-2">
                  <input type="checkbox" checked={supprimer} className="mt-0.5"
                    onChange={e => setSupprimer(e.target.checked)} />
                  <span>
                    Supprimer aussi les objets présents dans l'app mais absents des fichiers.
                    <strong> Irréversible</strong> — laissez décoché en cas de doute.
                  </span>
                </label>
              )}

              {diff.script === null && changements === 0 && (
                <div className="text-xs text-ink-muted flex items-center gap-2">
                  <Check size={13} className="text-accent-ink" /> Les fichiers et l'app sont déjà synchronisés.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
          <span className="text-[11px] flex-1">
            {diff && diff.verrouille
              ? <span className="text-danger">App publiée : dupliquez-la pour pouvoir appliquer</span>
              : <span className="text-ink-muted">
                  {changements > 0
                    ? `${changements} changement(s) dans les portées cochées`
                    : 'Aucun changement dans les portées cochées'}
                </span>}
          </span>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={appliquer}
            disabled={envoi || chargement || changements === 0 || !!(diff && diff.verrouille)}>
            {envoi ? <><Loader2 size={14} className="animate-spin" /> Application…</> : 'Appliquer'}
          </Button>
        </div>
      </div>
    </div>
  );
}
