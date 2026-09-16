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

Open http://localhost on this PC. On Windows, `npm start` uses PowerShell 7 and an HTTP.sys frontend on port 80, forwarding to a private Node backend on port 3000. Existing Windows services keep their more-specific HTTP.sys paths. The same frontend also accepts `pd.local`, but that hostname works only on the machine its DNS resolves to. This workspace already has a local ignored `.env` configured; do not overwrite it. For development use `PORT=3000`, `HOST=127.0.0.1` and `npm run dev` after stopping an existing backend using that port.

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

The configuration now binds to all IPv4 interfaces on port 80. Restart is required to apply it. To serve other PCs and phones on the same trusted network:

1. Set a strong `CMMS_APP_PASSWORD` of at least 16 characters in `.env`.
2. Use `HOST=0.0.0.0` and `PORT=80` on the machine that pd.local resolves to.
3. Restart `npm start` and use `http://pd.local` from the same network.
4. Have the network administrator allow that port only on the required LAN segment. For production, terminate HTTPS at an internal reverse proxy; do not expose this server or Node-RED to the public Internet.

## Named accounts and permissions

The application now uses individual usernames and passwords with 8-hour sessions. The initial account is `admin` / the existing `CMMS_APP_PASSWORD` value. This environment value bootstraps the first account only; later password changes belong in **ผู้ใช้และสิทธิ์**. Administrators can create accounts, change roles, disable accounts and reset passwords. Production accounts now live in `BASF_CHEMCAT_CMMS.cmms_auth.Users`, accessed through the private identity API. Passwords remain salted scrypt hashes; existing accounts were migrated without changing their passwords. Set `CMMS_IDENTITY_STORAGE=database`. The ignored local user file is a pre-migration backup and is used only in explicit local development mode. See [SQL identity deployment and API](deployment/IDENTITY.md).

These are the initial defaults. Administrators can customize Planner, Technician and Production permissions in **ผู้ใช้และสิทธิ์**, with persisted SQL policies, revision checks and an audit trail. Administrator remains reserved.

| Role                  | Master records                  | Active work orders              | History                                                                         | Reports |
| --------------------- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- | ------- |
| Administrator         | Read, create, edit, soft-delete | All supported actions           | Work-order edits allowed; append-only API histories remain immutable            | Yes     |
| Planner               | Read, create, edit; no delete   | Create, edit, cancel            | Completed/closed/cancelled work orders read-only; stock/calibration append-only | Yes     |
| Technician            | Read only                       | Create, edit; no delete         | Same history lock                                                               | No      |
| Production (Operator) | Read assets only                | Create and read, no edit/delete | Read/create stock movements; no calibration                                     | No      |

Production receives a restricted spare-part lookup (code, name, quantity, unit) for the stock form, without access to the master page or cost fields. Master records are assets, PM plans and spare parts. The stock and calibration endpoints currently cannot edit/delete history even for Administrator.

Permissions are enforced in shared policy code and on each server request. Server-side sessions bind to stored users; changing a password, role or active state invalidates existing sessions. Role fields sent in login payloads or request headers do not grant privileges. Each work-order mutation checks the current database status before allowing non-administrator edits. External/concurrent updates outside this application still require the database gateway to enforce atomic history locking; the existing gateway has no conditional update/version parameter.

Administrator operations use `CMMS_API_KEY_ADMIN`. Other operations use `CMMS_API_KEY`; Planner cancellation uses the admin transport key only after application and current-record permission checks. Database transport roles do not replace application roles. SSO and individual attribution inside the existing SQL stored procedure are not implemented.

The localhost HTTP.sys frontend has been started on this PC; no deployment or test of pd.local was performed for the localhost fix. Where IIS already owns a matching site binding, use the optional reverse proxy configuration in `deployment/iis/README.th.md`, with Node on a separate backend port. The Windows launcher requires PowerShell 7 (`pwsh.exe`) on PATH, or an explicit `CMMS_PWSH_PATH`.

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
- No automatic PM-to-WO generation, purchase orders, approvals, notifications or file attachment storage were added. Those need additional API capabilities/business rules.
- Cloud hosting cannot directly reach `pd.local`; this delivery is designed to run inside the plant network.

## Validation

```powershell
npm test
npm run build
```

Tests cover the actual response envelope, authorization matrix, immutable history, payload constraints, session login/logout, CSRF origin checks and upstream error/request-ID propagation using an isolated HTTP mock. Production data is not created, edited or deleted by tests. Live GET verification covers all six resources plus search/id/limit.

Secrets must stay in `.env`, which is ignored by Git. The SQL credentials supplied for investigation are not saved in this application. `gateway-reference.local.sql` is an ignored read-only inspection reference, not a migration.
