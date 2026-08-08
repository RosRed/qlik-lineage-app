import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, Globe, Clock, ShieldCheck, Settings, Database, Server
} from 'lucide-react';
import UserMenu from '../components/UserMenu.jsx';

/*
 * Coquille de l'application : rail de navigation + zone de contenu routée.
 *
 * Remplace les trois colonnes permanentes de l'ancien App.jsx (sidebar 250px +
 * éditeur 350px + panneau de résultats). Le rail fait 72px et porte des
 * libellés sous les icônes : assez compact pour rendre la largeur au contenu,
 * assez explicite pour qu'on trouve les sections sans les deviner.
 */

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Accueil', end: true },
  { to: '/apps', icon: Boxes, label: 'Apps' },
  { to: '/global', icon: Globe, label: 'Global' },
  { to: '/ssis', icon: Server, label: 'SSIS' },
  { to: '/tasks', icon: Clock, label: 'Tâches' },
  { to: '/governance', icon: ShieldCheck, label: 'Gouv.' }
];

function RailLink({ to, icon: Icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg transition-colors ${
          isActive
            ? 'bg-accent-soft text-accent-ink'
            : 'text-ink-faint hover:text-ink hover:bg-raised'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Repère d'onglet actif, plus lisible que la seule couleur */}
          {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />
          )}
          <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
          <span className="text-[10px] font-medium tracking-tight">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function AppShell() {
  return (
    <div className="flex h-screen bg-canvas text-ink overflow-hidden">
      <nav
        className="w-[72px] min-w-[72px] bg-surface border-r border-line flex flex-col"
        aria-label="Navigation principale"
      >
        <NavLink
          to="/"
          className="flex flex-col items-center gap-1 py-4 border-b border-line text-accent hover:opacity-80 transition-opacity"
          title="Qlik Lineage"
        >
          <Database size={22} />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-ink-faint">
            Lineage
          </span>
        </NavLink>

        <div className="flex-1 p-2 space-y-1 overflow-y-auto">
          {NAV.map(item => <RailLink key={item.to} {...item} />)}
        </div>

        <div className="p-2 border-t border-line space-y-1">
          <RailLink to="/settings" icon={Settings} label="Réglages" />
          <UserMenu />
        </div>
      </nav>

      {/* min-w-0 : sans lui, un tableau large pousse la mise en page et casse le scroll */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
