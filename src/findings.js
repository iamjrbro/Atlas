import { hash } from "./security.js";
export async function findings(pool, tenant) {
  const resources = (
    await pool.query(
      "SELECT key,name,kind,service,properties,evidence_id,last_seen FROM resources WHERE tenant_id=$1 AND active",
      [tenant],
    )
  ).rows;
  const edges = (
    await pool.query("SELECT * FROM edges WHERE tenant_id=$1 AND active", [
      tenant,
    ])
  ).rows;
  const out = [];
  const add = (r, rule, severity, title, description) =>
    out.push({
      id: hash([r.key, rule]),
      rule,
      severity,
      title,
      description,
      resourceKey: r.key,
      resourceName: r.name,
      service: r.service,
      evidenceId: r.evidence_id,
      observedAt: r.last_seen,
    });
  for (const r of resources) {
    const p = r.properties;
    if (r.kind === "application") {
      for (const cred of [
        ...(p.passwordCredentials || []),
        ...(p.keyCredentials || []),
      ]) {
        const end = new Date(cred.endDateTime).getTime(),
          days = Math.ceil((end - Date.now()) / 86400000);
        if (Number.isFinite(end) && days <= 30)
          add(
            r,
            "credential." + (cred.keyId || hash(cred)),
            days < 0 ? "high" : "medium",
            days < 0
              ? "Credencial expirada"
              : "Credencial próxima do vencimento",
            `${cred.displayName || cred.keyId || "Credencial"} · ${days < 0 ? "expirou" : "expira"} em ${cred.endDateTime}. A presença de credencial não comprova uso.`,
          );
      }
    }
    if (r.kind === "conditionalAccess" && p.state === "disabled")
      add(
        r,
        "ca.disabled",
        "medium",
        "Política de acesso condicional desabilitada",
        "Revise se a desativação é intencional. Isso não comprova ausência de outras políticas ou de MFA.",
      );
    if (r.kind === "device" && p.complianceState === "noncompliant")
      add(
        r,
        "device.noncompliant",
        "medium",
        "Dispositivo não conforme",
        "Estado informado pelo Intune. Consulte os detalhes de conformidade antes de restringir acessos.",
      );
    if (r.kind === "license") {
      const capacity = p.prepaidUnits?.enabled || 0,
        consumed = p.consumedUnits || 0;
      if (consumed > capacity)
        add(
          r,
          "license.overallocated",
          "high",
          "Consumo acima da capacidade habilitada",
          `${consumed} unidades consumidas e ${capacity} habilitadas; confirme o estado da assinatura.`,
        );
      else if (capacity > consumed)
        add(
          r,
          "license.available",
          "info",
          "Capacidade de licença disponível",
          `${capacity - consumed} unidades habilitadas não consumidas. Não é uma estimativa de desperdício ou de custo.`,
        );
    }
  }
  for (const edge of edges)
    if (
      edge.relation === "azure_role" &&
      /(8e3af657-a8ff-443c-a75c-2fe8c4bcb635|18d7d88d-d35e-4fb5-a5c3-7773c20a72d9)$/i.test(
        edge.role || "",
      )
    )
      out.push({
        id: hash([edge.key, "privileged"]),
        rule: "azure.privileged",
        severity: "high",
        title: "Atribuição Azure privilegiada observada",
        description:
          "Owner ou User Access Administrator no escopo coletado. Revise necessidade, condição e elegibilidade; não é confirmação de atividade maliciosa.",
        resourceKey: edge.to_key,
        resourceName: edge.scope,
        service: "Azure",
        evidenceId: edge.evidence_id,
        observedAt: edge.last_seen,
      });
  return out;
}
