import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../api/authApi.js';
import { getToken, setToken, clearToken, onUnauthorized } from '../api/httpClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'anonymous' | 'authenticated'
  const [serverStatus, setServerStatus] = useState(null); // { authDisabled, hasUsers }

  const refreshMe = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch (_) {
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  // Bootstrap : récupère le statut du serveur (auth activée ?) puis /me si token
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await authApi.status();
        if (cancelled) return;
        setServerStatus(s);

        if (s.authDisabled) {
          // Serveur en mode dev sans auth : on considère l'utilisateur authentifié en admin virtuel
          setUser({ id: 0, username: 'dev', role: 'admin', devMode: true });
          setStatus('authenticated');
          return;
        }
        if (getToken()) {
          await refreshMe();
        } else {
          setStatus('anonymous');
        }
      } catch (_) {
        // Serveur injoignable — bloque en anonymous, le login form gérera l'erreur
        if (!cancelled) setStatus('anonymous');
      }
    })();
    return () => { cancelled = true; };
  }, [refreshMe]);

  // Écoute les 401 émis par le fetch interceptor
  useEffect(() => {
    return onUnauthorized(() => {
      setUser(null);
      setStatus('anonymous');
    });
  }, []);

  const login = async (username, password) => {
    const res = await authApi.login(username, password);
    setToken(res.token);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch (_) { /* déjà déconnecté */ }
    clearToken();
    setUser(null);
    setStatus('anonymous');
  };

  const value = {
    user,
    status,
    serverStatus,
    isAuthenticated: status === 'authenticated',
    isLoading: status === 'loading',
    isAdmin: user?.role === 'admin',
    login,
    logout,
    refreshMe
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
