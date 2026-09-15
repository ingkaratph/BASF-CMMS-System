import "dotenv/config";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { validatePayload } from "./validation.mjs";
import {
  resources,
  canWrite,
  validateRequest,
  normalizeData,
} from "./gateway.mjs";

const app = express();
const port = Number(process.env.PORT || 80);
const host = process.env.HOST || "0.0.0.0";
const password = process.env.CMMS_APP_PASSWORD || "";
const key =
  process.env.CMMS_API_KEY ||
  process.env.CMMS_API_KEY_OPERATOR ||
  process.env.CMMS_API_KEY_READONLY ||
  "";
const base = (process.env.CMMS_API_BASE_URL || "http://pd.local:1880").replace(
  /\/$/,
  "",
);
if (!["127.0.0.1", "localhost", "::1"].includes(host) && password.length < 16)
  throw new Error(
    "LAN access requires CMMS_APP_PASSWORD with at least 16 characters.",
  );
const sessions = new Map();
const attempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id);
  for (const [ip, s] of attempts) if (s.until < now) attempts.delete(ip);
}, 60000).unref();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!password && !["127.0.0.1", "localhost", "[::1]"].includes(req.hostname))
    return res.status(403).send("Untrusted host");
  next();
});
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin).host;
    } catch {
      return res
        .status(403)
        .json({ ok: false, error: { message: "Invalid origin" } });
    }
    if (origin !== req.headers.host)
      return res
        .status(403)
        .json({
          ok: false,
          error: { message: "Cross-origin request blocked" },
        });
  }
  next();
});
function authenticated(req) {
  if (!password) return true;
  const id = /(?:^|;\s*)cmms_session=([^;]+)/.exec(
    req.headers.cookie || "",
  )?.[1];
  const s = sessions.get(id);
  return !!s && s.expires > Date.now();
}
app.get("/api/session", (req, res) =>
  res.json({
    authenticated: authenticated(req),
    loginRequired: !!password,
    configured: !!key,
  }),
);
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const attempt = attempts.get(ip);
  if (attempt && attempt.count >= 8 && attempt.until > Date.now())
    return res
      .status(429)
      .json({ ok: false, error: { message: "ลองใหม่ใน 15 นาที" } });
  const input = Buffer.from(String(req.body.password || ""));
  const expected = Buffer.from(password);
  if (
    !password ||
    input.length !== expected.length ||
    !timingSafeEqual(input, expected)
  ) {
    attempts.set(ip, {
      count: (attempt?.count || 0) + 1,
      until: Date.now() + 900000,
    });
    return res
      .status(401)
      .json({ ok: false, error: { message: "รหัสผ่านไม่ถูกต้อง" } });
  }
  const id = randomBytes(32).toString("hex");
  sessions.set(id, { expires: Date.now() + 8 * 60 * 60 * 1000 });
  attempts.delete(ip);
  res.cookie("cmms_session", id, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  const id = /(?:^|;\s*)cmms_session=([^;]+)/.exec(
    req.headers.cookie || "",
  )?.[1];
  sessions.delete(id);
  res.clearCookie("cmms_session", { path: "/" });
  res.json({ ok: true });
});
app.use("/api/cmms", (req, res, next) =>
  authenticated(req)
    ? next()
    : res
        .status(401)
        .json({
          ok: false,
          error: { code: "LOGIN_REQUIRED", message: "กรุณาเข้าสู่ระบบ" },
        }),
);
app.get("/api/lookups", (req, res) => {
  if (!authenticated(req)) return res.status(401).json({ ok: false });
  res.json({
    asOf: "2026-09-15",
    vendors: JSON.parse(
      readFileSync(new URL("./vendors.json", import.meta.url), "utf8"),
    ),
    warehouses: [
      {
        WarehouseID: 1,
        WarehouseName: "EM-MAIN · EM Spare Part Main Warehouse",
      },
    ],
  });
});
async function upstream(resource, method = "GET", query = "", body) {
  const response = await fetch(
    `${base}/cmms/api/${resource}${query ? "?" + query : ""}`,
    {
      method,
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  let json;
  try {
    json = await response.json();
  } catch {
    json = {
      ok: false,
      error: {
        code: "UPSTREAM_FORMAT",
        message: "Gateway returned a non-JSON response",
      },
    };
  }
  return { status: response.status, json };
}
app.all("/api/cmms/:resource", async (req, res) => {
  const { resource } = req.params;
  const error = validateRequest(resource, req.method, req.query, req.body);
  if (error)
    return res
      .status(resources.includes(resource) ? 400 : 404)
      .json({ ok: false, error: { code: "INVALID_REQUEST", message: error } });
  const payloadError = validatePayload(resource, req.method, req.body);
  if (payloadError)
    return res
      .status(400)
      .json({
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: payloadError },
      });
  if (!key)
    return res
      .status(503)
      .json({
        ok: false,
        error: {
          code: "API_KEY_REQUIRED",
          message:
            "ยังไม่ได้ตั้งค่า CMMS_API_KEY บนเซิร์ฟเวอร์ กรุณาใช้ Key จาก Node-RED",
        },
      });
  try {
    // Use the gateway's actual role, never a browser-provided role.
    if (req.method !== "GET") {
      const probe = await upstream(resource, "GET", "limit=1");
      if (probe.status >= 400 || !probe.json.ok)
        return res
          .status(probe.status >= 400 ? probe.status : 502)
          .json(probe.json);
      if (!canWrite(probe.json.role, req.method, resource))
        return res
          .status(403)
          .json({
            ok: false,
            requestId: probe.json.requestId,
            error: {
              code: "FORBIDDEN",
              message: "บทบาทนี้ไม่มีสิทธิ์ดำเนินการ",
            },
          });
    }
    const query = new URLSearchParams();
    for (const field of ["id", "search", "limit"])
      if (req.query[field] !== undefined)
        query.set(field, String(req.query[field]));
    const { status, json } = await upstream(
      resource,
      req.method,
      query.toString(),
      ["POST", "PUT"].includes(req.method) ? req.body : undefined,
    );
    if (json.ok) json.data = normalizeData(json.data);
    res.status(status).json(json);
  } catch (error) {
    res
      .status(502)
      .json({
        ok: false,
        error: {
          code: "GATEWAY_UNAVAILABLE",
          message:
            error.name === "TimeoutError"
              ? "Gateway timed out"
              : "เชื่อมต่อ Node-RED ไม่สำเร็จ ตรวจสอบเครือข่าย",
        },
      });
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ ok: false, error: { message: "Unknown API route" } }),
);
if (process.argv.includes("--production")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((err, req, res, next) =>
  res
    .status(err.status === 413 ? 413 : 400)
    .json({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Invalid request body" },
    }),
);
app.listen(port, host, () =>
  console.log(`BASF CHEMCAT CMMS running at http://${host}:${port}`),
);
