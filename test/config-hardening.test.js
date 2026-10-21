import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/provider.js";
test("URL do PostgreSQL não pode desligar validação TLS em produção", () => {
  const c = {
    NODE_ENV: "production",
    APP_MODE: "microsoft",
    PUBLIC_ORIGIN: "https://atlas.example",
    DATABASE_SSL: "require",
    DATABASE_URL: "postgresql://atlas@db/atlas?sslmode=no-verify",
    SESSION_SECRET: "s".repeat(50),
    WEB_CLIENT_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    WEB_CLIENT_SECRET: "fixture",
    COLLECTOR_CLIENT_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    COLLECTOR_CLIENT_SECRET: "fixture",
  };
  assert.throws(() => loadConfig(c), /TLS/);
  assert.throws(
    () => loadConfig({ ...c, DATABASE_URL: "redis://db/atlas" }),
    /PostgreSQL/,
  );
});
test("erro de autenticação não é mascarado como falha de rede nem envia token a uma URL", async () => {
  let called = false;
  const p = await createProvider(
    { maxPages: 1 },
    {
      getToken: async () => {
        throw Object.assign(new Error("fixture"), { code: "COLLECTOR_AUTH" });
      },
      fetcher: async () => {
        called = true;
        throw new Error("não deveria executar");
      },
    },
  );
  await assert.rejects(
    () => p.call("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "graph", "users"),
    (e) => e.code === "COLLECTOR_AUTH",
  );
  assert.equal(called, false);
});
