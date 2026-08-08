import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/*
 * Thème clair/sombre. Le provider ne fait qu'écrire [data-theme] sur <html> :
 * toutes les couleurs sont résolues par les variables CSS de index.css.
 *
 * Le sélecteur visible arrive avec la phase 2 (conversion des composants aux
 * tokens sémantiques). Tant que les écrans internes utilisent des classes
 * gray-* codées en dur, le mode clair afficherait une interface mi-claire
 * mi-sombre — on garde donc 'dark' par défaut.
 */

const STORAGE_KEY = 'qla-theme';
const ThemeContext = createContext(null);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage indisponible (navigation privée, iframe restreinte)
  }
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // échec silencieux : le thème reste appliqué pour la session en cours
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme doit être utilisé dans un <ThemeProvider>');
  return ctx;
}
