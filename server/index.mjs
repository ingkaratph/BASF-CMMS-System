import "dotenv/config";
import express from "express";
import { randomBytes } from "node:crypto";
import { resolve,dirname,join } from "node:path";
import { readFileSync } from "node:fs";
import { validatePayload } from "./validation.mjs";
import {
  resources,
  canWrite,
  validateRequest,
  normalizeData,
} from "./gateway.mjs";

import { createUserStore } from "./users.mjs";
import { canAccess as policyAccess, canPerform as policyPerform } from "../shared/permissions.mjs";
import {createPermissionsStore} from './permissions-store.mjs';
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
const users = createUserStore(
  process.env.CMMS_USERS_FILE || "server/users.local.json",
  password,
);
const adminKey = process.env.CMMS_API_KEY_ADMIN || key;
const permissionStore=createPermissionsStore(process.env.CMMS_PERMISSIONS_FILE || join(dirname(process.env.CMMS_USERS_FILE || 'server/users.local.json'),'permissions.local.json'));
function canAccess(role,page){return policyAccess(role,page,permissionStore.read().roles)}
function canPerform(role,resource,method,row){return policyPerform(role,resource,method,row,permissionStore.read().roles)}
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
      return res.status(403).json({
        ok: false,
        error: { message: "Cross-origin request blocked" },
      });
  }
  next();
});
function currentUser(req) {
  const id = /(?:^|;\s*)cmms_session=([^;]+)/.exec(
    req.headers.cookie || "",
  )?.[1];
  const session = sessions.get(id);
  if (!session || session.expires <= Date.now()) return null;
  const user = users.get(session.userId);
  return user?.active && user.version === session.version && session.policyVersion === permissionStore.read().roleVersions[user.role] ? user : null;
}
function authenticated(req) {
  return !!currentUser(req);
}
app.get("/api/session", (req, res) => {
  const user = currentUser(req);
  res.json({
    authenticated: !!user,
    loginRequired: true,
    configured: !!key,
    user,
    role: user?.role,
    permissions:user?permissionStore.read().roles:undefined,
  });
});
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const attempt = attempts.get(ip);
  if (attempt && attempt.count >= 8 && attempt.until > Date.now())
    return res
      .status(429)
      .json({ ok: false, error: { message: "ลองใหม่ใน 15 นาที" } });
  const input = String(req.body.password || "");
  const user =
    input.length <= 128
      ? users.authenticate(req.body.username || "admin", input)
      : null;
  if (!user) {
    attempts.set(ip, {
      count: (attempt?.count || 0) + 1,
      until: Date.now() + 900000,
    });
    return res
      .status(401)
      .json({ ok: false, error: { message: "รหัสผ่านไม่ถูกต้อง" } });
  }
  const id = randomBytes(32).toString("hex");
  sessions.set(id, {
    expires: Date.now() + 8 * 60 * 60 * 1000,
    userId: user.id,
    version: user.version,
    policyVersion: permissionStore.read().roleVersions[user.role],
  });
  attempts.delete(ip);
  res.cookie("cmms_session", id, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ ok: true, user, role: user.role, permissions:permissionStore.read().roles });
});
app.post("/api/logout", (req, res) => {
  const id = /(?:^|;\s*)cmms_session=([^;]+)/.exec(
    req.headers.cookie || "",
  )?.[1];
  sessions.delete(id);
  res.clearCookie("cmms_session", { path: "/" });
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => {
  req.user = currentUser(req);
  if (!req.user)
    return res
      .status(401)
      .json({
        ok: false,
        error: { code: "LOGIN_REQUIRED", message: "กรุณาเข้าสู่ระบบ" },
      });
  next();
});
function forbidden(res) {
  return res
    .status(403)
    .json({
      ok: false,
      error: { code: "FORBIDDEN", message: "คุณไม่มีสิทธิ์ใช้ฟังก์ชันนี้" },
    });
}
app.get('/api/permissions',(req,res)=>{
  if(!canAccess(req.user.role,'users'))return forbidden(res);
  res.json({ok:true,data:permissionStore.read()});
});
app.put('/api/permissions/:role',(req,res)=>{
  if(!canAccess(req.user.role,'users'))return forbidden(res);
  try{res.json({ok:true,data:permissionStore.update(req.params.role,req.body.permissions,req.body.revision,req.user.username)})}
  catch(e){res.status(e.status||400).json({ok:false,error:{message:e.message}})}
});
app.get("/api/users", (req, res) =>
  canAccess(req.user.role, "users")
    ? res.json({ ok: true, data: users.list() })
    : forbidden(res),
);
app.post("/api/users", (req, res) => {
  if (!canAccess(req.user.role, "users")) return forbidden(res);
  try {
    res
      .status(201)
      .json({ ok: true, data: users.saveUser(null, req.body, req.user.id) });
  } catch (e) {
    res.status(400).json({ ok: false, error: { message: e.message } });
  }
});
app.put("/api/users/:id", (req, res) => {
  if (!canAccess(req.user.role, "users")) return forbidden(res);
  try {
    res.json({
      ok: true,
      data: users.saveUser(req.params.id, req.body, req.user.id),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: { message: e.message } });
  }
});
app.get("/api/reports", async (req, res) => {
  if (!canAccess(req.user.role, "reports")) return forbidden(res);
  try {
    const entries = await Promise.all(
      ["assets", "work-orders", "maintenance-plans", "spare-parts"].map(
        async (resource) => {
          const response = await upstream(
            resource,
            "GET",
            "limit=500",
            undefined,
            req.user.role === "ADMINISTRATOR" ? adminKey : key,
          );
          if (response.status >= 400 || !response.json.ok)
            throw new Error("เชื่อมต่อฐานข้อมูลไม่ได้");
          return [resource, normalizeData(response.json.data)];
        },
      ),
    );
    res.json({
      ok: true,
      role: req.user.role,
      data: Object.fromEntries(entries),
    });
  } catch {
    res
      .status(502)
      .json({ ok: false, error: { message: "เชื่อมต่อฐานข้อมูลไม่ได้" } });
  }
});
app.get("/api/lookups", (req, res) => {
  if (!authenticated(req)) return res.status(401).json({ ok: false });
  res.json({
    asOf: "2026-09-15",
    vendors:
      !canAccess(req.user.role,"calibration-history")
        ? []
        : JSON.parse(
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
async function upstream(
  resource,
  method = "GET",
  query = "",
  body,
  apiKey = key,
) {
  const response = await fetch(
    `${base}/cmms/api/${resource}${query ? "?" + query : ""}`,
    {
      method,
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
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
        message: "รูปแบบข้อมูลที่ได้รับไม่ถูกต้อง",
      },
    };
  }
  return { status: response.status, json };
}
app.all("/api/cmms/:resource", async (req, res) => {
  const { resource } = req.params;
  if (!canPerform(req.user.role, resource, req.method)) return forbidden(res);
  const error = validateRequest(resource, req.method, req.query, req.body);
  if (error)
    return res
      .status(resources.includes(resource) ? 400 : 404)
      .json({ ok: false, error: { code: "INVALID_REQUEST", message: error } });
  const payloadError = validatePayload(resource, req.method, req.body);
  if (payloadError)
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_PAYLOAD", message: payloadError },
    });
  const apiKey =
    req.user.role === "ADMINISTRATOR" || req.method === "DELETE"
      ? adminKey
      : key;
  if (!apiKey)
    return res.status(503).json({
      ok: false,
      error: {
        code: "API_KEY_REQUIRED",
        message:
          "เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาติดต่อผู้ดูแลระบบเพื่อตั้งค่าการเชื่อมต่อ",
      },
    });
  try {
    // Use the gateway's actual role, never a browser-provided role.
    if (req.method !== "GET") {
      const probe = await upstream(
        resource,
        "GET",
        req.query.id
          ? "id=" + encodeURIComponent(String(req.query.id))
          : "limit=1",
        undefined,
        apiKey,
      );
      if (probe.status >= 400 || !probe.json.ok)
        return res
          .status(probe.status >= 400 ? probe.status : 502)
          .json(probe.json);
      if (
        resource === "work-orders" &&
        ["PUT", "DELETE"].includes(req.method)
      ) {
        const row = normalizeData(probe.json.data).find(
          (r) => String(r.WorkOrderID) === String(req.query.id),
        );
        if (!row)
          return res
            .status(404)
            .json({ ok: false, error: { message: "ไม่พบใบงาน" } });
        if (!canPerform(req.user.role, resource, req.method, row))
          return forbidden(res);
      }
      if (!canWrite(probe.json.role, req.method, resource))
        return res.status(403).json({
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
      apiKey,
    );
    if (json.ok) {
      json.data = normalizeData(json.data);
      if (!canAccess(req.user.role,resource)) {
        const fields={
          'spare-parts':['PartID','PartCode','PartName','Quantity','Unit'],
          'assets':['AssetID','MachineCode','TagNo','AssetName'],
          'work-orders':['WorkOrderID','WorkOrderNo','Title'],
          'maintenance-plans':['PlanID','MachineCode','TagNo','TaskDescription']
        }[resource]||[];
        json.data=json.data.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]??null])));
      }
      json.role = req.user.role;
    }
    res.status(status).json(json);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: {
        code: "GATEWAY_UNAVAILABLE",
        message:
          error.name === "TimeoutError"
            ? "เชื่อมต่อฐานข้อมูลไม่ได้"
            : "เชื่อมต่อฐานข้อมูลไม่ได้",
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
  res.status(err.status === 413 ? 413 : 400).json({
    ok: false,
    error: { code: "BAD_REQUEST", message: "Invalid request body" },
  }),
);
app.listen(port, host, () =>
  console.log(`BASF CHEMCAT CMMS running at http://${host}:${port}`),
);
