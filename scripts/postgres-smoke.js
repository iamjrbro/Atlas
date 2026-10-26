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
import { seedDemo, DEMO_TENANTS } from "../src/seed.js";
import { resourceHistory } from "../src/changes.js";
import { policyReach } from "../src/intune-reach.js";
import { connectionDiagnostics } from "../src/diagnostics.js";
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
  await seedDemo(pool);
  const fixtureTenant = DEMO_TENANTS[0].id;
  const history = await resourceHistory(
    pool,
    fixtureTenant,
    "intune:catalog:catalog-001",
  );
  assert.equal(history.items.length, 2);
  const reach = await policyReach(
    pool,
    fixtureTenant,
    "intune:catalog:catalog-001",
  );
  assert.equal(reach.complete, true);
  assert.equal(reach.items.length, 4);
  assert.ok(reach.items.some((d) => d.outcome === "estimated_excluded"));
  const reports = await policyReach(
    pool,
    fixtureTenant,
    "intune-policy:config-01",
  );
  assert.equal(reports.reports.length, 2);
  const diagnostics = await connectionDiagnostics(pool, fixtureTenant, config);
  assert.ok(diagnostics.services.length > 0);
  await assert.rejects(() => pool.query("DELETE FROM evidence"));
  console.log(
    "PostgreSQL 17: migração, coleta, histórico, alcance Intune, relatórios, diagnóstico e proteção de evidências verificados.",
  );
} finally {
  await pool.end();
}
