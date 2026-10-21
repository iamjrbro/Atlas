import test from "node:test";
import assert from "node:assert/strict";
import { database, migrate } from "../src/db.js";
import { ensureTenant, queueSource } from "../src/store.js";
import { processOne } from "../src/worker.js";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  config = { maxPages: 1, maxRecords: 100, overlap: 60 };
test("Graph retoma páginas em jobs distintos sem remover registros de páginas anteriores", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    let calls = [];
    const provider = {
      async call(t, k, path) {
        calls.push(path);
        return {
          data: path.includes("page2")
            ? { value: [{ id: "u2", displayName: "User 2" }] }
            : {
                value: [{ id: "u1", displayName: "User 1" }],
                "@odata.nextLink":
                  "https://graph.microsoft.com/v1.0/users?page2=1",
              },
        };
      },
    };
    await queueSource(pool, tenant, "entra.users");
    await processOne(pool, config, provider);
    assert.equal(
      (await pool.query("SELECT status FROM coverage")).rows[0].status,
      "partial",
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM collection_cursors")).rows[0].n,
      1,
    );
    await queueSource(pool, tenant, "entra.users");
    await processOne(pool, config, provider);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes("page2"));
    assert.equal(
      (await pool.query("SELECT status FROM coverage")).rows[0].status,
      "success",
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM resources WHERE active"))
        .rows[0].n,
      2,
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM collection_cursors")).rows[0].n,
      0,
    );
  } finally {
    await pool.end();
  }
});
test("fanout de grupos retoma relação e pai; ciclo completo mantém todas as associações", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    const paths = [];
    const provider = {
      async call(t, k, path) {
        paths.push(path);
        return {
          data: path.startsWith("groups?")
            ? { value: [{ id: "g1" }, { id: "g2" }] }
            : path.endsWith("/members")
              ? { value: [{ id: path.includes("g1") ? "u1" : "u2" }] }
              : { value: [] },
        };
      },
    };
    for (let i = 0; i < 6; i++) {
      await queueSource(pool, tenant, "entra.memberships");
      await processOne(pool, config, provider);
      const state = (await pool.query("SELECT status FROM coverage")).rows[0]
        .status;
      if (state === "success") break;
    }
    assert.equal(paths.length, 5);
    assert.equal(
      (await pool.query("SELECT status FROM coverage")).rows[0].status,
      "success",
    );
    assert.equal(
      (await pool.query("SELECT count(*) n FROM edges WHERE active")).rows[0].n,
      2,
    );
  } finally {
    await pool.end();
  }
});
