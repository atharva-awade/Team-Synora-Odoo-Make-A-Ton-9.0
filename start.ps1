$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$runtime = Join-Path $root '.runtime'
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $runtime, $logs, (Join-Path $root 'data') -Force | Out-Null

$venvPython = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) { python -m venv (Join-Path $backend '.venv') }
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $backend 'requirements.txt')
& $venvPython -m alembic -c (Join-Path $backend 'alembic.ini') upgrade head
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) { npm --prefix $frontend install }

$apiPidFile = Join-Path $runtime 'api.pid'
$webPidFile = Join-Path $runtime 'web.pid'
if ((Test-Path $apiPidFile) -or (Test-Path $webPidFile)) {
    Write-Host 'Runtime PID files already exist. Run .\stop.ps1 before restarting.' -ForegroundColor Yellow
    exit 1
}

$env:BRIGHTLOOP_DEMO_MODE = 'true'
$api = Start-Process -FilePath $venvPython -ArgumentList @('-m','uvicorn','app.main:app','--app-dir','.','--host','127.0.0.1','--port','8000') -WorkingDirectory $backend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log') -PassThru
$node = (Get-Command node.exe).Source
$web = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1') -WorkingDirectory $frontend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log') -PassThru
Set-Content -LiteralPath $apiPidFile -Value $api.Id
Set-Content -LiteralPath $webPidFile -Value $web.Id

Start-Sleep -Seconds 3
$apiReady = $false
$webReady = $false
for ($attempt = 0; $attempt -lt 8; $attempt++) {
    if (-not $api.HasExited) {
        try { Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 | Out-Null; $apiReady = $true } catch { }
    }
    if (-not $web.HasExited) {
        try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 2 | Out-Null; $webReady = $true } catch { }
    }
    if ($apiReady -and $webReady) { break }
    Start-Sleep -Milliseconds 500
}
if (-not ($apiReady -and $webReady)) {
    Stop-Process -Id @($api.Id, $web.Id) -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $apiPidFile, $webPidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Brightloop OS did not become ready. Check logs/api-error.log and logs/web-error.log.' -ForegroundColor Red
    throw 'Startup check failed.'
}
Write-Host 'Brightloop OS is starting:' -ForegroundColor Green
Write-Host '  Web app:  http://127.0.0.1:5173'
Write-Host '  API docs: http://127.0.0.1:8000/docs'
Write-Host '  Stop:     .\stop.ps1'
Write-Host "  Logs:     $logs"
