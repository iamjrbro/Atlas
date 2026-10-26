import { AppError } from "./security.js";
import { sourceById } from "./sources.js";
import { evaluateFilter, and, or } from "./intune-filter.js";

export function estimateReach({
  devices,
  objects,
  edges,
  assignments,
  complete = false,
}) {
  const byKey = new Map(objects.map((r) => [r.key, r])),
    adjacency = new Map(),
    members = new Map(),
    closures = new Map(),
    audiences = new Map();
  for (const e of edges) {
    if (["member_of", "alias"].includes(e.relation)) {
      if (!adjacency.has(e.from_key)) adjacency.set(e.from_key, []);
      adjacency.get(e.from_key).push(e.to_key);
    }
    if (e.relation === "member_of") {
      if (!members.has(e.to_key)) members.set(e.to_key, []);
      members.get(e.to_key).push(e);
    }
  }
  function closure(key) {
    if (closures.has(key)) return closures.get(key);
    const nodes = new Set([key]),
      queue = [[key, 0]];
    let limited = false;
    for (let at = 0; at < queue.length; at++) {
      const [node, depth] = queue[at],
        next = adjacency.get(node) || [];
      if (depth >= 8 || nodes.size >= 5000) {
        if (next.some((x) => !nodes.has(x))) limited = true;
        continue;
      }
      for (const child of next)
        if (!nodes.has(child)) {
          nodes.add(child);
          queue.push([child, depth + 1]);
        }
    }
    const result = { nodes, limited };
    closures.set(key, result);
    return result;
  }
  function audience(key) {
    if (audiences.has(key)) return audiences.get(key);
    const seen = new Set(),
      queue = [[key, 0]],
      types = new Set();
    for (let i = 0; i < queue.length; i++) {
      const [group, depth] = queue[i];
      if (seen.has(group)) continue;
      seen.add(group);
      if (depth > 8 || seen.size > 5000) {
        types.add("unknown");
        break;
      }
      for (const e of members.get(group) || []) {
        const obj = byKey.get(e.from_key),
          type =
            obj?.kind ||
            String(e.properties?.["@odata.type"] || "")
              .split(".")
              .at(-1);
        if (type === "group") queue.push([e.from_key, depth + 1]);
        else
          types.add(
            type === "user"
              ? "user"
              : ["device", "directoryDevice"].includes(type)
                ? "device"
                : "unknown",
          );
      }
    }
    const result = types.size > 1 ? "mixed" : [...types][0] || "empty";
    audiences.set(key, result);
    return result;
  }
  return devices.map((device) => {
    const props = device.properties || {},
      path = closure(device.key),
      identityKnown =
        [...path.nodes].filter((k) => byKey.get(k)?.kind === "directoryDevice")
          .length === 1;
    const reasons = [];
    function evaluateAssignment(a) {
      const target = a.properties?.target || {},
        group = target.groupId || target.entraObjectId;
      let result = null,
        scope = "unknown",
        reason;
      const targetType = String(target["@odata.type"] || "")
        .replace(/^#?microsoft\.graph\./i, "")
        .toLowerCase();
      if (group && typeof group !== "string")
        reason = "Identificador de grupo inválido na atribuição observada.";
      else if (
        group &&
        !["groupassignmenttarget", "exclusiongroupassignmenttarget"].includes(
          targetType,
        )
      )
        reason =
          "Tipo de destino de grupo não suportado; não presume associação de grupo.";
      else if (group) {
        const key = "entra:" + group.toLowerCase(),
          object = byKey.get(key),
          kind = audience(key);
        scope = kind;
        if (
          !object ||
          object.properties?.securityEnabled === false ||
          ["mixed", "unknown"].includes(kind)
        )
          reason =
            "Grupo ausente, misto ou não suportado; confira a atribuição no Intune.";
        else if (kind === "user")
          reason =
            "Atribuição por usuário depende do contexto de entrada; não é convertida em associação de dispositivo.";
        else {
          scope = "device";
          result =
            identityKnown && path.nodes.has(key)
              ? true
              : complete && identityKnown && !path.limited
                ? false
                : null;
          reason =
            result === true
              ? "Dispositivo ligado ao grupo por associações observadas."
              : result === false
                ? "Sem associação observada no snapshot completo."
                : "Associações ou identidade do dispositivo incompletas.";
        }
        if (object?.properties?.membershipRule)
          reasons.push(
            "Grupo dinâmico: usa membros observados; a regra não foi recalculada localmente.",
          );
      } else if (targetType === "alldevicesassignmenttarget") {
        result = true;
        scope = "device";
        reason =
          "Alvo configurado: todos os dispositivos gerenciados observados.";
      } else if (targetType === "alllicensedusersassignmenttarget") {
        scope = "user";
        reason =
          "Todos os usuários: aplicabilidade depende do contexto do usuário e da licença.";
      } else reason = "Tipo de destino não suportado pelo avaliador local.";
      const filterId = target.deviceAndAppManagementAssignmentFilterId,
        mode = target.deviceAndAppManagementAssignmentFilterType;
      if (filterId && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(filterId)) {
        const filter = byKey.get("intune:filters:" + filterId);
        const platform = String(
            filter?.properties?.platform || "",
          ).toLowerCase(),
          os = String(props.operatingSystem || "").toLowerCase();
        const family = ["windows", "macos", "ios", "android"].find((p) =>
          platform.startsWith(p),
        );
        const evaluated =
          family && !os.startsWith(family)
            ? {
                result: null,
                reason:
                  "Plataforma do filtro incompatível ou ausente; avaliação requer Intune.",
              }
            : evaluateFilter(filter?.properties?.rule, props);
        if (
          a.relation === "excluded_from" ||
          !["include", "exclude"].includes(mode) ||
          filter?.properties?.assignmentFilterManagementType === "apps"
        ) {
          result = and(result, null);
          reason += " Filtro incompatível ou modalidade desconhecida.";
        } else {
          const v =
            mode === "exclude" && evaluated.result !== null
              ? !evaluated.result
              : evaluated.result;
          result = and(result, v);
          reason += " " + evaluated.reason;
        }
      } else if (mode && !["none", "notConfigured"].includes(mode)) {
        result = and(result, null);
        reason += " Filtro declarado sem definição disponível.";
      }
      return {
        assignmentId: a.key,
        target: a.to_key,
        targetName: byKey.get(a.to_key)?.name || a.to_key,
        relation: a.relation,
        intent: a.properties?.intent || null,
        scope,
        result,
        reason,
        evidenceId: a.evidence_id,
      };
    }
    const paths = assignments.map(evaluateAssignment),
      exclusions = paths.filter((p) => p.relation === "excluded_from"),
      includes = paths.filter((p) => p.relation === "assigned_to");
    let included = false,
      beforeExclusions = false;
    for (const p of includes) {
      beforeExclusions = or(beforeExclusions, p.result);
      let value = p.result;
      if (p.scope === "device")
        for (const e of exclusions) {
          // User exclusions never subtract a device assignment.
          if (e.scope === "user") {
            reasons.push(
              "Exclusão de usuários não remove atribuição direcionada a dispositivos.",
            );
            continue;
          }
          const denied = e.result === null ? null : !e.result;
          value = and(value, denied);
        }
      included = or(included, value);
    }
    if (!complete) {
      reasons.push(
        "Fontes necessárias incompletas ou antigas; não há base suficiente para concluir o escopo.",
      );
      included = null;
    }
    const outcome =
      included === null
        ? "indeterminate"
        : included
          ? "estimated_in_scope"
          : beforeExclusions === true
            ? "estimated_excluded"
            : "not_observed_in_scope";
    return {
      key: device.key,
      name: device.name,
      lastSeen: device.last_seen,
      lastSync: props.lastSyncDateTime || null,
      outcome,
      paths,
      reasons: [...new Set(reasons)],
      deployment: "not_verified",
    };
  });
}

export async function policyReach(
  pool,
  tenant,
  key,
  { limit = 50, offset = 0, q = "", reportOffset = 0 } = {},
) {
  const policy = (
    await pool.query(
      "SELECT key,name,kind,source FROM resources WHERE tenant_id=$1 AND key=$2 AND active",
      [tenant, key],
    )
  ).rows[0];
  if (!policy) throw new AppError(404, "RESOURCE_NOT_FOUND");
  if (
    !["devicePolicy", "intuneScript", "managedApp"].includes(policy.kind) ||
    !sourceById(policy.source)?.id.startsWith("intune.")
  )
    throw new AppError(400, "NOT_INTUNE_POLICY");
  const assignmentSource = policy.source + ".assignments";
  if (!sourceById(assignmentSource))
    throw new AppError(
      409,
      "ASSIGNMENTS_NOT_SUPPORTED",
      "Este objeto não possui fonte própria de atribuições. Consulte a política que referencia o script.",
    );
  const coverage = (
    await pool.query(
      "SELECT source,status,last_success,last_attempt,detail FROM coverage WHERE tenant_id=$1 AND source=ANY($2::text[])",
      [
        tenant,
        [
          assignmentSource,
          "entra.memberships",
          "entra.groups",
          "entra.devices",
          "intune.devices",
          "intune.filters",
        ],
      ],
    )
  ).rows;
  const required = [
      assignmentSource,
      "entra.memberships",
      "entra.groups",
      "entra.devices",
      "intune.devices",
    ],
    fresh = (s) =>
      s?.status === "success" &&
      new Date(s.last_success).getTime() > Date.now() - 86400000;
  const graph = (
    await pool.query(
      "SELECT from_key,to_key,relation,properties FROM edges WHERE tenant_id=$1 AND active AND relation IN ('member_of','alias') ORDER BY key LIMIT 50001",
      [tenant],
    )
  ).rows;
  const objects = (
    await pool.query(
      "SELECT key,name,kind,properties FROM resources WHERE tenant_id=$1 AND active AND kind IN ('group','user','directoryDevice','assignmentFilter') ORDER BY key LIMIT 50001",
      [tenant],
    )
  ).rows;
  const assignments = (
    await pool.query(
      "SELECT * FROM edges WHERE tenant_id=$1 AND from_key=$2 AND source=$3 AND active AND relation IN ('assigned_to','excluded_from') ORDER BY key LIMIT 501",
      [tenant, key, assignmentSource],
    )
  ).rows;
  const devices = (
    await pool.query(
      "SELECT key,name,properties,last_seen FROM resources WHERE tenant_id=$1 AND active AND source='intune.devices' AND kind='device' AND (name ILIKE $2 OR key ILIKE $2) ORDER BY name,key LIMIT $3 OFFSET $4",
      [tenant, "%" + q + "%", limit + 1, offset],
    )
  ).rows;
  const limited =
    graph.length > 50000 || objects.length > 50000 || assignments.length > 500;
  if (
    assignments.some(
      (a) =>
        a.properties?.target?.deviceAndAppManagementAssignmentFilterId &&
        !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(
          a.properties.target.deviceAndAppManagementAssignmentFilterId,
        ),
    )
  )
    required.push("intune.filters");
  const complete =
    !limited &&
    required.every((id) => fresh(coverage.find((s) => s.source === id)));
  const reportSource = policy.source + ".deployment",
    reports = (
      await pool.query(
        "SELECT key,name,properties,last_seen,evidence_id FROM resources WHERE tenant_id=$1 AND parent_key=$2 AND active AND kind='intuneDeployment' ORDER BY name,key LIMIT $3 OFFSET $4",
        [tenant, key, limit + 1, reportOffset],
      )
    ).rows;
  const reportCoverage =
    (
      await pool.query(
        "SELECT status,last_success,detail FROM coverage WHERE tenant_id=$1 AND source=$2",
        [tenant, reportSource],
      )
    ).rows[0] || null;
  return {
    policy,
    offset,
    q,
    complete,
    limited,
    coverage: [
      ...coverage,
      ...required
        .filter((id) => !coverage.some((s) => s.source === id))
        .map((source) => ({
          source,
          status: "never",
          last_success: null,
          last_attempt: null,
          detail: {},
        })),
    ],
    assignments: assignments.slice(0, 500).map((a) => ({
      key: a.key,
      relation: a.relation,
      target: a.to_key,
      targetName: objects.find((o) => o.key === a.to_key)?.name || a.to_key,
      properties: a.properties,
      evidenceId: a.evidence_id,
    })),
    items: estimateReach({
      devices: devices.slice(0, limit),
      objects: objects.slice(0, 50000),
      edges: graph.slice(0, 50000),
      assignments: assignments.slice(0, 500),
      complete,
    }),
    hasMore: devices.length > limit,
    reports: reports.slice(0, limit),
    reportsOffset: reportOffset,
    reportsHasMore: reports.length > limit,
    reportCoverage,
    limitations: [
      "Estimativa local de escopo sobre snapshots; não executa regras de grupos dinâmicos, não comprova compatibilidade de plataforma, licença nem implantação.",
      "Atribuições por usuário não são convertidas em atribuições de dispositivo. Filtros usam um subconjunto seguro da sintaxe; o restante fica indeterminado.",
      "Relatórios abaixo são declarações da Microsoft, exibidas separadamente; nomes ou IDs de relatórios não são usados para presumir correlação com uma máquina.",
      "A visão é paginada. Limites do grafo, coleta parcial e fontes com mais de 24 horas são sinalizados. Conflitos de intent de aplicativos não são resolvidos localmente.",
    ],
  };
}
