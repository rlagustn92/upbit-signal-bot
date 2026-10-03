import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { log } from '../lib/logger';

/**
 * SQLite (Node 24 내장 node:sqlite). 네이티브 빌드가 필요 없다.
 * PostgreSQL 이전 시: 이 파일(연결/마이그레이션)과 repositories.ts만 교체하면 된다.
 * 금액/수량은 TEXT(10진 문자열)로 저장해 정밀도를 보존한다.
 */
export type DB = DatabaseSync;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  market_code TEXT NOT NULL,
  display_symbol TEXT NOT NULL,
  coin_name TEXT NOT NULL,
  strategy TEXT NOT NULL,
  strategy_config TEXT NOT NULL,
  strategy_state TEXT NOT NULL DEFAULT '{}',
  budget_krw TEXT NOT NULL,
  take_profit_percent REAL NOT NULL,
  stop_loss_percent REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'PAPER' CHECK (mode IN ('PAPER','LIVE')),
  last_signal_text TEXT,
  last_signal_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL REFERENCES bots(id),
  market_code TEXT NOT NULL,
  strategy TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_value TEXT,
  reason TEXT NOT NULL,
  outcome TEXT,
  order_id INTEGER,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_bot ON signals(bot_id, id DESC);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER REFERENCES bots(id),
  identifier TEXT NOT NULL UNIQUE,
  upbit_uuid TEXT UNIQUE,
  market_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('bid','ask')),
  ord_type TEXT NOT NULL,
  price TEXT,
  volume TEXT,
  executed_volume TEXT NOT NULL DEFAULT '0',
  remaining_volume TEXT,
  average_price TEXT,
  executed_funds TEXT NOT NULL DEFAULT '0',
  paid_fee TEXT NOT NULL DEFAULT '0',
  reserved_krw TEXT NOT NULL DEFAULT '0',
  state TEXT NOT NULL,
  upbit_state TEXT,
  purpose TEXT NOT NULL,
  grid_level_id TEXT,
  reason TEXT,
  strategy_signal_id INTEGER,
  mode TEXT NOT NULL CHECK (mode IN ('PAPER','LIVE')),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_bot_state ON orders(bot_id, state);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER REFERENCES bots(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  upbit_trade_uuid TEXT UNIQUE,
  market_code TEXT NOT NULL,
  side TEXT NOT NULL,
  price TEXT NOT NULL,
  volume TEXT NOT NULL,
  funds TEXT NOT NULL,
  fee TEXT NOT NULL,
  realized_pnl TEXT,
  cost_basis TEXT,
  mode TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS positions (
  bot_id INTEGER NOT NULL REFERENCES bots(id),
  market_code TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '0',
  average_entry_price TEXT NOT NULL DEFAULT '0',
  total_cost TEXT NOT NULL DEFAULT '0',
  realized_pnl TEXT NOT NULL DEFAULT '0',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, market_code)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_key TEXT NOT NULL,
  secret_key_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`,
  },
];

export function openDatabase(filePath: string): DB {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined;
  const current = row?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
      log.info('SYSTEM', `DB 마이그레이션 v${m.version} 적용`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
