param(
  [switch]$WithScrapers
)

$ErrorActionPreference = 'Stop'

$scriptPath = $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptPath
Set-Location $repoRoot

if (-not (Test-Path 'node_modules')) {
  npm install
}

if (-not (Test-Path 'gui/node_modules')) {
  npm --prefix gui install
}

$uiUrl = 'http://localhost:5173'
$serverPort = 3001
$uiPort = 5173
$timeoutSeconds = 120

Start-Job -ArgumentList $serverPort, $uiPort, $uiUrl, $timeoutSeconds -ScriptBlock {
  param([int]$serverPort, [int]$uiPort, [string]$uiUrl, [int]$timeoutSeconds)

  function Test-Port([int]$port) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $client.Connect('localhost', $port)
      $client.Close()
      return $true
    } catch {
      return $false
    }
  }

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Port $serverPort) -and (Test-Port $uiPort)) {
      Start-Process $uiUrl
      return
    }
    Start-Sleep -Milliseconds 500
  }
} | Out-Null

if ($WithScrapers) {
  npm run dev:all:with-scrapers
} else {
  npm run dev:all
}
