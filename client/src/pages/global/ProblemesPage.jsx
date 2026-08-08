import React from 'react';
import { AlertTriangle, Copy, Database, FileWarning } from 'lucide-react';
import { useGlobalContext } from '../../layouts/GlobalLayout.jsx';
import { PageBody } from '../../components/ui/primitives';
import { AppChips } from '../../components/global/bits.jsx';

/*
 * Problèmes agrégés : orphelins, doublons d'extraction, écrasements
 * potentiels, QVD externes. Une section par catégorie ; les catégories vides
 * disparaissent au lieu d'afficher un « Aucun 🎉 » quatre fois.
 */

function Section({ tone, icon: Icon, title, hint, items, renderItem, emptyLabel }) {
  const toneClasses = {
    danger: 'text-danger border-danger/30 bg-danger-soft',
    warn: 'text-warn border-warn/30 bg-warn-soft',
    muted: 'text-ink-muted border-line bg-raised'
  }[tone];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Icon size={15} className={
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-muted'
        } />
        <span className="text-ink">{title}</span>
        <span className="text-xs text-ink-faint font-normal">({items.length})</span>
      </h2>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-ink-faint pl-6">{emptyLabel}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className={`text-[13px] rounded-lg border px-3 py-2 ${toneClasses}`}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ProblemesPage() {
  const { data } = useGlobalContext();

  return (
    <PageBody>
      <div className="space-y-6 max-w-4xl">
        <Section
          tone="danger"
          icon={FileWarning}
          title="QVD orphelins"
          hint="Générés mais jamais consommés — candidats à la suppression."
          items={data.orphans}
          emptyLabel="Aucun orphelin détecté."
          renderItem={q => (
            <>
              <span className="font-mono text-danger">{q.name}</span>
              <span className="text-ink-muted"> — écrit par {q.producers.map(p => p.appName).join(', ')}</span>
              {q.paths[0] && (
                <div className="text-[11px] text-ink-faint font-mono mt-1 break-all">{q.paths[0]}</div>
              )}
            </>
          )}
        />

        <Section
          tone="warn"
          icon={Copy}
          title="Extractions dupliquées"
          hint="La même table SQL est tirée par plusieurs apps — extractions à mutualiser."
          items={data.duplicateExtractions}
          emptyLabel="Aucune extraction dupliquée."
          renderItem={d => (
            <>
              <span className="font-mono text-warn">{d.table}</span>
              <span className="text-ink-muted"> extraite par : </span>
              <AppChips list={d.apps} />
            </>
          )}
        />

        <Section
          tone="warn"
          icon={AlertTriangle}
          title="QVD écrits par plusieurs apps"
          hint="Risque d'écrasement — vérifier l'ordre des reloads ou renommer les cibles."
          items={data.multiProduced}
          emptyLabel="Aucun conflit d'écriture."
          renderItem={q => (
            <>
              <span className="font-mono text-warn">{q.name}</span>
              <span className="text-ink-muted"> écrit par : </span>
              <AppChips list={q.producers} />
            </>
          )}
        />

        <Section
          tone="muted"
          icon={Database}
          title="QVD externes"
          hint="Consommés mais producteur non identifié — soit l'app batch n'est pas encore importée, soit ils viennent d'un autre système."
          items={data.externals}
          emptyLabel="Aucun QVD externe."
          renderItem={q => (
            <span className="font-mono text-ink-muted">{q.name}</span>
          )}
        />
      </div>
    </PageBody>
  );
}
