import { ConfidentialClientApplication } from "@azure/msal-node";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { uuidPattern } from "../src/security.js";
const c = loadConfig(),
  args = process.argv.slice(2),
  tenant = args[args.indexOf("--tenant") + 1];
if (
  c.mode !== "microsoft" ||
  !args.includes("--confirm") ||
  !args.includes("--tenant") ||
  !uuidPattern.test(tenant || "")
)
  throw new Error(
    "Use APP_MODE=microsoft e node scripts/start-m365-feeds.js --tenant UUID --confirm. Isso inicia quatro subscriptions de auditoria no tenant.",
  );
const credential = c.certPath
  ? {
      clientCertificate: {
        thumbprintSha256: c.certThumbprint,
        privateKey: await readFile(c.certPath, "utf8"),
      },
    }
  : { clientSecret: c.collectorClientSecret };
const client = new ConfidentialClientApplication({
    auth: {
      clientId: c.collectorClientId,
      authority: `https://login.microsoftonline.com/${tenant}`,
      ...credential,
    },
  }),
  token = await client.acquireTokenByClientCredential({
    scopes: ["https://manage.office.com/.default"],
  });
for (const type of [
  "Audit.Exchange",
  "Audit.SharePoint",
  "Audit.General",
  "Audit.AzureActiveDirectory",
]) {
  const u = new URL(
    `https://manage.office.com/api/v1.0/${tenant}/activity/feed/subscriptions/start`,
  );
  u.searchParams.set("contentType", type);
  if (c.publisher) u.searchParams.set("PublisherIdentifier", c.publisher);
  const response = await fetch(u, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${token.accessToken}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `${type}: HTTP ${response.status}. Verifique consentimento e Unified Audit.`,
    );
  console.log(type + ": subscription ativada.");
}
