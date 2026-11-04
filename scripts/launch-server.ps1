$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$portNumber = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$serviceUrl = "http://127.0.0.1:$portNumber"
function Test-DispatchService {
  try { $state = Invoke-RestMethod -Uri "$serviceUrl/api/health" -TimeoutSec 1; return $state.ok -and $state.service -eq 'hazwaste-dispatch' } catch { return $false }
}
try {
  if (-not (Test-DispatchService)) {
    $logPath = Join-Path $projectPath 'data'
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $serverProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.js' -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'server-out.log') -RedirectStandardError (Join-Path $logPath 'server-error.log')
    for ($attemptNumber = 0; $attemptNumber -lt 40; $attemptNumber++) {
      if (Test-DispatchService) { break }
      if ($serverProcess.HasExited) { throw (Get-Content -LiteralPath (Join-Path $logPath 'server-error.log') -Raw) }
      Start-Sleep -Milliseconds 250
    }
    if (-not (Test-DispatchService)) { throw 'Server did not become ready. Check data/server-error.log.' }
  }
  Start-Process "$serviceUrl/web/"
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; Read-Host 'Press Enter to close' }
