'use strict';

/**
 * Synchronisation des exports Qlik vers un repo gitlab par app.
 *
 * Workflow déclenché par POST /api/apps/:id/git/sync :
 *   1. L'export Gitoqlok est produit dans `./data/exports/<slug>/`
 *      (déjà fait par le caller via exportApp).
 *   2. On s'assure qu'un repo gitlab existe (sinon on le crée via l'API GitLab)
 *      sous `<namespace>/<slug>` — namespace configurable (défaut: user owner
 *      du PAT).
 *   3. On initialise git dans le dossier d'export si besoin, puis commit +
 *      push vers `main`.
 *
 * Le token GitLab (Personal Access Token) est stocké dans `git_config.access_token`.
 * Pour l'authentification HTTP du push, on injecte `oauth2:<token>@` dans l'URL.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../database');

const execFileAsync = promisify(execFile);

/** Transforme un nom d'app Qlik en slug kebab-case utilisable comme nom de repo. */
function slugify(name) {
  return String(name || 'app')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'app';
}

/** Lit la config git (jamais le token côté client — c'est à l'appelant de le masquer). */
function getConfig() {
  return db.prepare('SELECT * FROM git_config WHERE id = 1').get() || null;
}

/** URL de push avec token injecté pour auth HTTP basic : oauth2:<token>@host/... */
function urlWithAuth(repoUrl, token) {
  try {
    const u = new URL(repoUrl);
    u.username = 'oauth2';
    u.password = encodeURIComponent(token);
    return u.toString();
  } catch (_) {
    return repoUrl;
  }
}

/**
 * Appelle l'API GitLab pour vérifier/créer le projet <namespace>/<slug>.
 * Retourne l'URL HTTP du repo (sans token).
 */
async function ensureGitlabProject(config, slug, description) {
  const { base_url, namespace, access_token } = config;
  const projectPath = encodeURIComponent(`${namespace}/${slug}`);

  // 1) Projet existe ?
  const headers = { 'PRIVATE-TOKEN': access_token };
  const existing = await fetch(`${base_url}/api/v4/projects/${projectPath}`, { headers });
  if (existing.ok) {
    const j = await existing.json();
    return j.http_url_to_repo;
  }
  if (existing.status !== 404) {
    const txt = await existing.text();
    throw new Error(`GitLab API ${existing.status} : ${txt.slice(0, 200)}`);
  }

  // 2) Création — le namespace est un user ou un group, GitLab accepte les deux par /namespaces/
  const nsRes = await fetch(`${base_url}/api/v4/namespaces/${encodeURIComponent(namespace)}`, { headers });
  if (!nsRes.ok) {
    throw new Error(`Namespace "${namespace}" introuvable sur GitLab (${nsRes.status})`);
  }
  const ns = await nsRes.json();

  const createRes = await fetch(`${base_url}/api/v4/projects`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: slug,
      path: slug,
      namespace_id: ns.id,
      description: description || 'Export auto depuis Qlik Lineage',
      visibility: 'private',
      initialize_with_readme: false,
      default_branch: 'main'
    })
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    throw new Error(`Création repo GitLab échouée (${createRes.status}) : ${txt.slice(0, 300)}`);
  }
  const created = await createRes.json();
  return created.http_url_to_repo;
}

/** Exécute une commande git dans un dossier. Collecte stdout + stderr. */
async function git(dir, args, env = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: dir,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/** True si le dossier contient un .git/. */
function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Construit le message de commit détaillé à partir de l'exportStats :
 *   `sync: 2026-10-09 — script + 12 feuilles + 8 mesures + 3 dimensions`
 */
function buildCommitMessage(exportStats) {
  const date = new Date().toISOString().slice(0, 10);
  const parts = ['script'];
  if (exportStats?.sheets) parts.push(`${exportStats.sheets} feuille${exportStats.sheets > 1 ? 's' : ''}`);
  if (exportStats?.measures) parts.push(`${exportStats.measures} mesure${exportStats.measures > 1 ? 's' : ''}`);
  if (exportStats?.dimensions) parts.push(`${exportStats.dimensions} dimension${exportStats.dimensions > 1 ? 's' : ''}`);
  if (exportStats?.variables) parts.push(`${exportStats.variables} variable${exportStats.variables > 1 ? 's' : ''}`);
  return `sync: ${date} — ${parts.join(' + ')}`;
}

/**
 * Flow complet : init git si besoin, commit, push vers le repo gitlab de l'app.
 * Retourne { repoUrl, commitSha, pushed, nothingToCommit }.
 */
async function syncAppDir(exportDir, repoUrl, token, branch, commitMessage, authorName, authorEmail) {
  const envAuth = {
    GIT_TERMINAL_PROMPT: '0',  // jamais de prompt interactif
    GIT_ASKPASS: 'echo',
    GIT_AUTHOR_NAME: authorName || 'Qlik Lineage',
    GIT_AUTHOR_EMAIL: authorEmail || 'qlik-lineage@local',
    GIT_COMMITTER_NAME: authorName || 'Qlik Lineage',
    GIT_COMMITTER_EMAIL: authorEmail || 'qlik-lineage@local'
  };

  if (!isGitRepo(exportDir)) {
    await git(exportDir, ['init', '-b', branch], envAuth);
  } else {
    // Branche courante → bascule sur `branch` (crée si manquante)
    try { await git(exportDir, ['checkout', branch], envAuth); }
    catch (_) { await git(exportDir, ['checkout', '-b', branch], envAuth); }
  }

  // Remote origin → crée ou met à jour avec URL authentifiée (token non logué).
  const authedUrl = urlWithAuth(repoUrl, token);
  try { await git(exportDir, ['remote', 'set-url', 'origin', authedUrl], envAuth); }
  catch (_) { await git(exportDir, ['remote', 'add', 'origin', authedUrl], envAuth); }

  await git(exportDir, ['add', '-A'], envAuth);

  // Rien de modifié ?
  const status = await git(exportDir, ['status', '--porcelain'], envAuth);
  if (!status.stdout) {
    return { repoUrl, commitSha: null, pushed: false, nothingToCommit: true };
  }

  await git(exportDir, ['commit', '-m', commitMessage], envAuth);
  const sha = (await git(exportDir, ['rev-parse', 'HEAD'], envAuth)).stdout;

  // Push : --set-upstream la première fois, --force-with-lease pour éviter l'écrasement de commits concurrents.
  try {
    await git(exportDir, ['push', '--force-with-lease', '-u', 'origin', branch], envAuth);
  } catch (e) {
    // Première poussée sur un repo vide : --force-with-lease échoue, on retente sans
    await git(exportDir, ['push', '-u', 'origin', branch], envAuth);
  }

  return { repoUrl, commitSha: sha, pushed: true, nothingToCommit: false };
}

/**
 * Point d'entrée pour la route : orchestre config → ensureProject → syncAppDir.
 * Met à jour `app_git_state` à la fin.
 */
async function syncApp({ app, exportDir, exportStats, user }) {
  const config = getConfig();
  if (!config || !config.base_url || !config.namespace || !config.access_token) {
    throw new Error('Configuration Git incomplète — renseignez base URL + namespace + token dans Paramètres.');
  }

  const slug = slugify(app.name);
  const repoUrl = await ensureGitlabProject(config, slug, `Export Qlik — ${app.name}`);
  const branch = config.default_branch || 'main';
  const message = buildCommitMessage(exportStats);

  const result = await syncAppDir(
    exportDir,
    repoUrl,
    config.access_token,
    branch,
    message,
    user?.username || 'qlik-lineage',
    user?.email || null
  );

  db.prepare(`
    INSERT INTO app_git_state (app_id, repo_url, last_commit_sha, last_sync_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(app_id) DO UPDATE SET
      repo_url = excluded.repo_url,
      last_commit_sha = COALESCE(excluded.last_commit_sha, last_commit_sha),
      last_sync_at = CURRENT_TIMESTAMP
  `).run(app.id, repoUrl, result.commitSha);

  return { ...result, slug, branch, commitMessage: message };
}

/** État Git d'une app (dernier commit, URL repo). */
function getAppGitState(appId) {
  return db.prepare('SELECT * FROM app_git_state WHERE app_id = ?').get(appId) || null;
}

module.exports = { slugify, getConfig, syncApp, getAppGitState, ensureGitlabProject, syncAppDir };
