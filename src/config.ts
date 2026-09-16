import type { Resource } from "./api";
export interface Field {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
  ref?: Resource;
  min?: number;
}
export interface Module {
  title: string;
  english: string;
  singular: string;
  id: string;
  columns: [string, string][];
  fields: Field[];
  edit?: Field[];
  status?: string;
}
const f = (
  key: string,
  label: string,
  type = "text",
  required = false,
  options?: string[],
  ref?: Resource,
  min?: number,
): Field => ({ key, label, type, required, options, ref, min });
const asset = f(
  "assetId",
  "เครื่องจักร",
  "number",
  true,
  undefined,
  "assets",
  1,
);
export const modules: Record<Resource, Module> = {
  assets: {
    title: "ทะเบียนเครื่องจักร",
    english: "Asset registry",
    singular: "เครื่องจักร",
    id: "AssetID",
    status: "StatusCode",
    columns: [
      ["MachineCode", "Machine code"],
      ["TagNo", "Tag no."],
      ["AssetName", "เครื่องจักร / อุปกรณ์"],
      ["AssetType", "ประเภท"],
      ["CriticalityCode", "ความสำคัญ"],
      ["StatusCode", "สถานะ"],
    ],
    fields: [
      f("assetGroupCode", "กลุ่มเครื่องจักร", "select", true, [
        "CAL",
        "ELEC",
        "HVAC",
        "PROD",
        "UTIL",
      ]),
      f("machineCode", "Machine code", "text", true),
      f("tagNo", "Tag no.", "text", true),
      f("assetName", "ชื่อเครื่องจักร", "text", true),
      f("assetType", "ประเภท", "text", true),
      f("criticalityCode", "ความสำคัญ", "select", true, [
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
      ]),
      f("pmRequired", "ต้องทำ PM", "checkbox"),
    ],
  },
  "work-orders": {
    title: "ใบงานซ่อมบำรุง",
    english: "Work orders",
    singular: "ใบงาน",
    id: "WorkOrderID",
    status: "StatusCode",
    columns: [
      ["WorkOrderNo", "ใบงาน"],
      ["Title", "รายละเอียดงาน"],
      ["MachineCode", "Machine code"],
      ["PriorityCode", "ความเร่งด่วน"],
      ["StatusCode", "สถานะ"],
      ["DueDate", "กำหนดเสร็จ"],
    ],
    fields: [
      asset,
      f("workTypeCode", "ประเภทงาน", "select", true, [
        "BREAKDOWN",
        "CALIBRATION",
        "CORRECTIVE",
        "INSPECTION",
        "OTHER",
        "PM",
      ]),
      f("priorityCode", "ความเร่งด่วน", "select", true, [
        "LOW",
        "MEDIUM",
        "HIGH",
        "VERY_HIGH",
        "URGENT",
        "DEFERRED",
      ]),
      f("title", "หัวข้องาน", "text", true),
      f("description", "รายละเอียด", "textarea"),
      f("requestorName", "ผู้แจ้ง", "text", true),
      f("dueDate", "กำหนดเสร็จ", "datetime-local", true),
    ],
    edit: [
      f("statusCode", "สถานะ", "select", true, [
        "OPEN",
        "PLANNED",
        "IN_PROGRESS",
        "OVERDUE",
        "COMPLETED",
      ]),
      f("finding", "สิ่งที่พบ", "textarea"),
      f("rootCause", "สาเหตุ", "textarea"),
      f("actionTaken", "การแก้ไข", "textarea"),
      f("actualStart", "เริ่มงานจริง", "datetime-local"),
      f("actualFinish", "เสร็จงานจริง", "datetime-local"),
      f(
        "downtimeMinutes",
        "เวลาหยุดเครื่อง (นาที)",
        "number",
        false,
        undefined,
        undefined,
        0,
      ),
    ],
  },
  "maintenance-plans": {
    title: "แผนบำรุงรักษา",
    english: "Preventive maintenance",
    singular: "แผน PM",
    id: "PlanID",
    status: "MaintenanceTypeCode",
    columns: [
      ["MachineCode", "Machine code"],
      ["TagNo", "Tag no."],
      ["TaskDescription", "รายการบำรุงรักษา"],
      ["FrequencyValue", "ทุก"],
      ["FrequencyUnitCode", "หน่วย"],
      ["NextDueDate", "กำหนดครั้งถัดไป"],
    ],
    fields: [
      asset,
      f("maintenanceTypeCode", "ประเภท", "select", true, ["PM", "CALIBRATION"]),
      f("taskDescription", "รายการงาน", "textarea", true),
      f("frequencyValue", "ความถี่", "number", true, undefined, undefined, 1),
      f("frequencyUnitCode", "หน่วย", "select", true, [
        "DAY",
        "WEEK",
        "MONTH",
        "YEAR",
      ]),
      f("nextDueDate", "วันครบกำหนด", "date", true),
    ],
  },
  "spare-parts": {
    title: "คลังอะไหล่",
    english: "Spare parts inventory",
    singular: "อะไหล่",
    id: "PartID",
    status: "StockStatus",
    columns: [
      ["PartCode", "รหัสอะไหล่"],
      ["PartName", "ชื่ออะไหล่"],
      ["Department", "Department"],
      ["PartType", "PartType"],
      ["Quantity", "คงเหลือ"],
      ["Unit", "หน่วย"],
      ["MinimumStock", "ขั้นต่ำ"],
      ["ReorderPoint", "จุดสั่งซื้อ"],
      ["StockStatus", "สถานะสต็อก"],
      ["MovementStatus", "การเคลื่อนไหว"],
      ["LastTransaction", "เคลื่อนไหวล่าสุด"],
      ["DaysSinceLastTransaction", "ไม่เคลื่อนไหว (วัน)"],
    ],
    fields: [
      f("partCode", "รหัสอะไหล่", "text", true),
      f("partName", "ชื่ออะไหล่", "text", true),
      f("unit", "หน่วย", "text", true),
      f("sapMaterial", "SAP Material"),
      f("description", "รายละเอียด", "textarea"),
      f(
        "minimumStock",
        "สต็อกขั้นต่ำ",
        "number",
        false,
        undefined,
        undefined,
        0,
      ),
      f(
        "maximumStock",
        "สต็อกสูงสุด",
        "number",
        false,
        undefined,
        undefined,
        0,
      ),
      f(
        "reorderPoint",
        "จุดสั่งซื้อ",
        "number",
        false,
        undefined,
        undefined,
        0,
      ),
      f(
        "standardCost",
        "ต้นทุนมาตรฐาน",
        "number",
        false,
        undefined,
        undefined,
        0,
      ),
    ],
  },
  "stock-transactions": {
    title: "รับ–เบิกอะไหล่",
    english: "Stock movements",
    singular: "รายการรับ–เบิก",
    id: "StockTransactionID",
    status: "TransactionTypeCode",
    columns: [
      ["TransactionDate", "วันที่"],
      ["PartCode", "รหัสอะไหล่"],
      ["PartName", "ชื่ออะไหล่"],
      ["TransactionTypeCode", "ประเภท"],
      ["Quantity", "จำนวน"],
      ["ReferenceNo", "เอกสารอ้างอิง"],
      ["Remark", "หมายเหตุ"],
    ],
    fields: [
      f("transactionTypeCode", "ประเภท", "select", true, [
        "RECEIVE",
        "ISSUE",
        "RETURN",
      ]),
      f("partId", "อะไหล่", "number", true, undefined, "spare-parts", 1),
      f("warehouseId", "คลังอะไหล่", "number", true, undefined, undefined, 1),
      f(
        "workOrderId",
        "ใบงานที่เกี่ยวข้อง",
        "number",
        false,
        undefined,
        "work-orders",
        1,
      ),
      f("quantity", "จำนวน", "number", true, undefined, undefined, 0.000001),
      f("referenceNo", "เอกสารอ้างอิง"),
      f("remark", "หมายเหตุ", "textarea"),
    ],
  },
  "calibration-history": {
    title: "การสอบเทียบ",
    english: "Calibration records",
    singular: "ผลสอบเทียบ",
    id: "CalibrationEventID",
    status: "OverallResult",
    columns: [
      ["MachineCode", "Machine code"],
      ["TagNo", "Tag no."],
      ["CalibrationDate", "วันที่สอบเทียบ"],
      ["CertificateNo", "ใบรับรอง"],
      ["OverallResult", "ผล"],
      ["VendorName", "ผู้ให้บริการ"],
      ["DataQualityStatus", "คุณภาพข้อมูล"],
    ],
    fields: [
      asset,
      f("planId", "แผน PM", "number", false, undefined, "maintenance-plans", 1),
      f("calibrationDate", "วันที่สอบเทียบ", "date", true),
      f("certificateNo", "เลขที่ใบรับรอง"),
      f("overallResult", "ผลสอบเทียบ", "select", true, ["PASS", "FAIL"]),
      f("vendorId", "ผู้ให้บริการ", "number", false, undefined, undefined, 1),
      f("remark", "หมายเหตุ", "textarea"),
    ],
  },
};

// EDIT fields are limited to fields actually supported by the live stored procedure.
modules.assets.edit = [
  f("machineCode", "Machine code"),
  f("tagNo", "Tag no."),
  f("assetName", "ชื่อเครื่องจักร", "text", true),
  f("assetType", "ประเภท"),
  f("pmRequired", "ต้องทำ PM", "checkbox"),
  f("statusCode", "สถานะ", "select", true, ["ACTIVE", "INACTIVE", "SPARE"]),
];
modules["maintenance-plans"].edit = [
  f("taskCode", "รหัสงาน"),
  f("taskDescription", "รายการงาน", "textarea", true),
  f("frequencyValue", "ความถี่", "number", true, undefined, undefined, 1),
  f("lastMaintenanceDate", "บำรุงรักษาล่าสุด", "date"),
  f("nextDueDate", "วันครบกำหนด", "date", true),
  f("remark", "หมายเหตุ", "textarea"),
];
