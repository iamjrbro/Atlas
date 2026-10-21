import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, migrate } from "../src/db.js";
import { ensureTenant, queueSource } from "../src/store.js";
import { processOne } from "../src/worker.js";
import { AppError } from "../src/security.js";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  config = { maxPages: 2, maxRecords: 100, overlap: 60 };
test("coleta parcial mantém evidências, não avança checkpoint e não marca objetos ausentes como removidos", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await queueSource(pool, tenant, "entra.users");
    const provider = {
      async *pages() {
        yield [{ id: "a", displayName: "Ana" }];
        throw new AppError(409, "COLLECTION_LIMIT");
      },
    };
    await processOne(pool, config, provider);
    const row = (await pool.query("SELECT * FROM coverage")).rows[0];
    assert.equal(row.status, "partial");
    assert.equal(row.checkpoint, null);
    assert.equal(row.last_success, null);
    assert.equal(
      (await pool.query("SELECT active FROM resources")).rows[0].active,
      true,
    );
    assert.equal(
      (await pool.query("SELECT records FROM runs")).rows[0].records,
      1,
    );
  } finally {
    await pool.end();
  }
});
test("403 vira lacuna explícita de permissão; eventos completos recebem checkpoint", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await queueSource(pool, tenant, "entra.audit");
    const denied = {
      async *pages() {
        throw Object.assign(new AppError(403, "PROVIDER_403"), {
          providerStatus: 403,
        });
      },
    };
    await processOne(pool, config, denied);
    assert.equal(
      (await pool.query("SELECT status FROM coverage")).rows[0].status,
      "forbidden",
    );
    await queueSource(pool, tenant, "entra.audit");
    const good = {
      async *pages() {
        yield [
          {
            id: "e",
            activityDisplayName: "Update group",
            activityDateTime: new Date().toISOString(),
          },
        ];
      },
    };
    await processOne(pool, config, good);
    const row = (await pool.query("SELECT * FROM coverage")).rows[0];
    assert.equal(row.status, "success");
    assert.ok(row.checkpoint);
    assert.equal(
      (await pool.query("SELECT count(*) n FROM events")).rows[0].n,
      1,
    );
  } finally {
    await pool.end();
  }
});
test("feed Microsoft 365 sem subscription ativa não vira coleta vazia bem-sucedida", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await queueSource(pool, tenant, "audit.exchange");
    await processOne(pool, config, {
      async *pages() {
        yield [];
      },
    });
    const row = (await pool.query("SELECT * FROM coverage")).rows[0];
    assert.equal(row.status, "needs_setup");
    assert.equal(row.detail.code, "M365_SUBSCRIPTION_REQUIRED");
  } finally {
    await pool.end();
  }
});
test("subscription feed com conteúdo de outro tenant é rejeitada antes da ingestão", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await queueSource(pool, tenant, "audit.exchange");
    const provider = {
      async *pages(t, k, path) {
        if (path.includes("/list"))
          yield [{ contentType: "Audit.Exchange", status: "enabled" }];
        else
          yield [
            {
              contentUri: `https://manage.office.com/api/v1.0/${tenant}/activity/feed/audit/x`,
            },
          ];
      },
      async call() {
        return {
          data: [
            {
              Id: randomUUID(),
              OrganizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              Operation: "Set-Mailbox",
            },
          ],
        };
      },
    };
    await processOne(pool, config, provider);
    assert.equal(
      (await pool.query("SELECT status FROM coverage")).rows[0].status,
      "failed",
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM evidence")).rows[0].n,
      0,
    );
  } finally {
    await pool.end();
  }
});
