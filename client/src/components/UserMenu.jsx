import React, { useState, useRef, useEffect } from 'react';
import { User, LogOut, KeyRound, Shield, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import toast from 'react-hot-toast';
import { authApi } from '../api/authApi.js';

export default function UserMenu() {
  const { user, logout, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const initial = (user.username || '?').charAt(0).toUpperCase();

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex flex-col items-center gap-1 py-2.5 w-full rounded-lg text-ink-faint hover:text-ink hover:bg-raised transition-colors"
          title={`Connecté en tant que ${user.username}`}
        >
          <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center text-xs font-semibold">
            {initial}
          </div>
          <span className="text-[10px] font-medium tracking-tight truncate max-w-[60px]">
            {user.username}
          </span>
        </button>

        {open && (
          <div className="absolute left-full ml-2 bottom-0 w-64 bg-surface border border-line rounded-xl shadow-xl overflow-hidden z-50">
            <div className="p-3 border-b border-line">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center text-sm font-semibold">
                  {initial}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{user.username}</div>
                  <div className="text-xs text-ink-faint flex items-center gap-1">
                    {isAdmin && <Shield size={11} />}
                    <span>{user.role}{user.devMode ? ' · dev' : ''}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-1">
              {!user.devMode && (
                <button
                  onClick={() => { setOpen(false); setShowPwdModal(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-raised transition text-ink"
                >
                  <KeyRound size={15} className="text-ink-faint" />
                  <span className="flex-1 text-left">Changer le mot de passe</span>
                  <ChevronRight size={13} className="text-ink-faint" />
                </button>
              )}
              <button
                onClick={async () => {
                  setOpen(false);
                  await logout();
                  toast.success('Déconnecté');
                }}
                disabled={user.devMode}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-danger-soft transition text-danger disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LogOut size={15} />
                <span className="flex-1 text-left">Se déconnecter</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showPwdModal && <ChangePasswordModal onClose={() => setShowPwdModal(false)} />}
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) return toast.error('Les nouveaux mots de passe ne correspondent pas');
    if (next.length < 8) return toast.error('8 caractères minimum');
    setSubmitting(true);
    try {
      await authApi.changePassword(current, next);
      toast.success('Mot de passe modifié — reconnexion requise');
      onClose();
      setTimeout(() => logout(), 1000);
    } catch (err) {
      toast.error(err?.error || 'Échec de la modification');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-surface border border-line rounded-xl p-5 space-y-4 shadow-xl"
      >
        <h3 className="text-base font-semibold">Changer le mot de passe</h3>

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Mot de passe actuel</label>
          <input
            type="password" required autoFocus
            value={current} onChange={e => setCurrent(e.target.value)}
            className="w-full px-3 py-2 bg-raised border border-line rounded-lg text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Nouveau mot de passe</label>
          <input
            type="password" required minLength={8}
            value={next} onChange={e => setNext(e.target.value)}
            className="w-full px-3 py-2 bg-raised border border-line rounded-lg text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Confirmer</label>
          <input
            type="password" required minLength={8}
            value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full px-3 py-2 bg-raised border border-line rounded-lg text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border border-line rounded-lg text-sm hover:bg-raised transition">
            Annuler
          </button>
          <button type="submit" disabled={submitting}
            className="flex-1 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {submitting ? 'Modification…' : 'Modifier'}
          </button>
        </div>
      </form>
    </div>
  );
}
