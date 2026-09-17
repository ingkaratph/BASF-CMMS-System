# Vendor, calibration points, and PM history

Routes require the existing authenticated application session and use private SQL connection settings.
- GET /api/vendors: all cmms.Vendor rows. POST /api/vendors and PUT /api/vendors/:id validate input and use parameterized SQL. PUT requires Version (hash of original editable values) and uses a transaction with update locks to reject concurrent changes. No delete endpoint. Inactive vendors remain in history; active vendors populate calibration lookups.
- Vendor navigation/read permission follows maintenance-plans.GET. Mutations require Administrator or Planner plus the corresponding maintenance-plans POST/PUT permission. This preserves the existing custom permission storage format; Vendor does not yet have an independent permission row.
- GET /api/calibration-points: calibration-history.GET permission; joins CalibrationSpec, CalibrationPoint and Asset. PointNo is displayed as CAL_n. SetpointValue is a specification, never treated as an actual measured result. No units or End markers are inferred.
- GET /api/pm-history: maintenance-plans.GET permission. Completed PM work orders (or completed work orders linked to a PM plan) are separate from MaintenancePlan.LastMaintenanceDate. Dates before 1902 are excluded. Last plan dates are not a full service log and no historical work orders are fabricated.

Verified live database: 156 vendors; 312 calibration specifications, 1155 points (100 specs have no points); 448 valid latest plan dates (190 PM, 247 calibration, 8 inspection, 3 other). No PM-type/plan-linked completed work orders at deployment.
Validation: build, unit and HTTP permission tests; live read-only SQL/API queries; UI search/edit-form inspection and CAL sample M249=100,300,550; PM Nauta plan dates. No test Vendor was written into production.
