import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeData,
  canWrite,
  validateRequest,
} from "../server/gateway.mjs";
import { validatePayload } from "../server/validation.mjs";
test("normalize real SQL-driver envelope and field aliases", () => {
  const row = {
    AssetID: "1",
    AssetStatus: "Active",
    Criticality: "Low",
    FrequencyUnit: "MONTH",
    TransactionType: "ISSUE",
  };
  const result = normalizeData({ recordsets: [[row]], recordset: [row] });
  assert.equal(result.length, 1);
  assert.equal(result[0].StatusCode, "ACTIVE");
  assert.equal(result[0].FrequencyUnitCode, "MONTH");
  assert.equal(result[0].TransactionTypeCode, "ISSUE");
  assert.equal(row.StatusCode, undefined);
  assert.deepEqual(normalizeData([]), []);
  assert.throws(() => normalizeData({}), /Unexpected/);
});
test("permission matrix protects history and restricts mutations", () => {
  assert.equal(canWrite("READ_ONLY", "POST", "work-orders"), false);
  assert.equal(canWrite("OPERATOR", "POST", "work-orders"), true);
  assert.equal(canWrite("INTEGRATION", "PUT", "assets"), false);
  assert.equal(canWrite("OPERATOR", "DELETE", "assets"), false);
  assert.equal(canWrite("ADMIN", "DELETE", "assets"), true);
  assert.equal(canWrite("ADMIN", "DELETE", "stock-transactions"), false);
  assert.equal(canWrite("ADMIN", "PUT", "calibration-history"), false);
  assert.equal(canWrite(undefined, "POST", "work-orders"), false);
});
test("resource, method, identifier and bounds validation", () => {
  assert.ok(validateRequest("users", "GET", {}));
  assert.ok(validateRequest("assets", "PUT", {}, {}));
  assert.ok(validateRequest("assets", "GET", { id: "1 OR 1=1" }));
  assert.ok(validateRequest("assets", "GET", { limit: "2001" }));
  assert.ok(validateRequest("assets", "GET", { limit: "1.5" }));
  assert.ok(validateRequest("assets", "GET", { search: "a".repeat(101) }));
  assert.equal(validateRequest("assets", "GET", { limit: "500" }), null);
  assert.equal(validateRequest("assets", "GET", { limit: "2000" }), null);
  assert.equal(validateRequest("spare-parts", "GET", { department: "", partType: "" }), null);
  assert.ok(validateRequest("spare-parts", "GET", { department: ["bad"] }));
});
test("validate meaningful stock quantities, financial bounds, allowed fields and completion", () => {
  const body = {
    partId: 1,
    warehouseId: 1,
    quantity: 1,
    transactionTypeCode: "ISSUE",
  };
  assert.equal(validatePayload("stock-transactions", "POST", body), null);
  for (const quantity of [0, -1, Infinity, "1"])
    assert.ok(
      validatePayload("stock-transactions", "POST", { ...body, quantity }),
    );
  assert.ok(validatePayload("work-orders", "PUT", { statusCode: "COMPLETED" }));
  assert.equal(
    validatePayload("work-orders", "PUT", {
      statusCode: "COMPLETED",
      actionTaken: "Repaired",
      actualFinish: "2026-09-15T12:00",
    }),
    null,
  );
  assert.ok(validatePayload("assets", "PUT", { sql: "DROP TABLE assets" }));
  assert.ok(
    validatePayload("spare-parts", "PUT", {
      minimumStock: 10,
      maximumStock: 5,
    }),
  );
  assert.ok(
    validatePayload("work-orders", "POST", {
      assetId: 1,
      title: "Test",
      priorityCode: "CRITICAL",
    }),
  );
  assert.ok(
    validatePayload("maintenance-plans", "PUT", { nextDueDate: "1900-01-01" }),
  );
});
