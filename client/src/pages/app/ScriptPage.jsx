import React, { useRef } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppContext } from '../../layouts/AppDetailLayout.jsx';
import { Button } from '../../components/ui/primitives';

/*
 * Éditeur de script en page dédiée.
 *
 * Remplace ScriptEditor, qui occupait 350px en permanence sur tous les écrans
 * alors qu'on ne consulte le script brut qu'occasionnellement. Le choix du mode
 * et le bouton « Analyser » vivent maintenant dans l'en-tête de l'application,
 * donc accessibles depuis n'importe quel onglet.
 */

const PLACEHOLDER = `// Collez votre script Qlik ici, ou importez un fichier .qvs
// Exemple :

[FACT_VENTES]:
NoConcatenate
LOAD
  ID_COMMANDE,
  DATE_CMD,
  MONTANT_HT
FROM [lib://QVD/ventes.qvd] (qvd);

[DIM_CLIENT]:
NoConcatenate
LOAD
  ID_CLIENT,
  NOM_CLIENT,
  VILLE
FROM [lib://QVD/clients.qvd] (qvd);`;

const ACCEPTED = ['.qvs', '.sql', '.txt'];

export default function ScriptPage() {
  const { script, setScript } = useAppContext();
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      toast.error(`Format non supporté. Utilisez ${ACCEPTED.join(', ')}`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScript(ev.target.result);
      toast.success(`Fichier « ${file.name} » chargé`);
    };
    reader.onerror = () => toast.error('Lecture du fichier impossible');
    reader.readAsText(file);
    e.target.value = '';
  };

  const lineCount = script ? script.split('\n').length : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-line">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Script Qlik / SQL
        </span>
        <div className="flex-1" />
        <Button icon={Upload} onClick={() => fileRef.current?.click()}>
          Importer un fichier
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
          onChange={handleFile}
        />
        {script.length > 0 && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => {
              if (window.confirm('Vider l\'éditeur ? Le script enregistré côté serveur reste inchangé jusqu\'à la prochaine analyse.')) {
                setScript('');
              }
            }}
          >
            Vider
          </Button>
        )}
      </div>

      <textarea
        className="flex-1 min-h-0 w-full bg-canvas text-ink text-[13px] font-mono p-5 resize-none outline-none border-none leading-relaxed placeholder-ink-faint"
        placeholder={PLACEHOLDER}
        value={script}
        onChange={e => setScript(e.target.value)}
        spellCheck={false}
        aria-label="Script Qlik ou SQL"
      />

      <div className="shrink-0 flex items-center gap-3 px-5 py-2 border-t border-line text-xs text-ink-faint">
        <span className="tabular-nums">
          {script.length > 0
            ? `${lineCount} ligne${lineCount > 1 ? 's' : ''} · ${script.length.toLocaleString('fr-FR')} caractères`
            : 'Aucun script'}
        </span>
        <div className="flex-1" />
        <span>Le bouton « Analyser » en haut enregistre le script puis lance l'analyse.</span>
      </div>
    </div>
  );
}
