import React from 'react';
import { NavLink } from 'react-router-dom';
import { Construction, ExternalLink } from 'lucide-react';
import { PageBody, Card } from '../../components/ui/primitives';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Écran commun aux vues encore non branchées (Dashboard, Exécutions, Erreurs,
 * Tables, Jobs). Explique où on en est et donne le lien vers les Réglages tant
 * que la connexion SSISDB n'est pas validée.
 */

export default function SsisPlaceholderPage({ title, description, phase }) {
  const { health } = useSsisContext();
  const configured = !!health?.configured;

  return (
    <PageBody>
      <Card className="max-w-xl mx-auto text-center py-10">
        <div className="flex justify-center mb-3">
          <Construction size={36} className="text-warn" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-muted mt-2 max-w-md mx-auto">{description}</p>
        {phase && (
          <div className="mt-3 inline-block text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-raised text-ink-muted">
            {phase}
          </div>
        )}
        {!configured && (
          <div className="mt-5 pt-4 border-t border-line">
            <p className="text-xs text-warn mb-2">Configurez d'abord la connexion à SSISDB.</p>
            <NavLink to="/ssis/settings"
              className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
              Aller aux réglages <ExternalLink size={11} />
            </NavLink>
          </div>
        )}
      </Card>
    </PageBody>
  );
}
