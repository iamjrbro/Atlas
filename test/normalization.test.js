import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/normalize.js";
test("inventário não inventa criador e distingue createdAt de observação", () => {
  const r = normalize("entra.users", { id: "u", displayName: "Ana" })
    .resources[0];
  assert.equal(r.createdBy, null);
  assert.equal(r.createdAt, null);
  const az = normalize("azure.resources", {
    id: "/subscriptions/s/resourceGroups/g/providers/p/r",
    name: "R",
    systemData: {
      createdBy: "real@example.test",
      createdAt: "2026-01-01T12:01:02Z",
    },
  }).resources[0];
  assert.equal(az.createdBy, "real@example.test");
  assert.equal(az.createdAt, "2026-01-01T12:01:02.000Z");
});
test("auditoria normaliza ator, target, horário, resultado e correlação", () => {
  const r = normalize("entra.audit", {
    id: "e",
    activityDateTime: "2026-01-01T12:01:02Z",
    activityDisplayName: "Update group",
    initiatedBy: { user: { id: "u", userPrincipalName: "ana@example.test" } },
    targetResources: [{ id: "g", displayName: "G" }],
    result: "success",
    correlationId: "c",
  }).events[0];
  assert.equal(r.actorKey, "entra:u");
  assert.equal(r.targetKey, "entra:g");
  assert.equal(r.correlationId, "c");
  assert.equal(r.occurredAt, "2026-01-01T12:01:02.000Z");
});
test("membership, licença e RBAC preservam relações e condições", () => {
  const member = normalize(
    "entra.memberships",
    { id: "u" },
    { parent: "g", relation: "members" },
  ).edges[0];
  assert.equal(member.relation, "member_of");
  assert.equal(member.from, "entra:u");
  assert.equal(member.to, "entra:g");
  const lic = normalize("entra.users", {
    id: "u",
    assignedLicenses: [{ skuId: "sku" }],
  }).edges[0];
  assert.equal(lic.to, "license:sku");
  const role = normalize("azure.rbac", {
    id: "a",
    type: "microsoft.authorization/roleassignments",
    properties: {
      principalId: "g",
      roleDefinitionId: "r",
      scope: "/subscriptions/s",
      condition: "condition",
    },
  }).edges[0];
  assert.equal(role.properties.condition, "condition");
  assert.equal(role.scope, "/subscriptions/s");
});
test("SharePoint grants de aplicação não são apresentados como ACL completa de usuários", () => {
  const r = normalize(
    "sharepoint.appGrants",
    {
      id: "g",
      roles: ["read"],
      grantedToIdentitiesV2: [
        { application: { id: "app" } },
        { user: { id: "u" } },
      ],
    },
    { parent: "site" },
  );
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].relation, "site_app_grant");
  assert.equal(r.edges[0].from, "appId:app");
});
test("Microsoft 365 preserva segundos e actor desconhecido fica nulo", () => {
  const e = normalize("audit.exchange", {
    Id: "e",
    CreationTime: "2026-01-01T12:01:02",
    Operation: "Set-Mailbox",
    ObjectId: "financeiro@example.test",
  }).events[0];
  assert.equal(e.actorName, null);
  assert.equal(e.occurredAt, "2026-01-01T12:01:02.000Z");
});
