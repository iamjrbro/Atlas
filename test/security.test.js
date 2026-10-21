import test from "node:test";
import assert from "node:assert/strict";
import {
  safeUrl,
  withinScope,
  verifyBridge,
  hmac,
  hash,
  canonical,
  csrf,
  claimsIdentity,
  requireRole,
} from "../src/security.js";
import { loadConfig } from "../src/config.js";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("canonical hash não depende da ordem de propriedades", () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(
    hash({ b: { z: 2, a: 1 }, a: 1 }),
    hash({ a: 1, b: { a: 1, z: 2 } }),
  );
  assert.notEqual(hash([1, 2]), hash([2, 1]));
});
test("links de paginação e conteúdo não escapam da origem ou tenant", () => {
  assert.equal(safeUrl("users", "graph", a).hostname, "graph.microsoft.com");
  for (const [url, kind] of [
    ["https://evil.example/steal", "graph"],
    ["https://graph.microsoft.com/beta/users", "graph"],
    ["https://user:pass@graph.microsoft.com/v1.0/users", "graph"],
    [`https://manage.office.com/api/v1.0/${b}/activity/feed/audit/x`, "m365"],
    ["https://management.azure.com.evil.example/x", "arm"],
  ])
    assert.throws(() => safeUrl(url, kind, a));
});
test("herança de escopo respeita fronteira de caminho", () => {
  assert.ok(
    withinScope(
      "/subscriptions/A/resourceGroups/R/providers/Microsoft.Compute/virtualMachines/VM",
      "/subscriptions/a/resourceGroups/r",
    ),
  );
  assert.equal(
    withinScope(
      "/subscriptions/a/resourceGroups/rg2",
      "/subscriptions/a/resourceGroups/rg",
    ),
    false,
  );
  assert.equal(withinScope("/subscriptions/b", "/subscriptions/a"), false);
});
test("HMAC bridge valida corpo, tenant por chave, tempo e nonce", () => {
  const secret = "s".repeat(48),
    body = Buffer.from('{"sample":"ação"}'),
    timestamp = String(Date.now()),
    nonce = "n".repeat(32),
    signature = hmac(
      secret,
      `${timestamp}.${nonce}.${hash(body.toString("utf8"))}`,
    ),
    base = { secret, timestamp, nonce, signature, body };
  assert.doesNotThrow(() => verifyBridge(base));
  for (const bad of [
    { body: Buffer.from("{}") },
    { secret: "wrong".repeat(10) },
    { timestamp: "0" },
    { nonce: "short" },
    { signature: "bad" },
    { now: Date.now() + 3600000 },
  ])
    assert.throws(() => verifyBridge({ ...base, ...bad }));
});
test("CSRF e RBAC negam por padrão", () => {
  const req = {
    get: (k) =>
      ({ origin: "https://atlas.example", "x-csrf-token": "correct" })[k],
    session: { csrf: "correct" },
  };
  assert.doesNotThrow(() => csrf(req, "https://atlas.example"));
  assert.throws(() => csrf(req, "https://evil.example"));
  req.session.csrf = "wrong";
  assert.throws(() => csrf(req, "https://atlas.example"));
  assert.throws(() =>
    requireRole({ roles: ["Atlas.Reader"] }, ["Atlas.Admin"]),
  );
});
test("identidade exige tenant, nonce, audience e app role validado", () => {
  const p = {
    tid: a,
    aud: b,
    nonce: "expected",
    oid: a,
    roles: ["Atlas.Admin"],
    iat: Date.now() / 1000,
  };
  const c = { tenant: a, clientId: b, nonce: "expected" };
  assert.equal(claimsIdentity(p, c).tenant, a);
  for (const delta of [
    { tid: b },
    { aud: a },
    { nonce: "wrong" },
    { roles: [] },
    { roles: "Atlas.Admin" },
    { iat: 0 },
  ])
    assert.throws(() => claimsIdentity({ ...p, ...delta }, c));
});
test("produção bloqueia demo e exige TLS, credenciais e sessões fortes", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", APP_MODE: "demo" }));
  assert.throws(() => loadConfig({ APP_MODE: "microsoft" }));
  const c = {
    NODE_ENV: "production",
    APP_MODE: "microsoft",
    PUBLIC_ORIGIN: "https://atlas.example",
    DATABASE_SSL: "require",
    DATABASE_URL: "postgresql://atlas@db/atlas",
    SESSION_SECRET: "s".repeat(50),
    WEB_CLIENT_ID: a,
    WEB_CLIENT_SECRET: "web-placeholder",
    COLLECTOR_CLIENT_ID: b,
    COLLECTOR_CLIENT_SECRET: "collector-placeholder",
  };
  assert.equal(loadConfig(c).mode, "microsoft");
  for (const delta of [
    { PUBLIC_ORIGIN: "http://atlas.example" },
    { PUBLIC_ORIGIN: "https://atlas.example/path" },
    { DATABASE_SSL: "disable" },
    { SESSION_SECRET: "short" },
    { WEB_CLIENT_ID: "common" },
    { BRIDGE_HMAC_KEYS_JSON: '{"bad":"short"}' },
  ])
    assert.throws(() => loadConfig({ ...c, ...delta }));
});
