$ErrorActionPreference = 'SilentlyContinue'
$runtime = Join-Path $PSScriptRoot '.runtime'
foreach ($name in @('web.pid', 'api.pid')) {
    $path = Join-Path $runtime $name
    if (Test-Path $path) {
        $processId = [int](Get-Content -LiteralPath $path -Raw)
        Stop-Process -Id $processId -Force
        Remove-Item -LiteralPath $path -Force
    }
}
Write-Host 'Brightloop OS processes stopped.'
