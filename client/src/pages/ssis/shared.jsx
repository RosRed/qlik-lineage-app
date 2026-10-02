import React from 'react';

/** Formatage court d'une durée en secondes → "1m24s" / "43s" / "1h02m" */
export function fmtDur(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m${String(r).padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, '0')}m`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const BUCKET_STYLE = {
  success: 'bg-accent-soft text-accent-ink border-accent',
  failed:  'bg-danger-soft text-danger border-danger',
  running: 'bg-info-soft text-info border-info',
  other:   'bg-raised text-ink-muted border-line'
};

export function StatusBadge({ bucket, label }) {
  const cls = BUCKET_STYLE[bucket] || BUCKET_STYLE.other;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

/** Sélecteur de fenêtre temporelle réutilisable. */
export function DaysPicker({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(parseInt(e.target.value, 10))}
      className="bg-raised border border-line rounded px-2 py-1.5 text-xs text-ink">
      <option value={1}>24 heures</option>
      <option value={7}>7 jours</option>
      <option value={30}>30 jours</option>
      <option value={90}>90 jours</option>
    </select>
  );
}
