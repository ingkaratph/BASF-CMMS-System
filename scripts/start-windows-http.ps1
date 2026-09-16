param([int]$BackendPort = 3000)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
Add-Type -Path (Join-Path $projectPath 'server/windows-proxy.cs')
$backendProcess = $null
$previousPort = $env:PORT
$previousHost = $env:HOST
try {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $BackendPort -ErrorAction SilentlyContinue
    if ($listener) {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort" -UseBasicParsing -TimeoutSec 5
        if ($response.Content -notmatch 'BASF CHEMCAT') { throw "Port $BackendPort belongs to another application." }
    } else {
        $env:PORT = "$BackendPort"
        $env:HOST = '127.0.0.1'
        $null = New-Item -ItemType Directory -Path (Join-Path $projectPath 'artifacts') -Force
        $backendProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.mjs','--production' -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectPath 'artifacts/backend.log') -RedirectStandardError (Join-Path $projectPath 'artifacts/backend-error.log')
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if ($backendProcess.HasExited) { throw 'CMMS backend stopped. See artifacts/backend-error.log.' }
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort" -UseBasicParsing -TimeoutSec 1
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { Start-Sleep -Milliseconds 200 }
        }
        if (-not $ready) { throw 'CMMS backend did not become ready.' }
    }
    [CmmsWindowsProxy]::Run($BackendPort).GetAwaiter().GetResult()
} finally {
    $env:PORT = $previousPort
    $env:HOST = $previousHost
    if ($backendProcess -and -not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id }
}
