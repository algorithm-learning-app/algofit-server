import Database from 'better-sqlite3';

import type { ProgressRecord, ProgressStore } from './types.js';

interface Row {
  guest_id: string;
  updated_at: number;
  data: string;
}

/** better-sqlite3 기반 진행 저장소. `path` 가 ':memory:' 면 인메모리. */
export function createSqliteStore(path: string): ProgressStore {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      guest_id   TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL,
      data       TEXT NOT NULL
    )
  `);

  const getStmt = db.prepare<[string], Row>(
    'SELECT guest_id, updated_at, data FROM progress WHERE guest_id = ?',
  );
  const putStmt = db.prepare(`
    INSERT INTO progress (guest_id, updated_at, data)
    VALUES (@guestId, @updatedAt, @data)
    ON CONFLICT(guest_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      data       = excluded.data
  `);

  return {
    get(guestId) {
      const row = getStmt.get(guestId);
      if (!row) return null;
      return {
        guestId: row.guest_id,
        updatedAt: row.updated_at,
        data: JSON.parse(row.data) as Record<string, unknown>,
      };
    },
    put(record) {
      putStmt.run({
        guestId: record.guestId,
        updatedAt: record.updatedAt,
        data: JSON.stringify(record.data),
      });
    },
    close() {
      db.close();
    },
  };
}
