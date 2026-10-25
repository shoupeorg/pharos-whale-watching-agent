$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'publish.ps1')
& (Join-Path $PSScriptRoot 'deploy.ps1')
& (Join-Path $PSScriptRoot 'publish.ps1')
& (Join-Path $PSScriptRoot 'verify-public.ps1')
Write-Host 'PUBLICATION, DEPLOYMENT AND VERIFICATION COMPLETED' -ForegroundColor Green
