import { coverage } from "./store.js";

export const PROBES = {
  "Entra ID": ["entra.organization", "entra.users"],
  Intune: ["intune.devices", "intune.configuration", "intune.catalog"],
  Azure: ["azure.subscriptions"],
  "Microsoft 365": ["m365.licenses"],
  SharePoint: ["sharepoint.sites"],
  Teams: ["teams.teams"],
  "Exchange Online": ["audit.exchange"],
};
export function diagnoseSource(
  source,
  { mode, interval = 900, now = Date.now() } = {},
) {
  const code = source.detail?.code || null;
  let state = "unverified",
    action = "Habilite a fonte e execute uma coleta para verificar a conexão.";
  if (!source.enabled) {
    state = "disabled";
    action =
      "Habilite esta fonte em Conectar meu tenant se ela fizer parte do escopo desejado.";
  } else if (source.status === "forbidden" || code === "COLLECTOR_AUTH") {
    state = "blocked";
    action =
      "Confira credencial do collector, consentimento administrativo e a permissão exigida. Um 403 também pode refletir licença ou restrição do serviço; o código sozinho não identifica a causa.";
  } else if (code === "WORKSPACE_REQUIRED") {
    state = "setup";
    action =
      "Configure os workspaces e tabelas existentes; habilite os diagnostic settings no Azure.";
  } else if (code === "NO_AZURE_SCOPE") {
    state = "setup";
    action =
      "Confira o tenant, a lista de assinaturas e o papel Reader do collector nos escopos desejados.";
  } else if (code === "AZURE_INVENTORY_REQUIRED") {
    state = "setup";
    action = "Colete azure.resources antes de solicitar as configurações ARM.";
  } else if (code === "M365_SUBSCRIPTION_REQUIRED") {
    state = "setup";
    action =
      "Confira Unified Audit, ActivityFeed.Read e a ativação explícita da subscription do feed.";
  } else if (source.provider === "bridge" && !source.last_success) {
    state = "setup";
    action =
      "Instale e agende o bridge PowerShell deste workload; configure certificado, acesso de leitura e chave HMAC do tenant.";
  } else if (source.status === "gap") {
    state = "gap";
    action =
      "A janela excedeu a retenção disponível. Verifique exportação externa e planeje reconciliação; dados expirados podem não ser recuperáveis.";
  } else if (source.status === "partial") {
    state = "partial";
    action =
      "Há coleta incompleta. Confira limite, cursor e erros por recurso antes de usar os dados como inventário completo.";
  } else if (source.status === "failed" || source.status === "needs_setup") {
    state = "failed";
    action =
      "Investigue o código, a correlação e a configuração do serviço. Reexecute a fonte após corrigir a causa; não amplie permissões sem identificar a necessidade.";
  } else if (source.status === "success" && source.last_success) {
    const age = now - new Date(source.last_success).getTime(),
      stale = age < 0 || age > Math.max(interval * 3 * 1000, 3600000);
    state = stale ? "stale" : "observed";
    action = stale
      ? "O último sucesso é antigo. Confira worker, agendamento e última execução."
      : "Uma coleta recente concluiu neste escopo. Isso não comprova acesso a todo o serviço.";
  }
  if (
    (mode === "demo" || source.detail?.fixture === true) &&
    source.status === "success" &&
    source.enabled
  ) {
    state = "simulated";
    action =
      "Resultado de fixture fictícia; nenhuma conexão ou permissão Microsoft foi verificada.";
  }
  return {
    id: source.id,
    name: source.name,
    service: source.service,
    provider: source.provider,
    enabled: source.enabled,
    state,
    permission: source.permission,
    code,
    lastSuccess: source.last_success || null,
    lastAttempt: source.last_attempt || null,
    records: source.records || 0,
    correlation: source.detail?.correlation || null,
    retryAt: source.detail?.retryAt || null,
    action,
  };
}
export async function connectionDiagnostics(pool, tenant, config) {
  const rows = await coverage(pool, tenant),
    items = rows.map((s) =>
      diagnoseSource(s, { mode: config.mode, interval: config.interval }),
    );
  const services = [...new Set(items.map((s) => s.service))].map((name) => {
    const sources = items.filter((s) => s.service === name),
      enabled = sources.filter((s) => s.enabled),
      summary = {};
    for (const s of enabled) summary[s.state] = (summary[s.state] || 0) + 1;
    return {
      name,
      sources,
      summary,
      probes: (PROBES[name] || []).filter((id) =>
        enabled.some((s) => s.id === id),
      ),
      observed: enabled.filter((s) => s.state === "observed").length,
      totalEnabled: enabled.length,
    };
  });
  const tenantRow = (
    await pool.query("SELECT settings FROM tenants WHERE id=$1", [tenant])
  ).rows[0];
  return {
    mode: config.mode,
    generatedAt: new Date().toISOString(),
    services,
    configuration: {
      collectorConfigured:
        !!config.collectorClientId &&
        !!(
          config.collectorClientSecret ||
          (config.certPath && config.certThumbprint)
        ),
      workspaces: tenantRow?.settings.workspaces?.length || 0,
      subscriptionScope: tenantRow?.settings.subscriptions?.length
        ? "Lista explícita de assinaturas"
        : "Todas as assinaturas que o collector consegue enumerar",
      bridgeKeyConfigured: !!config.bridgeKeys?.[tenant],
    },
    limitations: [
      "Diagnóstico usa configuração e resultados das coletas; não inspeciona segredos nem presume que um consentimento foi concedido.",
      "As verificações enfileiram coletas de leitura em fontes representativas, não um teste universal de todas as permissões do serviço.",
      "Uma fonte com sucesso e zero registros não prova que o tenant está vazio. Compare escopos e resultados com o portal Microsoft.",
    ],
  };
}
