import React from 'react';
import { Loader2, Search } from 'lucide-react';

/*
 * Primitives d'interface partagées, adossées aux tokens sémantiques
 * (bg-surface, text-ink-muted, border-line…) donc compatibles avec les deux
 * thèmes sans variante `dark:`.
 *
 * Objectif : arrêter de recopier les mêmes en-têtes, cartes de stats et champs
 * de recherche dans chaque écran, comme c'était le cas dans GlobalTab.
 */

/** En-tête de page : reste visible, porte le titre et les actions. */
export function PageHeader({ icon: Icon, title, subtitle, actions, children }) {
  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex items-center gap-3 px-5 py-3">
        {Icon && <Icon size={20} className="text-accent shrink-0" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-ink truncate">{title}</h1>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {/* Emplacement des sous-onglets ou filtres persistants */}
      {children}
    </header>
  );
}

/** Corps de page défilant. `flush` retire le padding (tableaux pleine largeur). */
export function PageBody({ children, flush = false }) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto ${flush ? '' : 'p-5'}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = '', ...rest }) {
  return (
    <div
      className={`bg-surface border border-line rounded-xl shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

const STAT_TONES = {
  default: 'text-ink',
  accent: 'text-accent-ink',
  danger: 'text-danger',
  warn: 'text-warn'
};

/**
 * Carte de statistique. Pour les tons danger/warn, la couleur ne s'applique
 * que si la valeur est non nulle : « 0 orphelin » est une bonne nouvelle et ne
 * doit pas s'afficher en rouge.
 */
export function StatCard({ icon: Icon, label, value, tone = 'default', hint }) {
  const isAlert = (tone === 'danger' || tone === 'warn') && Number(value) > 0;
  const valueTone = isAlert || tone === 'accent' ? STAT_TONES[tone] : STAT_TONES.default;
  const borderTone = isAlert
    ? tone === 'danger' ? 'border-danger' : 'border-warn'
    : 'border-line';

  return (
    <div className={`bg-surface border ${borderTone} rounded-xl px-4 py-3 shadow-card`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {Icon && <Icon size={13} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${valueTone}`}>{value}</div>
      {hint && <div className="text-[11px] text-ink-faint mt-0.5">{hint}</div>}
    </div>
  );
}

const BADGE_TONES = {
  default: 'bg-raised text-ink-muted border-line',
  accent: 'bg-accent-soft text-accent-ink border-accent',
  danger: 'bg-danger-soft text-danger border-danger',
  warn: 'bg-warn-soft text-warn border-warn',
  info: 'bg-raised text-info border-info',
  violet: 'bg-raised text-violet border-violet'
};

export function Badge({ children, tone = 'default', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Rechercher…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-canvas border border-line rounded-lg pl-8 pr-3 py-1.5 text-sm text-ink placeholder-ink-faint outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}

export function Select({ value, onChange, children, className = '', ...rest }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-canvas border border-line rounded-lg px-2 py-1.5 text-sm text-ink outline-none focus:border-accent transition-colors ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90 border-transparent',
  secondary: 'bg-raised text-ink hover:bg-line border-line',
  ghost: 'bg-transparent text-ink-muted hover:text-ink hover:bg-raised border-transparent',
  danger: 'bg-transparent text-ink-faint hover:text-danger hover:bg-danger-soft border-transparent'
};

export function Button({ variant = 'secondary', icon: Icon, children, className = '', ...rest }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function Spinner({ label = 'Chargement…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-ink-muted py-12 ${className}`}>
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {Icon && <Icon size={40} className="text-ink-faint opacity-50 mb-3" />}
      <h2 className="text-sm font-semibold text-ink-muted">{title}</h2>
      {description && <p className="text-sm text-ink-faint mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }) {
  return (
    <div className="text-sm text-danger bg-danger-soft border border-danger rounded-lg px-3 py-2">
      {children}
    </div>
  );
}

/** Barre d'onglets secondaires, rendue sous un PageHeader. */
export function SubTabs({ children }) {
  return (
    <div className="flex gap-0.5 px-5 -mb-px overflow-x-auto" role="tablist">
      {children}
    </div>
  );
}
