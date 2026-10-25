$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
git config --global --add safe.directory ($Project -replace '\\','/')
if (-not (Test-Path '.git')) { git init -b main }
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m 'Build Pharos Whale-Watching Agent' }
$Remote = 'https://github.com/shoupeorg/pharos-whale-watching-agent.git'
if (-not (gh repo view shoupeorg/pharos-whale-watching-agent --json url 2>$null)) {
  gh repo create shoupeorg/pharos-whale-watching-agent --public
}
if (-not (git remote get-url origin 2>$null)) { git remote add origin $Remote }
git push -u origin main
$Local = (git rev-parse HEAD).Trim()
git fetch origin main
$RemoteHead = (git rev-parse origin/main).Trim()
if ($Local -ne $RemoteHead) { throw "Publication mismatch: local=$Local remote=$RemoteHead" }
Write-Host "PUBLICATION VERIFIED: $Local" -ForegroundColor Green
