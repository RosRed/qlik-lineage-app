import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { ssisApi } from '../../api/qlikApi';
import { PageBody, Card, Button } from '../../components/ui/primitives';
import { useSsisContext } from '../../layouts/SsisLayout.jsx';

/*
 * Config de la connexion SQL Server → SSISDB. Une seule ligne en base
 * (id = 1). Le mot de passe n'est jamais renvoyé au client : le champ reste
 * vide et le back garde l'ancien si on ne le retape pas.
 */

const EMPTY = {
  host: '', port: 1433, database: 'SSISDB',
  username: '', password: '', encrypt: true, trust_server_certificate: true
};

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-muted mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full bg-raised border border-line rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent';

export default function SsisSettingsPage() {
  const { reload } = useSsisContext();
  const [form, setForm] = useState(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    ssisApi.getConfig().then(cfg => {
      if (cfg) {
        setForm({ ...EMPTY, ...cfg, password: '' });
        setHasPassword(!!cfg.has_password);
      }
    }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.host || !form.username) {
      toast.error('Host et utilisateur sont obligatoires');
      return;
    }
    try {
      setBusy(true);
      const saved = await ssisApi.saveConfig(form);
      setHasPassword(!!saved.has_password);
      setForm(f => ({ ...f, password: '' }));
      toast.success('Configuration enregistrée');
      reload();
    } catch (e) {
      toast.error(e.error || e.message || 'Échec de la sauvegarde');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTestResult(null);
    if (!form.host || !form.username) {
      setTestResult({ ok: false, error: 'Renseignez au moins host et utilisateur.' });
      return;
    }
    try {
      setTesting(true);
      // On envoie les valeurs du formulaire — pas besoin d'enregistrer d'abord.
      // Si le champ mot de passe est vide, le back réutilise celui déjà stocké.
      const res = await ssisApi.test(form);
      setTestResult({ ok: true, ...res });
    } catch (e) {
      setTestResult({ ok: false, error: e.error || e.message || 'Erreur' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <PageBody>
      <Card className="max-w-2xl">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-ink">Connexion SSISDB</h3>
          <p className="text-xs text-ink-muted mt-1">
            Compte SQL Server en lecture seule sur la base <code className="text-info">SSISDB</code>.
            Droits nécessaires : <code>SELECT</code> sur <code>catalog.*</code> (rôle <code>ssis_admin</code> ou <code>ssis_logreader</code>).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Host / Server">
            <input className={inputCls} value={form.host}
              onChange={e => set('host', e.target.value)}
              placeholder="srv-sql-prod.local" />
          </Field>
          <Field label="Port">
            <input type="number" className={inputCls} value={form.port}
              onChange={e => set('port', parseInt(e.target.value, 10) || 1433)} />
          </Field>
          <Field label="Base">
            <input className={inputCls} value={form.database}
              onChange={e => set('database', e.target.value)} />
          </Field>
          <Field label="Utilisateur">
            <input className={inputCls} value={form.username}
              onChange={e => set('username', e.target.value)}
              placeholder="ssis_reader" />
          </Field>
          <Field
            label="Mot de passe"
            hint={hasPassword ? 'Un mot de passe est déjà enregistré — laissez vide pour le garder.' : null}>
            <input type="password" className={inputCls} value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder={hasPassword ? '••••••••' : ''} />
          </Field>
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={!!form.encrypt}
                onChange={e => set('encrypt', e.target.checked)} />
              Encrypt (TLS)
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={!!form.trust_server_certificate}
                onChange={e => set('trust_server_certificate', e.target.checked)} />
              Trust server certificate
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button onClick={test} disabled={testing}>
            {testing ? <><Loader2 size={13} className="animate-spin mr-1 inline" /> Test…</> : 'Tester la connexion'}
          </Button>
        </div>

        {testResult && (
          <div className={`mt-4 rounded border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300'
              : 'border-red-800/40 bg-red-900/10 text-red-300'}`}>
            {testResult.ok ? (
              <>
                <div className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 size={13} /> Connexion réussie
                </div>
                <div className="text-ink-muted mt-1">Base courante : <code>{testResult.currentDb}</code></div>
                {testResult.hasSsisDb === false && (
                  <div className="text-yellow-300 mt-1">
                    ⚠ La base SSISDB n'est pas visible depuis cet utilisateur — vérifiez les droits.
                  </div>
                )}
                {testResult.version && (
                  <details className="mt-1 text-ink-faint">
                    <summary className="cursor-pointer">Version SQL Server</summary>
                    <pre className="whitespace-pre-wrap text-[10px] mt-1">{testResult.version}</pre>
                  </details>
                )}
              </>
            ) : (
              <div className="flex items-start gap-1.5">
                <XCircle size={13} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Échec de la connexion</div>
                  <div className="mt-1 font-mono text-[11px]">{testResult.error}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </PageBody>
  );
}
