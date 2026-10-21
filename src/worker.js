import { transaction } from "./db.js";
import { collect } from "./collectors.js";
import { ledger, queueSource } from "./store.js";
import { sourceById } from "./sources.js";
export async function processOne(pool, config, provider) {
  const run = await transaction(pool, async (db) => {
    const r = await db.query(
      "SELECT * FROM runs WHERE status='queued' OR status='running' AND lease_until<now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!r.rowCount) return null;
    await db.query(
      "UPDATE runs SET status='running',started_at=COALESCE(started_at,now()),lease_until=now()+interval '180 seconds' WHERE id=$1",
      [r.rows[0].id],
    );
    return r.rows[0];
  });
  if (!run) return false;
  const tenant = (
    await pool.query("SELECT * FROM tenants WHERE id=$1", [run.tenant_id])
  ).rows[0];
  let outcome = "success",
    detail = {},
    result;
  try {
    if (!tenant?.enabled || !tenant.settings.sources?.includes(run.source))
      throw Object.assign(new Error(), { code: "SOURCE_DISABLED" });
    await pool.query(
      "INSERT INTO coverage(tenant_id,source,last_attempt) VALUES($1,$2,now()) ON CONFLICT(tenant_id,source) DO UPDATE SET last_attempt=now()",
      [tenant.id, run.source],
    );
    result = await collect(run, tenant, config, provider, pool);
  } catch (error) {
    outcome =
      error.providerStatus === 401 || error.providerStatus === 403
        ? "forbidden"
        : [
              "COLLECTION_LIMIT",
              "QUERY_TRUNCATED",
              "LOG_QUERY_PARTIAL",
              "AZURE_CONFIGURATION_GAPS",
            ].includes(error.code)
          ? "partial"
          : [
                "M365_SUBSCRIPTION_REQUIRED",
                "WORKSPACE_REQUIRED",
                "NO_AZURE_SCOPE",
                "BRIDGE_REQUIRED",
                "SOURCE_DISABLED",
                "AZURE_INVENTORY_REQUIRED",
              ].includes(error.code)
            ? "needs_setup"
            : error.code === "RETENTION_GAP"
              ? "gap"
              : "failed";
    detail = {
      code: error.code || "COLLECTION_FAILED",
      correlation: error.correlation || null,
      retryAt: error.retryAt || null,
    };
  }
  await transaction(pool, async (db) => {
    await db.query(
      "UPDATE runs SET status=$2,finished_at=now(),lease_until=NULL,error_code=$3,detail=detail||$4::jsonb WHERE id=$1",
      [run.id, outcome, detail.code || null, JSON.stringify(detail)],
    );
    await db.query(
      `INSERT INTO coverage(tenant_id,source,status,last_attempt,last_success,checkpoint,records,detail) VALUES($1,$2,$3,now(),$4,$5,(SELECT records FROM runs WHERE id=$6),$7) ON CONFLICT(tenant_id,source) DO UPDATE SET status=EXCLUDED.status,last_attempt=now(),last_success=COALESCE(EXCLUDED.last_success,coverage.last_success),checkpoint=COALESCE(EXCLUDED.checkpoint,coverage.checkpoint),records=EXCLUDED.records,detail=EXCLUDED.detail`,
      [
        run.tenant_id,
        run.source,
        outcome,
        outcome === "success" ? new Date() : null,
        outcome === "success" && sourceById(run.source).type === "events"
          ? result.end
          : null,
        run.id,
        JSON.stringify(detail),
      ],
    );
    await ledger(
      db,
      run.tenant_id,
      "collector",
      "collection." + outcome,
      run.source,
      { runId: run.id, ...detail },
    );
  });
  return true;
}
export function startWorker(pool, config, provider) {
  let busy = false,
    stopping = false,
    lastSchedule = 0;
  const timer = setInterval(async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      if (Date.now() - lastSchedule > 30000) {
        lastSchedule = Date.now();
        const tenants = (
          await pool.query("SELECT * FROM tenants WHERE enabled")
        ).rows;
        for (const tenant of tenants)
          for (const source of tenant.settings.sources || []) {
            if (!sourceById(source) || sourceById(source).provider === "bridge")
              continue;
            const previous = (
                await pool.query(
                  "SELECT last_attempt,detail FROM coverage WHERE tenant_id=$1 AND source=$2",
                  [tenant.id, source],
                )
              ).rows[0],
              last = previous?.last_attempt;
            if (
              previous?.detail?.retryAt &&
              new Date(previous.detail.retryAt) > new Date()
            )
              continue;
            if (!last || Date.now() - new Date(last) > config.interval * 1000)
              await queueSource(pool, tenant.id, source);
          }
      }
      await processOne(pool, config, provider);
    } catch {
      console.error('{"event":"worker.failed"}');
    } finally {
      busy = false;
    }
  }, 1500);
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 50));
  };
}
