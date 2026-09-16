import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

test("proxy authentication, actual role, mutations, validation and upstream errors", async () => {
  const userDirectory = mkdtempSync(join(tmpdir(), "cmms-test-"));
  const requests = [];
  let role = "OPERATOR",
    mode = "success";
  const mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      key: req.headers["x-api-key"],
      body,
    });
    res.setHeader("Content-Type", "application/json");
    if (mode === "error") {
      res.statusCode = 429;
      res.end(
        JSON.stringify({
          ok: false,
          requestId: "rate-123",
          error: { code: "RATE_LIMIT", message: "Too many requests" },
        }),
      );
      return;
    }
    res.statusCode = req.method === "POST" ? 201 : 200;
    res.end(
      JSON.stringify({
        ok: true,
        role,
        requestId: "mock-123",
        data: {
          recordset: [
            {
              WorkOrderID: "1",
              StatusCode: "OPEN",
              AssetID: "1",
              AssetStatus: "Active",
              Title: "Isolated test",
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
      ...process.env,
      CMMS_IDENTITY_STORAGE: "local",
      PORT: String(port),
      HOST: "127.0.0.1",
      CMMS_API_KEY: "isolated-test-key",
      CMMS_API_KEY_ADMIN: "isolated-test-key",
      CMMS_USERS_FILE: join(userDirectory, "users.json"),
      CMMS_APP_PASSWORD: "isolated-login-password",
      CMMS_API_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    },
    stdio: "pipe",
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server did not start")),
        10000,
      );
      child.stdout.on("data", (data) => {
        if (String(data).includes("running at")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code) reject(new Error(`Server exit ${code}`));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base + "/api/cmms/assets")).status, 401);
    assert.equal((await fetch(base + "/api/lookups")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        })
      ).status,
      401,
    );
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "isolated-login-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const read = await fetch(base + "/api/cmms/assets?limit=1", { headers });
    const json = await read.json();
    assert.equal(read.status, 200);
    assert.equal(json.data[0].StatusCode, "OPEN");
    assert.equal(requests.at(-1).key, "isolated-test-key");
    assert.equal(JSON.stringify(json).includes("isolated-test-key"), false);
    const create = () =>
      fetch(base + "/api/cmms/work-orders", {
        method: "POST",
        headers,
        body: JSON.stringify({ assetId: 1, title: "Isolated test" }),
      });
    assert.equal((await create()).status, 201);
    assert.equal(JSON.parse(requests.at(-1).body).title, "Isolated test");
    role = "READ_ONLY";
    const before = requests.filter((r) => r.method === "POST").length;
    assert.equal((await create()).status, 403);
    assert.equal(requests.filter((r) => r.method === "POST").length, before);
    assert.equal(
      (
        await fetch(base + "/api/cmms/assets?id=1", {
          method: "DELETE",
          headers,
        })
      ).status,
      403,
    );
    role = "OPERATOR";
    assert.equal(
      (
        await fetch(base + "/api/cmms/work-orders?id=1", {
          method: "PUT",
          headers,
          body: JSON.stringify({
            statusCode: "COMPLETED",
            actualFinish: "2026-09-15T12:00",
            actionTaken: "Repaired",
          }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/cmms/work-orders", {
          method: "POST",
          headers: { ...headers, Origin: "https://unrelated.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/cmms/stock-transactions?id=1", {
          method: "DELETE",
          headers,
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/cmms/assets?limit=501", { headers })).status,
      400,
    );
    mode = "error";
    const limited = await fetch(base + "/api/cmms/assets", { headers });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).requestId, "rate-123");
    await fetch(base + "/api/logout", { method: "POST", headers });
    assert.equal(
      (await fetch(base + "/api/cmms/assets", { headers })).status,
      401,
    );
  } finally {
    child.kill();
    await new Promise((r) => mock.close(r));
    rmSync(join(userDirectory, "users.json"), { force: true });
    rmSync(join(userDirectory, "users.json.tmp"), { force: true });
    rmdirSync(userDirectory);
  }
});
