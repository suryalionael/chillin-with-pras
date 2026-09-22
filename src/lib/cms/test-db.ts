// Test helper: a real SQLite database (node:sqlite, in memory) that runs the
// actual migration files and exposes the small D1 surface the data layer uses.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { D1Like, D1StatementLike } from './db.ts';

const MIGRATIONS = new URL('../../../migrations/', import.meta.url);

export function createTestDb(path = ':memory:'): D1Like & { exec(sql: string): void } {
  const sqlite = new DatabaseSync(path);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'));
  }
  return {
    exec: (sql) => sqlite.exec(sql),
    prepare(sql: string): D1StatementLike {
      const stmt = sqlite.prepare(sql);
      let params: unknown[] = [];
      const api: D1StatementLike = {
        bind(...values) {
          params = values;
          return api;
        },
        async first<T>() {
          return ((stmt.get(...(params as never[])) as T | undefined) ?? null) as T | null;
        },
        async all<T>() {
          return { results: stmt.all(...(params as never[])) as T[] };
        },
        async run() {
          const r = stmt.run(...(params as never[]));
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}
