const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || './data/lineage.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE,
    content TEXT,
    filename TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE,
    result JSON,
    script_hash TEXT,
    analyze_mode TEXT DEFAULT 'claude',
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE,
    role TEXT CHECK(role IN ('user','assistant')),
    content TEXT,
    mode TEXT,
    source TEXT DEFAULT 'claude',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS qlik_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    host TEXT,
    qrs_port INTEGER DEFAULT 4242,
    engine_port INTEGER DEFAULT 4747,
    auth_mode TEXT DEFAULT 'certificate',
    cert_dir TEXT,
    user_directory TEXT DEFAULT 'INTERNAL',
    user_id TEXT DEFAULT 'sa_repository',
    reject_unauthorized INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost_cents INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ssis_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    host TEXT NOT NULL,
    port INTEGER DEFAULT 1433,
    database TEXT DEFAULT 'SSISDB',
    username TEXT,
    password TEXT,
    encrypt INTEGER DEFAULT 1,
    trust_server_certificate INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ssis_table_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_key TEXT NOT NULL,
    database_name TEXT NOT NULL,
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_ssis_snapshots_lookup
    ON ssis_table_snapshots(server_key, database_name, schema_name, table_name, captured_at DESC);

  -- Snapshots nommés (déclenchés à la demande, granularité société)
  CREATE TABLE IF NOT EXISTS ssis_named_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    description TEXT,
    server_key TEXT NOT NULL,
    database_name TEXT NOT NULL,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    table_count INTEGER DEFAULT 0,
    row_count_total INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ssis_named_snapshot_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES ssis_named_snapshots(id) ON DELETE CASCADE,
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    ref_societe TEXT,      -- NULL = total table (aucune colonne REF_SOCIETE)
    row_count INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_named_snap_rows_lookup
    ON ssis_named_snapshot_rows(snapshot_id, schema_name, table_name, ref_societe);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')),
    email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    scopes TEXT DEFAULT 'read',
    last_used_at DATETIME,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    username TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at);
`);

// Migrations pour les colonnes ajoutées aux tables existantes
const migrations = [
  'ALTER TABLE ssis_config ADD COLUMN autosnapshot_enabled INTEGER DEFAULT 0',
  'ALTER TABLE ssis_config ADD COLUMN autosnapshot_database TEXT',
  'ALTER TABLE ssis_config ADD COLUMN autosnapshot_last_exec_id INTEGER',
  'ALTER TABLE analyses ADD COLUMN script_hash TEXT',
  'ALTER TABLE analyses ADD COLUMN analyze_mode TEXT DEFAULT \'claude\'',
  'ALTER TABLE chat_messages ADD COLUMN source TEXT DEFAULT \'claude\'',
  'ALTER TABLE apps ADD COLUMN qlik_app_id TEXT',
  'ALTER TABLE apps ADD COLUMN stream TEXT',
  'ALTER TABLE apps ADD COLUMN origin TEXT DEFAULT \'manual\'',
  'ALTER TABLE qlik_config ADD COLUMN cert_password TEXT',
  'ALTER TABLE qlik_config ADD COLUMN proxy_password TEXT',
  'ALTER TABLE apps ADD COLUMN published INTEGER DEFAULT 0',
  'ALTER TABLE apps ADD COLUMN owner TEXT',
  'ALTER TABLE apps ADD COLUMN last_reload TEXT',
  // Métadonnées QRS enrichies (P3)
  'ALTER TABLE apps ADD COLUMN file_size INTEGER',
  'ALTER TABLE apps ADD COLUMN created_date TEXT',
  'ALTER TABLE apps ADD COLUMN modified_date TEXT',
  'ALTER TABLE apps ADD COLUMN publish_time TEXT',
  'ALTER TABLE apps ADD COLUMN description TEXT',
  'ALTER TABLE apps ADD COLUMN tags TEXT',
  'ALTER TABLE apps ADD COLUMN custom_properties TEXT',
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* colonne déjà présente */ }
}

module.exports = db;
