import {type AppRole} from "../shared/permissions.mjs";
import {canPerform} from "./access";
export type Resource =
  | "assets"
  | "maintenance-plans"
  | "work-orders"
  | "spare-parts"
  | "stock-transactions"
  | "calibration-history";
export type Row = Record<string, string | number | boolean | null>;
export type Role = AppRole;
export interface User {
  id: string;
  username: string;
  displayName: string;
  department?: string;
  role: Role;
  active: boolean;
  version: number;
}
export interface GatewayResponse {
  ok: boolean;
  requestId?: string;
  role: Role;
  data: Row[];
  total?: number;
  facets?: {departments:string[];partTypes:string[]};
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
  if (response.status === 401 && result.error?.code === "LOGIN_REQUIRED")
    window.dispatchEvent(new Event("cmms-session-expired"));
  if (!response.ok || !result.ok)
    throw new ApiError(
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504 ||
      /node[-\s]?red/i.test(result.error?.message || "")
        ? "เชื่อมต่อฐานข้อมูลไม่ได้"
        : result.error?.message || "โหลดข้อมูลไม่สำเร็จ",
      result.requestId,
      result.error?.code,
    );
  if (method === "GET" && !Array.isArray(result.data))
    throw new ApiError(
      "รูปแบบข้อมูลที่ได้รับไม่ถูกต้อง",
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
  row?: Row,
) {
  return canPerform(role, resource, method, row);
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
