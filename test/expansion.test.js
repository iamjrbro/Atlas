import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { normalize, armKey } from "../src/normalize.js";
import { safeUrl } from "../src/security.js";
import { createProvider } from "../src/provider.js";
import { costRows, collectCosts } from "../src/costs.js";
import { collectGraph } from "../src/resumable-graph.js";
import { collectConfigurations } from "../src/azure-configurations.js";
import { sourceById } from "../src/sources.js";
import { database, migrate } from "../src/db.js";
import {
  ensureTenant,
  ingest,
  resourceDetail,
  finishSnapshot,
} from "../src/store.js";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sub = "55555555-5555-4555-8555-555555555555",
  rid = `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm`;
const period = { from: "2026-10-01T00:00:00Z", to: "2026-10-21T12:00:00Z" };
const response = {
  properties: {
    columns: [
      { name: "Currency" },
      { name: "UsageDate" },
      { name: "ResourceId" },
      { name: "PreTaxCost" },
    ],
    rows: [
      ["BRL", 20261020, rid, 19.5],
      ["USD", 20261020, "", 2],
    ],
  },
};
test("custos: colunas por nome, moedas separadas, sem ResourceId, paginação POST e limites de escopo", async () => {
  const rows = costRows(response, sub, period);
  assert.equal(rows[0].amount, 19.5);
  assert.equal(rows[1].resourceId, null);
  assert.equal(
    rows[0].id,
    costRows(response, sub, { ...period, to: "2026-10-22T00:00:00Z" })[0].id,
  );
  assert.throws(
    () => costRows({ properties: { columns: [], rows: [] } }, sub, period),
    /COST_COLUMNS/,
  );
  assert.throws(
    () =>
      costRows(
        {
          ...response,
          properties: {
            ...response.properties,
            rows: [["BRL", 20261020, "/subscriptions/evil/r", 1]],
          },
        },
        sub,
        period,
      ),
    /COST_SCOPE/,
  );
  const calls = [],
    emitted = [];
  await collectCosts({
    tenant,
    subscriptions: [sub],
    config: { maxPages: 3 },
    heartbeat: async () => {},
    emit: async (x) => emitted.push(...x),
    provider: {
      async call(t, k, url, opts) {
        calls.push({ t, k, url, opts });
        return {
          data:
            calls.length === 1
              ? {
                  properties: {
                    ...response.properties,
                    nextLink: `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.CostManagement/query?api-version=2025-03-01&$skiptoken=x`,
                  },
                }
              : response,
        };
      },
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].opts, calls[1].opts);
  assert.equal(emitted.length, 4);
  await assert.rejects(
    collectCosts({
      tenant,
      subscriptions: [sub],
      config: { maxPages: 3 },
      heartbeat: async () => {},
      emit: async () => {},
      provider: {
        async call() {
          return {
            data: {
              properties: {
                ...response.properties,
                nextLink:
                  "https://management.azure.com/subscriptions/evil/providers/Microsoft.CostManagement/query",
              },
            },
          };
        },
      },
    }),
    /COST_PAGINATION_SCOPE/,
  );
});
test("provider: beta limitado ao Intune e POST somente em consultas de leitura", async () => {
  assert.equal(
    safeUrl(
      "/beta/deviceManagement/deviceHealthScripts/x/assignments",
      "graph",
      tenant,
    ).hostname,
    "graph.microsoft.com",
  );
  for (const url of [
    "/beta/users",
    "/beta/deviceManagement/deviceHealthScriptsEvil",
    "https://evil.test/beta/deviceManagement/deviceHealthScripts",
  ])
    assert.throws(() => safeUrl(url, "graph", tenant));
  let requests = 0;
  const provider = await createProvider(
    {},
    {
      getToken: async () => "fixture",
      fetcher: async () => {
        requests++;
        return new Response(JSON.stringify(response));
      },
    },
  );
  await provider.call(
    tenant,
    "arm",
    `/subscriptions/${sub}/providers/Microsoft.CostManagement/query`,
    { method: "POST", body: {} },
  );
  await assert.rejects(
    provider.call(
      tenant,
      "graph",
      "/beta/deviceManagement/deviceHealthScripts/x/runRemediation",
      { method: "POST" },
    ),
    /COLLECTOR_READ_ONLY/,
  );
  await assert.rejects(
    provider.call(tenant, "arm", rid + "/listKeys", { method: "POST" }),
    /COLLECTOR_READ_ONLY/,
  );
  assert.equal(requests, 1);
});
test("atribuições preservam exclusões, filtros e alvos globais sem inventar membros", () => {
  const n = normalize(
    "intune.catalog.assignments",
    {
      id: "a",
      target: {
        "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget",
        groupId: "g",
        deviceAndAppManagementAssignmentFilterId: "f",
        deviceAndAppManagementAssignmentFilterType: "exclude",
      },
    },
    { parent: "p" },
  );
  assert.equal(n.edges[0].relation, "excluded_from");
  assert.equal(n.edges[0].to, "entra:g");
  assert.equal(n.edges[1].to, "intune:filters:f");
  assert.equal(n.resources.length, 0);
  const global = normalize(
    "intune.powershell.assignments",
    {
      id: "b",
      target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" },
    },
    { parent: "p" },
  );
  assert.equal(global.edges[0].to, "intune-target:allDevicesAssignmentTarget");
});
test("integração: cursor Intune, conteúdo, nomes, membros paginados, custos idempotentes e configuração ARM", async () => {
  const pool = await database({ mode: "demo" }, { memory: true });
  try {
    await migrate(pool);
    await ensureTenant(pool, tenant, "A");
    await ensureTenant(pool, other, "B");
    async function run(source) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status,detail) VALUES($1,$2,$3,'success','{}')",
        [id, tenant, source],
      );
      return { id, source, detail: {} };
    }
    async function put(source, records) {
      const r = await run(source);
      await ingest(pool, { tenant, source, runId: r.id, records });
      return r;
    }
    await put("entra.groups", [
      { record: { id: "g", displayName: "Computadores" } },
    ]);
    await put(
      "entra.users",
      Array.from({ length: 55 }, (_, i) => ({
        record: {
          id: "u" + i,
          displayName: "Pessoa " + i,
          assignedLicenses: [{ skuId: "sku" }],
        },
      })),
    );
    await put("m365.licenses", [
      {
        record: {
          id: "sku",
          skuId: "sku",
          skuPartNumber: "M365_E5",
          servicePlans: [{ servicePlanName: "EXCHANGE" }],
        },
      },
    ]);
    await put(
      "entra.memberships",
      Array.from({ length: 55 }, (_, i) => ({
        record: { id: "u" + i },
        context: { parent: "g", relation: "members" },
      })),
    );
    let d = await resourceDetail(pool, tenant, "entra:g");
    assert.equal(d.edges.length, 50);
    assert.equal(d.relationshipsHasMore, true);
    assert.match(d.edges[0].fromName, /Pessoa/);
    d = await resourceDetail(pool, tenant, "entra:g", 50);
    assert.equal(d.edges.length, 5);
    assert.equal(d.relationshipsHasMore, false);
    d = await resourceDetail(pool, tenant, "entra:u0");
    assert.equal(d.related[0].name, "M365_E5");
    await assert.rejects(
      resourceDetail(pool, other, "entra:g"),
      /não foi coletado/,
    );
    const source = sourceById("intune.powershell.details"),
      paths = [];
    const provider = {
      async call(t, k, path) {
        paths.push(path);
        return {
          data: path.endsWith("?$select=id")
            ? { value: [{ id: "script" }] }
            : { id: "script", scriptContent: "V3JpdGUtT3V0cHV0ICdPaSc=" },
        };
      },
    };
    const r = await run(source.id);
    await assert.rejects(
      collectGraph(
        r,
        { id: tenant, settings: {} },
        source,
        { maxPages: 1, maxRecords: 100 },
        provider,
        pool,
        new Date(),
        new Date(),
      ),
      /cursor persistido/,
    );
    const r2 = await run(source.id);
    await collectGraph(
      r2,
      { id: tenant, settings: {} },
      source,
      { maxPages: 5, maxRecords: 100 },
      provider,
      pool,
      new Date(),
      new Date(),
    );
    assert.ok(
      paths.every((p) =>
        p.startsWith("/beta/deviceManagement/deviceManagementScripts"),
      ),
    );
    d = await resourceDetail(
      pool,
      tenant,
      "intune:powershell:script:detail:configuration",
    );
    assert.equal(
      d.resource.properties.scriptContent,
      "V3JpdGUtT3V0cHV0ICdPaSc=",
    );
    const rows = costRows(response, sub, period).map((record) => ({ record }));
    await put("azure.costs", rows);
    const costRun = await put("azure.costs", rows);
    await finishSnapshot(pool, tenant, "azure.costs", costRun.id);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM resources WHERE kind='costLine'",
        )
      ).rows[0].n,
      2,
    );
    await put("azure.resources", [
      {
        record: {
          id: rid,
          name: "VM",
          type: "Microsoft.Compute/virtualMachines",
          subscriptionId: sub,
          resourceGroup: "rg",
        },
      },
    ]);
    const cr = await run("azure.configurations");
    await collectConfigurations(
      cr,
      { id: tenant },
      [sub],
      { maxPages: 10, maxRecords: 10 },
      {
        async call(t, k, path) {
          return {
            data: path.includes("/providers/Microsoft.Compute?")
              ? {
                  resourceTypes: [
                    {
                      resourceType: "virtualMachines",
                      apiVersions: ["2025-01-01-preview", "2024-07-01"],
                    },
                  ],
                }
              : {
                  id: rid,
                  name: "VM",
                  properties: {
                    hardwareProfile: { vmSize: "Standard_D2s_v5" },
                  },
                },
          };
        },
      },
      pool,
    );
    d = await resourceDetail(pool, tenant, armKey(rid));
    assert.equal(d.children[0].properties.collectedApiVersion, "2024-07-01");
    assert.equal(d.costs[0].amount, "19.5");
  } finally {
    await pool.end();
  }
});
