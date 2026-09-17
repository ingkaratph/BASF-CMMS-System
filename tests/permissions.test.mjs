import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { canAccess, canPerform, roles } from "../shared/permissions.mjs";
import { createUserStore } from "../server/users.mjs";

test("role matrix, master protection, history lock and navigation boundaries", () => {
  for (const role of roles)
    assert.equal(canPerform(role, "assets", "GET"), true);
  for (const resource of ["assets", "maintenance-plans", "spare-parts"]) {
    for (const method of ["POST", "PUT", "DELETE"])
      assert.equal(canPerform("ADMINISTRATOR", resource, method), true);
    assert.equal(canPerform("PLANNER", resource, "POST"), true);
    assert.equal(canPerform("PLANNER", resource, "PUT"), true);
    assert.equal(canPerform("PLANNER", resource, "DELETE"), false);
    for (const role of ["TECHNICIAN", "PRODUCTION"])
      for (const method of ["POST", "PUT", "DELETE"])
        assert.equal(canPerform(role, resource, method), false);
  }
  for (const role of ["PLANNER", "TECHNICIAN", "PRODUCTION"])
    for (const status of ["COMPLETED", "CLOSED", "CANCELLED"])
      for (const method of ["PUT", "DELETE"])
        assert.equal(
          canPerform(role, "work-orders", method, { StatusCode: status }),
          false,
        );
  for (const role of roles)
    for (const resource of ["stock-transactions", "calibration-history"])
      for (const method of ["PUT", "DELETE"])
        assert.equal(canPerform(role, resource, method), false);
  assert.equal(
    canPerform("TECHNICIAN", "work-orders", "PUT", { StatusCode: "OPEN" }),
    true,
  );
  assert.equal(
    canPerform("PLANNER", "work-orders", "DELETE", { StatusCode: "OPEN" }),
    true,
  );
  assert.equal(canAccess("TECHNICIAN", "reports"), false);
  assert.equal(canAccess("PLANNER", "reports"), true);
  assert.equal(canAccess("PRODUCTION", "spare-parts"), false);
  assert.equal(canPerform("PRODUCTION", "spare-parts", "GET"), true);
  assert.equal(canPerform("PRODUCTION", "work-orders", "POST"), true);
  assert.equal(canPerform("PRODUCTION", "work-orders", "PUT"), false);
  assert.equal(canAccess("PRODUCTION", "settings"), false);
  assert.equal(canAccess("TECHNICIAN", "users"), false);
  assert.equal(canPerform(undefined, "assets", "GET"), false);
  assert.equal(canPerform("ADMIN", "assets", "POST"), false);
});

test("named accounts, stored password hashes and session version revocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmms-auth-"));
  const file = join(dir, "users.json");
  try {
    const store = createUserStore(file, "initial-admin-password");
    const admin = store.authenticate("admin", "initial-admin-password");
    assert.equal(admin.role, "ADMINISTRATOR");
    assert.equal("passwordHash" in admin, false);
    const technician = store.saveUser(
      null,
      {
        username: "tech1",
        displayName: "Tech",
        role: "TECHNICIAN",
        password: "technician-password",
      },
      admin.id,
    );
    assert.equal(store.authenticate("tech1", "incorrect"), null);
    assert.equal(
      store.authenticate("tech1", "technician-password").role,
      "TECHNICIAN",
    );
    assert.throws(() => store.saveUser(admin.id, { active: false }, admin.id));
    assert.throws(() =>
      store.saveUser(
        null,
        {
          username: "evil",
          displayName: "Bad",
          role: "ADMIN",
          password: "long-password",
        },
        admin.id,
      ),
    );
    store.saveUser(technician.id, { active: false }, admin.id);
    assert.equal(store.authenticate("tech1", "technician-password"), null);
    assert.notEqual(store.get(technician.id).version, technician.version);
  } finally {
    rmSync(file, { force: true });
    rmSync(file + ".tmp", { force: true });
    if(existsSync(join(dir,"media"))){for(const name of readdirSync(join(dir,"media")))rmSync(join(dir,"media",name));rmdirSync(join(dir,"media"));}
    rmdirSync(dir);
  }
});

test("HTTP permission enforcement, role spoofing, closed history, reports and revoked sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cmms-rbac-"));
  const file = join(dir, "users.json");
  const store = createUserStore(file, "initial-admin-password");
  const admin = store.authenticate("admin", "initial-admin-password");
  for (const role of ["PLANNER", "TECHNICIAN", "PRODUCTION"])
    store.saveUser(
      null,
      {
        username: role.toLowerCase(),
        displayName: role,
        role,
        password: "role-test-password",
      },
      admin.id,
    );
  let calls = [];
  const mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({
      method: req.method,
      key: req.headers["x-api-key"],
      url: req.url,
      body,
    });
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, "http://test");
    const id = url.searchParams.get("id") || "1";
    const resource = url.pathname.split("/").at(-1);
    res.statusCode = req.method === "POST" ? 201 : 200;
    res.end(
      JSON.stringify({
        ok: true,
        role: req.headers["x-api-key"] === "admin-key" ? "ADMIN" : "OPERATOR",
        data: {
          recordset:
            resource === "work-orders"
              ? [
                  {
                    WorkOrderID: id,
                    AssetID: "1",
                    StatusCode: id === "2" ? "COMPLETED" : "OPEN",
                  },
                ]
              : [
                  {
                    AssetID: "1",
                    StockTransactionID: "1",
                    PartID: "1",
                    PartCode: "PART",
                    PartName: "Part",
                    Quantity: 2,
                    Unit: "PCS",
                    StandardCost: 100,
                  },
                ],
        },
      }),
    );
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const holder = http.createServer();
  await new Promise((r) => holder.listen(0, "127.0.0.1", r));
  const port = holder.address().port;
  await new Promise((r) => holder.close(r));
  const child = spawn(process.execPath, ["server/index.mjs", "--production"], {
    env: {
      ...process.env,CMMS_INVENTORY_VALUATION_ENABLED:'false',
      CMMS_IDENTITY_STORAGE: "local",
      CMMS_USERS_FILE: file,
      CMMS_MEDIA_DIR: join(dir,"media"),
      CMMS_APP_PASSWORD: "initial-admin-password",
      CMMS_API_KEY: "operator-key",
      CMMS_API_KEY_ADMIN: "admin-key",
      HOST: "127.0.0.1",
      PORT: String(port),
      CMMS_API_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    },
    stdio: "pipe",
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("startup timeout")), 15000);
      child.stdout.on("data", (d) => {
        if (String(d).includes("running at")) {
          clearTimeout(t);
          resolve();
        }
      });
      child.on("error", reject);
      child.on("exit", (c) => {
        if (c) reject(new Error("startup failed"));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    async function login(username, password) {
      const r = await fetch(base + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: "ADMINISTRATOR" }),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie").split(";")[0];
    }
    const cookies = {};
    for (const role of ["PLANNER", "TECHNICIAN", "PRODUCTION"])
      cookies[role] = await login(role.toLowerCase(), "role-test-password");
    cookies.ADMINISTRATOR = await login("admin", "initial-admin-password");
    const request = (role, url, method = "GET", body) =>
      fetch(base + url, {
        method,
        headers: { Cookie: cookies[role], "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    for (const role of ["PLANNER", "TECHNICIAN", "PRODUCTION"])
      assert.equal((await request(role, "/api/users")).status, 403);
    for(const role of ['TECHNICIAN','PRODUCTION']){
      assert.equal((await request(role,'/api/cmms/stock-transactions','POST',{transactionTypeCode:'RECEIVE',partId:1,warehouseId:1,quantity:1})).status,403);
      for(const transactionTypeCode of ['ISSUE','RETURN'])assert.equal((await request(role,'/api/cmms/stock-transactions','POST',{transactionTypeCode,partId:1,warehouseId:1,quantity:1})).status,201);
    }
    assert.equal((await request('PLANNER','/api/cmms/stock-transactions','POST',{transactionTypeCode:'RECEIVE',partId:1,warehouseId:1,quantity:1})).status,201);
    assert.equal((await request('ADMINISTRATOR','/api/cmms/spare-parts?id=1','PUT',{partCode:'P',partName:'P',unit:'PC',quantity:99})).status,400);
    for (const role of ["TECHNICIAN", "PRODUCTION"])
      assert.equal((await request(role, "/api/reports")).status, 403);
    assert.equal((await request("PLANNER", "/api/reports")).status, 200);
    for(const role of ["TECHNICIAN","PRODUCTION"])assert.equal((await request(role,"/api/inventory-valuation")).status,403);
    assert.equal((await request("PLANNER","/api/inventory-valuation")).status,503);
    calls = [];
    assert.equal(
      (
        await request("TECHNICIAN", "/api/cmms/assets?id=1", "PUT", {
          assetName: "Change",
        })
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (await request("PLANNER", "/api/cmms/assets?id=1", "DELETE")).status,
      403,
    );
    assert.equal(
      (
        await request("PLANNER", "/api/cmms/assets", "POST", {
          assetGroupCode: "PROD",
          assetName: "New",
        })
      ).status,
      201,
    );
    assert.equal(calls.at(-1).key, "operator-key");
    for (const role of ["PLANNER", "TECHNICIAN"]) {
      assert.equal(
        (
          await request(role, "/api/cmms/work-orders?id=2", "PUT", {
            title: "Change history",
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(role, "/api/cmms/work-orders?id=2", "DELETE")).status,
        403,
      );
    }
    assert.equal(
      (
        await request("TECHNICIAN", "/api/cmms/work-orders?id=1", "PUT", {
          title: "Work",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("PLANNER", "/api/cmms/work-orders?id=1", "DELETE")).status,
      200,
    );
    assert.equal(calls.at(-1).key, "admin-key");
    assert.equal(
      (
        await request("PRODUCTION", "/api/cmms/work-orders", "POST", {
          assetId: 1,
          title: "Repair request",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("PRODUCTION", "/api/cmms/work-orders?id=1", "PUT", {
          title: "Change",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("PRODUCTION", "/api/cmms/calibration-history")).status,
      403,
    );
    const parts = await (
      await request("PRODUCTION", "/api/cmms/spare-parts")
    ).json();
    assert.equal(parts.role, "PRODUCTION");
    assert.equal(parts.data[0].StandardCost, undefined);
    assert.equal(
      (await request("ADMINISTRATOR", "/api/cmms/assets?id=1", "DELETE"))
        .status,
      200,
    );
    for(const role of ['TECHNICIAN','PRODUCTION']){
      const forbiddenUpload=await fetch(base+'/api/media/assets/1?name=manual.pdf',{method:'POST',headers:{Cookie:cookies[role],'Content-Type':'application/octet-stream'},body:Buffer.from('%PDF-1.4\n%%EOF')});
      assert.equal(forbiddenUpload.status,403);
    }
    for(const role of ['TECHNICIAN','PRODUCTION']){const r=await fetch(base+'/api/media/stock-transactions/1?name=record.pdf',{method:'POST',headers:{Cookie:cookies[role],'Content-Type':'application/octet-stream'},body:Buffer.from('%PDF-1.4\n%%EOF')});assert.equal(r.status,201);const item=(await r.json()).data;assert.equal((await request(role,item.url)).status,200);assert.equal((await request(role,item.url,'DELETE')).status,403);}
    const upload=await fetch(base+'/api/media/assets/1?name=manual.pdf',{method:'POST',headers:{Cookie:cookies.PLANNER,'Content-Type':'application/octet-stream'},body:Buffer.from('%PDF-1.4\n%%EOF')});
    assert.equal(upload.status,201);const media=(await upload.json()).data;
    assert.equal((await fetch(base+media.url)).status,401);
    const download=await request('TECHNICIAN',media.url);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);
    assert.equal((await request('TECHNICIAN',media.url,'DELETE')).status,403);
    assert.equal((await request('ADMINISTRATOR',media.url.replace('/assets/1/','/assets/2/'))).status,404);
    assert.equal((await request('PLANNER',media.url,'DELETE')).status,200);
    assert.equal((await request('PLANNER',media.url)).status,404);
    await request('ADMINISTRATOR','/api/cmms/spare-parts?department=&partType=&limit=2000');
    const forwarded=new URL(calls.at(-1).url,'http://test');assert.equal(forwarded.searchParams.has('department'),false);assert.equal(forwarded.searchParams.has('partType'),false);assert.equal(forwarded.searchParams.get('limit'),'2000');
    const account = store.list().find((u) => u.role === "TECHNICIAN");
    assert.equal(
      (
        await request("ADMINISTRATOR", "/api/users/" + account.id, "PUT", {
          role: "PRODUCTION",
        })
      ).status,
      200,
    );
    assert.equal((await request("TECHNICIAN", "/api/cmms/assets")).status, 401);
  } finally {
    child.kill();
    await new Promise((r) => mock.close(r));
    rmSync(file, { force: true });
    rmSync(file + ".tmp", { force: true });
    if(existsSync(join(dir,"media"))){for(const name of readdirSync(join(dir,"media")))rmSync(join(dir,"media",name));rmdirSync(join(dir,"media"));}
    rmdirSync(dir);
  }
});
