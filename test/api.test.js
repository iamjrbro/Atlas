import test from "node:test";
import assert from "node:assert/strict";
import { database, migrate } from "../src/db.js";
import { createApp } from "../src/server.js";
import { seedDemo, DEMO_TENANTS } from "../src/seed.js";
import { loadConfig } from "../src/config.js";
import { hmac, hash } from "../src/security.js";
import { gzipSync } from "node:zlib";
test("HTTP: isolamento real entre tenants, sessão, RBAC, CSRF, paginação e bridge anti-replay", async () => {
  const c = loadConfig({
      APP_MODE: "demo",
      SESSION_SECRET: "s".repeat(50),
      BRIDGE_HMAC_KEYS_JSON: JSON.stringify({
        [DEMO_TENANTS[0].id]: "k".repeat(48),
      }),
    }),
    pool = await database(c, { memory: true });
  await migrate(pool);
  await seedDemo(pool);
  const app = createApp(c, pool),
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
  const origin = "http://127.0.0.1:" + server.address().port;
  c.origin = origin;
  async function request(
    path,
    {
      cookie = "",
      method = "GET",
      body,
      token,
      from = origin,
      headers = {},
    } = {},
  ) {
    const r = await fetch(origin + path, {
      method,
      headers: {
        Origin: from,
        Cookie: cookie,
        "Content-Type": "application/json",
        ...(token ? { "x-csrf-token": token } : {}),
        ...headers,
      },
      body: body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined,
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  }
  async function login(tenant, role = "Atlas.Admin") {
    const r = await request("/api/demo/session", {
      method: "POST",
      body: { tenant, role },
    });
    assert.equal(r.status, 200);
    const m = await request("/api/me", { cookie: r.cookie });
    return { cookie: r.cookie, token: m.body.csrf, me: m.body };
  }
  try {
    // Regression for GHSA-27r3-jxmh-p828: malformed compressed input must not
    // terminate the application, including before authentication/routing.
    const compressed = await fetch(origin + "/api/demo/session", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: Buffer.concat([
        gzipSync(Buffer.from("{}")),
        Buffer.from("invalid trailing bytes"),
      ]),
    });
    assert.equal(compressed.status, 400);
    await compressed.arrayBuffer();
    assert.equal((await request("/api/session")).status, 200);
    assert.equal((await request("/api/resources")).status, 401);
    const a = await login(DEMO_TENANTS[0].id),
      b = await login(DEMO_TENANTS[1].id),
      reader = await login(DEMO_TENANTS[0].id, "Atlas.Reader");
    let r = await request("/api/resources?kind=organization", a);
    assert.equal(r.body.items[0].name, "Aurora Labs");
    r = await request(
      "/api/resources?kind=organization&tenant=" + DEMO_TENANTS[0].id,
      b,
    );
    assert.equal(r.body.items[0].name, "Horizonte Educação");
    const evidence = r.body.items[0].evidence_id;
    assert.equal((await request("/api/evidence/" + evidence, a)).status, 404);
    assert.equal(
      (await request("/api/evidence/" + evidence, b)).body.hashValid,
      true,
    );
    assert.equal(
      (await request("/api/evidence/" + evidence, reader)).status,
      403,
    );
    assert.equal(
      (
        await request("/api/tenant/settings", {
          ...a,
          method: "PUT",
          token: "bad",
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/tenant/settings", {
          ...a,
          method: "PUT",
          from: "https://evil.example",
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/tenant/settings", {
          ...reader,
          method: "PUT",
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/tenant/settings", {
          ...a,
          method: "PUT",
          body: {
            name: "Attempt",
            sources: [],
            subscriptions: [],
            workspaces: [],
            tenantId: DEMO_TENANTS[1].id,
          },
        })
      ).status,
      400,
    );
    r = await request("/api/events?limit=2", a);
    assert.equal(r.body.items.length, 2);
    assert.equal(r.body.hasMore, true);
    assert.equal((await request("/api/events?limit=201", a)).status, 400);
    assert.equal(
      (
        await request(
          "/api/resources?q=" + encodeURIComponent("'; DROP TABLE tenants; --"),
          a,
        )
      ).body.items.length,
      0,
    );
    assert.equal((await request("/api/overview", b)).status, 200);
    assert.equal((await request("/api/integrity", a)).body.valid, true);
    assert.equal((await request("/api/ledger", reader)).status, 403);
    assert.equal(
      (
        await request("/api/collect", {
          ...a,
          method: "POST",
          body: { sources: ["entra.users"] },
        })
      ).status,
      409,
    );
    assert.equal(
      (await request("/api/overview", a)).headers.get("cache-control"),
      "no-store",
    );
    // Bridge isolado: habilitação explícita por tenant e assinatura do corpo bruto.
    const tenant = DEMO_TENANTS[0].id,
      settings = {
        ...a.me.tenant.settings,
        sources: [...a.me.tenant.settings.sources, "bridge.exchange"],
      };
    await pool.query("UPDATE tenants SET settings=$2 WHERE id=$1", [
      tenant,
      JSON.stringify(settings),
    ]);
    const raw = JSON.stringify({
        tenantId: tenant,
        source: "bridge.exchange",
        capturedAt: new Date().toISOString(),
        complete: false,
        records: [
          {
            id: "fixture",
            recordType: "resource",
            key: "mailbox:bridge@example.test",
            name: "Bridge test",
            kind: "mailbox",
          },
        ],
      }),
      timestamp = String(Date.now()),
      nonce = "n".repeat(32),
      signature = hmac("k".repeat(48), `${timestamp}.${nonce}.${hash(raw)}`),
      bridgeHeaders = {
        "x-atlas-tenant": tenant,
        "x-atlas-timestamp": timestamp,
        "x-atlas-nonce": nonce,
        "x-atlas-signature": signature,
      };
    assert.equal(
      (
        await request("/bridge/v1/snapshots", {
          method: "POST",
          body: raw,
          headers: bridgeHeaders,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/bridge/v1/snapshots", {
          method: "POST",
          body: raw,
          headers: bridgeHeaders,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/bridge/v1/snapshots", {
          method: "POST",
          body: raw + " ",
          headers: bridgeHeaders,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/bridge/v1/snapshots", {
          method: "POST",
          body: raw,
          headers: { ...bridgeHeaders, "x-atlas-tenant": DEMO_TENANTS[1].id },
        })
      ).status,
      401,
    );
    assert.equal(
      (await request("/api/logout", { ...a, method: "POST", body: {} })).status,
      200,
    );
    assert.equal((await request("/api/me", a)).status, 401);
  } finally {
    app.locals.sessionStore.close();
    await new Promise((r) => server.close(r));
    await pool.end();
  }
});
