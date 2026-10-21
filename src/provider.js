import { ConfidentialClientApplication } from "@azure/msal-node";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AppError, safeUrl, uuidPattern } from "./security.js";
const scopes = {
  graph: "https://graph.microsoft.com/.default",
  arm: "https://management.azure.com/.default",
  m365: "https://manage.office.com/.default",
  logs: "https://api.loganalytics.io/.default",
};
export async function createProvider(
  config,
  {
    fetcher = fetch,
    getToken,
    sleeper = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const clients = new Map();
  let cert;
  if (config.certPath)
    cert = {
      thumbprintSha256: config.certThumbprint,
      privateKey: await readFile(config.certPath, "utf8"),
    };
  async function token(tenant, kind) {
    if (getToken) return getToken(tenant, kind);
    if (!uuidPattern.test(tenant)) throw new AppError(400, "INVALID_TENANT");
    let client = clients.get(tenant);
    if (!client) {
      client = new ConfidentialClientApplication({
        auth: {
          clientId: config.collectorClientId,
          authority: `https://login.microsoftonline.com/${tenant}`,
          ...(cert
            ? { clientCertificate: cert }
            : { clientSecret: config.collectorClientSecret }),
        },
      });
      if (clients.size >= 200) clients.delete(clients.keys().next().value);
      clients.set(tenant, client);
    }
    let result;
    try {
      result = await client.acquireTokenByClientCredential({
        scopes: [scopes[kind]],
      });
    } catch {
      const error = new AppError(
        403,
        "COLLECTOR_AUTH",
        "Não foi possível autenticar o collector. Verifique credencial, consentimento e tenant.",
      );
      error.providerStatus = 403;
      throw error;
    }
    if (!result?.accessToken) throw new AppError(502, "PROVIDER_TOKEN");
    return result.accessToken;
  }
  async function call(tenant, kind, path, { method = "GET", body } = {}) {
    const url = safeUrl(path, kind, tenant);
    if (
      !["GET", "POST"].includes(method) ||
      (method === "POST" &&
        !(
          (kind === "arm" &&
            (url.pathname === "/providers/Microsoft.ResourceGraph/resources" ||
              /^\/subscriptions\/[0-9a-f-]{36}\/providers\/Microsoft\.CostManagement\/query$/i.test(
                url.pathname,
              ))) ||
          (kind === "logs" &&
            /^\/v1\/workspaces\/[0-9a-f-]+\/query$/.test(url.pathname))
        ))
    )
      throw new AppError(403, "COLLECTOR_READ_ONLY");
    let last;
    for (let attempt = 0; attempt < 4; attempt++) {
      const id = randomUUID();
      const accessToken = await token(tenant, kind);
      let response;
      try {
        response = await fetcher(url, {
          method,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "client-request-id": id,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        if (attempt === 3) throw new AppError(502, "PROVIDER_NETWORK");
        await sleeper(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        if (response.status === 204) return {};
        const text = await response.text();
        if (text.length > 30_000_000)
          throw new AppError(413, "PROVIDER_RESPONSE_TOO_LARGE");
        try {
          return { data: JSON.parse(text), headers: response.headers };
        } catch {
          throw new AppError(502, "PROVIDER_INVALID_JSON");
        }
      }
      const status = response.status;
      last = new AppError(
        status === 401 || status === 403 ? 403 : 502,
        "PROVIDER_" + status,
      );
      last.providerStatus = status;
      last.correlation = id;
      if (![429, 500, 502, 503, 504].includes(status) || attempt === 3)
        throw last;
      const ra =
          response.headers.get(
            "x-ms-ratelimit-microsoft.consumption-retry-after",
          ) || response.headers.get("retry-after"),
        seconds = Number(ra),
        delay =
          Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : 1000 * 2 ** attempt;
      if (delay > 30000) {
        last.retryAt = new Date(Date.now() + delay).toISOString();
        throw last;
      }
      await sleeper(delay);
    }
    throw last;
  }
  async function* pages(tenant, kind, path, { limit = config.maxPages } = {}) {
    let next = path,
      count = 0;
    const seen = new Set();
    while (next) {
      const url = String(safeUrl(next, kind, tenant));
      if (seen.has(url)) throw new AppError(502, "PAGINATION_LOOP");
      seen.add(url);
      if (++count > limit) throw new AppError(409, "COLLECTION_LIMIT");
      const r = await call(tenant, kind, url);
      if (!Array.isArray(r.data) && !Array.isArray(r.data.value))
        throw new AppError(502, "PROVIDER_SHAPE");
      yield Array.isArray(r.data) ? r.data : r.data.value;
      next =
        r.data["@odata.nextLink"] ||
        r.data.nextLink ||
        r.headers.get("NextPageUri");
    }
  }
  return { call, pages };
}
