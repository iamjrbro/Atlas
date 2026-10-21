import { hash, AppError } from "./security.js";
import { ingest, finishSnapshot } from "./store.js";
// Um ciclo de snapshot pode atravessar vários jobs; só o ciclo completo retira
// objetos não observados. O cursor avança depois da persistência das evidências.
export async function collectGraph(
  run,
  tenant,
  source,
  config,
  provider,
  pool,
  start,
  end,
) {
  const fingerprint = hash({
    source: source.id,
    definition: source.path,
    fanout: source.fanout,
    relations: source.relations,
    settings: tenant.settings,
  });
  let saved = (
    await pool.query(
      "SELECT state FROM collection_cursors WHERE tenant_id=$1 AND source=$2",
      [tenant.id, source.id],
    )
  ).rows[0]?.state;
  if (saved?.fingerprint !== fingerprint || run.detail.backfillDays)
    saved = null;
  const parentPath =
    source.fanout === "teams"
      ? "groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id"
      : source.fanout === "groups"
        ? "groups?$select=id"
        : source.fanout === "servicePrincipals"
          ? "servicePrincipals?$select=id"
          : "sites/getAllSites";
  let initial = source.path;
  if (source.type === "events") {
    const field =
      source.id === "entra.signins" ? "createdDateTime" : "activityDateTime";
    initial +=
      (initial.includes("?") ? "&" : "?") +
      "$filter=" +
      encodeURIComponent(
        `${field} ge ${start.toISOString()} and ${field} le ${end.toISOString()}`,
      );
  }
  const state = saved || {
    fingerprint,
    generation: run.id,
    start: start.toISOString(),
    end: end.toISOString(),
    stage: source.fanout ? "parents" : "list",
    next: source.fanout ? parentPath : initial,
    parents: [],
    index: 0,
    relation: 0,
  };
  const visited = new Set();
  let count = 0,
    requests = 0;
  async function persist() {
    await pool.query(
      "INSERT INTO collection_cursors(tenant_id,source,state) VALUES($1,$2,$3) ON CONFLICT(tenant_id,source) DO UPDATE SET state=EXCLUDED.state,updated_at=now()",
      [tenant.id, source.id, JSON.stringify(state)],
    );
    await pool.query(
      "UPDATE runs SET lease_until=now()+interval '180 seconds',window_start=$2,window_end=$3 WHERE id=$1",
      [run.id, state.start, state.end],
    );
  }
  async function emit(items, context) {
    for (let i = 0; i < items.length; i += 100) {
      await ingest(pool, {
        tenant: tenant.id,
        source: source.id,
        runId: run.id,
        snapshotId: state.generation,
        records: items
          .slice(i, i + 100)
          .map((record) => ({ record, context: context || {} })),
      });
      count += Math.min(100, items.length - i);
      await pool.query("UPDATE runs SET records=$2 WHERE id=$1", [
        run.id,
        count,
      ]);
    }
  }
  await persist();
  while (state.stage !== "done") {
    if (requests >= config.maxPages || count >= config.maxRecords) {
      await persist();
      throw new AppError(
        409,
        "COLLECTION_LIMIT",
        "Coleta parcial com cursor persistido; continuará no próximo job.",
      );
    }
    let path,
      context = {};
    if (state.stage === "parents" || state.stage === "list") path = state.next;
    else {
      if (state.index >= state.parents.length) {
        state.stage = "done";
        break;
      }
      const parent = state.parents[state.index],
        relation = source.relations[state.relation],
        root =
          source.fanout === "teams"
            ? "teams"
            : source.fanout === "sites/getAllSites"
              ? "sites"
              : source.fanout;
      path = state.next || `${root}/${encodeURIComponent(parent)}/${relation}`;
      context = { parent, relation };
    }
    const step = state.stage + ":" + path;
    if (visited.has(step)) throw new AppError(502, "PAGINATION_LOOP");
    visited.add(step);
    const { data } = await provider.call(tenant.id, "graph", path);
    requests++;
    if (!Array.isArray(data.value)) throw new AppError(502, "PROVIDER_SHAPE");
    const items = data.value,
      next = data["@odata.nextLink"] || null;
    if (items.length + count > config.maxRecords) {
      await persist();
      throw new AppError(
        409,
        "COLLECTION_LIMIT",
        "A página excede o limite de registros por job. Aumente MAX_RECORDS_PER_RUN.",
      );
    }
    if (state.stage === "parents") {
      state.parents.push(...items.map((p) => p.id));
      state.next = next;
      if (!next) {
        state.parents = [...new Set(state.parents)];
        state.stage = "children";
        state.next = null;
      }
    } else {
      await emit(items, context);
      state.next = next;
      if (!next) {
        if (state.stage === "list") state.stage = "done";
        else if (++state.relation >= source.relations.length) {
          state.relation = 0;
          state.index++;
        }
      }
    }
    await persist();
  }
  if (source.type === "snapshot")
    await finishSnapshot(pool, tenant.id, source.id, state.generation);
  await pool.query(
    "DELETE FROM collection_cursors WHERE tenant_id=$1 AND source=$2",
    [tenant.id, source.id],
  );
  return { count, start: new Date(state.start), end: new Date(state.end) };
}
