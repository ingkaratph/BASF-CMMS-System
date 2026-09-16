export const resources = [
  "assets",
  "maintenance-plans",
  "work-orders",
  "spare-parts",
  "stock-transactions",
  "calibration-history",
];
export const immutable = ["stock-transactions", "calibration-history"];
export function normalizeData(data) {
  const rows = Array.isArray(data)
    ? data
    : (data?.recordset ?? data?.recordsets?.[0]);
  if (!Array.isArray(rows)) throw new Error("Unexpected gateway data format");
  return rows.map((row) => {
    const copy = { ...row };
    for (const [to, from] of [
      ["StatusCode", "AssetStatus"],
      ["CriticalityCode", "Criticality"],
      ["FrequencyUnitCode", "FrequencyUnit"],
      ["TransactionTypeCode", "TransactionType"],
    ]) {
      if (copy[to] === undefined && copy[from] !== undefined)
        copy[to] =
          typeof copy[from] === "string"
            ? copy[from].toUpperCase()
            : copy[from];
    }
    return copy;
  });
}
export function canWrite(role, method, resource) {
  if (method === "GET") return true;
  if (immutable.includes(resource) && method !== "POST") return false;
  return method === "POST"
    ? ["OPERATOR", "INTEGRATION", "ADMIN"].includes(role)
    : method === "PUT"
      ? ["OPERATOR", "ADMIN"].includes(role)
      : method === "DELETE" && role === "ADMIN";
}
export function validateRequest(resource, method, query, body) {
  if(resource==='spare-parts'&&['department','partType'].some(k=>query[k]!==undefined&&(typeof query[k]!=='string'||query[k].length>100)))return 'Invalid part filter';
  if (!resources.includes(resource)) return "Unknown resource";
  if (!["GET", "POST", "PUT", "DELETE"].includes(method))
    return "Method not allowed";
  if (immutable.includes(resource) && ["PUT", "DELETE"].includes(method))
    return "Historical records cannot be changed";
  if (["PUT", "DELETE"].includes(method) && !query.id)
    return "A record ID is required";
  if (query.id && !/^[1-9]\d*$/.test(String(query.id)))
    return "Invalid record ID";
  if (
    query.limit &&
    (!/^\d+$/.test(String(query.limit)) ||
      +query.limit < 1 ||
      +query.limit > 500)
  )
    return "Limit must be between 1 and 500";
  if (
    query.search &&
    (typeof query.search !== "string" || query.search.length > 100)
  )
    return "Search must be at most 100 characters";
  if (
    ["POST", "PUT"].includes(method) &&
    (!body ||
      Array.isArray(body) ||
      typeof body !== "object" ||
      !Object.keys(body).length)
  )
    return "A nonempty JSON object is required";
  return null;
}
