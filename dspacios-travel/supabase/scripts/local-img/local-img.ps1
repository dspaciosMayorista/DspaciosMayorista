# Local, isolated environment for the Programas/Receptivos image-delivery measurements. LOOPBACK ONLY, synthetic data only.
#   pg4360 (container, DB dspacios_img = private copy of lote_revision) <- img-rest (PostgREST 54372) <- proxy_rest.mjs (54370)
#   servidor_imagenes.mjs (54371)  = stand-in for Storage public buckets
#   app: next build / next start on 127.0.0.1:3047 (own env built from scratch; network guard blocks non-loopback)
# Usage: .\local-img.ps1 build | start | servicios | detener
param([Parameter(Mandatory = $true, Position = 0)][ValidateSet('build', 'start', 'servicios', 'detener')][string]$Accion,
      [string]$Fixtures = "$env:TEMP\img-fixtures", [int]$MinLibreMB = 2600, [int]$HeapMB = 3072)
$ErrorActionPreference = 'Stop'
$App = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Cfg = Get-Content (Join-Path $env:LOCALAPPDATA 'dspacios-localimg\config.json') -Raw | ConvertFrom-Json
$Pids = Join-Path $env:LOCALAPPDATA 'dspacios-localimg\pids.txt'
function Libre { [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function NodeConEntorno([string[]]$args2, [int]$heap, [string]$cwd, [switch]$App, [string]$log) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node).Source; $psi.Arguments = ($args2 -join ' '); $psi.WorkingDirectory = $cwd
  if ($log) { $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true }
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.Environment.Clear()
  foreach ($k in 'SystemRoot', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA') { $psi.Environment[$k] = [Environment]::GetEnvironmentVariable($k) }
  if ($App) {
    $psi.Environment['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54370'
    $psi.Environment['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $Cfg.anonKey
    $psi.Environment['SUPABASE_SERVICE_ROLE_KEY'] = $Cfg.serviceKey
    $psi.Environment['CRON_SECRET'] = 'local-img-cron'
    $psi.Environment['NEXT_PUBLIC_SITE_URL'] = 'http://127.0.0.1:3047'
    $psi.Environment['NEXT_TELEMETRY_DISABLED'] = '1'; $psi.Environment['QUICK_LOGIN_ENABLED'] = '0'
    $guardia = (Join-Path $PSScriptRoot '..\local-lote\guardia_red_lote.cjs' | Resolve-Path).Path.Replace([string][char]92, '/')
    $psi.Environment['NODE_OPTIONS'] = "--require `"$guardia`" --max-old-space-size=$heap"
  }
  $proc = [System.Diagnostics.Process]::Start($psi)
  if ($log) { $script:t1 = $proc.StandardOutput.ReadToEndAsync(); $script:t2 = $proc.StandardError.ReadToEndAsync() }
  return $proc
}
switch ($Accion) {
  'servicios' {
    docker start pg4360 | Out-Null
    foreach ($i in 1..60) { $null = cmd /c "docker exec -e PGPASSWORD=postgres pg4360 psql -h 127.0.0.1 -U supabase_admin -d dspacios_img -X -At -c 'select 1' >nul 2>nul"; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }
    if (-not (docker ps -aq --filter 'name=^img-rest$')) { throw 'img-rest no existe (ver docs/tecnico/imagenes-programas-receptivos-2026-11-17.md, paso 3)' }
    docker start img-rest | Out-Null
    $a = NodeConEntorno @((Join-Path $PSScriptRoot 'servidor_imagenes.mjs'), $Fixtures, '54371') 256 $PSScriptRoot
    $b = NodeConEntorno @((Join-Path $PSScriptRoot 'proxy_rest.mjs'), '54370', '54372') 256 $PSScriptRoot
    "$($a.Id)`n$($b.Id)" | Set-Content $Pids; "servicios arriba (libre $(Libre) MB)"
  }
  'build' {
    if ((Libre) -lt $MinLibreMB) { throw "RAM libre $(Libre) MB < $MinLibreMB MB: build cancelado (liberar memoria o parar servicios)" }
    $p = NodeConEntorno @('node_modules/next/dist/bin/next', 'build') $HeapMB $App -App -log (Join-Path $env:LOCALAPPDATA 'dspacios-localimg/build.log')
    $p.PriorityClass = 'BelowNormal'; $p.WaitForExit(); ($script:t1.Result + $script:t2.Result) | Set-Content (Join-Path $env:LOCALAPPDATA 'dspacios-localimg/build.log'); "build exit=$($p.ExitCode)"
  }
  'start' {
    $p = NodeConEntorno @((Join-Path $PSScriptRoot 'servir_con_log.mjs'), (Join-Path $env:LOCALAPPDATA 'dspacios-localimg/app.log'), 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3047') 1024 $App -App
    Add-Content $Pids $p.Id; "app pid $($p.Id)"
  }
  'detener' {
    if (Test-Path $Pids) { foreach ($i in Get-Content $Pids) { Stop-Process -Id ([int]$i) -Force -ErrorAction SilentlyContinue }; Remove-Item $Pids }
    docker stop img-rest 2>$null | Out-Null
  }
}
