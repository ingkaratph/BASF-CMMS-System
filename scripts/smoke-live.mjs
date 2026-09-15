import assert from "node:assert/strict";
const base = process.env.CMMS_APP_URL || "http://127.0.0.1:3000";
const resources = [
  "assets",
  "maintenance-plans",
  "work-orders",
  "spare-parts",
  "stock-transactions",
  "calibration-history",
];
for (const resource of resources) {
  const res = await fetch(`${base}/api/cmms/${resource}?limit=2`);
  assert.equal(res.status, 200, resource);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.data));
  assert.ok(json.data.length <= 2);
  console.log(`${resource}: OK (${json.data.length} records, ${json.role})`);
}
const search = await (
  await fetch(`${base}/api/cmms/assets?search=MN-NAU-001&limit=10`)
).json();
assert.ok(search.data.length > 0);
assert.ok(search.data.every((r) => r.MachineCode.includes("MN-NAU-001")));
const id = search.data[0].AssetID;
const one = await (await fetch(`${base}/api/cmms/assets?id=${id}`)).json();
assert.equal(one.data.length, 1);
assert.equal(one.data[0].AssetID, id);
console.log("Live search, id and limit: OK. No mutations performed.");
