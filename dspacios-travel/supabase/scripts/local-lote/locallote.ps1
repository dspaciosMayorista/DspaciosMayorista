# ─────────────────────────────────────────────────────────────────────────────
# ENTORNO LOCAL DE REVISIÓN DEL LOTE DE MEJORAS OPERATIVAS (worktree lote-mejoras-operativas). SOLO LOCAL.
# Adaptado del entorno de #43/#60 (supabase/scripts/local4360 en su worktree) con recursos PROPIOS:
#   Postgres : el contenedor EXISTENTE pg4360 (no se duplica). Base PROPIA lote_revision = copia (template) de
#              local4360_base + migraciones de esta rama que faltan + semilla SINTÉTICA. local4360_base,
#              dspacios_local4360 y su foto NO se modifican.
#   Roles    : lote_authenticator / lote_auth_admin (propios; NO se cambia la contraseña de los roles de #43/#60).
#   Servicios: lote-auth (GoTrue v2.197.0), lote-rest (PostgREST v16.4), lote-kong (Kong 2.8.1, 1 worker, caché 16m,
#              --memory 256m) en la red lote-revision. Sin Storage (ningún recorrido lo usa).
#   Gateway  : http://127.0.0.1:54361   ·   App: http://127.0.0.1:3045 (build de producción, solo loopback)
# Claves: secreto JWT local NUEVO en %LOCALAPPDATA%\dspacios-local-lote\config.json. La app corre en un proceso hijo
# con entorno desde cero + guardia de red (solo loopback y fuentes de Google). No arranca si hay .env* en la app ni si
# el entorno de #43/#60 está levantado. Control de memoria antes de arrancar y vigilante con piso de RAM libre.
#
#   .\locallote.ps1 preparar   # base + migraciones + semilla + usuarios (una vez)
#   (luego, con la app arriba: generar el tarifario de los paquetes 915001-915003, pestaña «Tarifario resultado»)
#   .\locallote.ps1 contratos  # contrato pendiente DTM-9001 + abonos DTM-9011..9014 (necesita el tarifario generado)
#   .\locallote.ps1 iniciar    # servicios del lote (pg4360 debe estar libre de #43/#60)
#   .\locallote.ps1 prod       # next build + next start en 127.0.0.1:3045
#   .\locallote.ps1 start      # solo next start del build existente
#   .\locallote.ps1 estado
#   .\locallote.ps1 detener [-IncluirPostgres]   # detiene SOLO lo del lote (y pg4360 si se pide)
#   .\locallote.ps1 limpiar    # tras la revisión: borra SOLO los recursos del lote, comprobando sus nombres
# ─────────────────────────────────────────────────────────────────────────────
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('preparar', 'contratos', 'iniciar', 'detener', 'estado', 'prod', 'start', 'limpiar')][string]$Accion,
  [switch]$IncluirPostgres
)
$ErrorActionPreference = 'Continue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$App = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Dir = Join-Path $env:LOCALAPPDATA 'dspacios-local-lote'
$Cfg = Join-Path $Dir 'config.json'
$PG = 'pg4360'; $DB = 'lote_revision'; $BASE = 'local4360_base'
$PROTEGIDAS = @('local4360_base', 'dspacios_local4360', 'dspacios_local4360_semilla', 'base4360')
$RED = 'lote-revision'; $ETIQUETA = 'dspacios.lote-revision=1'
$C_AUTH = 'lote-auth'; $C_REST = 'lote-rest'; $C_KONG = 'lote-kong'
$CONTENEDORES = @($C_KONG, $C_REST, $C_AUTH)
$ROL_REST = 'lote_authenticator'; $ROL_AUTH = 'lote_auth_admin'
$URL = 'http://127.0.0.1:54361'; $PUERTO = 3045
$CLAVE = 'LoteRevision!'
$USUARIOS = @(
  @{ email = 'superadmin@lote.test';     nombre = 'Lote Superadmin';     rol = 'superadmin' },
  @{ email = 'administracion@lote.test'; nombre = 'Lote Administracion'; rol = 'administracion' },
  @{ email = 'operaciones@lote.test';    nombre = 'Lote Operaciones';    rol = 'operaciones' },
  @{ email = 'venta@lote.test';          nombre = 'Lote Venta';          rol = 'venta' }
)
# Migraciones de ESTA rama que no trae local4360_base (Producción ≤287 + 293 + 294).
$MIGRACIONES = @('286', '288', '289', '290', '291', '292', '295')

function Fallo($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Paso($m) { Write-Host "== $m" -ForegroundColor Cyan }
function DockerOk { & docker.exe @args; if ($LASTEXITCODE -ne 0) { Fallo "docker $($args -join ' ')" } }
function Sql([string]$db, [string]$sql) {
  $r = $sql | docker.exe exec -i -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -At -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { Fallo "SQL en ${db}: $r" }
  return $r
}
function SqlArchivo([string]$db, [string]$ruta) {
  DockerOk cp $ruta "${PG}:/tmp/lote_actual.sql" | Out-Null
  $r = docker.exe exec -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -v ON_ERROR_STOP=1 -f /tmp/lote_actual.sql 2>&1
  $st = $LASTEXITCODE
  docker.exe exec $PG rm -f /tmp/lote_actual.sql | Out-Null
  if ($st -ne 0) { Fallo "al aplicar $(Split-Path $ruta -Leaf): $($r | Select-String -Pattern 'ERROR' | Select-Object -First 3)" }
}
function Config { if (-not (Test-Path $Cfg)) { Fallo "falta ${Cfg}: corre 'preparar'." }; Get-Content $Cfg -Raw | ConvertFrom-Json }
function PgCorriendo { (docker.exe inspect -f '{{.State.Running}}' $PG 2>$null) -eq 'true' }
function Existe([string]$n) { [bool](docker.exe ps -aq --filter "name=^${n}$" 2>$null) }
function ExisteBase([string]$db) { (Sql 'postgres' "select count(*) from pg_database where datname = '$db'") -eq '1' }
function EntornoAjenoArriba { [bool](docker.exe ps -q --filter "label=dspacios.local4360=1" 2>$null) }

function Roles {
  $c = Config
  Sql 'postgres' @"
do `$`$ begin
  if not exists (select 1 from pg_roles where rolname = '$ROL_REST') then create role $ROL_REST noinherit login; end if;
  if not exists (select 1 from pg_roles where rolname = '$ROL_AUTH') then create role $ROL_AUTH login; end if;
end `$`$;
alter role $ROL_REST with password '$($c.rolesPassword)';
alter role $ROL_AUTH with password '$($c.rolesPassword)';
grant anon, authenticated, service_role to $ROL_REST;
grant supabase_auth_admin to $ROL_AUTH;
alter role $ROL_AUTH in database $DB set role = 'supabase_auth_admin';
"@ | Out-Null
}

function Red {
  if (-not (docker.exe network ls -q --filter "name=^${RED}$")) { DockerOk network create --label $ETIQUETA $RED | Out-Null }
  $en = docker.exe inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $PG
  if ($en -notmatch "\b$RED\b") { DockerOk network connect --alias $PG $RED $PG | Out-Null }
}

function Servicios {
  $c = Config
  if (-not (Existe $C_AUTH)) {
    DockerOk run -d --name $C_AUTH --label $ETIQUETA --network $RED --memory 128m `
      -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=$URL `
      -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://${ROL_AUTH}:$($c.rolesPassword)@${PG}:5432/${DB}?search_path=auth" `
      -e "GOTRUE_SITE_URL=http://127.0.0.1:$PUERTO" -e "GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:$PUERTO/**" `
      -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated `
      -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e "GOTRUE_JWT_SECRET=$($c.jwtSecret)" `
      -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false `
      public.ecr.aws/supabase/gotrue:v2.197.0 | Out-Null
  } else { DockerOk start $C_AUTH | Out-Null }
  if (-not (Existe $C_REST)) {
    DockerOk run -d --name $C_REST --label $ETIQUETA --network $RED --memory 128m `
      -e "PGRST_DB_URI=postgres://${ROL_REST}:$($c.rolesPassword)@${PG}:5432/${DB}" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon `
      -e "PGRST_JWT_SECRET=$($c.jwtSecret)" -e PGRST_DB_USE_LEGACY_GUCS=false -e PGRST_DB_POOL=4 `
      public.ecr.aws/supabase/postgrest:v16.4 | Out-Null
  } else { DockerOk start $C_REST | Out-Null }
  if (-not (Existe $C_KONG)) {
    DockerOk run -d --name $C_KONG --label $ETIQUETA --network $RED -p 127.0.0.1:54361:8000 --memory 256m `
      -v "$(Join-Path $PSScriptRoot 'kong-lote.yml'):/home/kong/kong.yml:ro" `
      -e KONG_NGINX_WORKER_PROCESSES=1 -e KONG_MEM_CACHE_SIZE=16m `
      -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml -e KONG_PLUGINS=bundled `
      -e KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k -e "KONG_NGINX_PROXY_PROXY_BUFFERS=64 160k" `
      public.ecr.aws/supabase/kong:2.8.1 | Out-Null
  } else { DockerOk start $C_KONG | Out-Null }
  foreach ($i in 1..180) {
    try {
      $a = Invoke-WebRequest -UseBasicParsing "$URL/auth/v1/health" -TimeoutSec 2
      $r = Invoke-WebRequest -UseBasicParsing "$URL/rest/v1/" -Headers @{ apikey = $c.anonKey } -TimeoutSec 2
      if ($a.StatusCode -eq 200 -and $r.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  Fallo "los servicios del lote no respondieron en 180 s (docker logs $C_AUTH / $C_REST / $C_KONG)"
}
function DetenerServicios { foreach ($n in $CONTENEDORES) { if (Existe $n) { docker.exe stop $n | Out-Null } } }

$AUTH_UID = "create or replace function auth.uid() returns uuid language sql stable as `$f`$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid `$f`$;"

function Usuarios {
  $c = Config
  $h = @{ apikey = $c.serviceKey; Authorization = "Bearer $($c.serviceKey)" }
  foreach ($u in $USUARIOS) {
    if ((Sql $DB "select count(*) from auth.users where email = '$($u.email)'") -ne '1') {
      $cuerpo = @{ email = $u.email; password = $CLAVE; email_confirm = $true } | ConvertTo-Json
      Invoke-RestMethod -Method Post "$URL/auth/v1/admin/users" -Headers $h -ContentType 'application/json' -Body $cuerpo | Out-Null
    }
    Sql $DB "insert into public.usuarios (id, email, nombre, rol, tenant, activo) select id, email, '$($u.nombre)', '$($u.rol)', 'mayorista', true from auth.users where email = '$($u.email)' on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, tenant = excluded.tenant, activo = true;" | Out-Null
  }
}

# ── App aislada (mismo esquema que #43/#60) ──
$MEM_BUILD = 4096; $MEM_START = 2048; $REQ_BUILD = 1400; $REQ_START = 700; $PISO_LIBRE = 400
$SISTEMA = @('PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'COMPUTERNAME')
function MemLibreMB { [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function AsegurarMemoria([int]$mb, [string]$que) {
  $libre = MemLibreMB
  if ($libre -lt ($mb + $PISO_LIBRE)) { Fallo "memoria libre insuficiente para $que ($libre MB; se necesitan ~$($mb + $PISO_LIBRE) MB)." }
  Write-Host "memoria libre $libre MB (requisito $($mb + $PISO_LIBRE) MB para $que)" -ForegroundColor DarkGray
}
function PreflightApp {
  $envs = Get-ChildItem -Path $App -Force -File -Filter '.env*' | Where-Object { $_.Name -ne '.env.example' }
  if ($envs) { Fallo "hay archivos de entorno en la app ($(($envs | ForEach-Object Name) -join ', ')): no se arranca." }
  if (EntornoAjenoArriba) { Fallo "el entorno de #43/#60 está levantado: no se ejecutan ambos a la vez." }
  if (Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) { Fallo "el puerto $PUERTO ya está en uso." }
}
function EntornoHijo($c, [int]$mb) {
  $e = @{}
  foreach ($n in $SISTEMA) { $v = [Environment]::GetEnvironmentVariable($n); if ($v) { $e[$n] = $v } }
  $e['NEXT_PUBLIC_SUPABASE_URL'] = $URL; $e['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $c.anonKey; $e['SUPABASE_SERVICE_ROLE_KEY'] = $c.serviceKey
  $e['CRON_SECRET'] = $c.cronSecret; $e['NEXT_PUBLIC_SITE_URL'] = "http://127.0.0.1:$PUERTO"
  $e['NEXT_TELEMETRY_DISABLED'] = '1'; $e['QUICK_LOGIN_ENABLED'] = '0'
  $e['LOTE_REGISTRO_RED'] = (Join-Path $Dir 'red_bloqueada.log')
  $e['NODE_OPTIONS'] = "--require `"$((Join-Path $PSScriptRoot 'guardia_red_lote.cjs') -replace '\\', '/')`" --max-old-space-size=$mb"
  return $e
}
function EjecutarNext($c, [string]$modo, [int]$mb) {
  $next = Join-Path $App 'node_modules\next\dist\bin\next'
  $a = if ($modo -eq 'build') { 'build' } else { "start -H 127.0.0.1 -p $PUERTO" }
  Paso "next $modo (heap $mb MB; solo 127.0.0.1; red externa bloqueada)$(if ($modo -ne 'build') { " → http://127.0.0.1:$PUERTO" })"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node).Source; $psi.Arguments = "`"$next`" $a"; $psi.WorkingDirectory = $App; $psi.UseShellExecute = $false
  $psi.EnvironmentVariables.Clear()
  foreach ($kv in (EntornoHijo $c $mb).GetEnumerator()) { $psi.EnvironmentVariables[$kv.Key] = $kv.Value }
  $p = [System.Diagnostics.Process]::Start($psi)
  $pico = 0; $minLibre = [int]::MaxValue; $t0 = Get-Date; $cortado = $false
  try {
    while (-not $p.WaitForExit(3000)) {
      $libre = MemLibreMB
      $todos = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, WorkingSetSize
      $ids = @{ [int]$p.Id = $true }; do { $n = $ids.Count; foreach ($q in $todos) { if ($ids.ContainsKey([int]$q.ParentProcessId)) { $ids[[int]$q.ProcessId] = $true } } } while ($ids.Count -ne $n)
      $arbol = [int](($todos | Where-Object { $ids.ContainsKey([int]$_.ProcessId) } | Measure-Object WorkingSetSize -Sum).Sum / 1MB)
      if ($arbol -gt $pico) { $pico = $arbol }; if ($libre -lt $minLibre) { $minLibre = $libre }
      if ($libre -lt $PISO_LIBRE) { Write-Host "ALTO: quedan $libre MB libres; se detiene la app." -ForegroundColor Red; $cortado = $true; taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null; break }
    }
    if ($cortado) { return 99 }; return $p.ExitCode
  } finally {
    if (-not $p.HasExited) { taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null }
    if ($minLibre -ne [int]::MaxValue) {
      Add-Content -Path (Join-Path $Dir 'mediciones.log') -Value "$((Get-Date).ToString('s')) next $modo | pico árbol $pico MB | mínimo libre $minLibre MB | $([int]((Get-Date) - $t0).TotalSeconds) s" -Encoding utf8
      Write-Host "medición: pico del árbol $pico MB · mínimo libre $minLibre MB" -ForegroundColor DarkGray
    }
  }
}

switch ($Accion) {
  'preparar' {
    if (EntornoAjenoArriba) { Fallo "el entorno de #43/#60 está levantado: no se prepara a la vez." }
    if (-not (PgCorriendo)) { DockerOk start $PG | Out-Null; Start-Sleep -Seconds 5 }
    Paso "claves locales"; New-Item -ItemType Directory -Force $Dir | Out-Null; & node (Join-Path $PSScriptRoot 'claves_lote.mjs') $Cfg
    if (ExisteBase $DB) { Fallo "$DB ya existe: usa 'iniciar' (o 'limpiar' para empezar de cero)." }
    Paso "base $DB (template $BASE, que no se modifica)"
    Sql 'postgres' "create database $DB template $BASE" | Out-Null
    Paso "migraciones de la rama que faltan: $($MIGRACIONES -join ', ')"
    foreach ($m in $MIGRACIONES) {
      $f = Get-ChildItem (Join-Path $App 'supabase\migrations') -Filter "20260601000${m}_*.sql" | Select-Object -First 1
      if (-not $f) { Fallo "no se encontró la migración $m" }
      SqlArchivo $DB $f.FullName
    }
    SqlArchivo $DB (Join-Path $PSScriptRoot 'dueno_auth_lote.sql')
    Roles
    Paso "servicios del lote"; Red; Servicios
    Sql $DB $AUTH_UID | Out-Null
    Paso "usuarios sintéticos"; Usuarios
    Paso "semilla sintética"; SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_lote.sql')
    Paso "LISTO. Gateway $URL · app: .\locallote.ps1 prod"
  }
  'contratos' {
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}." }
    if ((Sql $DB "select count(*) from public.armado_paquetes where id between 915001 and 915003 and tarifario_estado = 'listo'") -ne '3') { Fallo "genera antes el tarifario de los paquetes 915001-915003 desde la app (pestaña Tarifario resultado)." }
    SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_lote_contratos.sql'); Paso "contrato pendiente DTM-9001 y abonos DTM-9011..9014 sembrados"
  }
  'iniciar' {
    if (EntornoAjenoArriba) { Fallo "el entorno de #43/#60 está levantado: no se ejecutan ambos a la vez." }
    if (-not (PgCorriendo)) { DockerOk start $PG | Out-Null; Start-Sleep -Seconds 5 }
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}: corre 'preparar'." }
    Roles; Red; Servicios; Paso "Gateway en $URL"
  }
  'detener' {
    DetenerServicios
    if ($IncluirPostgres) { docker.exe stop $PG | Out-Null }
    Paso "detenido (solo $($CONTENEDORES -join ', ')$(if ($IncluirPostgres) { " y $PG" }))"
  }
  'estado' {
    docker.exe ps -a --filter "label=$ETIQUETA" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    Write-Host "pg4360: $(if (PgCorriendo) { 'corriendo' } else { 'detenido' }) · entorno #43/#60: $(if (EntornoAjenoArriba) { 'ARRIBA' } else { 'detenido' })"
    if (PgCorriendo) { Write-Host "base del lote: $(if (ExisteBase $DB) { $DB } else { 'no existe' })" }
  }
  { $_ -in 'prod', 'start' } {
    $c = Config; PreflightApp
    if ($Accion -eq 'prod') {
      AsegurarMemoria $REQ_BUILD 'build'
      $st = EjecutarNext $c 'build' $MEM_BUILD
      if ($st -ne 0) { exit $st }
    }
    AsegurarMemoria $REQ_START 'start'
    exit (EjecutarNext $c 'start' $MEM_START)
  }
  'limpiar' {
    if ($PROTEGIDAS -contains $DB) { Fallo "nombre de base protegido: $DB" }
    Paso "comprobando nombres antes de borrar"
    foreach ($n in $CONTENEDORES) {
      if (Existe $n) {
        $et = docker.exe inspect -f '{{index .Config.Labels "dspacios.lote-revision"}}' $n
        if ($et -ne '1') { Fallo "$n no tiene la etiqueta del lote: no se borra." }
        DockerOk rm -f $n | Out-Null; Write-Host "borrado contenedor $n"
      }
    }
    if (docker.exe network ls -q --filter "name=^${RED}$") {
      if ((docker.exe network inspect -f '{{index .Labels "dspacios.lote-revision"}}' $RED) -ne '1') { Fallo "la red $RED no es del lote." }
      if (PgCorriendo) { docker.exe network disconnect $RED $PG 2>$null | Out-Null }
      DockerOk network rm $RED | Out-Null; Write-Host "borrada red $RED"
    }
    if (PgCorriendo) {
      if (ExisteBase $DB) {
        Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" | Out-Null
        Sql 'postgres' "drop database $DB" | Out-Null; Write-Host "borrada base $DB"
      }
      Sql 'postgres' "drop role if exists $ROL_REST; drop role if exists $ROL_AUTH;" | Out-Null; Write-Host "borrados roles $ROL_REST, $ROL_AUTH"
    } else { Write-Host "pg4360 detenido: la base $DB y los roles del lote quedan; repite 'limpiar' con pg4360 encendido." -ForegroundColor Yellow }
    if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force; Write-Host "borrada configuración local $Dir" }
  }
}
