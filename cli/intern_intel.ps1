<#
Intern Intel with the Bright Data CLI (Windows PowerShell 5.1 or PowerShell 7).

  powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1
  powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 -Role "data science intern" -Location "New York, NY"
  powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 -Pages 2 -MinHourly 40 -Limit 20

"-ExecutionPolicy Bypass" is there because stock Windows refuses to run .ps1 files. If your
machine allows scripts, .\cli\intern_intel.ps1 -Role "..." works too.

Parameters: -Role, -Location, -Pages (1 or 2), -Zone, -TitleIncludes, -LocationIncludes,
-MinHourly, -Limit, -TimeoutSeconds (default 180: pages still running after that count as
failed). PowerShell style, one dash. There is no --offline or --refresh here: use
python/intern_intel.py or js/intern_intel.mjs for those.

Three steps:
  1. python/intern_intel.py --print-urls      builds the Indeed and Glassdoor search URLs
  2. the Bright Data CLI fetches each page as markdown, all pages at the same time:
       npx -y @brightdata/cli@0.4.0 scrape <url> -f markdown --country us --zone <zone> -o <file>
  3. python/intern_intel.py --from-dir <folder>  parses, merges, removes duplicates, filters,
     and writes out/intern_intel.csv and out/intern_intel.json

You need Node.js 20 or newer (for npx), Python 3 with python/requirements.txt installed,
and a Bright Data API key. Nothing is installed globally: npx keeps the CLI in its own cache.

API key: BRIGHTDATA_API_KEY or BRIGHTDATA_API_TOKEN, from your environment or the .env file
in the repo root. The CLI reads the name BRIGHTDATA_API_KEY, so this script sets it for its
own process only.
Zone: -Zone, else BRIGHTDATA_UNLOCKER_ZONE or BRIGHTDATA_ZONE, else the first Web Unlocker
zone on your account (found with "npx -y @brightdata/cli@0.4.0 zones --json").

Steps 1 and 3 run the Python version, so do the Python setup in SETUP.md first. This script
uses the repo's .venv by itself.
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Role = "software engineer intern",
    [string]$Location = "San Francisco, CA",
    [ValidateRange(1, 2)][int]$Pages = 1,
    [string]$Zone = "",
    [string]$TitleIncludes,
    [string]$LocationIncludes,
    [double]$MinHourly,
    [int]$Limit,
    [ValidateRange(5, 3600)][int]$TimeoutSeconds = 180,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$CliPackage = "@brightdata/cli@0.4.0"
$Root = Split-Path -Parent $PSScriptRoot
$Started = Get-Date

if ($Rest) {
    Write-Host "Not understood: $($Rest -join ' ')"
    Write-Host "This script takes PowerShell-style parameters with one dash, for example:"
    Write-Host '  powershell -ExecutionPolicy Bypass -File cli\intern_intel.ps1 -Role "data science intern" -Location "New York, NY"'
    Write-Host "Parameters: -Role -Location -Pages -Zone -TitleIncludes -LocationIncludes -MinHourly -Limit -TimeoutSeconds"
    Write-Host "There is no --offline or --refresh here. For those, run python/intern_intel.py or js/intern_intel.mjs."
    exit 2
}

function Get-DotEnv([string]$Name) {
    # The value of $Name in the repo .env file, or "".
    $file = Join-Path $Root ".env"
    if (-not (Test-Path $file)) { return "" }
    foreach ($line in Get-Content $file -Encoding UTF8) {
        if ($line -match "^\s*$Name\s*=\s*(.*)$") { return $Matches[1].Trim().Trim('"').Trim("'") }
    }
    return ""
}

function Stop-WithMessage([string]$Message) {
    Write-Host $Message
    exit 1
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "npx not found. Install Node.js 20 or newer from nodejs.org, then open a new terminal."
}

# Python: $env:PYTHON, else the repo's .venv, else python on the PATH.
$Python = $env:PYTHON
if (-not $Python) {
    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
    $Python = if (Test-Path $venvPython) { $venvPython } else { "python" }
}
$IntelPy = Join-Path $Root "python\intern_intel.py"

# ------------------------------------------------------------------ API key and zone
$key = $env:BRIGHTDATA_API_KEY
if (-not $key) { $key = $env:BRIGHTDATA_API_TOKEN }
if (-not $key) { $key = Get-DotEnv "BRIGHTDATA_API_KEY" }
if (-not $key) { $key = Get-DotEnv "BRIGHTDATA_API_TOKEN" }
if (-not $key) { Stop-WithMessage "No Bright Data API key. Put BRIGHTDATA_API_TOKEN=... in .env (see .env.example)." }
$env:BRIGHTDATA_API_KEY = $key   # this process and its children only; never printed
Remove-Variable key

if (-not $Zone) { $Zone = $env:BRIGHTDATA_UNLOCKER_ZONE }
if (-not $Zone) { $Zone = $env:BRIGHTDATA_ZONE }
if (-not $Zone) { $Zone = Get-DotEnv "BRIGHTDATA_ZONE" }
if (-not $Zone) {
    # The CLI does not pick a zone by itself (only "bdata login" sets a default), so we look one up.
    $zonesText = (& npx -y $CliPackage zones --json) | Out-String
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Could not list your zones with the Bright Data CLI (see the message above)." }
    $zones = $zonesText | ConvertFrom-Json
    [string[]]$names = @($zones | Where-Object { $_.type -eq "unblocker" } | ForEach-Object { $_.name })
    if ($names.Count -eq 0) {
        Stop-WithMessage "No Web Unlocker zone on this account. Create one in the Bright Data control panel, then set BRIGHTDATA_ZONE=<its name> in .env."
    }
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $Zone = $names[0]
    Write-Host "Zone not set, using Web Unlocker zone '$Zone' (found: $($names -join ', '))"
} else {
    $version = & npx -y $CliPackage --version   # also installs the CLI into the npx cache before the parallel step
    Write-Host "Bright Data CLI $version, zone '$Zone'"
}
$env:BRIGHTDATA_ZONE = $Zone   # step 1 may need it for a Glassdoor location lookup

# ------------------------------------------------------------------ 1. URLs
# "--name=value" keeps an empty value: Windows PowerShell 5.1 drops "" arguments to programs.
$planText = & $Python $IntelPy --print-urls "--role=$Role" "--location=$Location" "--pages=$Pages"
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Could not build the search URLs (see the message above)." }
$plan = foreach ($line in $planText) {
    $parts = $line -split "`t"
    if ($parts.Count -eq 3 -and ($parts[0] -eq "indeed" -or $parts[0] -eq "glassdoor")) {
        [pscustomobject]@{ Source = $parts[0]; Page = $parts[1]; Url = $parts[2] }
    } elseif ($line) {
        Write-Host $line   # e.g. "[glassdoor] skipped: ..."
    }
}

# ------------------------------------------------------------------ 2. fetch with the CLI
$slug = (("$Role $Location p$Pages").ToLower() -replace "[^a-z0-9]+", "-").Trim("-")
$OutDir = Join-Path $Root "cache\cli\$slug"
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -Filter *.md | Remove-Item   # old pages from an earlier run of the same search

$scrape = {
    param($pkg, $url, $zone, $file)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $log = & npx -y $pkg scrape $url -f markdown --country us --zone $zone -o $file 2>&1 | ForEach-Object { "$_" }
    [pscustomobject]@{ Code = $LASTEXITCODE; Seconds = [math]::Round($timer.Elapsed.TotalSeconds, 1); Log = ($log -join "`n") }
}

Write-Host "Fetching $(@($plan).Count) pages with the Bright Data CLI (a page can take over a minute; the limit is $TimeoutSeconds s) ..."
$jobs = foreach ($p in $plan) {
    $file = Join-Path $OutDir "$($p.Source)_p$($p.Page).md"
    Start-Sleep -Milliseconds 100   # space out the request starts
    Start-Job -Name "$($p.Source) p$($p.Page)" -ScriptBlock $scrape -ArgumentList $CliPackage, $p.Url, $Zone, $file
}

$jobs = @($jobs)
$fetchStarted = Get-Date
$deadline = $fetchStarted.AddSeconds($TimeoutSeconds)
while ($true) {
    $running = @($jobs | Where-Object { $_.State -eq "Running" -or $_.State -eq "NotStarted" })
    $left = ($deadline - (Get-Date)).TotalSeconds
    if ($running.Count -eq 0 -or $left -le 0) { break }
    Wait-Job $running -Timeout ([int][math]::Ceiling([math]::Min(15, $left))) | Out-Null
    $running = @($jobs | Where-Object { $_.State -eq "Running" -or $_.State -eq "NotStarted" })
    if ($running.Count -gt 0 -and (Get-Date) -lt $deadline) {
        Write-Host ("  still waiting for {0} ({1:N0} s so far)" -f (($running | ForEach-Object { $_.Name }) -join ", "), ((Get-Date) - $fetchStarted).TotalSeconds)
    }
}
$i = 0
foreach ($p in $plan) {
    $job = $jobs[$i]; $i++
    $timedOut = $job.State -eq "Running" -or $job.State -eq "NotStarted"
    if ($timedOut) {
        Stop-Job $job
        $r = [pscustomobject]@{ Code = -1; Seconds = $TimeoutSeconds; Log = "No answer within $TimeoutSeconds s. Run the script again, or raise -TimeoutSeconds." }
    } else {
        $r = Receive-Job $job
        if (-not $r) { $r = [pscustomobject]@{ Code = -1; Seconds = 0; Log = "job $($job.State): $($job.ChildJobs[0].JobStateInfo.Reason)" } }
    }
    Remove-Job $job -Force
    $file = Join-Path $OutDir "$($p.Source)_p$($p.Page).md"
    $empty = -not (Test-Path $file) -or (Get-Item $file).Length -eq 0
    if ($timedOut -and (Test-Path $file)) { Remove-Item $file }   # never parse a half-written page
    if ($r.Code -eq 0 -and $empty) {
        # An empty answer is worth exactly one more try. Errors (bad key, bad zone, login wall) are not.
        $r = & $scrape $CliPackage $p.Url $Zone $file
        $empty = -not (Test-Path $file) -or (Get-Item $file).Length -eq 0
    }
    if ($r.Code -eq 0 -and -not $empty) {
        $kb = [math]::Round((Get-Item $file).Length / 1KB, 1)
        Write-Host ("[{0} p{1}] {2} KB in {3} s" -f $p.Source, $p.Page, $kb, $r.Seconds)
    } else {
        if (Test-Path $file) { Remove-Item $file }
        Write-Host ("[{0} p{1}] FAILED after {2} s (exit code {3}):" -f $p.Source, $p.Page, $r.Seconds, $r.Code)
        Write-Host $r.Log
    }
}

# ------------------------------------------------------------------ 3. parse, merge, filter
$parseArgs = @("--from-dir=$OutDir")
if ($TitleIncludes) { $parseArgs += "--title-includes=$TitleIncludes" }
if ($LocationIncludes) { $parseArgs += "--location-includes=$LocationIncludes" }
if ($PSBoundParameters.ContainsKey("MinHourly")) { $parseArgs += "--min-hourly=$MinHourly" }
if ($PSBoundParameters.ContainsKey("Limit")) { $parseArgs += "--limit=$Limit" }
Write-Host ""
& $Python $IntelPy @parseArgs
$code = $LASTEXITCODE
Write-Host ("Total {0:N1} s (pages saved in {1})" -f ((Get-Date) - $Started).TotalSeconds, $OutDir)
exit $code
