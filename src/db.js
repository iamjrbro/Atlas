import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export async function database(config, { memory = false } = {}) {
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.ssl ? { rejectUnauthorized: true } : false,
      max: 12,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    pool.on("error", () =>
      console.error('{"event":"database.connection.error"}'),
    );
    return pool;
  }
  if (config.mode !== "demo")
    throw new Error("PostgreSQL obrigatório no modo microsoft.");
  const { PGlite } = await import("@electric-sql/pglite");
  if (!memory && config.demoPath)
    await mkdir(dirname(config.demoPath), { recursive: true });
  const pgLite = new PGlite(
    memory || !config.demoPath ? undefined : config.demoPath,
  );
  let chain = Promise.resolve();
  const lock = async (fn) => {
    const before = chain;
    let release;
    chain = new Promise((r) => (release = r));
    await before;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const raw = async (text, values) => {
    const r = await pgLite.query(text, values || []);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  };
  const pool = {
    query(text, values, cb) {
      if (typeof values === "function") {
        cb = values;
        values = [];
      }
      if (typeof text === "object") {
        values = text.values;
        text = text.text;
      }
      const p = lock(() => raw(text, values));
      if (cb) p.then((r) => cb(null, r), cb);
      return p;
    },
    async connect() {
      const before = chain;
      let release;
      chain = new Promise((r) => (release = r));
      await before;
      return { query: raw, release };
    },
    async end() {
      await chain;
      await pgLite.close();
    },
    on() {},
    async exec(sql) {
      return lock(() => pgLite.exec(sql));
    },
  };
  return pool;
}
export async function transaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const v = await fn(db);
    await db.query("COMMIT");
    return v;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function migrate(pool) {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  if (pool.exec) return pool.exec(sql);
  return pool.query(sql);
}
