# Revisión CONSOLIDADA del dueño: #126 + #127 + bloque Portal/B2B (rama codex/integracion-126-127-b2b). Solo local; no toca producción ni la base de revisión anterior (rev_revision en pg304).
#   powershell -File supabase\scripts\localreview_integrado\revision_integrada.ps1 iniciar|detener|estado
# Requiere: Docker Desktop, Git Bash, la carpeta %LOCALAPPDATA%\dspacios-local-revision-int (config.json, storage\) y el contenedor `pgb2b` con la base rev_verif_int_revision.
# iniciar: arranca pgb2b + GoTrue/PostgREST/Storage/Mailpit/gateway (pila.sh) sobre ESA base (nunca se crea ni se borra) y la app compilada en http://localhost:3070
#          (Next escucha SOLO en 127.0.0.1; la URL de la app, el SITE_URL de Auth y la compilación usan el nombre `localhost`: abre siempre http://localhost:3070, nunca 127.0.0.1:3070, para no mezclar cookies/PKCE).
#          Códigos de verificación: vencen a los 600 s (PILA_OTP_EXP; los 20 s son solo del entorno automatizado de pruebas de vencimiento).
#          Termina con código distinto de 0 y NUNCA escribe «Lista» si algo no quedó sano (pila, gateway/Auth, PostgREST, correo de pruebas, app, dirección de escucha).
# detener: baja la app y la pila y detiene pgb2b (las bases se conservan). aiomotor-db y pg304 no se tocan.
#   restaurar -Confirmar: DESCARTA el avance de la revisión y vuelve al estado inicial (copia `rev_verif_int_revision_pristina` + storage_pristina); sin -Confirmar no hace nada.
param([ValidateSet("iniciar", "detener", "estado", "restaurar")][string]$Accion = "estado", [switch]$Confirmar)
$ErrorActionPreference = "Stop"
$app = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path          # .../dspacios-travel
$cfg = Join-Path $env:LOCALAPPDATA "dspacios-local-revision-int"
$cfgM = $cfg -replace "\\", "/"
$bash = "C:\Program Files\Git\bin\bash.exe"
$base = "rev_verif_int_revision"
$conf = Get-Content (Join-Path $cfg "config.json") -Raw | ConvertFrom-Json
$puertoApp = $conf.puertos.app
$logApp = Join-Path $cfg "app.log"
$logPila = Join-Path $cfg "pila.log"

# Cola de un log sin llaves, contraseñas ni JWT (se muestra en el mensaje de error).
function ColaSegura([string]$ruta, [int]$n = 6) {
  if (-not (Test-Path $ruta)) { return "(sin log en $ruta)" }
  (Get-Content $ruta -Tail $n | ForEach-Object { $_ -replace 'eyJ[\w\-\.]+', '<jwt>' -replace '(?i)(password|passwd|secret|apikey|key)(["''=: ]+)\S+', '$1$2<oculto>' }) -join "`n"
}
function Fallar([string]$que, [string]$log) { throw "FALLÓ: $que`nLog: $log`n$(ColaSegura $log)" }

function Pila([string]$a, [hashtable]$vars = @{}) {
  foreach ($k in $vars.Keys) { Set-Item -Path "env:$k" -Value $vars[$k] }
  try {
    # La salida va a un archivo: pila.sh deja procesos de fondo (gateway) que, si heredan la tubería, dejarían esta consola esperando para siempre.
    Remove-Item $logPila -ErrorAction SilentlyContinue
    $cmd = "cd '$($app -replace '\\','/')' && MSYS_NO_PATHCONV=1 bash supabase/scripts/real_62/pila.sh $a '$cfgM' pgb2b plantilla_int > '$($logPila -replace '\\','/')' 2>&1 < /dev/null"
    $p = Start-Process -FilePath $bash -ArgumentList @("-lc", "`"$cmd`"") -WindowStyle Hidden -PassThru
    # No se espera a que termine el proceso (deja el gateway de fondo): se espera su línea final y se EXIGE.
    $fin = if ($a -eq "subir") { "pila v1real lista" } else { "pila v1real bajada" }
    $ok = $false
    for ($i = 0; $i -lt 150; $i++) {
      if ((Test-Path $logPila) -and (Select-String -Path $logPila -Pattern $fin -Quiet)) { $ok = $true; break }
      if ($p.HasExited -and $p.ExitCode -ne 0) { Fallar "pila.sh $a terminó con código $($p.ExitCode)" $logPila }
      Start-Sleep 2
    }
    if (-not $ok) { Fallar "pila.sh $a no mostró «$fin» en 300 s" $logPila }
  } finally { foreach ($k in $vars.Keys) { Remove-Item -Path "env:$k" -ErrorAction SilentlyContinue } }
}
# Espera una respuesta HTTP con el código esperado; devuelve $false si no llega.
function EsperarHttp([string]$url, [int]$intentos = 30, [hashtable]$cab = @{}, [int]$esperado = 200) {
  for ($i = 0; $i -lt $intentos; $i++) {
    try { if ((Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3 -Headers $cab).StatusCode -eq $esperado) { return $true } } catch { }
    Start-Sleep 2
  }
  return $false
}
function EscuchaApp { @(Get-NetTCPConnection -LocalPort $puertoApp -State Listen -ErrorAction SilentlyContinue) }

switch ($Accion) {
  "iniciar" {
    if (-not (Test-Path (Join-Path $app ".next\BUILD_ID"))) { throw "FALLÓ: no hay build de producción en $app\.next. Compila primero: node supabase/scripts/localreview_integrado/app_integrada.mjs `"$cfgM`" build build.log" }
    docker start pgb2b | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "FALLÓ: no arranca el contenedor pgb2b (¿Docker Desktop está abierto?)" }
    Pila "subir" @{ PILA_DB = $base; PILA_SIN_MIGRACIONES = "1"; PILA_STORAGE_DIR = "$cfgM/storage"; PILA_OTP_EXP = "600" }
    $gw = "http://127.0.0.1:$($conf.puertos.gateway)"
    if (-not (EsperarHttp "$gw/auth/v1/health" 15 @{ apikey = $conf.anonKey })) { Fallar "GoTrue (Auth) no responde 200 en $gw/auth/v1/health" $logPila }
    if (-not (EsperarHttp "$gw/rest/v1/" 15 @{ apikey = $conf.anonKey; Authorization = "Bearer $($conf.anonKey)" })) { Fallar "PostgREST no responde 200 en $gw/rest/v1/" $logPila }
    if (-not (EsperarHttp "http://127.0.0.1:$($conf.puertos.correo)/" 10)) { Fallar "el correo de pruebas (Mailpit) no responde en el puerto $($conf.puertos.correo)" $logPila }
    # Si algo ya escucha en el puerto de la app, debe ser SOLO loopback; si no, no se lanza otro encima ni se da por buena.
    if ((EscuchaApp).Count -eq 0) {
      # Proceso aparte y oculto: no hereda la consola ni sus tuberías.
      Start-Process -FilePath "node" -ArgumentList @("supabase/scripts/localreview_integrado/app_integrada.mjs", $cfgM, "start", $logApp) -WorkingDirectory $app -WindowStyle Hidden
    }
    if (-not (EsperarHttp "http://localhost:$puertoApp/login" 30)) { Fallar "la app no responde 200 en http://localhost:$puertoApp/login" $logApp }
    $dir = @(EscuchaApp | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
    if ($dir.Count -ne 1 -or $dir[0] -ne "127.0.0.1") { Fallar "la app debe escuchar SOLO en 127.0.0.1:$puertoApp y escucha en: $($dir -join ', '). Ejecuta «detener» y vuelve a «iniciar»" $logApp }
    Write-Host "Lista: http://localhost:$puertoApp  (escucha solo en 127.0.0.1) · correo de pruebas: http://127.0.0.1:$($conf.puertos.correo) · códigos vencen a los 600 s"
  }
  "detener" {
    EscuchaApp | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
    Pila "bajar" @{ PILA_DB = $base }
    docker stop pgb2b | Out-Null
    Write-Host "Revisión integrada detenida (bases conservadas)."
  }
  "restaurar" {
    if (-not $Confirmar) { throw "restaurar descarta TODO el avance de la revisión (firmas, pagos, solicitudes, cierres…). Repite con -Confirmar si es lo que quieres." }
    & $PSCommandPath detener
    docker start pgb2b | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "FALLÓ: no arranca el contenedor pgb2b (¿Docker Desktop está abierto?)" }
    $listo = $false
    for ($i = 0; $i -lt 60; $i++) { docker exec pgb2b pg_isready -U postgres -h 127.0.0.1 *> $null; if ($LASTEXITCODE -eq 0) { $listo = $true; break }; Start-Sleep 1 }
    if (-not $listo) { throw "FALLÓ: Postgres de pgb2b no queda listo en 60 s" }
    Start-Sleep 2
    $psql = @("exec", "-i", "-e", "PGPASSWORD=postgres", "pgb2b", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c")
    if ((& docker @psql "select count(*) from pg_database where datname = 'rev_verif_int_revision_pristina'" -t -A) -ne "1") { throw "FALLÓ: no existe la copia inicial rev_verif_int_revision_pristina" }
    & docker @psql "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$base' and pid <> pg_backend_pid()" | Out-Null
    & docker @psql "drop database if exists $base with (force)"; if ($LASTEXITCODE -ne 0) { throw "FALLÓ: no se pudo borrar $base" }
    & docker @psql "create database $base template rev_verif_int_revision_pristina"; if ($LASTEXITCODE -ne 0) { throw "FALLÓ: no se pudo recrear $base" }
    Remove-Item (Join-Path $cfg "storage") -Recurse -Force
    Copy-Item (Join-Path $cfg "storage_pristina") (Join-Path $cfg "storage") -Recurse
    Write-Host "Revisión restaurada al estado inicial. Ejecuta «iniciar»."
  }
  "estado" {
    $dir = @(EscuchaApp | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
    "app :$puertoApp = " + $(if ($dir.Count) { "arriba, escucha en " + ($dir -join ", ") } else { "abajo" })
    docker ps --format "{{.Names}} {{.Status}}" | Select-String "pgb2b|v1real"
  }
}
