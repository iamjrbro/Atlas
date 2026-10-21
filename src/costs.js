import { AppError, hash, safeUrl, withinScope } from "./security.js";
export function costRows(data, subscription, period) {
  if (!data) return []; // HTTP 204: successful query with no data.
  const p = data.properties;
  if (!Array.isArray(p?.columns) || !Array.isArray(p.rows))
    throw new AppError(502, "COST_SHAPE");
  const names = p.columns.map((c) => c.name.toLowerCase());
  for (const name of ["pretaxcost", "currency", "resourceid", "usagedate"])
    if (!names.includes(name)) throw new AppError(502, "COST_COLUMNS");
  return p.rows.map((row) => {
    const v = Object.fromEntries(names.map((name, i) => [name, row[i]]));
    if (
      typeof v.pretaxcost !== "number" ||
      !Number.isFinite(v.pretaxcost) ||
      !/^[A-Z]{3}$/.test(v.currency) ||
      !/^\d{8}$/.test(String(v.usagedate))
    )
      throw new AppError(502, "COST_VALUE");
    const resourceId = v.resourceid || null;
    if (
      resourceId &&
      !withinScope(resourceId, "/subscriptions/" + subscription)
    )
      throw new AppError(502, "COST_SCOPE");
    return {
      id: hash([
        subscription.toLowerCase(),
        period.from.slice(0, 7),
        String(v.usagedate),
        resourceId?.toLowerCase() || null,
        v.currency,
      ]),
      subscriptionId: subscription,
      resourceId,
      usageDate: String(v.usagedate),
      amount: v.pretaxcost,
      currency: v.currency,
      periodStart: period.from,
      periodEnd: period.to,
      costType: "ActualCost",
    };
  });
}
export async function collectCosts({
  tenant,
  subscriptions,
  provider,
  config,
  emit,
  heartbeat,
}) {
  const now = new Date(),
    period = {
      from: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString(),
      to: now.toISOString(),
    };
  let pages = 0;
  for (const sub of subscriptions) {
    const path = `/subscriptions/${sub}/providers/Microsoft.CostManagement/query`,
      body = {
        type: "ActualCost",
        timeframe: "Custom",
        timePeriod: period,
        dataset: {
          granularity: "Daily",
          aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
          grouping: [{ type: "Dimension", name: "ResourceId" }],
        },
      };
    let next = path + "?api-version=2025-03-01";
    const seen = new Set();
    while (next) {
      const url = safeUrl(next, "arm", tenant);
      if (url.pathname.toLowerCase() !== path.toLowerCase())
        throw new AppError(502, "COST_PAGINATION_SCOPE");
      if (seen.has(String(url))) throw new AppError(502, "PAGINATION_LOOP");
      seen.add(String(url));
      if (++pages > config.maxPages)
        throw new AppError(409, "COLLECTION_LIMIT");
      const { data } = await provider.call(tenant, "arm", String(url), {
        method: "POST",
        body,
      });
      await emit(costRows(data, sub, period));
      await heartbeat();
      next = data?.properties?.nextLink || null;
    }
  }
}
