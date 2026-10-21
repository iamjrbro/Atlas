import test from "node:test";
import assert from "node:assert/strict";
import { createProvider } from "../src/provider.js";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  config = { maxPages: 3 };
test("paginação completa coleções Graph e não confunde erro 200 com lista vazia", async () => {
  let calls = 0;
  const p = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () =>
      Response.json(
        ++calls === 1
          ? {
              value: [{ id: 1 }],
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/users?$skiptoken=x",
            }
          : { value: [{ id: 2 }] },
      ),
    sleeper: async () => {},
  });
  const items = [];
  for await (const rows of p.pages(tenant, "graph", "users"))
    items.push(...rows);
  assert.equal(items.length, 2);
  assert.equal(calls, 2);
  const bad = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () => Response.json({ unexpected: true }),
  });
  await assert.rejects(
    async () => {
      for await (const _ of bad.pages(tenant, "graph", "users")) {
      }
    },
    (e) => e.code === "PROVIDER_SHAPE",
  );
});
test("repetição de 429 respeita retry-after e não repete 403", async () => {
  let calls = 0,
    waits = [];
  const p = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () =>
      ++calls === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "2" } })
        : Response.json({ value: [] }),
    sleeper: async (ms) => waits.push(ms),
  });
  await p.call(tenant, "graph", "users");
  assert.deepEqual(waits, [2000]);
  assert.equal(calls, 2);
  calls = 0;
  const forbidden = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 403 });
    },
  });
  await assert.rejects(
    () => forbidden.call(tenant, "graph", "users"),
    (e) => e.providerStatus === 403,
  );
  assert.equal(calls, 1);
});
test("token fica no servidor e redirects, mutações e SSRF são recusados", async () => {
  let calls = 0;
  const p = await createProvider(config, {
    getToken: async (t, k) => {
      assert.equal(t, tenant);
      assert.equal(k, "graph");
      return "server-only";
    },
    fetcher: async (u, o) => {
      calls++;
      assert.equal(o.headers.Authorization, "Bearer server-only");
      assert.equal(o.redirect, "error");
      return Response.json({ value: [] });
    },
  });
  await p.call(tenant, "graph", "users");
  await assert.rejects(
    () => p.call(tenant, "graph", "users", { method: "POST", body: {} }),
    (e) => e.code === "COLLECTOR_READ_ONLY",
  );
  await assert.rejects(() =>
    p.call(tenant, "graph", "https://evil.example/steal"),
  );
  assert.equal(calls, 1);
});
test("paginação cíclica e cap de páginas encerram como parcial, sem loop infinito", async () => {
  const p = await createProvider(
    { ...config, maxPages: 1 },
    {
      getToken: async () => "test",
      fetcher: async () =>
        Response.json({
          value: [{ id: 1 }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/users?$skiptoken=2",
        }),
    },
  );
  await assert.rejects(
    async () => {
      for await (const _ of p.pages(tenant, "graph", "users")) {
      }
    },
    (e) => e.code === "COLLECTION_LIMIT",
  );
  const cyclic = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () =>
      Response.json({
        value: [],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users",
      }),
  });
  await assert.rejects(
    async () => {
      for await (const _ of cyclic.pages(tenant, "graph", "users")) {
      }
    },
    (e) => e.code === "PAGINATION_LOOP",
  );
});
test("retry-after longo retorna controle à fila em vez de bloquear minutos", async () => {
  const p = await createProvider(config, {
    getToken: async () => "test",
    fetcher: async () =>
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    sleeper: async () => {
      throw new Error("Não deve dormir");
    },
  });
  await assert.rejects(
    () => p.call(tenant, "graph", "users"),
    (e) => e.code === "PROVIDER_429" && !!e.retryAt,
  );
});
