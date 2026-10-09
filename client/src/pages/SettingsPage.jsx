import React, { useEffect, useState } from 'react';
import { Settings, Sun, Moon, Trash2, RotateCcw, TrendingUp, Brain, Zap, FolderGit2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi, gitApi } from '../api/qlikApi';
import { useTheme } from '../context/ThemeContext';
import { useAppsList } from '../context/AppsContext';
import { PageHeader, PageBody, Card, Button } from '../components/ui/primitives';
import { parseJson } from '../api/parseJson';

/*
 * Rassemble ce qui vivait dispersé dans l'ancienne UI :
 *   - le thème (jusqu'ici pas de contrôle utilisateur du tout),
 *   - l'usage API (autrefois collé en bas de sidebar),
 *   - la réinitialisation de la base (petite icône poubelle rouge cachée
 *     dans la barre d'actions du lineage global).
 * La configuration de connexion Qlik reste dans QlikImportModal — la sortir
 * proprement demande plus de travail et sera fait dans la phase 2.
 */

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { loadApps } = useAppsList();
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/usage').then(parseJson).then(setUsage).catch(() => {});
  }, []);

  const resetUsage = async () => {
    if (!window.confirm("Réinitialiser les statistiques d'utilisation ?")) return;
    await fetch('/api/usage', { method: 'DELETE' });
    const fresh = await fetch('/api/usage').then(parseJson);
    setUsage(fresh);
    toast.success('Statistiques réinitialisées');
  };

  const resetDatabase = async () => {
    const confirmed = window.confirm(
      'Vider toute la base locale (apps, scripts, analyses, chat) ?\n\n' +
      'Une sauvegarde du fichier .db est faite automatiquement.\n' +
      'La configuration serveur Qlik est conservée.'
    );
    if (!confirmed) return;
    try {
      setBusy(true);
      await adminApi.reset();
      await loadApps();
      toast.success('Base locale réinitialisée');
    } catch (e) {
      toast.error(e.error || e.message || 'Échec de la réinitialisation');
    } finally {
      setBusy(false);
    }
  };

  const totalCalls = usage?.totals?.calls || 0;
  const totalCostUsd = ((usage?.totals?.cost_cents || 0) / 100).toFixed(4);
  const byType = Object.fromEntries((usage?.byType || []).map(r => [r.type, r]));

  return (
    <>
      <PageHeader
        icon={Settings}
        title="Réglages"
        subtitle="Thème, usage API, maintenance"
      />
      <PageBody>
        <div className="space-y-6 max-w-2xl">

          <section>
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Apparence</h2>
            <Card className="p-4 flex items-center gap-4">
              <div className="p-2 rounded-lg bg-raised text-ink-muted">
                {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink">
                  Thème {theme === 'dark' ? 'sombre' : 'clair'}
                </div>
                <p className="text-xs text-ink-faint mt-0.5">
                  Le mode clair reste expérimental : quelques écrans internes utilisent encore
                  des couleurs codées en dur et paraîtront trop sombres. La conversion complète
                  est prévue dans la phase 2.
                </p>
              </div>
              <Button icon={theme === 'dark' ? Sun : Moon} onClick={toggleTheme}>
                Passer en {theme === 'dark' ? 'clair' : 'sombre'}
              </Button>
            </Card>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Usage de l'API Claude</h2>
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent-soft text-accent-ink">
                  <TrendingUp size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {totalCalls} appel{totalCalls !== 1 ? 's' : ''} · <span className="font-mono text-accent-ink">${totalCostUsd}</span>
                  </div>
                  <p className="text-xs text-ink-faint mt-0.5">Coût cumulé estimé côté Anthropic.</p>
                </div>
                <Button icon={RotateCcw} onClick={resetUsage}>Réinitialiser</Button>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-line">
                <UsageStat icon={Brain} tone="text-violet" label="Analyses" value={byType.analyze?.total_calls || 0} />
                <UsageStat icon={Brain} tone="text-info" label="Chat Claude" value={byType.chat?.total_calls || 0} />
                <UsageStat icon={Zap} tone="text-warn" label="Local / cache" value={usage?.localSaved || 0} />
              </div>

              {usage?.totals?.input_tokens > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-line text-xs text-ink-muted">
                  <div className="flex justify-between">
                    <span>Tokens input</span>
                    <span className="font-mono tabular-nums">{(usage.totals.input_tokens || 0).toLocaleString('fr-FR')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tokens output</span>
                    <span className="font-mono tabular-nums">{(usage.totals.output_tokens || 0).toLocaleString('fr-FR')}</span>
                  </div>
                </div>
              )}
            </Card>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Maintenance</h2>
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-danger-soft text-danger shrink-0">
                  <Trash2 size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">Réinitialiser la base locale</div>
                  <p className="text-xs text-ink-faint mt-0.5">
                    Supprime apps, scripts, analyses et historique de chat. La configuration
                    du serveur Qlik est conservée. Une sauvegarde <code className="font-mono">.db</code> est écrite
                    avant la suppression.
                  </p>
                  <div className="mt-3">
                    <Button variant="secondary" icon={Trash2} onClick={resetDatabase} disabled={busy}>
                      Réinitialiser la base
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <GitConfigSection />

        </div>
      </PageBody>
    </>
  );
}

/* ── Section Config GitLab ───────────────────────────────────────────────── */

function GitConfigSection() {
  const [cfg, setCfg] = useState({ base_url: '', namespace: '', default_branch: 'main', has_token: false });
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    gitApi.getConfig().then(r => { if (r) setCfg(r); }).catch(() => {});
  }, []);

  const save = async () => {
    if (!cfg.base_url || !cfg.namespace) {
      toast.error('base URL et namespace sont requis');
      return;
    }
    setSaving(true);
    try {
      await gitApi.saveConfig({ ...cfg, access_token: token || undefined });
      toast.success('Configuration Git sauvegardée');
      setToken('');
      const fresh = await gitApi.getConfig();
      if (fresh) setCfg(fresh);
    } catch (e) {
      toast.error(e.error || e.message || 'Échec sauvegarde');
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await gitApi.test();
      setTestResult({ ok: true, user: r.username, name: r.name });
    } catch (e) {
      setTestResult({ ok: false, error: e.error || e.message });
    } finally { setTesting(false); }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">Export Git (GitLab)</h2>
      <Card className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-raised text-ink-muted">
            <FolderGit2 size={18} />
          </div>
          <p className="text-xs text-ink-muted flex-1">
            Chaque app Qlik synchronisée pousse ses sources (script, feuilles, mesures…) vers un repo gitlab
            dédié <code className="font-mono">{cfg.namespace || '<namespace>'}/&lt;slug-app&gt;</code>.
            Le repo est créé automatiquement s'il n'existe pas.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">Base URL GitLab</label>
            <input
              value={cfg.base_url} onChange={e => setCfg({ ...cfg, base_url: e.target.value })}
              placeholder="https://gitlab.premium.local"
              className="w-full bg-raised border border-border rounded px-3 py-2 text-xs text-ink font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">Namespace (user ou group)</label>
            <input
              value={cfg.namespace} onChange={e => setCfg({ ...cfg, namespace: e.target.value })}
              placeholder="rrossamy"
              className="w-full bg-raised border border-border rounded px-3 py-2 text-xs text-ink font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">Branche par défaut</label>
            <input
              value={cfg.default_branch || 'main'} onChange={e => setCfg({ ...cfg, default_branch: e.target.value })}
              placeholder="main"
              className="w-full bg-raised border border-border rounded px-3 py-2 text-xs text-ink font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1">
              Personal Access Token {cfg.has_token && <span className="text-emerald-500">(configuré)</span>}
            </label>
            <input
              type="password" value={token} onChange={e => setToken(e.target.value)}
              placeholder={cfg.has_token ? '•••••• (laisser vide pour conserver)' : 'glpat-...'}
              className="w-full bg-raised border border-border rounded px-3 py-2 text-xs text-ink font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin mr-1" size={12} />}
            Sauvegarder
          </Button>
          <Button variant="secondary" onClick={test} disabled={testing || !cfg.has_token}>
            {testing ? <Loader2 className="animate-spin mr-1" size={12} /> : null}
            Tester la connexion
          </Button>
          {testResult && (
            testResult.ok
              ? <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 size={12} /> Connecté en tant que <code>{testResult.user}</code> ({testResult.name})
                </span>
              : <span className="text-[11px] text-rose-400 inline-flex items-center gap-1">
                  <XCircle size={12} /> {testResult.error}
                </span>
          )}
        </div>

        <p className="text-[11px] text-ink-subtle">
          Scopes du PAT requis : <code>api</code>, <code>read_repository</code>, <code>write_repository</code>.
          Créer : User Settings → Access Tokens sur votre instance GitLab.
        </p>
      </Card>
    </section>
  );
}

function UsageStat({ icon: Icon, tone, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} className={tone} />
      <span className="text-ink-muted flex-1 min-w-0 truncate">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}
