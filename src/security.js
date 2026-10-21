import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import { intuneFamilies } from "./intune-sources.js";
export class AppError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const random = () => randomBytes(32).toString("base64url");
export const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : canonical(v))
    .digest("hex");
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v ?? null);
}
export function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
export function requireRole(actor, roles) {
  if (!actor || !actor.roles?.some((r) => roles.includes(r)))
    throw new AppError(
      403,
      "FORBIDDEN",
      "Seu papel não permite esta operação.",
    );
}
export function csrf(req, origin) {
  if (
    req.get("origin") !== origin ||
    !equal(req.get("x-csrf-token"), req.session.csrf)
  )
    throw new AppError(403, "CSRF", "Origem ou proteção CSRF inválida.");
}
export const hmac = (secret, text) =>
  createHmac("sha256", secret).update(text).digest("hex");
export function verifyBridge({
  secret,
  timestamp,
  nonce,
  body,
  signature,
  now = Date.now(),
}) {
  if (
    !secret ||
    secret.length < 32 ||
    !/^\d{13}$/.test(timestamp || "") ||
    Math.abs(now - Number(timestamp)) > 300000 ||
    !/^[a-zA-Z0-9_-]{20,100}$/.test(nonce || "") ||
    !equal(
      signature,
      hmac(secret, `${timestamp}.${nonce}.${hash(body.toString("utf8"))}`),
    )
  )
    throw new AppError(
      401,
      "BRIDGE_SIGNATURE",
      "Assinatura da coleta inválida ou expirada.",
    );
}
export function withinScope(resource, scope) {
  const a = String(resource).toLowerCase().replace(/\/$/, ""),
    b = String(scope).toLowerCase().replace(/\/$/, "");
  return a === b || a.startsWith(b + "/");
}
export function safeUrl(value, kind, tenant) {
  const bases = {
    graph: "https://graph.microsoft.com/v1.0/",
    arm: "https://management.azure.com/",
    m365: `https://manage.office.com/api/v1.0/${tenant}/activity/feed/`,
    logs: "https://api.loganalytics.azure.com/v1/",
  };
  if (!bases[kind]) throw new AppError(500, "INVALID_PROVIDER");
  const base = new URL(bases[kind]),
    url = new URL(value, base);
  const intuneBeta =
    kind === "graph" &&
    url.pathname.startsWith("/beta/") &&
    [
      ...intuneFamilies.map((x) => x[2]),
      "deviceManagement/assignmentFilters",
      "deviceManagement/deviceCompliancePolicies",
      "deviceManagement/deviceConfigurations",
      "deviceAppManagement/mobileApps",
    ].some(
      (path) =>
        url.pathname === "/beta/" + path ||
        url.pathname.startsWith("/beta/" + path + "/"),
    );
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !(url.pathname.startsWith(base.pathname) || intuneBeta)
  )
    throw new AppError(
      400,
      "UNTRUSTED_PROVIDER_URL",
      "URL de paginação fora da origem ou do tenant esperado.",
    );
  return url;
}
export function claimsIdentity(p, { tenant, clientId, nonce }) {
  if (
    p.tid !== tenant ||
    p.aud !== clientId ||
    p.nonce !== nonce ||
    !uuidPattern.test(p.oid || "") ||
    !Array.isArray(p.roles) ||
    Date.now() / 1000 - p.iat > 600
  )
    throw new AppError(401, "INVALID_IDENTITY");
  const roles = p.roles.filter((r) =>
    ["Atlas.Reader", "Atlas.Auditor", "Atlas.Admin"].includes(r),
  );
  if (!roles.length)
    throw new AppError(
      403,
      "NO_APP_ROLE",
      "Solicite um papel Atlas no aplicativo empresarial.",
    );
  return {
    tenant,
    oid: p.oid,
    name: String(p.name || p.preferred_username || "Usuário"),
    roles,
  };
}
