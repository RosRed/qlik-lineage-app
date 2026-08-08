import React from 'react';
import { Badge } from '../ui/primitives';

/* Petits composants partagés par les pages du lineage global. */

// Les rôles passent par les tons sémantiques du Badge plutôt que par les
// hexadécimaux du graphe : contraste correct en thème clair comme sombre.
const ROLE_TONES = {
  batch: 'violet',
  transform: 'warn',
  front: 'accent',
  autonome: 'default',
  inconnu: 'default'
};

const ROLE_LABELS = {
  batch: 'BATCH',
  transform: 'TRANSFORM',
  front: 'FRONT',
  autonome: 'AUTONOME',
  inconnu: '?'
};

export function RoleBadge({ role }) {
  return (
    <Badge tone={ROLE_TONES[role] || 'default'}>
      {ROLE_LABELS[role] || ROLE_LABELS.inconnu}
    </Badge>
  );
}

const STATUS_TONES = { orphelin: 'danger', externe: 'warn', ok: 'accent' };

export function QvdStatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] || 'default'}>{status}</Badge>;
}

/** Liste compacte de noms d'apps ; affiche un tiret cadratin si vide. */
export function AppChips({ list }) {
  if (!list?.length) return <span className="text-ink-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((a, i) => (
        <span
          key={i}
          className="text-[11px] px-1.5 py-0.5 bg-raised text-ink-muted rounded whitespace-nowrap"
        >
          {a.appName}
        </span>
      ))}
    </div>
  );
}
