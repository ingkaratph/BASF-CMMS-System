# BASF CHEMCAT CMMS

React + TypeScript web application with a Node.js/Express server-side API gateway. The application uses the six existing Node-RED CMMS API resources. No SQL credentials, SQL queries, or CMMS keys are shipped in the browser bundle.

## Start on this PC

Requires Node.js 22+.

```powershell
npm install
# Copy .env.example to .env only on a fresh installation.
# Set CMMS_API_KEY to the Node-RED OPERATOR key in .env.
npm run build
npm start
```

Open http://127.0.0.1:3000. This workspace already has a local ignored `.env` configured; do not overwrite it. For development run `npm run dev`.

## Features

- Overview with loaded-data KPIs, open work, due PM and inventory health.
- Assets: search, details, related PM/repair history, create, edit.
- Work orders: create, update status, record finding/root cause/action, actual times and downtime.
- PM: search, overdue filter, calendar, create and supported field edits.
- Spare parts: master create/edit, stock/min/max/reorder, movement, dead stock and value by currency.
- Stock receive/issue/return: choose part, warehouse and related work order; immutable history.
- Calibration: record result, certificate, vendor and linked PM; preserve migrated unknown results.
- CSV export of loaded/filtered records; formula-leading values escaped.
- Loading, empty and API error states with gateway request IDs.
- Thai responsive interface, keyboard-accessible dialogs, role-aware controls.

## Mobile / intranet installation

The current preview binds to loopback. To serve other PCs and phones on the same trusted network:

1. Set a strong `CMMS_APP_PASSWORD` of at least 16 characters in `.env`.
2. Set `HOST=0.0.0.0` and choose `PORT` (default 3000).
3. Restart `npm start` and use `http://<this-PC-LAN-IP>:3000` from the same network.
4. Have the network administrator allow that port only on the required LAN segment. For production, terminate HTTPS at an internal reverse proxy; do not expose this server or Node-RED to the public Internet.

The application has a shared, 8-hour password session. API role is the actual role returned for the server key. This is **not** individual employee identity, SSO, per-user RBAC or individual audit attribution. Before a multi-user production rollout, connect company identity and map each employee role to the corresponding server-side gateway key. Session state currently clears when the server restarts.

## API compatibility / known limits

- Real Node-RED response uses `data.recordset` / `data.recordsets`, unlike the handoff's flat array. Server normalizes both.
- Real asset fields `AssetStatus`, `Criticality`, PM `FrequencyUnit` and stock `TransactionType` are mapped to the UI contract.
- The gateway allows at most 500 rows and has no offset/cursor, date range or aggregate endpoint. Counts and reports describe **loaded rows**, not the whole database. Search narrows the data. No complete-plant count, MTBF or MTTR is claimed.
- Dates in 1900/1901 are flagged for review and excluded from overdue KPIs. Source data is not modified. Bangkok timezone is used for displaying and editing source dates.
- Empty calibration results remain “not specified”; they are never labelled FAIL.
- Unknown minimum/reorder thresholds are not treated as zero. Unknown costs/currencies are excluded from monetary totals.
- The edit forms expose only fields the existing stored procedure actually updates; e.g. PM frequency unit/asset/type changes are not supported by its EDIT branch. Blank optional edits are omitted: the current procedure uses COALESCE and does not support clearing a value to NULL.
- Warehouse/vendor names are a reference snapshot read on 2026-09-15. Warehouse 1 is EM-MAIN. Maintain `server/vendors.json` and the lookup response when those master lists change, or extend Node-RED with lookup resources.
- Calibration creation requires an existing CalibrationSpec, as enforced by the upstream procedure.
- Stock balance transactionality, simultaneous issues and negative-stock prevention remain the responsibility of the SQL gateway/triggers. The app does not invent a balance or directly update stock.
- No automatic PM-to-WO generation, purchase orders, approvals, notifications, file attachment storage or database schema migrations were added. Those need additional API capabilities/business rules.
- Cloud hosting cannot directly reach `pd.local`; this delivery is designed to run inside the plant network.

## Validation

```powershell
npm test
npm run build
```

Tests cover the actual response envelope, authorization matrix, immutable history, payload constraints, session login/logout, CSRF origin checks and upstream error/request-ID propagation using an isolated HTTP mock. Production data is not created, edited or deleted by tests. Live GET verification covers all six resources plus search/id/limit.

Secrets must stay in `.env`, which is ignored by Git. The SQL credentials supplied for investigation are not saved in this application. `gateway-reference.local.sql` is an ignored read-only inspection reference, not a migration.
