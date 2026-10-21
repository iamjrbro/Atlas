import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate, transaction } from "../src/db.js";
import {
  ensureTenant,
  ingest,
  finishSnapshot,
  ledger,
  verifyLedger,
  accessPaths,
  resourceDetail,
} from "../src/store.js";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("persistência: evidência idempotente, snapshots, histórico e isolamento", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await ensureTenant(pool, other, "B");
    async function run(source) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status) VALUES($1,$2,$3,'success')",
        [id, tenant, source],
      );
      return id;
    }
    let id = await run("entra.users");
    const record = { id: "u", displayName: "Ana", assignedLicenses: [] };
    await ingest(pool, {
      tenant,
      source: "entra.users",
      runId: id,
      records: [{ record }],
    });
    await ingest(pool, {
      tenant,
      source: "entra.users",
      runId: id,
      records: [{ record }],
    });
    assert.equal(
      (await pool.query("SELECT count(*) n FROM evidence")).rows[0].n,
      1,
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM events")).rows[0].n,
      0,
    );
    id = await run("entra.users");
    await ingest(pool, {
      tenant,
      source: "entra.users",
      runId: id,
      records: [{ record }],
    });
    assert.equal(
      (await pool.query("SELECT count(*) n FROM events")).rows[0].n,
      0,
    );
    await ingest(pool, {
      tenant,
      source: "entra.users",
      runId: id,
      records: [{ record: { ...record, displayName: "Ana atualizada" } }],
    });
    assert.equal(
      (await pool.query("SELECT count(*) n FROM events")).rows[0].n,
      1,
    );
    let detail = await resourceDetail(pool, tenant, "entra:u");
    assert.equal(detail.resource.created_by, null);
    assert.equal(detail.versions.length, 2);
    assert.equal(detail.events[0].occurred_at, null);
    assert.equal(detail.events[0].actor_name, null);
    await assert.rejects(
      () => resourceDetail(pool, other, "entra:u"),
      (e) => e.code === "RESOURCE_NOT_FOUND",
    );
    const next = await run("entra.users");
    await finishSnapshot(pool, tenant, "entra.users", next);
    assert.equal(
      (
        await pool.query("SELECT active FROM resources WHERE tenant_id=$1", [
          tenant,
        ])
      ).rows[0].active,
      false,
    );
    assert.equal((await verifyLedger(pool, tenant)).valid, true);
    await assert.rejects(() =>
      pool.query("UPDATE evidence SET sha256='wrong'"),
    );
    await assert.rejects(() => pool.query("TRUNCATE audit_ledger"));
  } finally {
    await pool.end();
  }
});
test("grafo expande grupos, evita ciclos e inclui permissão no escopo pai", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    const run = randomUUID();
    await pool.query(
      "INSERT INTO runs(id,tenant_id,source) VALUES($1,$2,'entra.memberships')",
      [run, tenant],
    );
    await ingest(pool, {
      tenant,
      source: "entra.memberships",
      runId: run,
      records: [
        { record: { id: "u" }, context: { parent: "g", relation: "members" } },
        { record: { id: "g" }, context: { parent: "g2", relation: "members" } },
        { record: { id: "g2" }, context: { parent: "g", relation: "members" } },
      ],
    });
    await ingest(pool, {
      tenant,
      source: "azure.rbac",
      runId: run,
      records: [
        {
          record: {
            id: "role1",
            type: "microsoft.authorization/roleassignments",
            properties: {
              principalId: "g2",
              scope: "/subscriptions/s/resourceGroups/rg",
              roleDefinitionId: "Reader",
            },
          },
        },
      ],
    });
    const paths = await accessPaths(pool, tenant, "entra:u");
    assert.equal(paths.paths.length, 1);
    assert.deepEqual(paths.paths[0].membershipPaths[0], [
      "entra:u",
      "entra:g",
      "entra:g2",
    ]);
    await ingest(pool, {
      tenant,
      source: "azure.resources",
      runId: run,
      records: [
        {
          record: {
            id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
            name: "vm",
          },
        },
      ],
    });
    const resource = await resourceDetail(
      pool,
      tenant,
      "azure:/subscriptions/s/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm",
    );
    assert.equal(resource.edges.length, 1);
    const integrity = await verifyLedger(pool, tenant);
    assert.ok(integrity.valid);
    await transaction(pool, (db) =>
      ledger(db, tenant, "user", "test.action", "target", { x: 1 }),
    );
    assert.equal((await verifyLedger(pool, tenant)).valid, true);
  } finally {
    await pool.end();
  }
});
