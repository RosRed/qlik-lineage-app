import React from 'react';
import { Clock, Link2, Zap, User, HelpCircle, Ban } from 'lucide-react';
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

/**
 * Indicateur de tâche attachée à une app. Le picto choisit selon triggerType :
 *  - schedule / mixte : ⏱  planifiée
 *  - chain            : 🔗 déclenchée par une autre tâche
 *  - manual           : 👤 manuelle (tâche existe mais pas de trigger)
 *  - (aucune tâche)   : 🚫 pas de tâche du tout
 *  - (inconnu)        : ?  info non chargée
 * `disabled: true` la barre en gris désaturé.
 */
const TASK_ICONS = {
  schedule: { Icon: Clock, cls: 'text-emerald-400', tip: 'Tâche planifiée' },
  chain:    { Icon: Link2, cls: 'text-violet-400',  tip: 'Déclenchée en chaîne' },
  mixte:    { Icon: Zap,   cls: 'text-emerald-400', tip: 'Planifiée + chaînée' },
  manual:   { Icon: User,  cls: 'text-yellow-400',  tip: 'Tâche manuelle (pas de trigger)' },
  none:     { Icon: Ban,   cls: 'text-red-400',     tip: 'Pas de tâche de reload' },
  unknown:  { Icon: HelpCircle, cls: 'text-ink-faint', tip: 'Statut inconnu' }
};

function taskInfoFor(qlikAppId, taskMap) {
  if (!taskMap) return TASK_ICONS.unknown;
  if (!qlikAppId) return TASK_ICONS.unknown;
  const t = taskMap.get(qlikAppId);
  if (!t) return TASK_ICONS.none;
  const base = TASK_ICONS[t.triggerType] || TASK_ICONS.manual;
  if (!t.enabled) return { ...base, cls: 'text-ink-faint', tip: `${base.tip} — désactivée` };
  return base;
}

/**
 * Liste compacte de noms d'apps ; affiche un tiret cadratin si vide.
 * `taskMap` optionnel : Map<qlikAppId, {triggerType, enabled}> — active le picto.
 */
export function AppChips({ list, taskMap }) {
  if (!list?.length) return <span className="text-ink-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((a, i) => {
        const info = taskInfoFor(a.qlikAppId, taskMap);
        const { Icon, cls, tip } = info;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-raised text-ink-muted rounded whitespace-nowrap"
            title={taskMap ? `${a.appName} — ${tip}` : a.appName}
          >
            {taskMap && <Icon size={10} className={cls} />}
            {a.appName}
          </span>
        );
      })}
    </div>
  );
}
