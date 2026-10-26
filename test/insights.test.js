import test from "node:test";
import assert from "node:assert/strict";
import { compareValues, resourceHistory } from "../src/changes.js";
import { evaluateFilter } from "../src/intune-filter.js";
import { estimateReach } from "../src/intune-reach.js";
import { diagnoseSource } from "../src/diagnostics.js";
import { database, migrate } from "../src/db.js";
import { seedDemo, DEMO_TENANTS } from "../src/seed.js";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { verifyLedger } from "../src/store.js";

test("comparação preserva ausência, null, tipos e JSON pointers sem depender da ordem", () => {
  const result = compareValues(
    { a: null, b: 1, list: [1, 2], "a/b~": false },
    { b: "1", list: [1, 3], "a/b~": true, new: null },
  );
  assert.equal(result.changes.length, 5);
  assert.equal(
    result.changes.find((c) => c.path === "/a").operation,
    "removed",
  );
  assert.deepEqual(result.changes.find((c) => c.path === "/new").after, {
    present: true,
    value: null,
  });
  assert.equal(
    result.changes.find((c) => c.path === "/a~1b~0").before.value,
    false,
  );
  assert.equal(compareValues({ b: 2, a: 1 }, { a: 1, b: 2 }).changes.length, 0);
  assert.equal(
    compareValues({ a: 1, b: 1 }, { a: 2, b: 2 }, { maxChanges: 1 }).truncated,
    true,
  );
  assert.equal(
    compareValues("x".repeat(1001), "y").changes[0].before.truncated,
    true,
  );
  assert.equal(
    compareValues(undefined, { a: 1 }).changes[0].operation,
    "added",
  );
});
test("filtros: precedência, listas, case-insensitive e desconhecido sob NOT", () => {
  const device = {
    managedDeviceOwnerType: "company",
    manufacturer: "CONTOSO",
    osVersion: "11.0",
    deviceName: "NB-123",
  };
  for (const rule of [
    '(device.deviceOwnership -eq "Corporate")',
    'device.manufacturer -in ["Other", "Contoso"]',
    'device.deviceName -startsWith "nb-" -and -not (device.osVersion -eq "10")',
    'device.model -eq "Unknown" -or device.manufacturer -eq "Contoso"',
  ])
    assert.equal(evaluateFilter(rule, device).result, true, rule);
  assert.equal(
    evaluateFilter('device.model -ne "Laptop"', device).result,
    null,
  );
  assert.equal(
    evaluateFilter('-not (device.model -eq "Laptop")', device).result,
    null,
  );
  assert.equal(
    evaluateFilter(
      'device.manufacturer -eq "Other" -and device.model -eq "X"',
      device,
    ).result,
    false,
  );
  for (const rule of [
    'device.osVersion -ge "10"',
    'device.deviceName -match "(a+)+$"',
    'device.x -eq "1"; process.exit()',
    'device.manufacturer -eq "Contoso" trailing',
    "(".repeat(40) + 'device.manufacturer -eq "Contoso"' + ")".repeat(40),
  ])
    assert.equal(evaluateFilter(rule, device).result, null, rule);
});
function fixture() {
  const device = {
    key: "device:d",
    name: "Laptop",
    properties: {
      operatingSystem: "Windows",
      managedDeviceOwnerType: "company",
    },
  };
  const objects = [
    {
      key: "entra:obj",
      kind: "directoryDevice",
      properties: { deviceId: "registration" },
    },
    {
      key: "entra:g",
      kind: "group",
      name: "Devices",
      properties: { securityEnabled: true },
    },
    {
      key: "entra:excluded",
      kind: "group",
      properties: { securityEnabled: true },
    },
    { key: "entra:u", kind: "user", properties: {} },
    {
      key: "entra:users",
      kind: "group",
      properties: { securityEnabled: true },
    },
    {
      key: "intune:filters:f",
      kind: "assignmentFilter",
      properties: {
        rule: 'device.deviceOwnership -eq "Corporate"',
        platform: "windows10AndLater",
      },
    },
  ];
  const edges = [
    {
      from_key: device.key,
      to_key: "deviceId:registration",
      relation: "alias",
    },
    {
      from_key: "deviceId:registration",
      to_key: "entra:obj",
      relation: "alias",
    },
    { from_key: "entra:obj", to_key: "entra:g", relation: "member_of" },
    { from_key: "entra:u", to_key: "entra:users", relation: "member_of" },
  ];
  const assignment = (group, relation = "assigned_to", targetExtra = {}) => ({
    key: group + relation,
    to_key: "entra:" + group,
    relation,
    properties: {
      target: {
        "@odata.type":
          relation === "excluded_from"
            ? "#microsoft.graph.exclusionGroupAssignmentTarget"
            : "#microsoft.graph.groupAssignmentTarget",
        groupId: group,
        ...targetExtra,
      },
    },
  });
  return {
    devices: [device],
    objects,
    edges,
    assignments: [assignment("g")],
    complete: true,
    assignment,
  };
}
test("alcance: objectId e deviceId correlacionados, exclusões de dispositivo prevalecem", () => {
  const f = fixture();
  assert.equal(estimateReach(f)[0].outcome, "estimated_in_scope");
  f.assignments[0].properties.target["@odata.type"] =
    "microsoft.graph.groupAssignmentTarget";
  assert.equal(estimateReach(f)[0].outcome, "estimated_in_scope");
  f.edges.push({
    from_key: "entra:obj",
    to_key: "entra:excluded",
    relation: "member_of",
  });
  f.assignments.push(f.assignment("excluded", "excluded_from"));
  assert.equal(estimateReach(f)[0].outcome, "estimated_excluded");
  f.edges = f.edges.filter((e) => e.relation !== "alias");
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
});
test("alcance não transforma usuário em dispositivo e não aplica exclusão cruzada", () => {
  const f = fixture();
  f.assignments.push(f.assignment("users", "excluded_from"));
  assert.equal(estimateReach(f)[0].outcome, "estimated_in_scope");
  f.assignments = [f.assignment("users")];
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
  f.assignments = [
    {
      key: "all",
      to_key: "intune-target:allLicensedUsersAssignmentTarget",
      relation: "assigned_to",
      properties: {
        target: {
          "@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget",
        },
      },
    },
  ];
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
  f.edges.push({
    from_key: "entra:u",
    to_key: "entra:g",
    relation: "member_of",
  });
  f.assignments = [f.assignment("g")];
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
});
test("alcance: filtro include/exclude, propriedade ausente, alvo desconhecido e coleta parcial", () => {
  const f = fixture();
  f.assignments = [
    f.assignment("g", "assigned_to", {
      deviceAndAppManagementAssignmentFilterId: "f",
      deviceAndAppManagementAssignmentFilterType: "include",
    }),
  ];
  assert.equal(estimateReach(f)[0].outcome, "estimated_in_scope");
  f.assignments[0].properties.target.deviceAndAppManagementAssignmentFilterType =
    "exclude";
  assert.equal(estimateReach(f)[0].outcome, "not_observed_in_scope");
  delete f.devices[0].properties.managedDeviceOwnerType;
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
  f.assignments = [f.assignment("g")];
  f.assignments[0].properties.target["@odata.type"] =
    "#microsoft.graph.scopeTagGroupAssignmentTarget";
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
  f.assignments = [f.assignment("g")];
  f.complete = false;
  assert.equal(estimateReach(f)[0].outcome, "indeterminate");
});
test("grupos aninhados e ciclos permanecem limitados e explicáveis", () => {
  const f = fixture();
  f.objects.push({
    key: "entra:parent",
    kind: "group",
    properties: {
      securityEnabled: true,
      membershipRule: 'device.deviceOSType -eq "Windows"',
    },
  });
  f.edges.push(
    { from_key: "entra:g", to_key: "entra:parent", relation: "member_of" },
    { from_key: "entra:parent", to_key: "entra:g", relation: "member_of" },
  );
  f.assignments = [f.assignment("parent")];
  const result = estimateReach(f)[0];
  assert.equal(result.outcome, "estimated_in_scope");
  assert.ok(result.reasons.some((r) => r.includes("dinâmico")));
});
test("diagnóstico separa configuração, simulação, coleta antiga, acesso e retenção", () => {
  const base = {
    id: "x",
    enabled: true,
    status: "success",
    last_success: new Date().toISOString(),
    permission: "Read.All",
    detail: {},
  };
  assert.equal(diagnoseSource(base, { mode: "microsoft" }).state, "observed");
  assert.equal(diagnoseSource(base, { mode: "demo" }).state, "simulated");
  assert.equal(
    diagnoseSource(
      { ...base, detail: { fixture: true } },
      { mode: "microsoft" },
    ).state,
    "simulated",
  );
  assert.equal(
    diagnoseSource(
      { ...base, last_success: "2000-01-01T00:00:00Z" },
      { mode: "microsoft" },
    ).state,
    "stale",
  );
  assert.equal(
    diagnoseSource({ ...base, status: "forbidden" }, { mode: "microsoft" })
      .state,
    "blocked",
  );
  assert.equal(
    diagnoseSource({ ...base, status: "gap" }, { mode: "microsoft" }).state,
    "gap",
  );
  assert.equal(
    diagnoseSource(
      { ...base, status: "never", last_success: null },
      { mode: "microsoft" },
    ).state,
    "unverified",
  );
  assert.equal(
    diagnoseSource({ ...base, enabled: false }, { mode: "microsoft" }).state,
    "disabled",
  );
});

test("HTTP: histórico, alcance, relatórios, isolamento, RBAC/CSRF e coletas de diagnóstico", async () => {
  const config = loadConfig({
      APP_MODE: "demo",
      SESSION_SECRET: "s".repeat(50),
    }),
    pool = await database(config, { memory: true });
  let server;
  try {
    await migrate(pool);
    await seedDemo(pool);
    const app = createApp(config, pool);
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    config.origin = "http://127.0.0.1:" + server.address().port;
    async function request(
      path,
      { cookie = "", csrf = "", method = "GET", body } = {},
    ) {
      const response = await fetch(config.origin + path, {
        method,
        headers: {
          Origin: config.origin,
          Cookie: cookie,
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0],
      };
    }
    async function login(tenant, role = "Atlas.Admin") {
      const r = await request("/api/demo/session", {
        method: "POST",
        body: { tenant, role },
      });
      const me = await request("/api/me", { cookie: r.cookie });
      return { cookie: r.cookie, csrf: me.body.csrf };
    }
    const a = await login(DEMO_TENANTS[0].id),
      b = await login(DEMO_TENANTS[1].id),
      reader = await login(DEMO_TENANTS[0].id, "Atlas.Reader"),
      key = "intune:catalog:catalog-001";
    assert.equal((await request("/api/diagnostics")).status, 401);
    let result = await request(
      "/api/resource/history?" + new URLSearchParams({ key, limit: 1 }),
      a,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.items.length, 1);
    assert.equal(result.body.hasMore, true);
    assert.equal(result.body.items[0].actor, null);
    assert.ok(
      result.body.items[0].changes.some((c) => c.path === "/settingCount"),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM resource_versions WHERE tenant_id=$1 AND resource_key=$2",
          [DEMO_TENANTS[0].id, key],
        )
      ).rows[0].n,
      2,
    );
    const evidenceId = result.body.items[0].evidenceId;
    assert.ok(result.body.items[0].beforeEvidenceId);
    assert.notEqual(result.body.items[0].beforeEvidenceId, evidenceId);
    assert.equal(
      (
        await request(
          "/api/evidence/" + result.body.items[0].beforeEvidenceId,
          b,
        )
      ).status,
      404,
    );
    assert.equal((await request("/api/evidence/" + evidenceId, b)).status, 404);
    assert.equal(
      (
        await request(
          "/api/resource/history?key=" +
            encodeURIComponent(key) +
            "&offset=1&limit=1",
          reader,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/api/resource/history?key=" + encodeURIComponent(key) + "&limit=21",
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (await request("/api/resource/history?key=unknown", a)).status,
      404,
    );
    result = await request(
      "/api/intune/reach?key=" + encodeURIComponent(key),
      a,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.complete, true);
    assert.equal(result.body.items.length, 4);
    const outcomes = new Set(result.body.items.map((x) => x.outcome));
    assert.ok(outcomes.has("estimated_in_scope"));
    assert.ok(outcomes.has("estimated_excluded"));
    assert.ok(outcomes.has("indeterminate"));
    const conf = await request(
      "/api/intune/reach?key=intune-policy:config-01&limit=1",
      a,
    );
    assert.equal(conf.body.reports.length, 1);
    assert.equal(conf.body.reportsHasMore, true);
    const next = await request(
      "/api/intune/reach?key=intune-policy:config-01&limit=1&reportOffset=1",
      a,
    );
    assert.notEqual(next.body.reports[0].key, conf.body.reports[0].key);
    assert.equal(next.body.items[0].key, conf.body.items[0].key);
    await pool.query(
      "UPDATE coverage SET last_success='2000-01-01' WHERE tenant_id=$1 AND source='entra.memberships'",
      [DEMO_TENANTS[0].id],
    );
    const stale = await request(
      "/api/intune/reach?key=" + encodeURIComponent(key),
      a,
    );
    assert.equal(stale.body.complete, false);
    assert.ok(stale.body.items.every((d) => d.outcome === "indeterminate"));
    assert.equal(
      (await request("/api/intune/reach?key=" + encodeURIComponent(key), b))
        .body.complete,
      true,
    );
    const diagnostics = await request("/api/diagnostics", a);
    assert.ok(
      diagnostics.body.services
        .flatMap((s) => s.sources)
        .some((s) => s.state === "simulated"),
    );
    assert.equal(diagnostics.body.configuration.collectorConfigured, false);
    assert.equal(
      (
        await request("/api/diagnostics/probe", {
          ...reader,
          method: "POST",
          body: { service: "Azure" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/diagnostics/probe", {
          ...a,
          csrf: "bad",
          method: "POST",
          body: { service: "Azure" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/diagnostics/probe", {
          ...a,
          method: "POST",
          body: { service: "Azure" },
        })
      ).status,
      409,
    );
    // Only the HTTP queue branch is switched for this test; no worker/provider
    // is started and no Microsoft request can be made.
    config.mode = "microsoft";
    config.collectorClientId = "fixture-id";
    config.collectorClientSecret = "SECRET_NEVER_RETURNED";
    assert.equal((await request("/api/diagnostics")).status, 401);
    assert.ok(
      !JSON.stringify((await request("/api/diagnostics", a)).body).includes(
        "SECRET_NEVER_RETURNED",
      ),
    );
    result = await request("/api/diagnostics/probe", {
      ...a,
      method: "POST",
      body: { service: "Azure" },
    });
    assert.equal(result.status, 202);
    assert.equal(result.body.jobs[0].source, "azure.subscriptions");
    assert.equal(result.body.jobs[0].queued, true);
    assert.equal(
      (
        await request("/api/diagnostics/probe", {
          ...a,
          method: "POST",
          body: { service: "Azure", tenantId: DEMO_TENANTS[1].id },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/diagnostics/probe", {
          ...a,
          method: "POST",
          body: { service: "Unknown" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM runs WHERE tenant_id=$1 AND status='queued'",
          [DEMO_TENANTS[1].id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal((await verifyLedger(pool, DEMO_TENANTS[0].id)).valid, true);
    await assert.rejects(
      resourceHistory(pool, DEMO_TENANTS[1].id, "entra:missing"),
      /RESOURCE_NOT_FOUND/,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
