$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$SafeProject = $Project -replace '\\','/'
if (-not (Test-Path '.git')) { git init -b main }
git -c safe.directory=$SafeProject add -A
git -c safe.directory=$SafeProject diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git -c safe.directory=$SafeProject commit -m 'Build Pharos Whale-Watching Agent' }
$Remote = 'https://github.com/shoupeorg/pharos-whale-watching-agent.git'
$Remotes = @(git -c safe.directory=$SafeProject remote)
if ($Remotes -notcontains 'origin') { git -c safe.directory=$SafeProject remote add origin $Remote }
else { git -c safe.directory=$SafeProject remote set-url origin $Remote }
git -c safe.directory=$SafeProject push -u origin main
$Local = (git -c safe.directory=$SafeProject rev-parse HEAD).Trim()
git -c safe.directory=$SafeProject fetch origin main
$RemoteHead = (git -c safe.directory=$SafeProject rev-parse origin/main).Trim()
if ($Local -ne $RemoteHead) { throw "Publication mismatch: local=$Local remote=$RemoteHead" }
Write-Host "PUBLICATION VERIFIED: $Local" -ForegroundColor Green
