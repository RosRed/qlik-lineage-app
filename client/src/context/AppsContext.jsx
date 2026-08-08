import React, { createContext, useContext, useEffect } from 'react';
import { useApps } from '../hooks/useApps';
import { useAuth } from './AuthContext.jsx';

/*
 * Liste des applications partagée par toutes les pages.
 *
 * Avec l'ancienne interface mono-écran, la liste vivait dans App.jsx et
 * descendait par props. Maintenant que chaque section est une page routée,
 * un contexte évite de la recharger à chaque navigation.
 */

const AppsContext = createContext(null);

export function AppsProvider({ children }) {
  const apps = useApps();
  const { isAuthenticated } = useAuth();

  // Ne charge la liste que si l'utilisateur est authentifié — évite les 401
  // au montage avant login, et déclenche le chargement juste après la connexion.
  useEffect(() => {
    if (isAuthenticated) apps.loadApps();
  }, [isAuthenticated, apps.loadApps]);

  return <AppsContext.Provider value={apps}>{children}</AppsContext.Provider>;
}

export function useAppsList() {
  const ctx = useContext(AppsContext);
  if (!ctx) throw new Error('useAppsList doit être utilisé dans un <AppsProvider>');
  return ctx;
}
