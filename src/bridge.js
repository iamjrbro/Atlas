import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, verifyBridge, hash } from "./security.js";
import { transaction } from "./db.js";
import { ingest, finishSnapshot, ledger } from "./store.js";
const record = z
  .object({
    id: z.string().min(1).max(2000),
    recordType: z.enum(["resource", "permission", "event"]),
    key: z.string().max(2000).optional(),
    name: z.string().max(1000).optional(),
    kind: z.string().max(200).optional(),
    principalKey: z.string().max(2000).optional(),
    resourceKey: z.string().max(2000).optional(),
    role: z.string().max(2000).optional(),
    operation: z.string().max(500).optional(),
  })
  .passthrough()
  .superRefine((r, ctx) => {
    if (
      (r.recordType === "resource" && (!r.key || !r.name || !r.kind)) ||
      (r.recordType === "permission" &&
        (!r.principalKey || !r.resourceKey || !r.role)) ||
      (r.recordType === "event" && !r.operation)
    )
      ctx.addIssue({
        code: "custom",
        message: "Campos do tipo de registro ausentes.",
      });
  });
const schema = z
  .object({
    tenantId: z.uuid(),
    source: z.enum(["bridge.exchange", "bridge.sharepoint"]),
    capturedAt: z.iso.datetime(),
    complete: z.boolean(),
    records: z.array(record).max(50000),
  })
  .strict();
export function bridgeHandler(config, pool) {
  return async (req, res) => {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) throw new AppError(400, "RAW_BODY_REQUIRED");
    const tenant = String(req.get("x-atlas-tenant") || "").toLowerCase();
    verifyBridge({
      secret: config.bridgeKeys[tenant],
      timestamp: req.get("x-atlas-timestamp"),
      nonce: req.get("x-atlas-nonce"),
      signature: req.get("x-atlas-signature"),
      body: raw,
    });
    let body;
    try {
      body = schema.parse(JSON.parse(raw.toString("utf8")));
    } catch {
      throw new AppError(400, "INVALID_BRIDGE_SNAPSHOT");
    }
    if (
      body.tenantId !== tenant ||
      Math.abs(Date.now() - new Date(body.capturedAt)) > 24 * 3600000
    )
      throw new AppError(400, "BRIDGE_TENANT_OR_TIME");
    const t = (await pool.query("SELECT * FROM tenants WHERE id=$1", [tenant]))
      .rows[0];
    if (!t?.enabled || !t.settings.sources?.includes(body.source))
      throw new AppError(403, "SOURCE_DISABLED");
    const runId = randomUUID();
    await transaction(pool, async (db) => {
      await db.query(
        "INSERT INTO bridge_nonces(tenant_id,nonce) VALUES($1,$2)",
        [tenant, req.get("x-atlas-nonce")],
      );
      await db.query(
        "INSERT INTO runs(id,tenant_id,source,status,requested_by,started_at) VALUES($1,$2,$3,'running','bridge',now())",
        [runId, tenant, body.source],
      );
      await ledger(db, tenant, "bridge", "bridge.received", body.source, {
        runId,
        bodyHash: hash(raw.toString("utf8")),
        capturedAt: body.capturedAt,
        complete: body.complete,
      });
    });
    try {
      for (let i = 0; i < body.records.length; i += 100)
        await ingest(pool, {
          tenant,
          source: body.source,
          runId,
          records: body.records.slice(i, i + 100).map((record) => ({
            record,
            context: {
              capturedAt: body.capturedAt,
              trust: "collector_asserted",
            },
          })),
        });
      if (body.complete) await finishSnapshot(pool, tenant, body.source, runId);
      await transaction(pool, async (db) => {
        await db.query(
          "UPDATE runs SET status=$2,finished_at=now(),records=$3 WHERE id=$1",
          [runId, body.complete ? "success" : "partial", body.records.length],
        );
        await db.query(
          "INSERT INTO coverage(tenant_id,source,status,last_success,last_attempt,records,detail) VALUES($1,$2,$3,now(),now(),$4,$5) ON CONFLICT(tenant_id,source) DO UPDATE SET status=EXCLUDED.status,last_success=CASE WHEN EXCLUDED.status='success' THEN now() ELSE coverage.last_success END,last_attempt=now(),records=EXCLUDED.records,detail=EXCLUDED.detail",
          [
            tenant,
            body.source,
            body.complete ? "success" : "partial",
            body.records.length,
            JSON.stringify({
              trust: "collector_asserted",
              capturedAt: body.capturedAt,
            }),
          ],
        );
      });
      res
        .status(201)
        .json({ runId, records: body.records.length, complete: body.complete });
    } catch (error) {
      await pool.query(
        "UPDATE runs SET status='failed',finished_at=now(),error_code='BRIDGE_INGESTION_FAILED' WHERE id=$1",
        [runId],
      );
      throw error;
    }
  };
}
