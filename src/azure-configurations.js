import { hash, AppError } from "./security.js";
import { ingest, finishSnapshot } from "./store.js";
// ARG is an index. Fetch provider-exposed configuration with each resource's
// advertised API version; never call listKeys, actions or data-plane endpoints.
export async function collectConfigurations(
  run,
  tenant,
  subscriptions,
  config,
  provider,
  pool,
) {
  const fingerprint = hash([...subscriptions].sort());
  let state = (
    await pool.query(
      "SELECT state FROM collection_cursors WHERE tenant_id=$1 AND source=$2",
      [tenant.id, run.source],
    )
  ).rows[0]?.state;
  let requests = 0,
    count = 0;
  if (!state || state.fingerprint !== fingerprint) {
    const resources = (
      await pool.query(
        "SELECT key,properties FROM resources WHERE tenant_id=$1 AND active AND source='azure.resources' ORDER BY key",
        [tenant.id],
      )
    ).rows;
    state = {
      fingerprint,
      generation: run.id,
      index: 0,
      errors: 0,
      resources: resources
        .filter(
          (r) =>
            subscriptions.some((s) =>
              r.key
                .toLowerCase()
                .startsWith("azure:/subscriptions/" + s.toLowerCase() + "/"),
            ) && r.properties.type?.includes("/"),
        )
        .map((r) => ({
          id: r.key.slice(6),
          type: r.properties.type,
          name: r.properties.name,
          subscription: r.properties.subscriptionId,
        })),
    };
    if (!state.resources.length)
      throw new AppError(
        409,
        "AZURE_INVENTORY_REQUIRED",
        "Colete azure.resources antes das configurações ARM.",
      );
  }
  const providers = new Map();
  const persist = async () => {
    await pool.query(
      "INSERT INTO collection_cursors(tenant_id,source,state) VALUES($1,$2,$3) ON CONFLICT(tenant_id,source) DO UPDATE SET state=EXCLUDED.state,updated_at=now()",
      [tenant.id, run.source, JSON.stringify(state)],
    );
    await pool.query(
      "UPDATE runs SET lease_until=now()+interval '180 seconds',records=$2 WHERE id=$1",
      [run.id, count],
    );
  };
  await persist();
  while (state.index < state.resources.length) {
    // Reserve a request for provider discovery as well as the resource GET.
    if (requests + 2 > config.maxPages || count >= config.maxRecords) {
      await persist();
      throw new AppError(409, "COLLECTION_LIMIT");
    }
    const resource = state.resources[state.index],
      [namespace, ...type] = resource.type.split("/"),
      providerKey = resource.subscription + ":" + namespace;
    let versions = providers.get(providerKey);
    if (!versions) {
      const { data } = await provider.call(
        tenant.id,
        "arm",
        `subscriptions/${resource.subscription}/providers/${namespace}?api-version=2021-04-01`,
      );
      requests++;
      versions = data.resourceTypes || [];
      providers.set(providerKey, versions);
    }
    const api = versions.find(
      (x) => x.resourceType.toLowerCase() === type.join("/").toLowerCase(),
    )?.apiVersions;
    const version = api?.find((x) => !/preview|beta/i.test(x)) || api?.[0];
    let record;
    if (!version) {
      state.errors++;
      record = { ...resource, configurationStatus: "unsupported_api_version" };
    } else {
      try {
        const { data } = await provider.call(
          tenant.id,
          "arm",
          resource.id + "?api-version=" + encodeURIComponent(version),
        );
        requests++;
        if (!data?.id || data.id.toLowerCase() !== resource.id.toLowerCase())
          throw new AppError(502, "ARM_RESOURCE_MISMATCH");
        record = {
          ...data,
          configurationStatus: "observed",
          collectedApiVersion: version,
        };
      } catch (e) {
        if (![403, 404].includes(e.providerStatus)) throw e;
        requests++;
        state.errors++;
        record = {
          ...resource,
          configurationStatus: "unavailable",
          errorCode: e.code,
        };
      }
    }
    await ingest(pool, {
      tenant: tenant.id,
      source: run.source,
      runId: run.id,
      snapshotId: state.generation,
      records: [{ record }],
    });
    count++;
    state.index++;
    await persist();
  }
  await pool.query(
    "DELETE FROM collection_cursors WHERE tenant_id=$1 AND source=$2",
    [tenant.id, run.source],
  );
  if (state.errors)
    throw new AppError(
      409,
      "AZURE_CONFIGURATION_GAPS",
      `${state.errors} recurso(s) com configuração indisponível; consulte configurationStatus no inventário.`,
    );
  await finishSnapshot(pool, tenant.id, run.source, state.generation);
  return count;
}
