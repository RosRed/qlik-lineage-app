import React from 'react';
import { NavLink } from 'react-router-dom';

/**
 * Onglet secondaire routé, à placer dans un <SubTabs>.
 * Chaque onglet est une vraie URL : partageable, dans l'historique, et le
 * bouton retour du navigateur fonctionne — ce que l'ancien `useState` interdisait.
 */
export default function SubTabLink({ to, end = false, icon: Icon, label, count }) {
  return (
    <NavLink
      to={to}
      end={end}
      role="tab"
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
          isActive
            ? 'border-accent text-accent-ink'
            : 'border-transparent text-ink-muted hover:text-ink'
        }`
      }
    >
      {Icon && <Icon size={14} />}
      {label}
      {count !== undefined && (
        <span className="text-[11px] text-ink-faint tabular-nums">({count})</span>
      )}
    </NavLink>
  );
}
