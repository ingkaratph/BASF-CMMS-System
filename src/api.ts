export type Resource =
  | "assets"
  | "maintenance-plans"
  | "work-orders"
  | "spare-parts"
  | "stock-transactions"
  | "calibration-history";
export type Row = Record<string, string | number | boolean | null>;
export type Role = "READ_ONLY" | "OPERATOR" | "INTEGRATION" | "ADMIN";
export interface GatewayResponse {
  ok: boolean;
  requestId?: string;
  role: Role;
  data: Row[];
  error?: { code: string; message: string };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public requestId?: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api(
  resource: Resource,
  params: Record<string, string | number> = {},
  method = "GET",
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GatewayResponse> {
  const response = await fetch(
    `/api/cmms/${resource}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new ApiError(
      result.error?.message || "โหลดข้อมูลไม่สำเร็จ",
      result.requestId,
      result.error?.code,
    );
  if (method === "GET" && !Array.isArray(result.data))
    throw new ApiError(
      "รูปแบบข้อมูลจาก Gateway ไม่ตรงกับสัญญา API",
      result.requestId,
      "INVALID_DATA",
    );
  return result;
}
export function value(row: Row, key: string): Row[string] {
  const name = Object.keys(row).find(
    (k) => k.toLowerCase() === key.toLowerCase(),
  );
  return name ? row[name] : null;
}
export function str(row: Row, key: string) {
  return String(value(row, key) ?? "");
}
export function num(row: Row, key: string) {
  return Number(value(row, key) ?? 0);
}
export function canWrite(
  role: Role | undefined,
  method: string,
  resource: Resource,
) {
  if (
    ["stock-transactions", "calibration-history"].includes(resource) &&
    method !== "POST"
  )
    return false;
  return method === "POST"
    ? ["ADMIN", "OPERATOR", "INTEGRATION"].includes(role || "")
    : method === "PUT"
      ? ["ADMIN", "OPERATOR"].includes(role || "")
      : role === "ADMIN";
}
export function validDate(v: unknown) {
  return (
    !!v &&
    Number.isFinite(Date.parse(String(v))) &&
    new Date(String(v)).getFullYear() > 1901
  );
}
export function display(v: Row[string], key = "") {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "ใช่" : "ไม่";
  if (
    /date|transaction$|actualstart|actualfinish/i.test(key) &&
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(v)
  ) {
    if (!validDate(v)) return "ตรวจสอบวันที่";
    return new Intl.DateTimeFormat("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      timeZone: "Asia/Bangkok",
    }).format(new Date(v));
  }
  return String(v);
}
