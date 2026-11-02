import { DatabaseSync } from "node:sqlite";

// Node stand-in for D1, used by tests and the local fixture server.
// The deployed Worker uses the D1 binding and never imports this file.
export function createMemoryD1() {
  const db = new DatabaseSync(":memory:");
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const wrap = (args) => {
        const params = args.map((value) => (value === undefined ? null : value));
        return {
          async all() {
            return { results: stmt.all(...params), success: true };
          },
          async first() {
            const row = stmt.get(...params);
            return row === undefined ? null : row;
          },
          async run() {
            const info = stmt.run(...params);
            return {
              success: true,
              meta: {
                changes: Number(info.changes || 0),
                last_row_id: Number(info.lastInsertRowid || 0),
              },
            };
          },
        };
      };
      return {
        bind(...args) {
          return wrap(args);
        },
        all() {
          return wrap([]).all();
        },
        first() {
          return wrap([]).first();
        },
        run() {
          return wrap([]).run();
        },
      };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
