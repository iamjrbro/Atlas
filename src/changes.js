import { canonical, AppError } from "./security.js";

// JSON pointers distinguish a missing property from an explicit null. Large
// values remain available in evidence; the visual comparison is bounded.
export function compareValues(
  before,
  after,
  { maxChanges = 200, maxDepth = 32 } = {},
) {
  const changes = [];
  let truncated = false;
  function walk(a, b, path, aExists, bExists, depth) {
    if (aExists === bExists && canonical(a) === canonical(b)) return;
    if (changes.length >= maxChanges) {
      truncated = true;
      return;
    }
    const objects =
      aExists &&
      bExists &&
      a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b);
    if (objects && depth < maxDepth) {
      for (const key of [
        ...new Set([...Object.keys(a), ...Object.keys(b)]),
      ].sort()) {
        walk(
          a[key],
          b[key],
          path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"),
          Object.hasOwn(a, key),
          Object.hasOwn(b, key),
          depth + 1,
        );
      }
    } else {
      const preview = (value, exists) => {
        if (!exists) return { present: false };
        const text = JSON.stringify(value);
        return text.length > 1000
          ? { present: true, text: text.slice(0, 1000), truncated: true }
          : { present: true, value };
      };
      changes.push({
        path: path || "/",
        operation: !aExists ? "added" : !bExists ? "removed" : "changed",
        before: preview(a, aExists),
        after: preview(b, bExists),
      });
    }
  }
  walk(before, after, "", before !== undefined, after !== undefined, 0);
  return { changes, truncated };
}

export async function resourceHistory(
  pool,
  tenant,
  key,
  { limit = 20, offset = 0 } = {},
) {
  const resource = (
    await pool.query(
      "SELECT key,name,source FROM resources WHERE tenant_id=$1 AND key=$2",
      [tenant, key],
    )
  ).rows[0];
  if (!resource) throw new AppError(404, "RESOURCE_NOT_FOUND");
  const rows = (
    await pool.query(
      "SELECT id,source,observed_at,occurred_at,actor_name,evidence_id,properties FROM events WHERE tenant_id=$1 AND target_key=$2 AND category='inventory' ORDER BY observed_at DESC,id DESC LIMIT $3 OFFSET $4",
      [tenant, key, limit + 1, offset],
    )
  ).rows;
  const providerEvents = (
    await pool.query(
      "SELECT id,source,operation,actor_name,occurred_at,observed_at,evidence_id FROM events WHERE tenant_id=$1 AND target_key=$2 AND category<>'inventory' ORDER BY COALESCE(occurred_at,observed_at) DESC,id DESC LIMIT 20",
      [tenant, key],
    )
  ).rows;
  return {
    resource,
    offset,
    providerEvents,
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      source: row.source,
      observedAt: row.observed_at,
      occurredAt: row.occurred_at,
      actor: row.actor_name,
      evidenceId: row.evidence_id,
      beforeEvidenceId: row.properties.beforeEvidenceId || null,
      ...compareValues(row.properties.before, row.properties.after),
    })),
    limitations: [
      "Comparações mostram quando a mudança foi detectada; não determinam autor nem horário real da operação.",
      "A primeira observação é uma linha de base, sem estado anterior. Valores extensos podem ser abreviados; consulte a evidência.",
    ],
  };
}
