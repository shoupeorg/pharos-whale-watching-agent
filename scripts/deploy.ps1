$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$env:npm_config_cache = Join-Path $Project '.npm-cache'
npm run check
if ($LASTEXITCODE -ne 0) { throw "Tests/build failed with exit code $LASTEXITCODE" }
$List = npx wrangler d1 list --json | ConvertFrom-Json
$Db = $List | Where-Object { $_.name -eq 'pharos-whale-watching-agent' } | Select-Object -First 1
if (-not $Db) {
  npx wrangler d1 create pharos-whale-watching-agent | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "D1 creation failed with exit code $LASTEXITCODE" }
  $List = npx wrangler d1 list --json | ConvertFrom-Json
  $Db = $List | Where-Object { $_.name -eq 'pharos-whale-watching-agent' } | Select-Object -First 1
}
if (-not $Db.uuid) { throw 'Unable to resolve the D1 database UUID from Wrangler JSON.' }
$ConfigPath = Join-Path $Project 'wrangler.jsonc'
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Config.d1_databases[0].database_id = $Db.uuid
$Config | ConvertTo-Json -Depth 12 | Set-Content $ConfigPath -Encoding utf8
npx wrangler d1 migrations apply pharos-whale-watching-agent --remote
if ($LASTEXITCODE -ne 0) { throw "D1 migration failed with exit code $LASTEXITCODE" }
npm run build
npx wrangler deploy --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Deployment failed with exit code $LASTEXITCODE" }
Write-Host "DEPLOYMENT COMPLETED: D1 $($Db.uuid)" -ForegroundColor Green
