import { hash } from "./security.js";
import { sourceById } from "./sources.js";
import { intuneKey } from "./intune-sources.js";
export const entraKey = (id) => "entra:" + String(id).toLowerCase();
export const armKey = (id) =>
  "azure:" + String(id).toLowerCase().replace(/\/$/, "");
const timestamp = (v) => {
  if (!v) return null;
  const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(String(v)) ? v : String(v) + "Z");
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
export function normalize(source, raw, context = {}) {
  const resources = [],
    edges = [],
    events = [],
    id = String(raw.id || raw.Id || raw.eventDataId || hash(raw)),
    ref = context.parent;
  const resource = (key, name, kind, service, properties = raw, extra = {}) =>
    resources.push({
      key,
      nativeId: id,
      name: String(name || id),
      kind,
      service,
      properties,
      parentKey: null,
      createdAt: null,
      createdBy: null,
      ...extra,
    });
  const edge = (from, to, relation, role, properties = raw, scope = null) =>
    edges.push({
      key: hash([source, from, to, relation, role, id]),
      from,
      to,
      relation,
      role,
      properties,
      scope,
    });
  const event = (d) =>
    events.push({
      nativeId: id,
      occurredAt: null,
      actorKey: null,
      actorName: null,
      targetKey: null,
      targetName: null,
      category: "change",
      severity: "info",
      properties: raw,
      ...d,
    });
  const definition = sourceById(source);
  if (definition?.assignment) {
    const target = raw.target || {},
      type = String(target["@odata.type"] || "unknown"),
      group = target.groupId || target.entraObjectId,
      to = group
        ? entraKey(group)
        : "intune-target:" + type.replace("#microsoft.graph.", "");
    edge(
      intuneKey(definition.family, ref),
      to,
      /exclusion/i.test(type) ? "excluded_from" : "assigned_to",
      raw.intent || type.replace("#microsoft.graph.", ""),
      raw,
    );
    if (target.deviceAndAppManagementAssignmentFilterId)
      edge(
        intuneKey(definition.family, ref),
        intuneKey("filters", target.deviceAndAppManagementAssignmentFilterId),
        "assignment_filter",
        target.deviceAndAppManagementAssignmentFilterType,
        raw,
      );
  } else if (definition?.detail) {
    const parent = intuneKey(definition.family, ref);
    resource(
      parent + ":detail:" + (context.relation ? id : "configuration"),
      raw.displayName ||
        raw.name ||
        context.relation ||
        "Conteúdo e parâmetros",
      "intuneSetting",
      "Intune",
      raw,
      { parentKey: parent },
    );
  } else if (definition?.family) {
    resource(
      intuneKey(definition.family, id),
      raw.displayName || raw.name,
      /powershell|shell|remediations|attributes|scripts/i.test(
        definition.family,
      )
        ? "intuneScript"
        : definition.family === "filters"
          ? "assignmentFilter"
          : "devicePolicy",
      "Intune",
      raw,
      { createdAt: timestamp(raw.createdDateTime) },
    );
  } else if (source === "entra.licenseDetails") {
    resource(
      "user-license:" + ref + ":" + raw.skuId,
      raw.skuPartNumber,
      "userLicense",
      "Microsoft 365",
      raw,
      { parentKey: entraKey(ref) },
    );
  } else if (source === "entra.devices") {
    resource(entraKey(id), raw.displayName, "directoryDevice", "Entra ID");
    if (raw.deviceId)
      edge(
        "deviceId:" + raw.deviceId.toLowerCase(),
        entraKey(id),
        "alias",
        "deviceId",
        { deviceId: raw.deviceId },
      );
  } else if (source === "azure.subscriptions") {
    resource(
      armKey(raw.id || "/subscriptions/" + raw.subscriptionId),
      raw.displayName,
      "subscription",
      "Azure",
    );
  } else if (source === "azure.configurations") {
    resource(
      armKey(id) + ":configuration",
      raw.name || id,
      "azureConfiguration",
      "Azure",
      raw,
      { parentKey: armKey(id) },
    );
  } else if (source === "azure.costs") {
    resource(
      "cost:" + id,
      raw.resourceId || "Cobrança sem ResourceId",
      "costLine",
      "Azure Costs",
      raw,
      {
        parentKey: raw.resourceId
          ? armKey(raw.resourceId)
          : armKey("/subscriptions/" + raw.subscriptionId),
      },
    );
  } else if (source === "entra.users") {
    resource(entraKey(id), raw.displayName, "user", "Entra ID", raw, {
      createdAt: timestamp(raw.createdDateTime),
    });
    if (raw.userPrincipalName)
      edge(
        entraKey(id),
        "upn:" + raw.userPrincipalName.toLowerCase(),
        "alias",
        "UPN",
        { userPrincipalName: raw.userPrincipalName },
      );
    for (const lic of raw.assignedLicenses || [])
      edge(
        entraKey(id),
        "license:" + lic.skuId,
        "licensed_for",
        lic.skuId,
        lic,
      );
  } else if (source === "entra.groups") {
    resource(entraKey(id), raw.displayName, "group", "Entra ID", raw, {
      createdAt: timestamp(raw.createdDateTime),
    });
    for (const lic of raw.assignedLicenses || [])
      edge(
        entraKey(id),
        "license:" + lic.skuId,
        "licensed_for",
        lic.skuId,
        lic,
      );
  } else if (source === "entra.memberships") {
    const member =
      raw["@odata.type"] === "#microsoft.graph.servicePrincipal"
        ? entraKey(id)
        : entraKey(id);
    edge(
      member,
      entraKey(ref),
      context.relation === "owners" ? "owns" : "member_of",
      context.relation,
    );
  } else if (source === "entra.applications")
    resource(
      "application:" + id,
      raw.displayName,
      "application",
      "Entra ID",
      raw,
      { createdAt: timestamp(raw.createdDateTime) },
    );
  else if (source === "entra.servicePrincipals") {
    resource(entraKey(id), raw.displayName, "servicePrincipal", "Entra ID");
    if (raw.appId)
      edge(entraKey(id), "appId:" + raw.appId, "alias", "appId", {
        appId: raw.appId,
      });
  } else if (source === "entra.appPermissions") {
    if (context.relation === "owners")
      edge(entraKey(id), entraKey(ref), "owns", "owner");
    else
      edge(
        entraKey(raw.principalId || ref),
        entraKey(raw.resourceId),
        "app_permission",
        raw.appRoleId,
        raw,
      );
  } else if (source === "entra.consents")
    edge(
      entraKey(raw.clientId),
      entraKey(raw.resourceId),
      "delegated_consent",
      raw.scope,
      raw,
    );
  else if (source === "entra.roles")
    resource("role:" + id, raw.displayName, "directoryRole", "Entra ID");
  else if (source === "entra.roleAssignments")
    edge(
      entraKey(raw.principalId),
      "role:" + raw.roleDefinitionId,
      "directory_role",
      raw.roleDefinitionId,
      raw,
      raw.directoryScopeId,
    );
  else if (source === "entra.conditionalAccess")
    resource(
      "policy:" + id,
      raw.displayName,
      "conditionalAccess",
      "Entra ID",
      raw,
      { createdAt: timestamp(raw.createdDateTime) },
    );
  else if (source === "entra.organization")
    resource("organization:" + id, raw.displayName, "organization", "Entra ID");
  else if (source === "m365.licenses") {
    resource(
      "license:" + raw.skuId,
      raw.skuPartNumber,
      "license",
      "Microsoft 365",
      raw,
    );
  } else if (source === "intune.devices") {
    resource("device:" + id, raw.deviceName, "device", "Intune", raw, {
      createdAt: timestamp(raw.enrolledDateTime),
    });
    if (raw.azureADDeviceId)
      edge(
        "device:" + id,
        "deviceId:" + raw.azureADDeviceId.toLowerCase(),
        "alias",
        "Entra deviceId",
        { deviceId: raw.azureADDeviceId },
      );
    if (raw.userId)
      edge(
        "device:" + id,
        entraKey(raw.userId),
        "primary_user",
        "Usuário principal",
      );
  } else if (
    source === "intune.compliance" ||
    source === "intune.configuration"
  )
    resource(
      "intune-policy:" + id,
      raw.displayName,
      "devicePolicy",
      "Intune",
      raw,
      { createdAt: timestamp(raw.createdDateTime) },
    );
  else if (source === "intune.apps")
    resource("intune-app:" + id, raw.displayName, "managedApp", "Intune", raw, {
      createdAt: timestamp(raw.createdDateTime),
    });
  else if (source === "sharepoint.sites")
    resource(
      "site:" + id,
      raw.displayName || raw.webUrl,
      "site",
      "SharePoint",
      raw,
      { createdAt: timestamp(raw.createdDateTime) },
    );
  else if (source === "sharepoint.appGrants") {
    for (const identity of [
      ...(raw.grantedToIdentitiesV2 || raw.grantedToIdentities || []),
      raw.grantedToV2 || raw.grantedTo || {},
    ])
      if (identity.application?.id)
        edge(
          "appId:" + identity.application.id,
          "site:" + ref,
          "site_app_grant",
          (raw.roles || []).join(","),
          raw,
        );
  } else if (source === "teams.teams")
    resource("team:" + id, raw.displayName, "team", "Teams", raw, {
      createdAt: timestamp(raw.createdDateTime),
    });
  else if (source === "teams.members")
    edge(
      entraKey(raw.userId || id),
      "team:" + ref,
      "team_member",
      (raw.roles || ["member"]).join(","),
      raw,
    );
  else if (source === "azure.resources") {
    const key = armKey(id),
      sd = raw.systemData || {},
      subscription = /^\/subscriptions\/[^/]+\/?$/i.test(id);
    resource(
      key,
      raw.name,
      subscription ? "subscription" : raw.type || "azureResource",
      "Azure",
      raw,
      {
        parentKey: subscription
          ? null
          : raw.resourceGroup
            ? armKey(
                `/subscriptions/${raw.subscriptionId}/resourceGroups/${raw.resourceGroup}`,
              )
            : armKey(`/subscriptions/${raw.subscriptionId}`),
        createdAt: timestamp(sd.createdAt),
        createdBy: sd.createdBy || null,
      },
    );
  } else if (source === "azure.rbac") {
    if ((raw.type || "").toLowerCase().endsWith("/roledefinitions"))
      resource(armKey(id), raw.properties?.roleName, "azureRole", "Azure");
    else if ((raw.type || "").toLowerCase().endsWith("/roleassignments")) {
      const p = raw.properties || {};
      edge(
        entraKey(p.principalId),
        armKey(p.scope || id.split("/providers/Microsoft.Authorization/")[0]),
        "azure_role",
        p.roleDefinitionId,
        p,
        p.scope,
      );
    } else resource(armKey(id), raw.name, raw.type || "authorization", "Azure");
  } else if (source === "entra.audit") {
    const actor = raw.initiatedBy?.user || raw.initiatedBy?.app || {};
    event({
      operation: raw.activityDisplayName,
      occurredAt: timestamp(raw.activityDateTime),
      actorKey: actor.id ? entraKey(actor.id) : null,
      actorName: actor.userPrincipalName || actor.displayName || null,
      targetKey: raw.targetResources?.[0]?.id
        ? entraKey(raw.targetResources[0].id)
        : null,
      targetName: raw.targetResources
        ?.map((x) => x.displayName || x.id)
        .join(", "),
      outcome: raw.result,
      correlationId: raw.correlationId,
    });
  } else if (source === "entra.signins")
    event({
      operation:
        "Autenticação · " + (raw.appDisplayName || raw.appId || "aplicação"),
      category: "access",
      occurredAt: timestamp(raw.createdDateTime),
      actorKey: raw.userId ? entraKey(raw.userId) : null,
      actorName: raw.userPrincipalName || raw.userDisplayName,
      targetKey: raw.servicePrincipalId
        ? entraKey(raw.servicePrincipalId)
        : null,
      targetName: raw.resourceDisplayName || raw.appDisplayName,
      outcome: raw.status?.errorCode === 0 ? "success" : "failure",
      severity: raw.status?.errorCode === 0 ? "info" : "medium",
      correlationId: raw.correlationId,
    });
  else if (source === "intune.audit")
    event({
      operation: raw.displayName || raw.activity,
      occurredAt: timestamp(raw.activityDateTime),
      actorKey: raw.actor?.userId ? entraKey(raw.actor.userId) : null,
      actorName:
        raw.actor?.userPrincipalName || raw.actor?.applicationDisplayName,
      targetKey: raw.resources?.[0]?.resourceId
        ? "device:" + raw.resources[0].resourceId
        : null,
      targetName: raw.resources?.[0]?.displayName,
      outcome: raw.activityResult,
      correlationId: raw.correlationId,
    });
  else if (source === "azure.activity")
    event({
      nativeId: String(raw.eventDataId || id),
      operation:
        raw.operationName?.localizedValue ||
        raw.operationName?.value ||
        "Operação Azure",
      occurredAt: timestamp(raw.eventTimestamp),
      actorKey: raw.claims?.[
        "http://schemas.microsoft.com/identity/claims/objectidentifier"
      ]
        ? entraKey(
            raw.claims[
              "http://schemas.microsoft.com/identity/claims/objectidentifier"
            ],
          )
        : null,
      actorName: raw.caller || null,
      targetKey: raw.resourceId ? armKey(raw.resourceId) : null,
      targetName: raw.resourceId,
      outcome: raw.status?.value,
      correlationId: raw.correlationId,
    });
  else if (source === "azure.dataAccess")
    event({
      nativeId: hash(raw),
      operation: raw.OperationName || raw.OperationName_s || "Acesso a recurso",
      category: "data_access",
      occurredAt: timestamp(raw.TimeGenerated),
      actorName:
        raw.CallerIpAddress || raw.CallerIPAddress || raw.Identity || null,
      targetKey: raw._ResourceId
        ? armKey(raw._ResourceId)
        : raw.ResourceId
          ? armKey(raw.ResourceId)
          : null,
      targetName: raw.Uri || raw.RequestUri || raw.Resource,
      outcome: String(raw.StatusCode || raw.ResultType || ""),
      properties: {
        ...raw,
        actorAttribution:
          "IP/identidade conforme tabela; não presume pessoa identificada",
      },
    });
  else if (source.startsWith("audit."))
    event({
      nativeId: String(raw.Id || id),
      operation: raw.Operation || "Atividade Microsoft 365",
      category: /Access|Login|Downloaded|Viewed|Read|Bind/i.test(
        raw.Operation || "",
      )
        ? "access"
        : "change",
      occurredAt: timestamp(raw.CreationTime),
      actorKey:
        raw.UserId && /^[a-f0-9-]{36}$/i.test(raw.UserId)
          ? entraKey(raw.UserId)
          : null,
      actorName: raw.UserId || null,
      targetKey: raw.ObjectId ? String(raw.ObjectId) : null,
      targetName: raw.ObjectId || raw.SiteUrl || raw.OfficeObjectId || null,
      outcome: raw.ResultStatus,
      correlationId: raw.CorrelationId,
    });
  else if (source.startsWith("bridge.")) {
    if (raw.recordType === "permission")
      edge(
        raw.principalKey,
        raw.resourceKey,
        raw.relation || "delegated_access",
        raw.role,
        raw,
        raw.scope,
      );
    else if (raw.recordType === "event")
      event({
        nativeId: id,
        operation: raw.operation,
        category: raw.category || "change",
        occurredAt: timestamp(raw.occurredAt),
        actorName: raw.actorName,
        targetKey: raw.resourceKey,
        targetName: raw.resourceName,
        properties: { ...raw, trust: "collector_asserted" },
      });
    else
      resource(
        raw.key,
        raw.name,
        raw.kind,
        source === "bridge.exchange" ? "Exchange Online" : "SharePoint",
        { ...raw, trust: "collector_asserted" },
        {
          createdAt: timestamp(raw.createdAt),
          createdBy: raw.createdBy || null,
          parentKey: raw.parentKey || null,
        },
      );
  }
  return { resources, edges, events };
}
export function semanticResource(r) {
  const copy = structuredClone(r);
  for (const k of [
    "lastSyncDateTime",
    "lastModifiedDateTime",
    "lastSuccessfulSyncDateTime",
    "lastSignInDateTime",
    "observedAt",
    "capturedAt",
  ])
    delete copy.properties[k];
  return copy;
}
