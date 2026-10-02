/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      /*
       * Tokens sémantiques adossés aux variables CSS de index.css.
       * On écrit `bg-surface` / `text-ink-muted` une seule fois : le rendu suit
       * automatiquement le thème actif, sans variante `dark:`.
       */
      colors: {
        canvas: 'var(--c-canvas)',
        surface: 'var(--c-surface)',
        raised: 'var(--c-raised)',
        line: 'var(--c-line)',
        'line-strong': 'var(--c-line-strong)',
        ink: 'var(--c-ink)',
        'ink-muted': 'var(--c-ink-muted)',
        'ink-faint': 'var(--c-ink-faint)',
        accent: 'var(--c-accent)',
        'accent-ink': 'var(--c-accent-ink)',
        'accent-soft': 'var(--c-accent-soft)',
        danger: 'var(--c-danger)',
        'danger-soft': 'var(--c-danger-soft)',
        warn: 'var(--c-warn)',
        'warn-soft': 'var(--c-warn-soft)',
        info: 'var(--c-info)',
        'info-soft': 'var(--c-info-soft)',
        violet: 'var(--c-violet)',
        'violet-soft': 'var(--c-violet-soft)'
      },
      boxShadow: {
        card: '0 1px 2px var(--c-shadow)',
        pop: '0 8px 24px var(--c-shadow)'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
