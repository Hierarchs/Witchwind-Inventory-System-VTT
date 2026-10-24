# Packages the module into dist/witchwind-inventory.zip, with module.json at the zip root as Foundry expects.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File build.ps1

$root = $PSScriptRoot
$stage = Join-Path $env:TEMP "witchwind-build"
$zip = Join-Path $root "dist\witchwind-inventory.zip"
$include = "module.json", "README.md", "scripts", "styles", "lang"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($path in $include) { Copy-Item -Recurse (Join-Path $root $path) $stage }

New-Item -ItemType Directory -Force (Split-Path $zip) | Out-Null
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage @include
Remove-Item -Recurse -Force $stage

$version = (Get-Content (Join-Path $root "module.json") -Raw | ConvertFrom-Json).version
Write-Host "Built $zip (version $version)"
