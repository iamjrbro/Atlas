import express from "express";
import helmet from "helmet";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { database, migrate, transaction } from "./db.js";
import { createAuth, authenticate } from "./auth.js";
import { AppError, csrf, random, requireRole, hash } from "./security.js";
import { SOURCES, sourceById } from "./sources.js";
import {
  overview,
  coverage,
  resourceDetail,
  accessPaths,
  ledger,
  queueSource,
  verifyLedger,
} from "./store.js";
import { createProvider } from "./provider.js";
import { startWorker } from "./worker.js";
import { bridgeHandler } from "./bridge.js";
import { findings } from "./findings.js";
import { seedDemo, DEMO_TENANTS } from "./seed.js";
import { resourceHistory } from "./changes.js";
import { policyReach } from "./intune-reach.js";
import { connectionDiagnostics, PROBES } from "./diagnostics.js";
export function createApp(config, pool) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-ID", req.requestId);
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/auth") ||
      req.path.startsWith("/bridge")
    )
      res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  app.get("/health/ready", async (_req, res) => {
    await pool.query("SELECT 1 FROM tenants LIMIT 1");
    res.json({ ok: true });
  });
  app.post(
    "/bridge/v1/snapshots",
    rateLimit({ windowMs: 60000, limit: 20 }),
    express.raw({ type: "application/json", limit: "12mb" }),
    bridgeHandler(config, pool),
  );
  app.use(express.json({ limit: "32kb" }));
  const Store = pgSession(session),
    sessionStore = new Store({
      pool,
      tableName: "session",
      createTableIfMissing: false,
    });
  app.locals.sessionStore = sessionStore;
  app.use(
    session({
      name: config.production ? "__Host-atlas" : "atlas.sid",
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        maxAge: 15 * 60000,
        path: "/",
      },
    }),
  );
  const auth = createAuth(config, pool);
  app.use(
    "/auth",
    rateLimit({
      windowMs: 900000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  if (config.mode === "microsoft") {
    app.get("/auth/login", auth.login);
    app.get("/auth/callback", auth.callback);
    app.get("/auth/consent", authenticate(config, pool), auth.consentStart);
    app.get(
      "/auth/consent/callback",
      authenticate(config, pool),
      auth.consentCallback,
    );
  }
  app.get("/api/session", (req, res) =>
    res.json({
      mode: config.mode,
      authenticated: !!req.session.actor,
      demoTenants: config.mode === "demo" ? DEMO_TENANTS : [],
    }),
  );
  if (config.mode === "demo")
    app.post("/api/demo/session", async (req, res) => {
      if (req.get("origin") !== config.origin) throw new AppError(403, "CSRF");
      const { tenant, role } = z
        .object({
          tenant: z.enum(DEMO_TENANTS.map((t) => t.id)),
          role: z.enum(["Atlas.Admin", "Atlas.Auditor", "Atlas.Reader"]),
        })
        .strict()
        .parse(req.body);
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.actor = {
        tenant,
        oid:
          role === "Atlas.Admin"
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222",
        name: "Analista · demonstração",
        roles: [role],
      };
      req.session.started = Date.now();
      req.session.csrf = random();
      await transaction(pool, (db) =>
        ledger(db, tenant, req.session.actor.oid, "session.demo", role),
      );
      res.json({ ok: true });
    });
  const api = express.Router();
  api.use(authenticate(config, pool));
  api.use(
    rateLimit({
      windowMs: 60000,
      limit: 180,
      keyGenerator: (req) => req.actor.tenant + ":" + req.actor.oid,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  api.use((req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      csrf(req, config.origin);
    next();
  });
  const auditor = (req) =>
      requireRole(req.actor, ["Atlas.Auditor", "Atlas.Admin"]),
    admin = (req) => requireRole(req.actor, ["Atlas.Admin"]);
  api.get("/me", (req, res) =>
    res.json({
      actor: req.actor,
      tenant: {
        id: req.tenant.id,
        name: req.tenant.name,
        settings: req.tenant.settings,
      },
      csrf: req.session.csrf,
      mode: config.mode,
      expiresAt: new Date(req.session.started + 30 * 60000).toISOString(),
    }),
  );
  api.post("/logout", async (req, res) => {
    await transaction(pool, (db) =>
      ledger(
        db,
        req.actor.tenant,
        req.actor.oid,
        "session.logout",
        req.actor.oid,
      ),
    );
    await new Promise((resolve, reject) =>
      req.session.destroy((e) => (e ? reject(e) : resolve())),
    );
    res.clearCookie(config.production ? "__Host-atlas" : "atlas.sid", {
      path: "/",
    });
    res.json({ ok: true });
  });
  api.get("/overview", async (req, res) =>
    res.json(await overview(pool, req.actor.tenant)),
  );
  api.get("/coverage", async (req, res) =>
    res.json({ items: await coverage(pool, req.actor.tenant) }),
  );
  const pageSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    q: z.string().max(300).default(""),
    service: z.string().max(100).default(""),
    kind: z.string().max(100).default(""),
    source: z.string().max(100).default(""),
    category: z.string().max(100).default(""),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  });
  api.get("/resources", async (req, res) => {
    const p = pageSchema.parse(req.query),
      values = [
        req.actor.tenant,
        "%" + p.q + "%",
        p.service,
        p.kind,
        p.limit + 1,
        p.offset,
      ];
    const rows = (
      await pool.query(
        `SELECT key,name,kind,service,source,parent_key,created_at,created_by,first_seen,last_seen,active,evidence_id,properties FROM resources WHERE tenant_id=$1 AND active AND (name ILIKE $2 OR key ILIKE $2) AND ($3='' OR service=$3) AND ($4='' OR kind=$4) ORDER BY service,name,key LIMIT $5 OFFSET $6`,
        values,
      )
    ).rows;
    res.json({
      items: rows.slice(0, p.limit),
      hasMore: rows.length > p.limit,
      offset: p.offset,
    });
  });
  api.get("/resource", async (req, res) =>
    res.json(
      await resourceDetail(
        pool,
        req.actor.tenant,
        z.string().min(1).max(4000).parse(req.query.key),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .default(0)
          .parse(req.query.offset),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .default(0)
          .parse(req.query.childOffset),
      ),
    ),
  );
  api.get("/resource/history", async (req, res) => {
    auditor(req);
    const p = pageSchema.parse(req.query);
    p.limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .parse(req.query.limit);
    res.json(
      await resourceHistory(
        pool,
        req.actor.tenant,
        z.string().min(1).max(4000).parse(req.query.key),
        p,
      ),
    );
  });
  api.get("/intune/reach", async (req, res) => {
    const p = pageSchema.parse(req.query);
    res.json(
      await policyReach(
        pool,
        req.actor.tenant,
        z.string().min(1).max(4000).parse(req.query.key),
        {
          ...p,
          reportOffset: z.coerce
            .number()
            .int()
            .min(0)
            .max(1000000)
            .default(0)
            .parse(req.query.reportOffset),
        },
      ),
    );
  });
  api.get("/diagnostics", async (req, res) =>
    res.json(await connectionDiagnostics(pool, req.actor.tenant, config)),
  );
  api.post("/diagnostics/probe", async (req, res) => {
    admin(req);
    if (config.mode === "demo")
      throw new AppError(
        409,
        "DEMO_NO_COLLECTION",
        "Demonstração: nenhuma conexão Microsoft será testada.",
      );
    const { service } = z
      .object({ service: z.enum(Object.keys(PROBES)) })
      .strict()
      .parse(req.body);
    const settings = (
      await pool.query("SELECT settings FROM tenants WHERE id=$1", [
        req.actor.tenant,
      ])
    ).rows[0]?.settings;
    const sources = PROBES[service].filter((id) =>
      settings?.sources?.includes(id),
    );
    if (!sources.length)
      throw new AppError(
        409,
        "NO_ENABLED_PROBE",
        "Habilite uma fonte de verificação deste serviço antes de solicitar a coleta.",
      );
    const jobs = await transaction(pool, async (db) => {
      const queued = [];
      for (const source of sources)
        queued.push({
          source,
          ...(await queueSource(db, req.actor.tenant, source, req.actor.oid)),
        });
      await ledger(
        db,
        req.actor.tenant,
        req.actor.oid,
        "diagnostics.probe",
        service,
        { sources },
      );
      return queued;
    });
    res.status(202).json({
      service,
      jobs,
      message:
        "Coletas de leitura enfileiradas. Acompanhe Coletas e atualize o diagnóstico após a conclusão.",
    });
  });
  api.get("/costs", async (req, res) => {
    const p = pageSchema.parse(req.query),
      tenant = req.actor.tenant;
    const totals = (
      await pool.query(
        "SELECT properties->>'subscriptionId' AS subscription_id,properties->>'currency' AS currency,properties->>'periodStart' AS period_start,max(properties->>'periodEnd') AS period_end,sum((properties->>'amount')::numeric)::text AS amount,count(*)::int AS lines FROM resources WHERE tenant_id=$1 AND active AND kind='costLine' GROUP BY properties->>'subscriptionId',properties->>'currency',properties->>'periodStart' ORDER BY subscription_id,currency,period_start",
        [tenant],
      )
    ).rows;
    const rows = (
      await pool.query(
        "SELECT c.key,c.name,c.properties,c.parent_key,c.last_seen,c.evidence_id,r.name AS resource_name,r.key AS resource_key FROM resources c LEFT JOIN resources r ON r.tenant_id=c.tenant_id AND r.key=c.parent_key AND r.active WHERE c.tenant_id=$1 AND c.active AND c.kind='costLine' AND (c.name ILIKE $2 OR c.properties->>'subscriptionId' ILIKE $2) ORDER BY c.properties->>'usageDate' DESC,c.key LIMIT $3 OFFSET $4",
        [tenant, "%" + p.q + "%", p.limit + 1, p.offset],
      )
    ).rows;
    res.json({
      totals,
      items: rows.slice(0, p.limit),
      hasMore: rows.length > p.limit,
      offset: p.offset,
      coverage: (await coverage(pool, tenant)).find(
        (s) => s.id === "azure.costs",
      ),
    });
  });
  api.get("/access", async (req, res) =>
    res.json(
      await accessPaths(
        pool,
        req.actor.tenant,
        z.string().min(1).max(2000).parse(req.query.principal),
      ),
    ),
  );
  api.get("/events", async (req, res) => {
    const p = pageSchema.parse(req.query),
      rows = (
        await pool.query(
          `SELECT id,source,occurred_at,observed_at,actor_key,actor_name,target_key,target_name,operation,category,outcome,severity,correlation_id,evidence_id FROM events WHERE tenant_id=$1 AND (operation ILIKE $2 OR COALESCE(actor_name,'') ILIKE $2 OR COALESCE(target_name,'') ILIKE $2) AND ($3='' OR source=$3) AND ($4='' OR category=$4) AND ($5::timestamptz IS NULL OR COALESCE(occurred_at,observed_at)>=$5) AND ($6::timestamptz IS NULL OR COALESCE(occurred_at,observed_at)<=$6) ORDER BY COALESCE(occurred_at,observed_at) DESC,id DESC LIMIT $7 OFFSET $8`,
          [
            req.actor.tenant,
            "%" + p.q + "%",
            p.source,
            p.category,
            p.from || null,
            p.to || null,
            p.limit + 1,
            p.offset,
          ],
        )
      ).rows;
    res.json({
      items: rows.slice(0, p.limit),
      hasMore: rows.length > p.limit,
      offset: p.offset,
    });
  });
  api.get("/evidence/:id", async (req, res) => {
    auditor(req);
    const r = (
      await pool.query("SELECT * FROM evidence WHERE tenant_id=$1 AND id=$2", [
        req.actor.tenant,
        z.uuid().parse(req.params.id),
      ])
    ).rows[0];
    if (!r) throw new AppError(404, "EVIDENCE_NOT_FOUND");
    await transaction(pool, (db) =>
      ledger(db, req.actor.tenant, req.actor.oid, "evidence.read", r.id),
    );
    res.json({ ...r, hashValid: hash(r.payload) === r.sha256 });
  });
  api.get("/findings", async (req, res) =>
    res.json({ items: await findings(pool, req.actor.tenant) }),
  );
  api.get("/runs", async (req, res) =>
    res.json({
      items: (
        await pool.query(
          "SELECT * FROM runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200",
          [req.actor.tenant],
        )
      ).rows,
    }),
  );
  api.post("/sources/:id/reset", async (req, res) => {
    admin(req);
    const source = sourceById(req.params.id);
    if (!source) throw new AppError(404, "SOURCE_NOT_FOUND");
    await transaction(pool, async (db) => {
      const active = await db.query(
        "SELECT 1 FROM runs WHERE tenant_id=$1 AND source=$2 AND status IN ('queued','running')",
        [req.actor.tenant, source.id],
      );
      if (active.rowCount)
        throw new AppError(
          409,
          "SOURCE_BUSY",
          "Aguarde a coleta atual antes de reiniciar o cursor.",
        );
      await db.query(
        "DELETE FROM collection_cursors WHERE tenant_id=$1 AND source=$2",
        [req.actor.tenant, source.id],
      );
      await ledger(
        db,
        req.actor.tenant,
        req.actor.oid,
        "collection.cursor_reset",
        source.id,
      );
    });
    res.json({ ok: true });
  });
  api.post("/collect", async (req, res) => {
    admin(req);
    if (config.mode === "demo")
      throw new AppError(
        409,
        "DEMO_NO_COLLECTION",
        "A demonstração usa dados fictícios; conecte um tenant para coletar dados reais.",
      );
    const b = z
      .object({
        sources: z
          .array(
            z.enum(
              SOURCES.filter((s) => s.provider !== "bridge").map((s) => s.id),
            ),
          )
          .min(1)
          .max(SOURCES.length),
        backfillDays: z.number().int().min(1).max(6).optional(),
      })
      .strict()
      .parse(req.body);
    const result = [];
    for (const source of [...new Set(b.sources)])
      result.push({
        source,
        ...(await queueSource(
          pool,
          req.actor.tenant,
          source,
          req.actor.oid,
          b.backfillDays,
        )),
      });
    await transaction(pool, (db) =>
      ledger(
        db,
        req.actor.tenant,
        req.actor.oid,
        "collection.requested",
        "sources",
        { sources: b.sources, backfillDays: b.backfillDays },
      ),
    );
    res.status(202).json({ items: result });
  });
  api.put("/tenant/settings", async (req, res) => {
    admin(req);
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        sources: z.array(z.enum(SOURCES.map((s) => s.id))).max(SOURCES.length),
        subscriptions: z.array(z.uuid()).max(1000),
        workspaces: z
          .array(
            z
              .object({
                id: z.uuid(),
                tables: z
                  .array(
                    z.enum([
                      "AzureDiagnostics",
                      "StorageBlobLogs",
                      "StorageFileLogs",
                      "StorageQueueLogs",
                      "StorageTableLogs",
                      "AppServiceHTTPLogs",
                      "AZKVAuditLogs",
                    ]),
                  )
                  .min(1)
                  .max(7),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .parse(req.body);
    const { name, ...settings } = b;
    await transaction(pool, async (db) => {
      await db.query("UPDATE tenants SET name=$2,settings=$3 WHERE id=$1", [
        req.actor.tenant,
        name,
        JSON.stringify(settings),
      ]);
      await ledger(
        db,
        req.actor.tenant,
        req.actor.oid,
        "tenant.settings.updated",
        req.actor.tenant,
        { settings },
      );
    });
    res.json({ ok: true });
  });
  api.get("/ledger", async (req, res) => {
    auditor(req);
    res.json({
      items: (
        await pool.query(
          "SELECT * FROM audit_ledger WHERE tenant_id=$1 ORDER BY id DESC LIMIT 500",
          [req.actor.tenant],
        )
      ).rows,
    });
  });
  api.get("/integrity", async (req, res) => {
    auditor(req);
    res.json(await verifyLedger(pool, req.actor.tenant));
  });
  api.get("/export/events", async (req, res) => {
    auditor(req);
    const rows = (
      await pool.query(
        "SELECT * FROM events WHERE tenant_id=$1 ORDER BY COALESCE(occurred_at,observed_at) DESC,id LIMIT 10001",
        [req.actor.tenant],
      )
    ).rows;
    if (rows.length > 10000)
      throw new AppError(
        409,
        "EXPORT_LIMIT",
        "Refine ou use consultas paginadas para exportar mais de 10.000 eventos.",
      );
    await transaction(pool, (db) =>
      ledger(db, req.actor.tenant, req.actor.oid, "events.exported", "events", {
        count: rows.length,
      }),
    );
    res.set("Content-Disposition", 'attachment; filename="atlas-events.json"');
    res.json({
      tenant: req.actor.tenant,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      events: rows,
    });
  });
  api.use((_req, res) => res.status(404).json({ code: "API_NOT_FOUND" }));
  app.use("/api", api);
  app.use(
    express.static(fileURLToPath(new URL("../public", import.meta.url)), {
      maxAge: 0,
    }),
  );
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  app.use((err, req, res, _next) => {
    const status =
      err instanceof z.ZodError
        ? 400
        : err.code === "23505"
          ? 409
          : err.status || 500;
    const code =
      err instanceof z.ZodError
        ? "INVALID_INPUT"
        : err.code === "23505"
          ? "DUPLICATE"
          : err.code || "INTERNAL_ERROR";
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "http.error",
          status,
          code,
          requestId: req.requestId,
        }),
      );
    res.status(status).json({
      code: status >= 500 ? "SERVICE_UNAVAILABLE" : code,
      message:
        status >= 500
          ? "Serviço temporariamente indisponível."
          : err instanceof AppError
            ? err.message
            : "Dados inválidos ou solicitação duplicada.",
      requestId: req.requestId,
    });
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = loadConfig(),
    pool = await database(config);
  if (config.mode === "demo") {
    await migrate(pool);
    await seedDemo(pool);
  } else await pool.query("SELECT 1 FROM coverage LIMIT 1");
  const provider =
      config.mode === "microsoft" ? await createProvider(config) : null,
    stopWorker = provider
      ? startWorker(pool, config, provider)
      : async () => {};
  const app = createApp(config, pool),
    server = app.listen(
      config.port,
      config.production ? "0.0.0.0" : "127.0.0.1",
      () =>
        console.log(
          JSON.stringify({
            event: "atlas.ready",
            url: config.origin,
            mode: config.mode,
          }),
        ),
    );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      server.close(async () => {
        await stopWorker();
        app.locals.sessionStore.close();
        await pool.end();
        process.exit(0);
      }),
    );
}
