import { randomBytes } from "node:crypto";
import { uuidPattern } from "./security.js";
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production",
    mode = env.APP_MODE || "demo";
  if (!["demo", "microsoft"].includes(mode) || (production && mode === "demo"))
    throw new Error("Produção exige APP_MODE=microsoft.");
  const origin = new URL(env.PUBLIC_ORIGIN || "http://localhost:3000");
  if (
    origin.origin !== (env.PUBLIC_ORIGIN || "http://localhost:3000") ||
    origin.username ||
    origin.password ||
    (production && origin.protocol !== "https:")
  )
    throw new Error("PUBLIC_ORIGIN inválida; produção exige origem HTTPS.");
  const required =
    mode === "microsoft"
      ? [
          "SESSION_SECRET",
          "DATABASE_URL",
          "WEB_CLIENT_ID",
          "WEB_CLIENT_SECRET",
          "COLLECTOR_CLIENT_ID",
        ]
      : [];
  for (const key of required)
    if (!env[key]) throw new Error("Configure " + key);
  for (const key of [
    "WEB_CLIENT_ID",
    "COLLECTOR_CLIENT_ID",
    "PUBLISHER_TENANT_ID",
  ])
    if (env[key] && !uuidPattern.test(env[key]))
      throw new Error(key + " inválido.");
  if (
    mode === "microsoft" &&
    !env.COLLECTOR_CLIENT_SECRET &&
    !(env.COLLECTOR_CERT_PATH && env.COLLECTOR_CERT_THUMBPRINT)
  )
    throw new Error("Configure uma credencial do collector.");
  if (mode === "microsoft" && env.SESSION_SECRET?.length < 43)
    throw new Error(
      "SESSION_SECRET exige pelo menos 43 caracteres aleatórios.",
    );
  if (production && env.DATABASE_SSL !== "require")
    throw new Error("Produção exige DATABASE_SSL=require.");
  if (env.DATABASE_URL) {
    const database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw new Error("DATABASE_URL deve apontar para PostgreSQL.");
    if (
      production &&
      ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"].some((k) =>
        database.searchParams.has(k),
      )
    )
      throw new Error(
        "Configure TLS por DATABASE_SSL e NODE_EXTRA_CA_CERTS; parâmetros SSL na URL não são aceitos em produção.",
      );
  }
  let bridgeKeys;
  try {
    bridgeKeys = JSON.parse(env.BRIDGE_HMAC_KEYS_JSON || "{}");
  } catch {
    throw new Error("BRIDGE_HMAC_KEYS_JSON inválido.");
  }
  for (const [tenant, key] of Object.entries(bridgeKeys))
    if (!uuidPattern.test(tenant) || typeof key !== "string" || key.length < 32)
      throw new Error("Chave bridge inválida.");
  const number = (key, fallback, min, max) => {
    const n = Number(env[key] || fallback);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(key + " inválido.");
    return n;
  };
  return {
    production,
    mode,
    origin: origin.origin,
    port: number("PORT", 3000, 1, 65535),
    databaseUrl: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "require",
    demoPath: env.DEMO_DATABASE_PATH || null,
    sessionSecret: env.SESSION_SECRET || randomBytes(48).toString("base64url"),
    webClientId: env.WEB_CLIENT_ID,
    webClientSecret: env.WEB_CLIENT_SECRET,
    collectorClientId: env.COLLECTOR_CLIENT_ID,
    collectorClientSecret: env.COLLECTOR_CLIENT_SECRET,
    certPath: env.COLLECTOR_CERT_PATH,
    certThumbprint: env.COLLECTOR_CERT_THUMBPRINT,
    publisher: env.PUBLISHER_TENANT_ID,
    autoOnboard: env.ALLOW_SELF_ONBOARDING === "true",
    trustProxy: number("TRUST_PROXY_HOPS", 0, 0, 5),
    interval: number("COLLECTION_INTERVAL_SECONDS", 900, 60, 86400),
    maxPages: number("MAX_PAGES_PER_RUN", 100, 1, 1000),
    maxRecords: number("MAX_RECORDS_PER_RUN", 50000, 100, 1000000),
    overlap: number("EVENT_OVERLAP_MINUTES", 60, 5, 1440),
    bridgeKeys,
  };
}
