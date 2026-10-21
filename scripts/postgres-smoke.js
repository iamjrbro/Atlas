import assert from "node:assert/strict";
import { database, migrate, transaction } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import {
  ensureTenant,
  ledger,
  verifyLedger,
  queueSource,
} from "../src/store.js";
import { processOne } from "../src/worker.js";
const connection = process.env.TEST_DATABASE_URL;
if (!connection)
  throw new Error(
    "Defina TEST_DATABASE_URL para um banco dedicado atlas_test.",
  );
const url = new URL(connection);
if (
  url.pathname !== "/atlas_test" ||
  !["127.0.0.1", "localhost"].includes(url.hostname)
)
  throw new Error("Este smoke test aceita somente atlas_test em localhost.");
const config = loadConfig({
    APP_MODE: "demo",
    DATABASE_URL: connection,
    DATABASE_SSL: "disable",
  }),
  pool = await database(config);
try {
  await migrate(pool);
  const tenant = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await ensureTenant(pool, tenant, "CI fixture");
  await transaction(pool, (db) =>
    ledger(db, tenant, "ci", "smoke.started", "postgres"),
  );
  await queueSource(pool, tenant, "entra.users");
  await processOne(pool, config, {
    async call() {
      return {
        data: { value: [{ id: "ci-user", displayName: "PostgreSQL fixture" }] },
      };
    },
  });
  assert.equal(
    (
      await pool.query(
        "SELECT name FROM resources WHERE tenant_id=$1 AND key='entra:ci-user'",
        [tenant],
      )
    ).rows[0].name,
    "PostgreSQL fixture",
  );
  assert.equal((await verifyLedger(pool, tenant)).valid, true);
  await assert.rejects(() => pool.query("DELETE FROM evidence"));
  console.log(
    "PostgreSQL 17: migração, coleta, persistência e proteção de evidências verificadas.",
  );
} finally {
  await pool.end();
}
