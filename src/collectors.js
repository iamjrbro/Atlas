import { AppError } from "./security.js";
import { ingest, finishSnapshot } from "./store.js";
import { sourceById } from "./sources.js";
import { collectGraph } from "./resumable-graph.js";
import { collectCosts } from "./costs.js";
import { collectConfigurations } from "./azure-configurations.js";
const iso = (d) => new Date(d).toISOString();
export async function collect(run, tenant, config, provider, pool) {
  const source = sourceById(run.source);
  let count = 0,
    requests = 0;
  const checkpoint = (
    await pool.query(
      "SELECT checkpoint FROM coverage WHERE tenant_id=$1 AND source=$2",
      [tenant.id, source.id],
    )
  ).rows[0]?.checkpoint;
  const end = new Date(Date.now() - 120000),
    requested = run.detail.backfillDays
      ? Date.now() - run.detail.backfillDays * 86400000
      : checkpoint
        ? new Date(checkpoint).getTime() - config.overlap * 60000
        : Date.now() - 86400000;
  let start = new Date(requested);
  if (source.provider === "m365" && start < Date.now() - 6.9 * 86400000)
    throw new AppError(
      409,
      "RETENTION_GAP",
      "A janela pendente ultrapassa a disponibilidade de conteúdo da Management API; requer reconciliação e backfill explícito.",
    );
  if (start > end) start = new Date(end.getTime() - 300000);
  await pool.query(
    "UPDATE runs SET window_start=$2,window_end=$3 WHERE id=$1",
    [run.id, start, end],
  );
  const heartbeat = async () =>
    pool.query(
      "UPDATE runs SET lease_until=now()+interval '180 seconds' WHERE id=$1 AND status='running'",
      [run.id],
    );
  async function emit(records, context = {}) {
    if (count + records.length > config.maxRecords)
      throw new AppError(409, "COLLECTION_LIMIT");
    for (let i = 0; i < records.length; i += 100) {
      await ingest(pool, {
        tenant: tenant.id,
        source: source.id,
        runId: run.id,
        records: records
          .slice(i, i + 100)
          .map((record) => ({ record, context })),
      });
      count += Math.min(100, records.length - i);
      await pool.query("UPDATE runs SET records=$2 WHERE id=$1", [
        run.id,
        count,
      ]);
      await heartbeat();
    }
  }
  async function list(kind, path, context = {}) {
    for await (const page of provider.pages(tenant.id, kind, path)) {
      if (++requests > config.maxPages)
        throw new AppError(409, "COLLECTION_LIMIT");
      await emit(page, context);
    }
  }
  if (source.provider === "graph" && provider.call)
    return collectGraph(
      run,
      tenant,
      source,
      config,
      provider,
      pool,
      start,
      end,
    );
  if (source.provider === "graph") {
    if (source.fanout) {
      let parentPath =
        source.fanout === "teams"
          ? "groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id"
          : source.fanout === "groups"
            ? "groups?$select=id"
            : source.fanout === "servicePrincipals"
              ? "servicePrincipals?$select=id"
              : "sites/getAllSites";
      for await (const parents of provider.pages(
        tenant.id,
        "graph",
        parentPath,
      )) {
        if (++requests > config.maxPages)
          throw new AppError(409, "COLLECTION_LIMIT");
        for (const parent of parents) {
          for (const relation of source.relations) {
            const root =
              source.fanout === "teams"
                ? "teams"
                : source.fanout === "sites/getAllSites"
                  ? "sites"
                  : source.fanout;
            await list(
              "graph",
              `${root}/${encodeURIComponent(parent.id)}/${relation}`,
              { parent: parent.id, relation },
            );
          }
        }
      }
    } else {
      let path = source.path;
      if (source.type === "events") {
        const field =
          source.id === "entra.signins"
            ? "createdDateTime"
            : "activityDateTime";
        path +=
          (path.includes("?") ? "&" : "?") +
          "$filter=" +
          encodeURIComponent(
            `${field} ge ${iso(start)} and ${field} le ${iso(end)}`,
          );
      }
      await list("graph", path);
    }
  } else if (source.provider === "arm") {
    const subscriptions = [];
    for await (const page of provider.pages(
      tenant.id,
      "arm",
      "subscriptions?api-version=2022-12-01",
    ))
      for (const sub of page)
        if (
          !sub.tenantId ||
          sub.tenantId.toLowerCase() === tenant.id.toLowerCase()
        )
          if (
            !tenant.settings.subscriptions?.length ||
            tenant.settings.subscriptions.some(
              (id) => id.toLowerCase() === sub.subscriptionId.toLowerCase(),
            )
          ) {
            subscriptions.push(sub.subscriptionId);
            if (source.id === "azure.subscriptions") await emit([sub]);
          }
    if (!subscriptions.length)
      throw new AppError(
        409,
        "NO_AZURE_SCOPE",
        "Nenhuma assinatura Azure acessível no escopo configurado.",
      );
    if (source.id === "azure.configurations") {
      count = await collectConfigurations(
        run,
        tenant,
        subscriptions,
        config,
        provider,
        pool,
      );
      return { count, start, end };
    } else if (source.id === "azure.subscriptions") {
      // Subscription properties were persisted during discovery.
    } else if (source.id === "azure.costs") {
      await collectCosts({
        tenant: tenant.id,
        subscriptions,
        provider,
        config,
        emit,
        heartbeat,
      });
    } else if (source.query) {
      for (let offset = 0; offset < subscriptions.length; offset += 50) {
        let skip;
        do {
          if (++requests > config.maxPages)
            throw new AppError(409, "COLLECTION_LIMIT");
          const { data } = await provider.call(
            tenant.id,
            "arm",
            "providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01",
            {
              method: "POST",
              body: {
                subscriptions: subscriptions.slice(offset, offset + 50),
                query: source.query,
                options: {
                  resultFormat: "objectArray",
                  $top: 1000,
                  ...(skip ? { $skipToken: skip } : {}),
                },
              },
            },
          );
          await emit(data.data || []);
          skip = data.$skipToken;
          if (String(data.resultTruncated) === "true" && !skip)
            throw new AppError(409, "QUERY_TRUNCATED");
        } while (skip);
      }
    } else
      for (const sub of subscriptions)
        await list(
          "arm",
          `subscriptions/${sub}/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$filter=` +
            encodeURIComponent(
              `eventTimestamp ge '${iso(start)}' and eventTimestamp le '${iso(end)}'`,
            ),
        );
  } else if (source.provider === "m365") {
    const prefix = `https://manage.office.com/api/v1.0/${tenant.id}/activity/feed/`,
      publisher = config.publisher
        ? "&PublisherIdentifier=" + config.publisher
        : "";
    let subs;
    for await (const page of provider.pages(
      tenant.id,
      "m365",
      prefix + "subscriptions/list",
    ))
      subs = page;
    if (
      !subs?.some(
        (s) => s.contentType === source.contentType && s.status === "enabled",
      )
    )
      throw new AppError(
        409,
        "M365_SUBSCRIPTION_REQUIRED",
        "Ative a subscription do feed seguindo o guia de onboarding.",
      );
    for (let at = start.getTime(); at < end.getTime(); at += 23 * 3600000) {
      const until = Math.min(end.getTime(), at + 23 * 3600000);
      for await (const blobs of provider.pages(
        tenant.id,
        "m365",
        prefix +
          `subscriptions/content?contentType=${source.contentType}&startTime=${encodeURIComponent(iso(at))}&endTime=${encodeURIComponent(iso(until))}${publisher}`,
      )) {
        if (++requests > config.maxPages)
          throw new AppError(409, "COLLECTION_LIMIT");
        for (const blob of blobs) {
          if (++requests > config.maxPages)
            throw new AppError(409, "COLLECTION_LIMIT");
          const { data } = await provider.call(
            tenant.id,
            "m365",
            blob.contentUri,
          );
          if (!Array.isArray(data))
            throw new AppError(502, "INVALID_AUDIT_CONTENT");
          if (
            data.some(
              (r) =>
                r.OrganizationId &&
                r.OrganizationId.toLowerCase() !== tenant.id.toLowerCase(),
            )
          )
            throw new AppError(403, "EVIDENCE_TENANT_MISMATCH");
          await emit(data);
        }
      }
    }
  } else if (source.provider === "logs") {
    if (!tenant.settings.workspaces?.length)
      throw new AppError(
        409,
        "WORKSPACE_REQUIRED",
        "Configure os IDs dos workspaces de diagnóstico.",
      );
    for (const workspace of tenant.settings.workspaces) {
      const tables = workspace.tables || ["AzureDiagnostics"];
      for (const table of tables) {
        const query = `${table} | where TimeGenerated between (datetime(${iso(start)}) .. datetime(${iso(end)})) | take ${config.maxRecords + 1}`;
        const { data } = await provider.call(
          tenant.id,
          "logs",
          `workspaces/${workspace.id}/query`,
          {
            method: "POST",
            body: { query, timespan: `${iso(start)}/${iso(end)}` },
          },
        );
        if (data.error || data.tables?.some((t) => t.name === "QueryStatus"))
          throw new AppError(409, "LOG_QUERY_PARTIAL");
        for (const result of data.tables || []) {
          if (result.rows?.length > config.maxRecords)
            throw new AppError(409, "COLLECTION_LIMIT");
          await emit(
            (result.rows || []).map((row) =>
              Object.fromEntries(
                result.columns.map((c, i) => [c.name, row[i]]),
              ),
            ),
            { workspace: workspace.id, table },
          );
        }
      }
    }
  } else throw new AppError(409, "BRIDGE_REQUIRED");
  if (source.type === "snapshot")
    await finishSnapshot(pool, tenant.id, source.id, run.id);
  return { count, start, end };
}
