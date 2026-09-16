$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Copy .env.example to .env and configure CMMS_API_KEY first.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (-not (Test-Path -LiteralPath 'dist/index.html')) { npm run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
# Windows port 80 is already shared by HTTP.sys services. Use a host-scoped
# HTTP.sys frontend and a private Node backend instead of competing for it.
npm start
