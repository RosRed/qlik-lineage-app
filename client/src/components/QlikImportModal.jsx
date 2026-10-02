import React, { useEffect, useState, useMemo } from 'react';
import { X, Server, Plug, Download, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { qlikApi } from '../api/qlikApi';

const inputCls = 'w-full bg-surface border border-line rounded px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent font-mono';
const labelCls = 'block text-[11px] font-medium text-ink-muted mb-1';

export default function QlikImportModal({ onClose, onImported }) {
  const [step, setStep] = useState('config');            // config | apps
  const [config, setConfig] = useState({ host: '', qrs_port: 4242, engine_port: 4747, auth_mode: 'forms', cert_dir: '', cert_password: '', proxy_password: '', user_directory: '', user_id: '' });
  const [testState, setTestState] = useState(null);      // null | testing | {ok} | {error}
  const [serverApps, setServerApps] = useState(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [streamFilter, setStreamFilter] = useState('');
  const [publishedFilter, setPublishedFilter] = useState('oui'); // par défaut : publiées seulement
  const [nameFilter, setNameFilter] = useState('');
  const [analyzeMode, setAnalyzeMode] = useState('local');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [progress, setProgress] = useState(null); // {done,total,currentApp,imported,failed,elapsedMs}

  useEffect(() => {
    qlikApi.getConfig().then(cfg => {
      if (cfg) {
        setConfig({
          host: cfg.host || '', qrs_port: cfg.qrs_port || 4242, engine_port: cfg.engine_port || 4747,
          auth_mode: cfg.auth_mode || 'forms',
          cert_dir: cfg.cert_dir || '', cert_password: '',
          proxy_password: '', // jamais renvoyé par l'API ; laisser vide conserve l'existant
          user_directory: cfg.user_directory || '', user_id: cfg.user_id || '',
          has_proxy_password: cfg.has_proxy_password
        });
      }
    }).catch(() => {});
  }, []);

  const configReady = config.host && (
    config.auth_mode === 'forms'
      ? config.user_directory && config.user_id && (config.proxy_password || config.has_proxy_password)
      : config.cert_dir
  );

  const testConnection = async () => {
    setTestState('testing');
    try {
      await qlikApi.saveConfig(config);
      const r = await qlikApi.test();
      setTestState({ ok: true, version: r.buildVersion });
    } catch (e) {
      setTestState({ error: e.error || e.message || 'Connexion échouée' });
    }
  };

  const loadServerApps = async () => {
    setLoadingApps(true);
    try {
      await qlikApi.saveConfig(config);
      const apps = await qlikApi.listApps();
      setServerApps(apps);
      setStep('apps');
    } catch (e) {
      setTestState({ error: e.error || e.message || 'Impossible de lister les apps' });
    } finally {
      setLoadingApps(false);
    }
  };

  const streams = useMemo(() => {
    if (!serverApps) return [];
    return [...new Set(serverApps.map(a => a.stream || '(non publiée)'))].sort();
  }, [serverApps]);

  const filteredApps = useMemo(() => {
    if (!serverApps) return [];
    const q = nameFilter.trim().toLowerCase();
    return serverApps.filter(a => {
      if (publishedFilter === 'oui' && !a.published) return false;
      if (publishedFilter === 'non' && a.published) return false;
      if (streamFilter && (a.stream || '(non publiée)') !== streamFilter) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [serverApps, streamFilter, publishedFilter, nameFilter]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allIds = filteredApps.map(a => a.qlikAppId);
    const allSelected = allIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      allIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const runImport = async () => {
    const targets = serverApps
      .filter(a => selected.has(a.qlikAppId))
      .map(a => ({
        qlikAppId: a.qlikAppId, name: a.name, stream: a.stream,
        published: a.published, owner: a.owner, lastReloadTime: a.lastReloadTime
      }));
    setImporting(true);
    setImportResult(null);
    setProgress({ done: 0, total: targets.length, currentApp: targets[0]?.name });
    try {
      await qlikApi.import(targets, analyzeMode); // démarre le job en fond

      // Suivi de la progression jusqu'à la fin du job
      await new Promise((resolve) => {
        const poll = async () => {
          try {
            const p = await qlikApi.importProgress();
            setProgress(p);
            if (!p.running && p.done >= p.total) return resolve(p);
          } catch (_) { /* on retente au prochain tick */ }
          setTimeout(poll, 1000);
        };
        poll();
      }).then(p => {
        setImportResult({
          imported: p.imported,
          failed: p.failed,
          results: (p.errors || []).map(e => ({ ...e, ok: false, qlikAppId: e.name }))
        });
        onImported?.();
      });
    } catch (e) {
      setImportResult({ error: e.error || e.message || 'Import échoué' });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-canvas border border-line rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="flex items-center gap-2">
            <Server size={15} className="text-accent-ink" />
            <h2 className="text-sm font-semibold text-ink">Serveur Qlik Sense — import des apps</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'config' && (
            <div className="space-y-4">
              {/* Choix du mode d'authentification */}
              <div className="flex gap-2">
                {[
                  ['forms', '🔑 Compte utilisateur (port 443)', 'Login/mot de passe via le proxy — fonctionne à distance'],
                  ['certificate', '📜 Certificats QMC (ports 4242/4747)', 'Réseau interne du serveur uniquement'],
                ].map(([mode, label, hint]) => (
                  <button key={mode} onClick={() => setConfig({ ...config, auth_mode: mode })}
                    className={`flex-1 text-left px-3 py-2 rounded border text-xs ${
                      config.auth_mode === mode
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-line bg-surface text-ink-muted hover:border-line'}`}>
                    <div className="font-semibold">{label}</div>
                    <div className="text-[10px] text-ink-muted mt-0.5">{hint}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className={labelCls}>Serveur (hostname)</label>
                  <input className={inputCls} placeholder="qlik.mondomaine.com" value={config.host}
                    onChange={e => setConfig({ ...config, host: e.target.value })} />
                </div>

                {config.auth_mode === 'forms' ? (
                  <>
                    <div>
                      <label className={labelCls}>User Directory</label>
                      <input className={inputCls} placeholder="SRVDB2" value={config.user_directory}
                        onChange={e => setConfig({ ...config, user_directory: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Utilisateur</label>
                      <input className={inputCls} placeholder="qsservices" value={config.user_id}
                        onChange={e => setConfig({ ...config, user_id: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Mot de passe</label>
                      <input className={inputCls} type="password"
                        placeholder={config.has_proxy_password ? '(inchangé)' : 'mot de passe'}
                        value={config.proxy_password}
                        onChange={e => setConfig({ ...config, proxy_password: e.target.value })} />
                    </div>
                    <p className="col-span-3 text-[10px] text-ink-faint">
                      Le compte se connecte via le formulaire du virtual proxy (comme sur le hub).
                      Le mot de passe est stocké uniquement dans la base locale de cette app.
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={labelCls}>Port QRS</label>
                      <input className={inputCls} type="number" value={config.qrs_port}
                        onChange={e => setConfig({ ...config, qrs_port: +e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Port Engine</label>
                      <input className={inputCls} type="number" value={config.engine_port}
                        onChange={e => setConfig({ ...config, engine_port: +e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Mot de passe certificat (.pfx)</label>
                      <input className={inputCls} type="password" placeholder="(vide si aucun)" value={config.cert_password}
                        onChange={e => setConfig({ ...config, cert_password: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <label className={labelCls}>Dossier des certificats QMC</label>
                      <input className={inputCls} placeholder="C:\\QlikCerts" value={config.cert_dir}
                        onChange={e => setConfig({ ...config, cert_dir: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>User Directory</label>
                      <input className={inputCls} placeholder="INTERNAL" value={config.user_directory}
                        onChange={e => setConfig({ ...config, user_directory: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelCls}>User Id</label>
                      <input className={inputCls} placeholder="sa_repository" value={config.user_id}
                        onChange={e => setConfig({ ...config, user_id: e.target.value })} />
                    </div>
                    <p className="col-span-3 text-[10px] text-ink-faint">
                      Certificats exportés depuis QMC → Certificats : <code className="text-accent-ink">client.pfx</code> (format Windows)
                      ou <code className="text-accent-ink">client.pem</code> + <code className="text-accent-ink">client_key.pem</code> (format PEM).
                    </p>
                  </>
                )}
              </div>

              {testState && testState !== 'testing' && (
                testState.ok ? (
                  <div className="flex items-center gap-2 text-xs text-accent-ink bg-accent-soft border border-accent rounded px-3 py-2">
                    <CheckCircle2 size={14} /> Connecté — Qlik Sense build {testState.version}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-danger bg-danger-soft border border-danger rounded px-3 py-2">
                    <XCircle size={14} className="mt-0.5 shrink-0" /> {testState.error}
                  </div>
                )
              )}

              <div className="flex gap-2">
                <button onClick={testConnection} disabled={!configReady || testState === 'testing'}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-raised hover:bg-raised disabled:opacity-40 text-ink rounded">
                  {testState === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                  Tester la connexion
                </button>
                <button onClick={loadServerApps} disabled={!configReady || loadingApps}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-accent hover:bg-accent disabled:opacity-40 text-white rounded">
                  {loadingApps ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Lister les apps du serveur
                </button>
              </div>
            </div>
          )}

          {step === 'apps' && serverApps && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={publishedFilter} onChange={e => setPublishedFilter(e.target.value)}
                  className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                  <option value="oui">✅ Publiées uniquement</option>
                  <option value="non">Privées uniquement</option>
                  <option value="">Toutes</option>
                </select>
                <select value={streamFilter} onChange={e => setStreamFilter(e.target.value)}
                  className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink">
                  <option value="">Tous les streams</option>
                  {streams.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={nameFilter} onChange={e => setNameFilter(e.target.value)} placeholder="Filtrer par nom..."
                  className="bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink w-36 focus:outline-none focus:border-accent" />
                <button onClick={toggleAll} className="text-xs text-accent-ink hover:text-accent-ink">
                  Tout (dé)sélectionner
                </button>
                <span className="text-[10px] text-ink-faint">{filteredApps.length}/{serverApps.length} apps</span>
                <div className="flex-1" />
                <button onClick={() => setStep('config')} className="text-xs text-ink-muted hover:text-ink">← Connexion</button>
              </div>

              <div className="border border-line rounded max-h-72 overflow-y-auto divide-y divide-line">
                {filteredApps.map(a => (
                  <label key={a.qlikAppId} className="flex items-center gap-3 px-3 py-2 hover:bg-raised cursor-pointer">
                    <input type="checkbox" checked={selected.has(a.qlikAppId)} onChange={() => toggle(a.qlikAppId)}
                      className="accent-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink truncate">{a.name}</div>
                      <div className="text-[10px] text-ink-muted">
                        {a.stream || '(non publiée)'}
                        {a.lastReloadTime && ` · reload ${new Date(a.lastReloadTime).toLocaleDateString()}`}
                      </div>
                    </div>
                    {a.imported && <span className="text-[10px] px-1.5 py-0.5 bg-accent-soft text-accent-ink rounded">importée</span>}
                  </label>
                ))}
                {filteredApps.length === 0 && <div className="p-4 text-xs text-ink-faint text-center">Aucune app</div>}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-ink-muted">Analyse après import :</span>
                <select value={analyzeMode} onChange={e => setAnalyzeMode(e.target.value)}
                  className="bg-surface border border-line rounded px-2 py-1 text-xs text-ink">
                  <option value="local">⚡ Locale (rapide, gratuite)</option>
                  <option value="claude">🤖 Claude (sémantique, API)</option>
                </select>
              </div>

              {/* Progression de l'import */}
              {importing && progress && (
                <div className="bg-surface border border-line rounded px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink">
                      {progress.done}/{progress.total} apps
                      {progress.imported > 0 && <span className="text-accent-ink"> · {progress.imported} ok</span>}
                      {progress.failed > 0 && <span className="text-danger"> · {progress.failed} échec(s)</span>}
                    </span>
                    <span className="text-ink-muted text-[10px]">
                      {progress.elapsedMs > 3000 && progress.done > 0 && progress.done < progress.total && (
                        <>~{Math.ceil(((progress.elapsedMs / progress.done) * (progress.total - progress.done)) / 1000)}s restantes</>
                      )}
                    </span>
                  </div>
                  <div className="h-2 bg-raised rounded overflow-hidden">
                    <div className="h-full bg-accent transition-all duration-500"
                      style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                  {progress.currentApp && (
                    <div className="text-[10px] text-ink-muted flex items-center gap-1.5">
                      <Loader2 size={10} className="animate-spin" />
                      En cours : <span className="text-ink">{progress.currentApp}</span>
                      <span className="text-ink-faint">(script + analyse)</span>
                    </div>
                  )}
                </div>
              )}

              {importResult && (
                importResult.error ? (
                  <div className="text-xs text-danger bg-danger-soft border border-danger rounded px-3 py-2">{importResult.error}</div>
                ) : (
                  <div className="text-xs bg-surface border border-line rounded px-3 py-2 space-y-1">
                    <div className="text-accent-ink">✅ {importResult.imported} importée(s){importResult.failed > 0 && <span className="text-danger"> · {importResult.failed} échec(s)</span>}</div>
                    {importResult.results.filter(r => !r.ok).map(r => (
                      <div key={r.qlikAppId} className="text-danger">• {r.name} : {r.error}</div>
                    ))}
                  </div>
                )
              )}

              <button onClick={runImport} disabled={selected.size === 0 || importing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold bg-accent hover:bg-accent disabled:opacity-40 text-white rounded">
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {importing ? 'Import en cours (script + analyse)...' : `Importer ${selected.size} app(s)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
