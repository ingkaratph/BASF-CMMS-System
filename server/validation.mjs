// Supported payload fields verified against api.usp_CMMS_Gateway on 2026-09-15.
const create = {
  assets: [
    "assetGroupCode",
    "machineCode",
    "tagNo",
    "assetName",
    "assetType",
    "criticalityCode",
    "pmRequired",
  ],
  "maintenance-plans": [
    "assetId",
    "maintenanceTypeCode",
    "taskDescription",
    "frequencyValue",
    "frequencyUnitCode",
    "nextDueDate",
  ],
  "work-orders": [
    "assetId",
    "workTypeCode",
    "priorityCode",
    "title",
    "description",
    "requestorName",
    "dueDate",
  ],
  "spare-parts": [
    "partCode",
    "partName",
    "unit",
    "sapMaterial",
    "description",
    "minimumStock",
    "maximumStock",
    "reorderPoint",
    "standardCost",
  ],
  "stock-transactions": [
    "transactionTypeCode",
    "partId",
    "warehouseId",
    "workOrderId",
    "quantity",
    "referenceNo",
    "remark",
  ],
  "calibration-history": [
    "assetId",
    "planId",
    "calibrationDate",
    "certificateNo",
    "overallResult",
    "vendorId",
    "remark",
  ],
};
const edit = {
  assets: [
    "machineCode",
    "tagNo",
    "assetName",
    "assetType",
    "pmRequired",
    "statusCode",
  ],
  "maintenance-plans": [
    "taskCode",
    "taskDescription",
    "frequencyValue",
    "lastMaintenanceDate",
    "nextDueDate",
    "remark",
  ],
  "work-orders": [
    "title",
    "description",
    "dueDate",
    "requestorName",
    "statusCode",
    "finding",
    "rootCause",
    "actionTaken",
    "actualStart",
    "actualFinish",
    "downtimeMinutes",
  ],
  "spare-parts": create["spare-parts"],
};
const required = {
  assets: ["assetGroupCode", "assetName"],
  "maintenance-plans": ["assetId", "maintenanceTypeCode", "taskDescription"],
  "work-orders": ["assetId", "title"],
  "spare-parts": ["partCode", "partName", "unit"],
  "stock-transactions": [
    "transactionTypeCode",
    "partId",
    "warehouseId",
    "quantity",
  ],
  "calibration-history": ["assetId", "calibrationDate"],
};
const enums = {
  assetGroupCode: ["CAL", "ELEC", "HVAC", "PROD", "UTIL"],
  criticalityCode: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  maintenanceTypeCode: ["PM", "CALIBRATION"],
  workTypeCode: [
    "BREAKDOWN",
    "CALIBRATION",
    "CORRECTIVE",
    "INSPECTION",
    "OTHER",
    "PM",
  ],
  priorityCode: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH", "URGENT", "DEFERRED"],
  frequencyUnitCode: ["DAY", "WEEK", "MONTH", "YEAR"],
  transactionTypeCode: ["RECEIVE", "ISSUE", "RETURN"],
  overallResult: ["PASS", "FAIL"],
};
export function validatePayload(resource, method, body) {
  if (!["POST", "PUT"].includes(method)) return null;
  const allowed = (method === "POST" ? create : edit)[resource];
  if (!allowed) return "Operation not supported";
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (!allowed.includes(k)) return `Unsupported field: ${k}`;
    if (v === null || v === undefined || typeof v === "object")
      return `Invalid value: ${k}`;
    if (/Id$/.test(k) && (!Number.isSafeInteger(v) || v < 1))
      return `Invalid ID: ${k}`;
    if (
      [
        "quantity",
        "frequencyValue",
        "downtimeMinutes",
        "minimumStock",
        "maximumStock",
        "reorderPoint",
        "standardCost",
      ].includes(k) &&
      (!Number.isFinite(v) ||
        v < 0 ||
        (["quantity", "frequencyValue"].includes(k) && v <= 0))
    )
      return `Invalid number: ${k}`;
    if (k === "frequencyValue" && !Number.isInteger(v))
      return "Frequency must be a whole number";
    if (k === "pmRequired" && typeof v !== "boolean")
      return "pmRequired must be boolean";
    if (
      typeof v === "string" &&
      v.length >
        ({
          title: 255,
          assetName: 255,
          partName: 255,
          partCode: 60,
          unit: 30,
          machineCode: 50,
          tagNo: 50,
          description: resource === "work-orders" ? 2000 : 1000,
        }[k] || 1000)
    )
      return `Text too long: ${k}`;
    if (enums[k] && !enums[k].includes(v)) return `Unknown ${k}`;
    if (
      k === "statusCode" &&
      !(
        resource === "assets"
          ? ["ACTIVE", "INACTIVE", "SPARE"]
          : ["OPEN", "PLANNED", "IN_PROGRESS", "OVERDUE", "COMPLETED"]
      ).includes(v)
    )
      return "Unknown statusCode";
    if (
      /Date$|actualStart|actualFinish/.test(k) &&
      (!Number.isFinite(Date.parse(v)) || new Date(v).getFullYear() < 1902)
    )
      return `Invalid date: ${k}`;
  }
  if (method === "POST")
    for (const k of required[resource] || [])
      if (body[k] === undefined || body[k] === "")
        return `Required field: ${k}`;
  if (
    body.statusCode === "COMPLETED" &&
    (!body.actualFinish || !String(body.actionTaken || "").trim())
  )
    return "Completion requires actualFinish and actionTaken";
  if (
    body.actualStart &&
    body.actualFinish &&
    Date.parse(body.actualFinish) < Date.parse(body.actualStart)
  )
    return "Finish time must follow start time";
  if (
    body.minimumStock !== undefined &&
    body.maximumStock !== undefined &&
    body.maximumStock < body.minimumStock
  )
    return "Maximum stock must be at least minimum stock";
  return null;
}
