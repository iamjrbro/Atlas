import { transaction } from "./db.js";
import { hash, AppError, withinScope } from "./security.js";
import { normalize, semanticResource } from "./normalize.js";
import { SOURCES, defaultSources, sourceById } from "./sources.js";
export async function ledger(db, tenant, actor, action, target, details = {}) {
  await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenant]);
  const previous =
      (
        await db.query(
          "SELECT sha256 FROM audit_ledger WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1",
          [tenant],
        )
      ).rows[0]?.sha256 || "0".repeat(64),
    at = new Date().toISOString(),
    sha256 = hash({ tenant, at, actor, action, target, details, previous });
  await db.query(
    "INSERT INTO audit_ledger(tenant_id,at,actor,action,target,details,previous_hash,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      tenant,
      at,
      actor,
      action,
      target,
      JSON.stringify(details),
      previous,
      sha256,
    ],
  );
  return sha256;
}
export async function verifyLedger(pool, tenant) {
  const rows = (
    await pool.query(
      "SELECT * FROM audit_ledger WHERE tenant_id=$1 ORDER BY id",
      [tenant],
    )
  ).rows;
  let previous = "0".repeat(64);
  for (const r of rows) {
    const expected = hash({
      tenant,
      at: new Date(r.at).toISOString(),
      actor: r.actor,
      action: r.action,
      target: r.target,
      details: r.details,
      previous,
    });
    if (r.previous_hash !== previous || r.sha256 !== expected)
      return { valid: false, checked: rows.length, firstInvalid: r.id };
    previous = r.sha256;
  }
  return {
    valid: true,
    checked: rows.length,
    head: previous,
    limitation:
      "A cadeia exige uma âncora externa para detectar substituição integral ou truncamento do final por administrador do banco.",
  };
}
export async function ensureTenant(pool, id, name, { enabled = true } = {}) {
  await pool.query(
    "INSERT INTO tenants(id,name,enabled,settings) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
    [
      id,
      name,
      enabled,
      JSON.stringify({
        sources: defaultSources,
        subscriptions: [],
        workspaces: [],
      }),
    ],
  );
  return (await pool.query("SELECT * FROM tenants WHERE id=$1", [id])).rows[0];
}
export async function ingest(
  pool,
  { tenant, source, runId, snapshotId = runId, records },
) {
  return transaction(pool, async (db) => {
    let count = 0;
    const digests = [];
    for (const entry of records) {
      const { record, context = {} } = entry;
      const nativeId = [
          context.parent,
          context.relation,
          record.id || record.Id || record.eventDataId || hash(record),
        ]
          .filter(Boolean)
          .join("|"),
        payload = { record, context },
        sha = hash(payload);
      let evidence = (
        await db.query(
          "SELECT id FROM evidence WHERE tenant_id=$1 AND source=$2 AND native_id=$3 AND sha256=$4",
          [tenant, source, nativeId, sha],
        )
      ).rows[0];
      if (!evidence) {
        evidence =
          (
            await db.query(
              "INSERT INTO evidence(tenant_id,source,native_id,payload,sha256,run_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
              [tenant, source, nativeId, JSON.stringify(payload), sha, runId],
            )
          ).rows[0] ||
          (
            await db.query(
              "SELECT id FROM evidence WHERE tenant_id=$1 AND source=$2 AND native_id=$3 AND sha256=$4",
              [tenant, source, nativeId, sha],
            )
          ).rows[0];
        digests.push(sha);
      }
      const normalized = normalize(source, record, context);
      for (const r of normalized.resources) {
        const old = (
          await db.query(
            "SELECT properties,name,kind,service,created_at,created_by,parent_key,evidence_id FROM resources WHERE tenant_id=$1 AND key=$2",
            [tenant, r.key],
          )
        ).rows[0];
        const semantic = hash(semanticResource(r));
        const oldHash = old
          ? hash(
              semanticResource({
                ...r,
                name: old.name,
                kind: old.kind,
                service: old.service,
                properties: old.properties,
                createdAt: old.created_at
                  ? new Date(old.created_at).toISOString()
                  : null,
                createdBy: old.created_by || null,
                parentKey: old.parent_key || null,
              }),
            )
          : null;
        await db.query(
          `INSERT INTO resources(tenant_id,key,source,native_id,name,kind,service,parent_key,created_at,created_by,properties,evidence_id,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,key) DO UPDATE SET name=EXCLUDED.name,properties=EXCLUDED.properties,last_seen=now(),active=true,evidence_id=EXCLUDED.evidence_id,run_id=EXCLUDED.run_id,created_at=EXCLUDED.created_at,created_by=EXCLUDED.created_by,parent_key=EXCLUDED.parent_key`,
          [
            tenant,
            r.key,
            source,
            r.nativeId,
            r.name,
            r.kind,
            r.service,
            r.parentKey || null,
            r.createdAt || null,
            r.createdBy || null,
            JSON.stringify(r.properties),
            evidence.id,
            snapshotId,
          ],
        );
        await db.query(
          "INSERT INTO resource_versions(tenant_id,resource_key,sha256,evidence_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [tenant, r.key, semantic, evidence.id],
        );
        if (old && oldHash !== semantic) {
          await db.query(
            `INSERT INTO events(tenant_id,source,native_id,target_key,target_name,operation,category,evidence_id,properties) VALUES($1,$2,$3,$4,$5,'Alteração detectada entre snapshots','inventory',$6,$7) ON CONFLICT DO NOTHING`,
            [
              tenant,
              source,
              "snapshot:" + runId + ":" + r.key,
              r.key,
              r.name,
              evidence.id,
              JSON.stringify({
                before: old.properties,
                beforeEvidenceId: old.evidence_id,
                after: r.properties,
                attribution:
                  "Autor e horário real não determinados por comparação de snapshots.",
              }),
            ],
          );
        }
      }
      for (const edge of normalized.edges)
        await db.query(
          `INSERT INTO edges(tenant_id,key,source,from_key,to_key,relation,scope,role,properties,evidence_id,run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,key) DO UPDATE SET active=true,properties=EXCLUDED.properties,evidence_id=EXCLUDED.evidence_id,run_id=EXCLUDED.run_id,last_seen=now()`,
          [
            tenant,
            edge.key,
            source,
            edge.from,
            edge.to,
            edge.relation,
            edge.scope || null,
            edge.role || null,
            JSON.stringify(edge.properties),
            evidence.id,
            snapshotId,
          ],
        );
      for (const event of normalized.events)
        await db.query(
          `INSERT INTO events(tenant_id,source,native_id,occurred_at,actor_key,actor_name,target_key,target_name,operation,category,outcome,severity,correlation_id,evidence_id,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
          [
            tenant,
            source,
            event.nativeId,
            event.occurredAt,
            event.actorKey,
            event.actorName,
            event.targetKey,
            event.targetName,
            event.operation || "Operação não informada",
            event.category,
            event.outcome || null,
            event.severity,
            event.correlationId || null,
            evidence.id,
            JSON.stringify(event.properties),
          ],
        );
      count++;
    }
    if (digests.length)
      await ledger(db, tenant, "collector", "evidence.ingested", source, {
        runId,
        count,
        root: hash(digests),
        hashes: digests,
      });
    return count;
  });
}
export async function finishSnapshot(pool, tenant, source, runId) {
  await transaction(pool, async (db) => {
    await db.query(
      "UPDATE resources SET active=false WHERE tenant_id=$1 AND source=$2 AND run_id IS DISTINCT FROM $3 AND active=true",
      [tenant, source, runId],
    );
    await db.query(
      "UPDATE edges SET active=false WHERE tenant_id=$1 AND source=$2 AND run_id IS DISTINCT FROM $3 AND active=true",
      [tenant, source, runId],
    );
  });
}
export async function queueSource(
  pool,
  tenant,
  source,
  actor = "scheduler",
  days = null,
) {
  if (!sourceById(source) || sourceById(source).provider === "bridge")
    throw new AppError(400, "INVALID_SOURCE");
  const t = (
    await pool.query("SELECT enabled,settings FROM tenants WHERE id=$1", [
      tenant,
    ])
  ).rows[0];
  if (!t?.enabled || !t.settings.sources?.includes(source))
    throw new AppError(403, "SOURCE_DISABLED");
  const r = await pool.query(
    `INSERT INTO runs(tenant_id,source,requested_by,detail) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,source) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
    [tenant, source, actor, JSON.stringify(days ? { backfillDays: days } : {})],
  );
  return { queued: r.rowCount === 1, id: r.rows[0]?.id || null };
}
export async function coverage(pool, tenant) {
  const t = (
    await pool.query("SELECT settings FROM tenants WHERE id=$1", [tenant])
  ).rows[0];
  const rows = (
    await pool.query("SELECT * FROM coverage WHERE tenant_id=$1", [tenant])
  ).rows;
  return SOURCES.map((s) => ({
    ...s,
    enabled: t.settings.sources?.includes(s.id) || false,
    ...rows.find((r) => r.source === s.id),
    status: rows.find((r) => r.source === s.id)?.status || "never",
  }));
}
export async function overview(pool, tenant) {
  const counts = await pool.query(
    `SELECT (SELECT count(*) FROM resources WHERE tenant_id=$1 AND active) resources,(SELECT count(*) FROM events WHERE tenant_id=$1) events,(SELECT count(*) FROM edges WHERE tenant_id=$1 AND active) permissions,(SELECT count(*) FROM evidence WHERE tenant_id=$1) evidence`,
    [tenant],
  );
  const services = (
    await pool.query(
      "SELECT service,count(*) FROM resources WHERE tenant_id=$1 AND active GROUP BY service ORDER BY count(*) DESC",
      [tenant],
    )
  ).rows;
  const activity = (
    await pool.query(
      "SELECT date_trunc('day',COALESCE(occurred_at,observed_at)) AS day,count(*) FROM events WHERE tenant_id=$1 AND COALESCE(occurred_at,observed_at)>now()-interval '7 days' GROUP BY 1 ORDER BY 1",
      [tenant],
    )
  ).rows;
  return {
    ...counts.rows[0],
    services,
    activity,
    coverage: await coverage(pool, tenant),
  };
}
export async function resourceDetail(
  pool,
  tenant,
  key,
  offset = 0,
  childOffset = 0,
) {
  const r = (
    await pool.query("SELECT * FROM resources WHERE tenant_id=$1 AND key=$2", [
      tenant,
      key,
    ])
  ).rows[0];
  if (!r)
    throw new AppError(
      404,
      "RESOURCE_NOT_FOUND",
      "Este recurso ou escopo não foi coletado no inventário. Confira a fonte e o escopo de leitura.",
    );
  const edges = (
    await pool.query(
      "SELECT * FROM edges WHERE tenant_id=$1 AND active AND (from_key=$2 OR to_key=$2 OR ($4::boolean AND relation='azure_role' AND scope IS NOT NULL AND (lower($3)=lower(scope) OR left(lower($3),length(scope)+1)=lower(scope)||'/'))) ORDER BY relation,from_key,to_key,key LIMIT 51 OFFSET $5",
      [
        tenant,
        key,
        key.replace(/^azure:/, ""),
        key.startsWith("azure:"),
        offset,
      ],
    )
  ).rows.filter(
    (x) =>
      x.from_key === key ||
      x.to_key === key ||
      (x.scope && withinScope(key.replace(/^azure:/, ""), x.scope)),
  );
  const events = (
    await pool.query(
      "SELECT * FROM events WHERE tenant_id=$1 AND target_key=$2 ORDER BY COALESCE(occurred_at,observed_at) DESC LIMIT 100",
      [tenant, key],
    )
  ).rows;
  const versions = (
    await pool.query(
      "SELECT * FROM resource_versions WHERE tenant_id=$1 AND resource_key=$2 ORDER BY observed_at DESC LIMIT 50",
      [tenant, key],
    )
  ).rows;
  const keys = [...new Set(edges.flatMap((e) => [e.from_key, e.to_key]))];
  const related = keys.length
    ? (
        await pool.query(
          "SELECT key,name,kind,properties FROM resources WHERE tenant_id=$1 AND key=ANY($2::text[])",
          [tenant, keys],
        )
      ).rows
    : [];
  const names = new Map(related.map((r) => [r.key, r]));
  const linkedEdges = edges.map((e) => ({
    ...e,
    fromName:
      names.get(e.from_key)?.name ||
      (e.to_key === key
        ? e.properties.displayName || e.properties.userPrincipalName
        : null) ||
      e.from_key,
    toName:
      names.get(e.to_key)?.name ||
      e.to_key
        .replace("intune-target:#microsoft.graph.", "")
        .replace("intune-target:", ""),
    fromCollected: names.has(e.from_key),
    toCollected: names.has(e.to_key),
  }));
  const children = (
    await pool.query(
      "SELECT key,name,kind,service,source,properties,last_seen,evidence_id FROM resources WHERE tenant_id=$1 AND parent_key=$2 AND active AND kind<>'costLine' ORDER BY name,key LIMIT 51 OFFSET $3",
      [tenant, key, childOffset],
    )
  ).rows;
  const costs = (
    await pool.query(
      "SELECT properties->>'currency' AS currency,properties->>'periodStart' AS period_start,max(properties->>'periodEnd') AS period_end,sum((properties->>'amount')::numeric)::text AS amount FROM resources WHERE tenant_id=$1 AND active AND kind='costLine' AND (parent_key=$2 OR ($3::boolean AND left(lower(parent_key),length($2)+1)=lower($2)||'/')) GROUP BY properties->>'currency',properties->>'periodStart' ORDER BY currency,period_start",
      [
        tenant,
        key,
        r.kind === "subscription" ||
          r.kind.toLowerCase().includes("resourcegroups"),
      ],
    )
  ).rows;
  return {
    resource: r,
    edges: linkedEdges.slice(0, 50),
    relationshipsOffset: offset,
    relationshipsHasMore: edges.length > 50,
    edgesLimited: false,
    related: related.filter((r) => r.kind === "license"),
    children: children.slice(0, 50),
    childrenOffset: childOffset,
    childrenHasMore: children.length > 50,
    costs,
    events,
    versions,
    limitations:
      r.service === "Intune"
        ? [
            "Atribuições configuradas não comprovam implantação ou aplicabilidade final.",
            "Inclusões, exclusões, filtros, associação de grupos e sincronização podem alterar os dispositivos alcançados.",
          ]
        : [
            "Permissões observadas, não uma decisão definitiva de autorização.",
            "Condições RBAC, deny assignments, PIM, ACLs do plano de dados e fontes não conectadas podem alterar o acesso.",
          ],
  };
}
export async function accessPaths(pool, tenant, principal) {
  const memberships = (
    await pool.query(
      "WITH RECURSIVE paths AS (SELECT $2::text AS node,ARRAY[$2::text] AS path,0 AS depth UNION ALL SELECT e.to_key,p.path||e.to_key,p.depth+1 FROM paths p JOIN edges e ON e.tenant_id=$1 AND e.from_key=p.node AND e.relation IN ('member_of','alias') AND e.active WHERE p.depth<8 AND NOT e.to_key=ANY(p.path)) SELECT node,path,depth FROM paths LIMIT 5000",
      [tenant, principal],
    )
  ).rows;
  const nodes = [...new Set(memberships.map((p) => p.node))];
  const assignments = (
    await pool.query(
      "SELECT * FROM edges WHERE tenant_id=$1 AND from_key=ANY($2::text[]) AND active AND relation NOT IN ('member_of','alias') LIMIT 5000",
      [tenant, nodes],
    )
  ).rows;
  const referenceKeys = [
    ...new Set(
      assignments.flatMap((a) => [
        a.from_key,
        a.to_key,
        ...(a.role?.startsWith("/subscriptions/")
          ? ["azure:" + a.role.toLowerCase()]
          : []),
      ]),
    ),
  ];
  const referenced = (
    await pool.query(
      "SELECT key,name,properties FROM resources WHERE tenant_id=$1 AND key=ANY($2::text[])",
      [tenant, referenceKeys],
    )
  ).rows;
  const byKey = new Map(referenced.map((r) => [r.key, r]));
  return {
    principal,
    paths: assignments.map((a) => ({
      ...a,
      principalName: byKey.get(a.from_key)?.name || null,
      targetName:
        a.relation === "directory_role"
          ? "Diretório · " + (a.scope || "/")
          : byKey.get(a.to_key)?.name || null,
      roleName:
        byKey.get("azure:" + a.role?.toLowerCase())?.name ||
        byKey.get(a.to_key)?.properties?.appRoles?.find((r) => r.id === a.role)
          ?.value ||
        (a.relation === "directory_role" ? byKey.get(a.to_key)?.name : null),
      membershipPaths: memberships
        .filter((p) => p.node === a.from_key)
        .map((p) => p.path),
    })),
    limited:
      memberships.length === 5000 ||
      assignments.length === 5000 ||
      memberships.some((m) => m.depth === 8),
    limitations: [
      "Expansão de grupos até 8 níveis.",
      "Somente associações e atribuições coletadas; não calcula autorização efetiva nem regras de negação.",
    ],
  };
}
