$ErrorActionPreference = 'Stop'
$Base = 'https://pharos-whale-watching-agent.shoupeorg.workers.dev'
$Workspace = 'publicverify' + ([guid]::NewGuid().ToString('N'))
$Headers = @{ 'x-watch-workspace' = $Workspace }
$Page = Invoke-WebRequest -UseBasicParsing -Uri "$Base/" -TimeoutSec 30
if ($Page.StatusCode -ne 200 -or $Page.Headers.'Content-Type' -notmatch 'text/html' -or $Page.Content -notmatch 'Pharos Whale-Watching Agent') { throw 'Public UI assertion failed.' }
$Logo = Invoke-WebRequest -UseBasicParsing -Uri "$Base/pharos-logo.png" -TimeoutSec 30
if ($Logo.StatusCode -ne 200 -or $Logo.Headers.'Content-Type' -notmatch 'image/png') { throw 'Public logo assertion failed.' }
$Meta = Invoke-RestMethod -Uri "$Base/api/meta" -Headers $Headers -TimeoutSec 30
if ($Meta.chainId -ne 1672 -or $Meta.engineVersion -ne 'whale-watch/1.0.0') { throw 'Public metadata assertion failed.' }
$Example = Invoke-RestMethod -Method Post -Uri "$Base/api/example" -Headers $Headers -TimeoutSec 30
if ($Example.config.addresses.Count -lt 5) { throw 'Public example assertion failed.' }
$Saved = Invoke-WebRequest -UseBasicParsing -Uri "$Base/evidence/v1-live-report.json" -TimeoutSec 30
$SavedBody = $Saved.Content | ConvertFrom-Json
if ($SavedBody.summary.uniqueEvents -ne 5 -or $SavedBody.summary.belowThresholdEvents -ne 1) { throw 'Public evidence assertion failed.' }
$Start = Invoke-RestMethod -Method Post -Uri "$Base/api/monitor/start" -Headers $Headers -TimeoutSec 30
$State = Invoke-RestMethod -Uri "$Base/api/state" -Headers $Headers -TimeoutSec 30
if (-not $Start.monitoring -or -not $State.monitoring) { throw 'Persistent monitor assertion failed.' }
$Stop = Invoke-RestMethod -Method Post -Uri "$Base/api/monitor/stop" -Headers $Headers -TimeoutSec 30
if ($Stop.monitoring) { throw 'Stop monitor assertion failed.' }
[pscustomobject]@{ base=$Base; ui=$Page.StatusCode; logo=$Logo.StatusCode; engine=$Meta.engineVersion; chainId=$Meta.chainId; exampleAddresses=$Example.config.addresses.Count; evidenceEvents=$SavedBody.summary.uniqueEvents; monitoringPersistence=$true } | ConvertTo-Json
