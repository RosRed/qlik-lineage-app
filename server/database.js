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
`);

// Migrations pour les colonnes ajoutées aux tables existantes
const migrations = [
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
