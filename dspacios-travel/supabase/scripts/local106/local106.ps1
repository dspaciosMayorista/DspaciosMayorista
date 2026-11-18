# ─────────────────────────────────────────────────────────────────────────────
# ENTORNO LOCAL DE REVISIÓN de #106 (gestión integral de contratos, solo superadmin). SOLO LOCAL.
#   Derivado de local53.ps1 / local4360.ps1 (mismo aislamiento: entorno desde cero, guardia de red, vigilante de memoria); sin Storage.
#
#   Postgres  : contenedor pg304, base dspacios_local106
#               = copia de plantilla304 (esquema de Producción ≤302, VACÍO) + 305 + 306 + 309 (#106)
#               + semilla SINTÉTICA (semilla_local106.sql, Mayorista y Minorista). Ningún dato de Producción.
#   Auth      : GoTrue v2.197.0  · REST: PostgREST v16.4
#   Gateway   : Kong 2.8.1 en http://127.0.0.1:54356 (rutas /auth/v1 y /rest/v1, como Supabase)
#   App       : dev  → http://127.0.0.1:3056   ·   build de producción local → http://127.0.0.1:3057 (solo loopback)
#
# Claves: un secreto JWT local NUEVO (claves_local4360.mjs) en %LOCALAPPDATA%\dspacios-local4360\config.json.
# No lee ni escribe ningún .env (si existe alguno en la app, no arranca); la app corre en un proceso hijo con
# un entorno armado desde cero y una guardia que bloquea toda conexión no loopback (correo, pagos, webhooks,
# Supabase alojado, telemetría). La terminal no se modifica. Memoria: dev 3 GB, build 4 GB, start 2 GB.
# Solo toca SUS contenedores (prefijo local106-), su red (local106) y sus bases en pg304.
#
# Uso (PowerShell, desde cualquier carpeta):
#   .\local106.ps1 preparar    # una vez: base + migraciones + semilla + usuarios + foto para restaurar
#   .\local106.ps1 iniciar     # levanta Auth/REST/Gateway (pg304 ya corriendo)
#   .\local106.ps1 estado
#   .\local106.ps1 dev         # app en modo desarrollo (Ctrl+C para salir)
#   .\local106.ps1 prod        # next build + next start (build de producción local)
#   .\local106.ps1 start       # solo next start del build EXISTENTE (sin recompilar; se niega si no corresponde al código)
#   .\local106.ps1 restaurar   # vuelve SOLO los datos locales a la foto inicial
#   .\local106.ps1 detener [-IncluirPostgres]
#   .\local106.ps1 aislamiento  # comprueba el aislamiento sin llamadas reales al exterior
# ─────────────────────────────────────────────────────────────────────────────
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('preparar', 'iniciar', 'detener', 'restaurar', 'estado', 'dev', 'prod', 'start', 'aislamiento')][string]$Accion,
  [switch]$IncluirPostgres
)
$ErrorActionPreference = 'Continue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$App      = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Dir      = Join-Path $env:LOCALAPPDATA 'dspacios-local106'
$Cfg      = Join-Path $Dir 'config.json'
$PG = 'pg304'; $DB = 'dspacios_local106'; $SEMILLA = 'dspacios_local106_semilla'; $BASE = 'g106_base'; $L4360 = Join-Path $PSScriptRoot '..\local4360'
$RED = 'local106'; $ETIQUETA = 'dspacios.local106=1'
$C_AUTH = 'local106-auth'; $C_REST = 'local106-rest'; $C_KONG = 'local106-kong'
$URL = 'http://127.0.0.1:54356'   # IPv4 explícito: localhost puede resolverse a ::1 y Kong publica solo en 127.0.0.1
$CLAVE_PRUEBA = 'Local106!'   # contraseña de los usuarios SINTÉTICOS de prueba (solo local)
$USUARIOS = @(
  @{ email = 'superadmin@local106.test';  nombre = 'Local Superadmin';  rol = 'superadmin';     tenant = 'mayorista' },
  @{ email = 'gerencia@local106.test';    nombre = 'Local Gerencia';    rol = 'gerencia';      tenant = 'mayorista' },
  @{ email = 'administracion@local106.test'; nombre = 'Local Administracion'; rol = 'administracion'; tenant = 'mayorista' },
  @{ email = 'operaciones@local106.test'; nombre = 'Local Operaciones'; rol = 'operaciones';   tenant = 'mayorista' },
  @{ email = 'venta@local106.test';       nombre = 'Local Venta';       rol = 'venta';         tenant = 'mayorista' },
  @{ email = 'aliado@local106.test';      nombre = 'Local Aliado Agencia'; rol = 'agencia';    tenant = 'mayorista' },
  @{ email = 'aliado2@local106.test';     nombre = 'Local Aliado Dos';  rol = 'agencia';       tenant = 'mayorista' }
)

function Fallo($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Paso($m) { Write-Host "== $m" -ForegroundColor Cyan }
function DockerOk { & docker.exe @args; if ($LASTEXITCODE -ne 0) { Fallo "docker $($args -join ' ')" } }
function Sql([string]$db, [string]$sql) {
  $r = $sql | docker exec -i -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -At -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { Fallo "SQL en ${db}: $r" }
  return $r
}
function SqlArchivo([string]$db, [string]$ruta) {
  DockerOk cp $ruta "${PG}:/tmp/local106_actual.sql" | Out-Null
  $r = docker exec -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -v ON_ERROR_STOP=1 -f /tmp/local106_actual.sql 2>&1
  $st = $LASTEXITCODE
  docker exec $PG rm -f /tmp/local106_actual.sql | Out-Null
  if ($st -ne 0) { Fallo "al aplicar $(Split-Path $ruta -Leaf): $($r | Select-String -Pattern 'ERROR' | Select-Object -First 3)" }
}
function Config { if (-not (Test-Path $Cfg)) { Fallo "falta ${Cfg}: corre primero 'preparar'." }; Get-Content $Cfg -Raw | ConvertFrom-Json }
function PgCorriendo { (docker inspect -f '{{.State.Running}}' $PG 2>$null) -eq 'true' }
function Existe([string]$nombre) { [bool](docker ps -aq --filter "name=^${nombre}$" 2>$null) }
function ExisteBase([string]$db) { (Sql 'postgres' "select count(*) from pg_database where datname = '$db'") -eq '1' }

function Red {
  if (-not (docker network ls -q --filter "name=^${RED}$")) { DockerOk network create --label $ETIQUETA $RED | Out-Null }
  $en = docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $PG
  if ($en -notmatch "\b$RED\b") { DockerOk network connect --alias $PG $RED $PG | Out-Null }
}

function Servicios {
  $c = Config
  # Contraseña LOCAL (aleatoria, de config.json) de los roles de servicio en pg304: los servicios entran por la red.
  Sql 'postgres' "alter role authenticator with password '$($c.rolesPassword)'; alter role supabase_auth_admin with password '$($c.rolesPassword)'; " | Out-Null
  $dbAuth = "postgres://supabase_auth_admin:$($c.rolesPassword)@${PG}:5432/${DB}?search_path=auth"
  if (-not (Existe $C_AUTH)) {
    DockerOk run -d --name $C_AUTH --label $ETIQUETA --network $RED `
      -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=$URL `
      -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=$dbAuth" `
      -e GOTRUE_SITE_URL=http://127.0.0.1:3056 -e "GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:3056/**,http://127.0.0.1:3057/**" `
      -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated `
      -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e "GOTRUE_JWT_SECRET=$($c.jwtSecret)" `
      -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false `
      public.ecr.aws/supabase/gotrue:v2.197.0 | Out-Null
  } else { DockerOk start $C_AUTH | Out-Null }
  if (-not (Existe $C_REST)) {
    DockerOk run -d --name $C_REST --label $ETIQUETA --network $RED `
      -e "PGRST_DB_URI=postgres://authenticator:$($c.rolesPassword)@${PG}:5432/${DB}" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon `
      -e "PGRST_JWT_SECRET=$($c.jwtSecret)" -e PGRST_DB_USE_LEGACY_GUCS=false `
      public.ecr.aws/supabase/postgrest:v16.4 | Out-Null
  } else { DockerOk start $C_REST | Out-Null }
  # Perfil pequeño: Kong usa worker_processes=auto (1 worker de ~100 MB por núcleo: 16 en este equipo = 1,38 GB).
  # Un worker y caché de 16 MB sobran para un solo desarrollador. Kong es sin estado (DB-off, kong.yml montado):
  # si el contenedor existente no trae este perfil, se recrea sin perder nada.
  if ((Existe $C_KONG) -and -not ((docker inspect $C_KONG --format '{{json .Config.Env}}') -match 'KONG_NGINX_WORKER_PROCESSES=1')) {
    Paso "recreando $C_KONG con el perfil pequeño (sin estado, no se pierde nada)"
    DockerOk rm -f $C_KONG | Out-Null
  }
  if (-not (Existe $C_KONG)) {
    DockerOk run -d --name $C_KONG --label $ETIQUETA --network $RED -p 127.0.0.1:54356:8000 --memory 256m `
      -v "$(Join-Path $PSScriptRoot 'kong.yml'):/home/kong/kong.yml:ro" `
      -e KONG_NGINX_WORKER_PROCESSES=1 -e KONG_MEM_CACHE_SIZE=16m `
      -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml -e KONG_PLUGINS=bundled `
      -e KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k -e "KONG_NGINX_PROXY_PROXY_BUFFERS=64 160k" `
      public.ecr.aws/supabase/kong:2.8.1 | Out-Null
  } else { DockerOk start $C_KONG | Out-Null }
  # Esperar a que respondan (máx. ~180 s: la primera vez GoTrue migra el esquema auth; solo lectura de salud).
  $c = Config
  foreach ($i in 1..180) {
    try {
      $a = Invoke-WebRequest -UseBasicParsing "$URL/auth/v1/health" -TimeoutSec 2
      $r = Invoke-WebRequest -UseBasicParsing "$URL/rest/v1/" -Headers @{ apikey = $c.anonKey } -TimeoutSec 2
      if ($a.StatusCode -eq 200 -and $r.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  Fallo "los servicios no respondieron en 180 s (mira: docker logs $C_AUTH / $C_REST / $C_KONG)"
}

function DetenerServicios { foreach ($n in @($C_KONG, $C_REST, $C_AUTH)) { if (Existe $n) { docker stop $n | Out-Null } } }

# La imagen local trae el auth.uid() antiguo (solo request.jwt.claim.sub); PostgREST v16 fija request.jwt.claims.
# Se usa la definición de Supabase, que lee ambas. Diferencia de ENTORNO (no de esquema): Supabase ya la trae.
$AUTH_UID = "create or replace function auth.uid() returns uuid language sql stable as `$f`$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid `$f`$;"

function Usuarios {
  $c = Config
  $h = @{ apikey = $c.serviceKey; Authorization = "Bearer $($c.serviceKey)" }
  foreach ($u in $USUARIOS) {
    $existe = Sql $DB "select count(*) from auth.users where email = '$($u.email)'"
    if ($existe -ne '1') {
      $cuerpo = @{ email = $u.email; password = $CLAVE_PRUEBA; email_confirm = $true } | ConvertTo-Json
      Invoke-RestMethod -Method Post "$URL/auth/v1/admin/users" -Headers $h -ContentType 'application/json' -Body $cuerpo | Out-Null
    }
    Sql $DB "insert into public.usuarios (id, email, nombre, rol, tenant, activo) select id, email, '$($u.nombre)', '$($u.rol)', '$($u.tenant)', true from auth.users where email = '$($u.email)' on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, tenant = excluded.tenant, activo = true;" | Out-Null
  }
}


# ── Ejecución AISLADA de la app ─────────────────────────────────────────────────────────
# La app corre en un proceso HIJO con un entorno armado desde cero: solo lo mínimo del sistema operativo +
# la configuración local. La terminal actual NO se modifica (se comprueba al salir). Ninguna variable de
# credenciales/integraciones del usuario pasa al hijo. Escucha solo en 127.0.0.1.
$PUERTO_DEV = 3056; $PUERTO_PROD = 3057
$MEM_DEV = 3072; $MEM_BUILD = 4096; $MEM_START = 2048   # MB: TOPE de heap de Node por proceso (no se reserva)
# RAM REAL exigida para arrancar = pico medido del árbol de procesos (mediciones.log) + margen; no el tope de heap.
# Medido 2026-11-11 (mediciones.log; pico del árbol / caída de RAM libre del sistema): dev 692 / ~1.200 MB (humo de 5 rutas),
# build 1.186 / ~1.050 MB (con caché de Turbopack; uno en frío no se midió), start 132-140 / ~300-650 MB (2 mediciones). Requisito = caída del sistema + margen (start: la mayor observada).
$REQ_DEV = 1000; $REQ_BUILD = 1400; $REQ_START = 700   # #106: dev medido en local53 (pico 692 MB); 1000 + piso 400 = 1400 MB libres
$PISO_LIBRE = 400   # MB libres por debajo de los cuales el vigilante detiene la app
$SISTEMA = @('PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'COMPUTERNAME')

function HuellaEntorno {
  $t = (Get-ChildItem env: | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "`n"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($t)))
}
function ComprobarEntorno($antes) {
  if ((HuellaEntorno) -eq $antes) { Write-Host "OK    el entorno de esta terminal quedó igual que antes" }
  else { Write-Host "AVISO: el entorno de esta terminal cambió durante la ejecución" -ForegroundColor Yellow }
}
function PreflightApp {
  # Next carga .env* de la carpeta de la app por su cuenta: si existe alguno, NO se arranca (solo se miran nombres).
  $envs = Get-ChildItem -Path $App -Force -File -Filter '.env*' | Where-Object { $_.Name -ne '.env.example' }
  if ($envs) { Fallo "hay archivos de entorno en la app ($(($envs | ForEach-Object Name) -join ', ')): muévelos fuera antes de usar el entorno local; no se leen." }
  $l = Join-Path $Dir 'app.lock'
  if (Test-Path $l) {
    $pidPrevio = [int]((Get-Content $l -Raw).Split(' ')[1])
    if (Get-Process -Id $pidPrevio -ErrorAction SilentlyContinue) { Fallo "ya hay una app local corriendo ($((Get-Content $l -Raw).Trim())): ciérrala antes (dev y prod no van a la vez)." }
    Remove-Item $l -Force
  }
  foreach ($p in @($PUERTO_DEV, $PUERTO_PROD)) {
    if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { Fallo "el puerto $p ya está en uso: cierra la otra app (dev y prod no van a la vez)." }
  }
}
function MemLibreMB { [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function AsegurarMemoria([int]$mb, [string]$que) {
  # $mb = memoria REAL medida (pico del árbol de procesos), no el tope de heap; + el piso que vigila EjecutarNodo.
  $libre = MemLibreMB
  if ($libre -lt ($mb + $PISO_LIBRE)) { Fallo "memoria libre insuficiente para $que ($libre MB libres; se necesitan ~$($mb + $PISO_LIBRE) MB = $mb medidos + $PISO_LIBRE de piso)." }
}
function EntornoHijo($c, [int]$puerto, [int]$mb) {
  $e = @{}
  foreach ($n in $SISTEMA) { $v = [Environment]::GetEnvironmentVariable($n); if ($v) { $e[$n] = $v } }
  $e['NEXT_PUBLIC_SUPABASE_URL'] = $URL
  $e['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $c.anonKey
  $e['SUPABASE_SERVICE_ROLE_KEY'] = $c.serviceKey
  $e['CRON_SECRET'] = $c.cronSecret
  $e['NEXT_PUBLIC_SITE_URL'] = "http://127.0.0.1:$puerto"
  $e['NEXT_TELEMETRY_DISABLED'] = '1'
  $e['QUICK_LOGIN_ENABLED'] = '0'
  $e['LOCAL4360_REGISTRO_RED'] = (Join-Path $Dir 'red_bloqueada.log')
  # Barras normales: dentro de NODE_OPTIONS una barra invertida entre comillas se lee como escape.
  $e['NODE_OPTIONS'] = "--require `"$((Join-Path $L4360 'guardia_red_local4360.cjs') -replace '\\', '/')`" --max-old-space-size=$mb"
  return $e
}
function EjecutarNodo($c, [string]$exe, [string]$argumentos, [int]$mb, [int]$puerto = $PUERTO_DEV) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = $argumentos; $psi.WorkingDirectory = $App; $psi.UseShellExecute = $false
  $psi.EnvironmentVariables.Clear()
  foreach ($kv in (EntornoHijo $c $puerto $mb).GetEnumerator()) { $psi.EnvironmentVariables[$kv.Key] = $kv.Value }
  $p = [System.Diagnostics.Process]::Start($psi)
  # Vigilante: cada 3 s mide la RAM libre y la memoria real (working set) de TODO el árbol de procesos de la app.
  # Si la RAM libre baja de $PISO_LIBRE, detiene el árbol antes de agotar el equipo. Los picos quedan en mediciones.log.
  $picoArbol = 0; $minLibre = [int]::MaxValue; $t0 = Get-Date; $cortado = $false
  try {
    while (-not $p.WaitForExit(3000)) {
      $libre = MemLibreMB
      $todos = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, WorkingSetSize
      $ids = @{ [int]$p.Id = $true }; do { $n = $ids.Count; foreach ($q in $todos) { if ($ids.ContainsKey([int]$q.ParentProcessId)) { $ids[[int]$q.ProcessId] = $true } } } while ($ids.Count -ne $n)
      $arbol = [int](($todos | Where-Object { $ids.ContainsKey([int]$_.ProcessId) } | Measure-Object WorkingSetSize -Sum).Sum / 1MB)
      if ($arbol -gt $picoArbol) { $picoArbol = $arbol }; if ($libre -lt $minLibre) { $minLibre = $libre }
      if ($libre -lt $PISO_LIBRE) {
        Write-Host "ALTO: quedan $libre MB libres (piso $PISO_LIBRE MB); se detiene la app para no agotar el equipo." -ForegroundColor Red
        $cortado = $true; taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null; break
      }
    }
    if ($cortado) { return 99 }
    return $p.ExitCode
  }
  finally {
    if (-not $p.HasExited) { taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null }
    if ($minLibre -ne [int]::MaxValue) {   # si terminó antes de la primera muestra no hay nada que medir
    $linea = "$((Get-Date).ToString('s')) $argumentos | heap $mb MB | pico árbol $picoArbol MB | mínimo libre $minLibre MB | $([int]((Get-Date) - $t0).TotalSeconds) s$(if ($cortado) { ' | DETENIDO por el piso' })"
    Add-Content -Path (Join-Path $Dir 'mediciones.log') -Value $linea -Encoding utf8
    Write-Host "medición: pico del árbol $picoArbol MB · mínimo libre $minLibre MB" -ForegroundColor DarkGray
    }
  }
}
function EjecutarNext($c, [string]$modo, [int]$puerto, [int]$mb) {
  $next = Join-Path $App 'node_modules\next\dist\bin\next'
  $a = switch ($modo) { 'dev' { "dev -H 127.0.0.1 -p $puerto" } 'build' { 'build' } 'start' { "start -H 127.0.0.1 -p $puerto" } }
  Paso "next $modo (heap $mb MB; solo 127.0.0.1; red externa bloqueada)$(if ($modo -ne 'build') { " → http://127.0.0.1:$puerto" })"
  return EjecutarNodo $c (Get-Command node).Source "`"$next`" $a" $mb $puerto
}

switch ($Accion) {
  'preparar' {
    if (-not (PgCorriendo)) { Fallo "el contenedor $PG no está corriendo (docker start $PG)." }
    Paso "claves locales"; & node (Join-Path $L4360 'claves_local4360.mjs') $Cfg
    if (-not (ExisteBase $BASE)) {
      Paso "copia de plantilla304 (esquema de Producción ≤302, vacío) + 305 + 306 → $PG/$BASE"
      Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'plantilla304' and pid <> pg_backend_pid()" | Out-Null
      Sql 'postgres' "create database $BASE template plantilla304" | Out-Null
      foreach ($f in @('20260601000305_recobro_comision_reserva.sql', '20260601000306_cotizacion_clave_envio.sql')) { SqlArchivo $BASE (Join-Path $App "supabase\migrations\$f") }
    }
    if (ExisteBase $SEMILLA) { Fallo "el entorno ya está preparado: usa 'iniciar' o 'restaurar'." }
    if (ExisteBase $DB) { Paso "$DB ya existe (preparación interrumpida): se retoma desde los servicios" }
    else {
      Paso "base $DB + migración 309 (#106) + semilla sintética"
      Sql 'postgres' "create database $DB template $BASE" | Out-Null
      SqlArchivo $DB (Join-Path $App 'supabase\migrations\20260601000309_gestion_contratos_superadmin.sql')
      SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_local106.sql')
      SqlArchivo $DB (Join-Path $L4360 'dueno_auth_local4360.sql')
    }
    Paso "servicios (Auth, REST, Storage, Gateway)"
    Red; Servicios
    Sql $DB $AUTH_UID | Out-Null
    Paso "usuarios de prueba"; Usuarios
    SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_local106_usuarios.sql')
    Paso "foto para 'restaurar'"
    DetenerServicios
    Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" | Out-Null
    Sql 'postgres' "create database $SEMILLA template $DB" | Out-Null
    Servicios
    Paso "LISTO. App: .\local106.ps1 dev  →  http://127.0.0.1:3056"
  }
  'iniciar' {
    if (-not (PgCorriendo)) { DockerOk start $PG | Out-Null }
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}: corre 'preparar'." }
    Red; Servicios; Paso "Gateway en $URL · app: .\local106.ps1 dev"
  }
  'detener' {
    DetenerServicios
    if ($IncluirPostgres) { docker stop $PG | Out-Null }
    Paso "detenido (solo los contenedores local106-*$(if ($IncluirPostgres) { " y $PG" }))"
  }
  'restaurar' {
    if (-not (ExisteBase $SEMILLA)) { Fallo "no existe la foto ${SEMILLA}: corre 'preparar'." }
    Paso "restaurar SOLO los datos locales de prueba ($DB ← $SEMILLA)"
    DetenerServicios
    Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB', '$SEMILLA') and pid <> pg_backend_pid()" | Out-Null
    Sql 'postgres' "drop database if exists $DB" | Out-Null
    Sql 'postgres' "create database $DB template $SEMILLA" | Out-Null
    Red; Servicios; Paso "restaurado"
  }
  'estado' {
    docker ps -a --filter "label=$ETIQUETA" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    Write-Host "pg304: $(if (PgCorriendo) { 'corriendo' } else { 'detenido' })"
    if (PgCorriendo) { Write-Host "bases: $((Sql 'postgres' "select string_agg(datname, ', ' order by datname) from pg_database where datname like '%local106%'"))" }
    try { $c = Config; Write-Host "REST: $((Invoke-WebRequest -UseBasicParsing "$URL/rest/v1/" -Headers @{ apikey = $c.anonKey } -TimeoutSec 3).StatusCode) · Auth: $((Invoke-WebRequest -UseBasicParsing "$URL/auth/v1/health" -TimeoutSec 3).StatusCode)" }
    catch { Write-Host "Gateway: no responde ($URL)" }
  }
  { $_ -in 'dev', 'prod' } {
    $c = Config
    PreflightApp
    $antes = HuellaEntorno
    $candado = Join-Path $Dir 'app.lock'
    if ($Accion -eq 'dev') {
      AsegurarMemoria $REQ_DEV 'desarrollo'
      Set-Content -Path $candado -Value "dev $PID" -Encoding ascii
      try { $st = EjecutarNext $c 'dev' $PUERTO_DEV $MEM_DEV }
      finally { Remove-Item $candado -Force -ErrorAction SilentlyContinue; ComprobarEntorno $antes }
    } else {
      AsegurarMemoria $REQ_BUILD 'build'
      Set-Content -Path $candado -Value "prod $PID" -Encoding ascii
      try {
        $st = EjecutarNext $c 'build' $PUERTO_PROD $MEM_BUILD
        if ($st -eq 0) { & node (Join-Path $L4360 'huella_build_local4360.mjs') $App escribir; if ($LASTEXITCODE -ne 0) { $st = 1 } }
        if ($st -eq 0) { AsegurarMemoria $REQ_START 'start'; $st = EjecutarNext $c 'start' $PUERTO_PROD $MEM_START }
      } finally { Remove-Item $candado -Force -ErrorAction SilentlyContinue; ComprobarEntorno $antes }
    }
    exit $st
  }
  'start' {
    # Sirve el build que ya está en .next SIN recompilar (mismo entorno aislado, loopback, guardia y vigilante que 'prod').
    $c = Config
    PreflightApp
    Paso "comprobando que el build corresponda al código actual"
    & node (Join-Path $L4360 'huella_build_local4360.mjs') $App comprobar
    if ($LASTEXITCODE -ne 0) { Fallo "no se arranca: el build no corresponde al código actual (detalle arriba). Recompila con 'prod' cuando haya ~1,8 GB libres." }
    $antes = HuellaEntorno
    $candado = Join-Path $Dir 'app.lock'
    AsegurarMemoria $REQ_START 'start'
    Set-Content -Path $candado -Value "start $PID" -Encoding ascii
    try { $st = EjecutarNext $c 'start' $PUERTO_PROD $MEM_START }
    finally { Remove-Item $candado -Force -ErrorAction SilentlyContinue; ComprobarEntorno $antes }
    exit $st
  }
  'aislamiento' {
    # Comprueba el aislamiento SIN llamadas reales al exterior: la guardia rechaza antes de resolver DNS.
    $c = Config
    PreflightApp
    $antes = HuellaEntorno
    $sonda = Join-Path $L4360 'sonda_aislamiento_local4360.mjs'
    $st = EjecutarNodo $c (Get-Command node).Source "`"$sonda`"" 256
    $ext = Sql $DB "select count(*) from public.crm_email_config where coalesce(api_key, '') <> ''"
    Write-Host "$(if ($ext -eq '0') { 'OK   ' } else { 'FALLO' }) base local sin claves de correo configuradas (crm_email_config: $ext)"
    ComprobarEntorno $antes
    if ($st -ne 0 -or $ext -ne '0') { exit 1 }
  }
}
