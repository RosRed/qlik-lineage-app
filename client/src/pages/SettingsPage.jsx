import React, { useEffect, useState } from 'react';
import { Settings, Sun, Moon, Trash2, RotateCcw, TrendingUp, Brain, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminApi } from '../api/qlikApi';
import { useTheme } from '../context/ThemeContext';
import { useAppsList } from '../context/AppsContext';
import { PageHeader, PageBody, Card, Button } from '../components/ui/primitives';

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
    fetch('/api/usage').then(r => r.json()).then(setUsage).catch(() => {});
  }, []);

  const resetUsage = async () => {
    if (!window.confirm("Réinitialiser les statistiques d'utilisation ?")) return;
    await fetch('/api/usage', { method: 'DELETE' });
    const fresh = await fetch('/api/usage').then(r => r.json());
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

        </div>
      </PageBody>
    </>
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
