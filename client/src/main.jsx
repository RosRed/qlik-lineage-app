import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AppsProvider } from './context/AppsContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { installFetchInterceptor } from './api/httpClient.js';
import './index.css';

// Patch global de window.fetch : injecte le Bearer token sur toutes les
// requêtes /api/* et déclenche un déconnexion sur 401. Doit être installé
// AVANT le premier appel réseau, donc avant le render.
installFetchInterceptor();

/*
 * Providers empilés — l'ordre compte :
 *   ThemeProvider   → écrit data-theme au plus tôt
 *   BrowserRouter   → routing global
 *   AuthProvider    → gate d'authentification (bloque le rendu de l'app tant que non authentifié)
 *   AppsProvider    → liste des apps (nécessite d'être authentifié pour charger)
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppsProvider>
            <App />
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: 'var(--c-surface)',
                  color: 'var(--c-ink)',
                  border: '1px solid var(--c-line)'
                },
                success: { iconTheme: { primary: 'var(--c-accent)', secondary: 'var(--c-surface)' } },
                error: { iconTheme: { primary: 'var(--c-danger)', secondary: 'var(--c-surface)' } }
              }}
            />
          </AppsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
