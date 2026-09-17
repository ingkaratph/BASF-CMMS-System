# Inventory valuation

- Endpoint: `GET /api/inventory-valuation`; requires the configurable reports permission.
- Reads the full SQL inventory view and joins `inv.Part.PriceText`; no 2,000-row cap.
- Quantity basis is the existing `inv.vwSparePartListAPI` definition (latest stock snapshots plus non-historical movements).
- Value = current quantity × parsed PriceText, rounded to two decimals per part. StandardCost is not substituted.
- Missing currency defaults to THB as confirmed by the inventory owner; explicitly recorded currencies stay separate. Non-numeric price text, conflicting currencies and invalid/negative quantities are excluded and counted. Zero prices are counted separately.
- History is stored in `server/inventory-valuations.local.json` (ignored by Git). Back up this file together with uploads and local application data.
- Successful captures replace only the current Bangkok calendar month's entry. Prior months retain quantities, prices, timestamps and totals. No retrospective history is fabricated.
- Capture runs on server startup, hourly while the app server is running, and when the report is read (one-minute cache). A closed month's value is its last successful capture, not a guaranteed audited month-end closing balance. Server downtime can leave months absent or captures earlier than month end.
- SQL queries are read-only; no existing SQL tables or prices are changed.
- Runtime variables: CMMS_INVENTORY_VALUATION_ENABLED=true, CMMS_SQL_HOST, CMMS_SQL_PORT (default 1433), CMMS_SQL_USER, CMMS_SQL_PASSWORD. Keep credentials in private .env only. Tests disable production capture explicitly.
