import React, { useState } from 'react';
import { Database, LogIn, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err?.error || err?.message || 'Connexion impossible');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-ink p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent-soft flex items-center justify-center mb-3">
            <Database size={26} className="text-accent" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Qlik Lineage</h1>
          <p className="text-sm text-ink-faint mt-1">Connexion à votre espace</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-surface border border-line rounded-xl p-6 space-y-4 shadow-sm"
        >
          <div>
            <label htmlFor="username" className="block text-xs font-medium text-ink-muted mb-1.5">
              Identifiant
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-raised border border-line rounded-lg text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition"
              placeholder="admin"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-ink-muted mb-1.5">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-raised border border-line rounded-lg text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-danger-soft border border-danger/30 rounded-lg text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !username || !password}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {submitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-ink-faint mt-6">
          Un compte oublié ? Contactez l'administrateur.
        </p>
      </div>
    </div>
  );
}
