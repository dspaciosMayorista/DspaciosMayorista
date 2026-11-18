# ──────────────────────────────────────────────────────────────────
# ENTORNO LOCAL DE REVISIÓN CONSOLIDADA (#1, #53, #102, #105, #106, #124 sobre UNA sola fuente integrada). SOLO LOCAL, datos sintéticos.
# Mismo aislamiento que los entornos de #43/#60 y del lote (entorno de proceso desde cero, guardia de red, vigilante de memoria):
#   Postgres : contenedor pg304 (el mismo de los demás entornos), base PROPIA rev_revision = copia (template) de plantilla304 +
#              migraciones 303–309 + semillas sintéticas de cada bloque + ejemplos creados con las ACCIONES REALES de la app.
#              plantilla304, las bases de los demás entornos y sus fotos NO se modifican.
#   Servicios: rev-auth (GoTrue), rev-rest (PostgREST), rev-storage (storage-api, archivos en disco local), rev-kong (gateway) en la red rev-revision.
#   Gateway  : http://127.0.0.1:54370   ·   App (build de producción local): http://127.0.0.1:3070   (solo loopback)
# Claves: secreto JWT local NUEVO en %LOCALAPPDATA%\dspacios-local-revision\config.json (nunca uno real).
#
#   .\localreview.ps1 preparar [-Forzar]  # UNA vez: base + migraciones + semillas + usuarios + ejemplos reales + imágenes + foto para «restaurar»
#   .\localreview.ps1 iniciar             # levanta los servicios SIN tocar los datos (conserva el progreso de la revisión)
#   .\localreview.ps1 prod                # next build + next start (necesita ≈3 GB de RAM libre)
#   .\localreview.ps1 start               # solo next start del build existente (se niega si el código cambió)
#   .\localreview.ps1 estado
#   .\localreview.ps1 restaurar           # EXPLÍCITO: vuelve los datos a la foto de «preparar» (se pierde el progreso de la revisión)
#   .\localreview.ps1 detener [-IncluirPostgres]
#   .\localreview.ps1 limpiar             # borra SOLO lo de esta revisión (nombres comprobados)
# ──────────────────────────────────────────────────────────────────
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('preparar', 'iniciar', 'detener', 'estado', 'construir', 'prod', 'start', 'restaurar', 'limpiar', 'publicar', 'foto', 'ampliar125')][string]$Accion,
  [switch]$IncluirPostgres,
  [switch]$Forzar,
  [string]$Paquetes = ''
)
$ErrorActionPreference = 'Continue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$App = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Dir = Join-Path $env:LOCALAPPDATA 'dspacios-local-revision'
$Cfg = Join-Path $Dir 'config.json'
$Archivos = Join-Path $Dir 'storage'
$PG = 'pg304'; $DB = 'rev_revision'; $SEMILLA = 'rev_revision_semilla'; $BASE = 'plantilla304'
# Solo para quien VERIFICA (ejecutores/auditores): con REV_DB_VERIF=<base> los servicios y los ejemplos usan esa base DESECHABLE (copia de la revisión) y una carpeta de archivos propia, con los MISMOS
# puertos, claves y nombres de contenedor; así los recorridos que escriben (CRM, imágenes, acuses, calculadora) no tocan los datos de la revisión. No se usa en la revisión del dueño.
if ($env:REV_DB_VERIF) { $DB = $env:REV_DB_VERIF; $SEMILLA = "${DB}_foto"; $Archivos = Join-Path $Dir 'storage_verif' }
$PROTEGIDAS = @('plantilla304', 'local4360_base', 'dspacios_local4360', 'dspacios_local4360_semilla', 'base4360', 'g106_base', 'local53_base', 'local102_base', 'dspacios_local53', 'dspacios_local102', 'dspacios_local106')
$RED = 'rev-revision'; $ETIQUETA = 'dspacios.rev-revision=1'
$C_AUTH = 'rev-auth'; $C_REST = 'rev-rest'; $C_STOR = 'rev-storage'; $C_KONG = 'rev-kong'
$CONTENEDORES = @($C_KONG, $C_STOR, $C_REST, $C_AUTH)
$ROL_REST = 'rev_authenticator'; $ROL_AUTH = 'rev_auth_admin'; $ROL_STOR = 'rev_storage_admin'
$URL = 'http://127.0.0.1:54370'; $PUERTO = 3070
$CLAVE = 'Revision2026!'   # contraseña de TODOS los usuarios sintéticos (solo local)
$USUARIOS = @(
  @{ email = 'superadmin@revision.test';     nombre = 'Rev Superadmin';     rol = 'superadmin';     tenant = 'mayorista'; aliado = $null },
  @{ email = 'gerencia@revision.test';       nombre = 'Rev Gerencia';       rol = 'gerencia';       tenant = 'mayorista'; aliado = $null },
  @{ email = 'administracion@revision.test'; nombre = 'Rev Administracion'; rol = 'administracion'; tenant = 'mayorista'; aliado = $null },
  @{ email = 'operaciones@revision.test';    nombre = 'Rev Operaciones';    rol = 'operaciones';    tenant = 'mayorista'; aliado = $null },
  @{ email = 'venta@revision.test';          nombre = 'Rev Venta';          rol = 'venta';          tenant = 'mayorista'; aliado = $null },
  @{ email = 'venta2@revision.test';         nombre = 'Rev Venta Dos';      rol = 'venta';          tenant = 'mayorista'; aliado = $null },
  @{ email = 'minorista@revision.test';      nombre = 'Rev Minorista';      rol = 'administracion'; tenant = 'minorista'; aliado = $null },
  @{ email = 'aliado@revision.test';         nombre = 'Rev Aliado Uno';     rol = 'agencia';        tenant = 'mayorista'; aliado = 9301 },
  @{ email = 'aliado2@revision.test';        nombre = 'Rev Aliado Dos';     rol = 'agencia';        tenant = 'mayorista'; aliado = 9302 },
  @{ email = 'aliado3@revision.test';        nombre = 'Rev Aliado Tres';    rol = 'agencia';        tenant = 'mayorista'; aliado = 9801 },
  @{ email = 'aliado4@revision.test';        nombre = 'Rev Aliado Cuatro';  rol = 'agencia';        tenant = 'mayorista'; aliado = 9802 }
)
# Migraciones del repositorio que plantilla304 no trae (303–306 las trae cada entorno por separado; 307/308/309 son las de #53, #1 y #106).
$MIGRACIONES = @('303', '304', '305', '306', '307', '308', '309', '310', '311')   # 310 = #125 (promociones que siguen la base ganadora + niño gratis); orden numérico, 311 al final
# Semillas sintéticas por bloque (orden fijo). Los EJEMPLOS reales de #53 y los tarifarios se crean después con las acciones de la app.
$SEMILLAS = @('localreview\semilla_revision_53.sql', 'local106\semilla_local106.sql', 'local102\semilla_local102.sql', 'localreview\semilla_revision_1.sql', 'localreview\semilla_revision_105.sql', 'localreview\semilla_revision_124.sql', 'localreview\semilla_revision_o3.sql', 'localreview\semilla_revision_u1.sql', 'localreview\semilla_revision_125.sql')

function Fallo($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Paso($m) { Write-Host "== $m" -ForegroundColor Cyan }
function DockerOk { & docker.exe @args; if ($LASTEXITCODE -ne 0) { Fallo "docker $($args -join ' ')" } }
function Sql([string]$db, [string]$sql) {
  $r = $sql | docker.exe exec -i -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -At -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { Fallo "SQL en ${db}: $r" }
  return $r
}
function SqlArchivo([string]$db, [string]$ruta) {
  DockerOk cp $ruta "${PG}:/tmp/rev_actual.sql" | Out-Null
  $r = docker.exe exec -e PGPASSWORD=postgres $PG psql -h 127.0.0.1 -U supabase_admin -d $db -X -q -v ON_ERROR_STOP=1 -f /tmp/rev_actual.sql 2>&1
  $st = $LASTEXITCODE
  docker.exe exec $PG rm -f /tmp/rev_actual.sql | Out-Null
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
  if not exists (select 1 from pg_roles where rolname = '$ROL_STOR') then create role $ROL_STOR login; end if;
end `$`$;
alter role $ROL_REST with password '$($c.rolesPassword)';
alter role $ROL_AUTH with password '$($c.rolesPassword)';
alter role $ROL_STOR with password '$($c.rolesPassword)';
grant anon, authenticated, service_role to $ROL_REST;
grant supabase_auth_admin to $ROL_AUTH;
grant supabase_storage_admin to $ROL_STOR;
alter role $ROL_AUTH in database $DB set role = 'supabase_auth_admin';
alter role $ROL_STOR in database $DB set role = 'supabase_storage_admin';
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
  if (-not (Existe $C_STOR)) {
    New-Item -ItemType Directory -Force $Archivos | Out-Null
    DockerOk run -d --name $C_STOR --label $ETIQUETA --network $RED --memory 192m -v "${Archivos}:/var/lib/storage" `
      -e "ANON_KEY=$($c.anonKey)" -e "SERVICE_KEY=$($c.serviceKey)" -e "PGRST_JWT_SECRET=$($c.jwtSecret)" -e "AUTH_JWT_SECRET=$($c.jwtSecret)" `
      -e "POSTGREST_URL=http://${C_REST}:3000" -e "DATABASE_URL=postgres://${ROL_STOR}:$($c.rolesPassword)@${PG}:5432/${DB}" `
      -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage `
      -e TENANT_ID=revision -e REGION=local -e GLOBAL_S3_BUCKET=revision -e ENABLE_IMAGE_TRANSFORMATION=false `
      public.ecr.aws/supabase/storage-api:v1.84.19 | Out-Null
  } else { DockerOk start $C_STOR | Out-Null }
  if (-not (Existe $C_KONG)) {
    DockerOk run -d --name $C_KONG --label $ETIQUETA --network $RED -p 127.0.0.1:54370:8000 --memory 256m `
      -v "$(Join-Path $PSScriptRoot 'kong-review.yml'):/home/kong/kong.yml:ro" `
      -e KONG_NGINX_WORKER_PROCESSES=1 -e KONG_MEM_CACHE_SIZE=16m `
      -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml -e KONG_PLUGINS=bundled `
      -e KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k -e "KONG_NGINX_PROXY_PROXY_BUFFERS=64 160k" `
      public.ecr.aws/supabase/kong:2.8.1 | Out-Null
  } else { DockerOk start $C_KONG | Out-Null }
  foreach ($i in 1..240) {
    try {
      $a = Invoke-WebRequest -UseBasicParsing "$URL/auth/v1/health" -TimeoutSec 2
      $r = Invoke-WebRequest -UseBasicParsing "$URL/rest/v1/" -Headers @{ apikey = $c.anonKey } -TimeoutSec 2
      $s = Invoke-WebRequest -UseBasicParsing "$URL/storage/v1/status" -TimeoutSec 2
      if ($a.StatusCode -eq 200 -and $r.StatusCode -eq 200 -and $s.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  Fallo "los servicios de la revisión no respondieron en 240 s (docker logs $C_AUTH / $C_REST / $C_STOR / $C_KONG)"
}
function DetenerServicios { foreach ($n in $CONTENEDORES) { if (Existe $n) { docker.exe stop $n | Out-Null } } }

# auth.uid() lee claims del JWT también con PGRST_DB_USE_LEGACY_GUCS=false (la plantilla local trae una versión que no lo hace).
$AUTH_UID = "create or replace function auth.uid() returns uuid language sql stable as `$f`$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid `$f`$"

function Usuarios {
  $c = Config
  $h = @{ apikey = $c.serviceKey; Authorization = "Bearer $($c.serviceKey)" }
  foreach ($u in $USUARIOS) {
    if ((Sql $DB "select count(*) from auth.users where email = '$($u.email)'") -ne '1') {
      $cuerpo = @{ email = $u.email; password = $CLAVE; email_confirm = $true } | ConvertTo-Json
      Invoke-RestMethod -Method Post "$URL/auth/v1/admin/users" -Headers $h -ContentType 'application/json' -Body $cuerpo | Out-Null
    }
    $al = 'null'  # el enlace con la ficha del aliado se hace al final (semilla_revision_vinculos.sql), cuando ya existe el catálogo
    Sql $DB "insert into public.usuarios (id, email, nombre, rol, tenant, activo, aliado_id) select id, email, '$($u.nombre)', '$($u.rol)', '$($u.tenant)', true, $al from auth.users where email = '$($u.email)' on conflict (id) do update set rol = excluded.rol, tenant = excluded.tenant, activo = true, nombre = excluded.nombre, aliado_id = excluded.aliado_id" | Out-Null
  }
}

# ── App aislada (mismo esquema que los demás entornos) ──
$MEM_BUILD = 3072; $MEM_START = 2048; $REQ_BUILD = 1800; $REQ_START = 700; $PISO_LIBRE = 400
$SISTEMA = @('PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'COMPUTERNAME')
function MemLibreMB { [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function AsegurarMemoria([int]$mb, [string]$que) {
  $libre = MemLibreMB
  if ($libre -lt ($mb + $PISO_LIBRE)) { Fallo "memoria libre insuficiente para $que ($libre MB; se necesitan ~$($mb + $PISO_LIBRE) MB). No se evade el vigilante: libera memoria y repite." }
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
  $e['REV_REGISTRO_RED'] = (Join-Path $Dir 'red_bloqueada.log')
  $e['NODE_OPTIONS'] = "--require `"$((Join-Path $PSScriptRoot 'guardia_red_review.cjs') -replace '\\', '/')`" --max-old-space-size=$mb"
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
      Add-Content -Path (Join-Path $Dir 'mediciones.log') -Value "$((Get-Date).ToString('s')) next $modo | pico árbol $pico MB | mínimo libre $minLibre MB | $([int]((Get-Date) - $t0).TotalSeconds) s" -Encoding UTF8
      Write-Host "medición: pico del árbol $pico MB · mínimo libre $minLibre MB" -ForegroundColor DarkGray
    }
  }
}
# Huella del build: sha256 de lo que entra al build (código versionado o nuevo). `start` se niega si el código cambió.
function Huella { & node (Join-Path $PSScriptRoot 'huella_build_review.mjs') $App @args }

# Scripts de Node con las ACCIONES REALES (ejemplos de #53 y tarifarios): corren con el entorno de ESTA revisión.
function NodeAcciones([string]$script) {
  $c = Config
  $env:REV_URL = $URL; $env:REV_SERVICE_KEY = $c.serviceKey; $env:REV_ANON_KEY = $c.anonKey; $env:REV_JWT_SECRET = $c.jwtSecret; $env:REV_DB = $DB; $env:REV_PG = $PG
  Push-Location $App
  try {
    & node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoaderRelativo.mjs --test --test-force-exit --test-reporter=spec $script
    if ($LASTEXITCODE -ne 0) { Fallo "falló $script" }
  } finally {
    Pop-Location
    Remove-Item Env:REV_URL, Env:REV_SERVICE_KEY, Env:REV_ANON_KEY, Env:REV_JWT_SECRET, Env:REV_DB, Env:REV_PG -ErrorAction SilentlyContinue
  }
}

switch ($Accion) {
  'preparar' {
    if (EntornoAjenoArriba) { Fallo "el entorno de #43/#60 está levantado: no se prepara a la vez." }
    if (-not (PgCorriendo)) { DockerOk start $PG | Out-Null; Start-Sleep -Seconds 5 }
    Paso "claves locales"; New-Item -ItemType Directory -Force $Dir | Out-Null; & node (Join-Path $PSScriptRoot 'claves_review.mjs') $Cfg
    if (ExisteBase $DB) { if ($Forzar) { Fallo "${DB} ya existe: usa 'limpiar' primero (no se borra nada sin pedirlo)." } else { Fallo "${DB} ya existe: usa 'iniciar' (o 'limpiar' para empezar de cero)." } }
    Paso "base $DB (template $BASE, que no se modifica)"
    Sql 'postgres' "create database $DB template $BASE" | Out-Null
    Paso "migraciones del repositorio: $($MIGRACIONES -join ', ')"
    foreach ($m in $MIGRACIONES) {
      $f = Get-ChildItem (Join-Path $App 'supabase\migrations') -Filter "20260601000${m}_*.sql" | Select-Object -First 1
      if (-not $f) { Fallo "no se encontró la migración $m" }
      SqlArchivo $DB $f.FullName
    }
    SqlArchivo $DB (Join-Path $PSScriptRoot 'dueno_auth_review.sql')
    Roles
    Paso "servicios (Auth, REST, Storage, Gateway)"; Red; Servicios
    Sql $DB $AUTH_UID | Out-Null
    Paso "usuarios sintéticos (contraseña común, ver el documento de revisión)"; Usuarios
    Paso "semillas sintéticas de los bloques"
    foreach ($s in $SEMILLAS) { SqlArchivo $DB (Join-Path (Join-Path $PSScriptRoot '..') $s) }
    SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_revision_ajustes.sql')
    Paso "ejemplos y tarifarios con las ACCIONES REALES de la app (#53, #102, #1)"
    NodeAcciones 'supabase/scripts/localreview/ejemplos_revision.ts'
    # O3/O4: el paquete de «CARTAGENA O3» se publica con la acción real mientras sus hoteles tienen edades válidas; después los «heredados» quedan sin ellas.
    $env:EJ_PUBLICAR = '10301'; try { NodeAcciones 'supabase/scripts/localreview/publicar_paquetes_revision.ts' } finally { Remove-Item Env:EJ_PUBLICAR -ErrorAction SilentlyContinue }
    SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_revision_o3_despues.sql')
    SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_revision_vinculos.sql')
    Paso "ejemplos y tarifarios de #125 con las ACCIONES REALES (promoción que sigue la base ganadora + niño gratis)"
    NodeAcciones 'supabase/scripts/localreview/ejemplos_revision_125.ts'
    Paso "imágenes sintéticas en Storage local (#105: originales pesados ya almacenados)"
    & node (Join-Path $PSScriptRoot 'cargar_imagenes_revision.mjs') $Cfg $URL
    if ($LASTEXITCODE -ne 0) { Fallo "no se cargaron las imágenes" }
    Paso "foto para 'restaurar'"
    DetenerServicios
    Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" | Out-Null
    Sql 'postgres' "create database $SEMILLA template $DB" | Out-Null
    Roles; Servicios
    Paso "LISTO. Gateway $URL · build: .\localreview.ps1 prod  ·  app: http://127.0.0.1:$PUERTO"
  }
  'publicar' {
    # Publica con la acción REAL los paquetes indicados (-Paquetes 10301,10302) en un entorno YA preparado; no toca nada más. Requiere los servicios arriba.
    if (-not (PgCorriendo)) { Fallo "pg304 no está corriendo: usa 'iniciar'." }
    if (-not $Paquetes) { Fallo "indica -Paquetes <ids separados por coma>." }
    $env:EJ_PUBLICAR = $Paquetes; try { NodeAcciones 'supabase/scripts/localreview/publicar_paquetes_revision.ts' } finally { Remove-Item Env:EJ_PUBLICAR -ErrorAction SilentlyContinue }
  }
  'ampliar125' {
    # #125 en un entorno YA preparado (que se preparó sin #125). ADITIVO E IDEMPOTENTE: respaldo previo → migración 310 (solo si falta) → semilla 9125xx → tarifario y ejemplos con las acciones reales.
    # No restaura, no borra ni modifica datos de la revisión (contratos, cotizaciones, acuerdos, usuarios) y no toca la foto de 'restaurar': tras un 'restaurar' vuelve a correrse.
    if (-not (PgCorriendo)) { Fallo "pg304 no está corriendo: usa 'iniciar'." }
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}: corre 'preparar'." }
    $resp = Join-Path $Dir 'respaldos'; New-Item -ItemType Directory -Force $resp | Out-Null
    $arch = Join-Path $resp ('rev_revision_antes_ampliar125_{0:yyyyMMdd_HHmmss}.dump' -f (Get-Date))
    Paso "respaldo previo de $DB → $arch (restauración posible con pg_restore)"
    & docker.exe exec -e PGPASSWORD=postgres $PG sh -c "pg_dump -h 127.0.0.1 -U supabase_admin -d $DB -Fc -f /tmp/rev_antes_125.dump"
    if ($LASTEXITCODE -ne 0) { Fallo "no se pudo respaldar ${DB}: no se modificó nada." }
    & docker.exe cp "${PG}:/tmp/rev_antes_125.dump" $arch | Out-Null
    & docker.exe exec $PG rm -f /tmp/rev_antes_125.dump | Out-Null
    if (-not (Test-Path $arch) -or (Get-Item $arch).Length -lt 1024) { Fallo "el respaldo no se copió: no se modificó nada." }
    $tiene310 = Sql $DB "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hotel_temporadas' and column_name = 'promo_sigue_base'"
    if ($tiene310 -eq '0') {
      $f = Get-ChildItem (Join-Path $App 'supabase\migrations') -Filter '20260601000310_*.sql' | Select-Object -First 1
      if (-not $f) { Fallo "no se encontró la migración 310" }
      Paso "migración 310 (aditiva; la 311 ya está aplicada en este entorno)"; SqlArchivo $DB $f.FullName
    } else { Paso "la migración 310 ya estaba aplicada: no se repite (se aborta a propósito si se repite)" }
    # La semilla BORRA y recrea sus propios ids 9125xx; con los ejemplos ya creados (contratos/cotizaciones que referencian esos paquetes) fallaría por llaves foráneas. Por eso solo se carga si falta.
    $yaSembrado = Sql $DB "select count(*) from public.hoteles where id between 912501 and 912504"
    if ($yaSembrado -eq '4') { Paso "la semilla de #125 ya estaba cargada: no se repite (los tarifarios y los ejemplos sí se reconcilian abajo)" }
    else { Paso "semilla sintética de #125 (solo ids 9125xx)"; SqlArchivo $DB (Join-Path $PSScriptRoot 'semilla_revision_125.sql') }
    Roles; Red; Servicios
    Paso "tarifarios y ejemplos de #125 con las ACCIONES REALES"; NodeAcciones 'supabase/scripts/localreview/ejemplos_revision_125.ts'
    Paso "LISTO. Datos de la revisión intactos; #125 añadido (ver el recorrido 3.9 del documento de revisión)."
  }
  'foto' {
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}: corre 'preparar'." }
    Write-Host "Esto REHACE la foto de 'restaurar' desde el estado ACTUAL de ${DB}: lo que haya ahora pasa a ser el nuevo punto de partida (úsalo solo cuando el dueño no ha empezado su revisión)." -ForegroundColor Yellow
    DetenerServicios
    Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB', '$SEMILLA') and pid <> pg_backend_pid()" | Out-Null
    Sql 'postgres' "drop database if exists $SEMILLA" | Out-Null
    Sql 'postgres' "create database $SEMILLA template $DB" | Out-Null
    Roles; Servicios; Paso "foto rehecha desde el estado actual"
  }
  'iniciar' {
    if (EntornoAjenoArriba) { Fallo "el entorno de #43/#60 está levantado: no se ejecutan ambos a la vez." }
    if (-not (PgCorriendo)) { DockerOk start $PG | Out-Null; Start-Sleep -Seconds 5 }
    if (-not (ExisteBase $DB)) { Fallo "no existe ${DB}: corre 'preparar'." }
    Roles; Red; Servicios; Paso "Gateway en $URL (datos intactos: 'iniciar' nunca restaura)"
  }
  'restaurar' {
    if (-not (ExisteBase $SEMILLA)) { Fallo "no existe la foto ${SEMILLA}: nada que restaurar." }
    Write-Host "Esto REEMPLAZA los datos de $DB por la foto inicial y se pierde el progreso de la revisión." -ForegroundColor Yellow
    DetenerServicios
    Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" | Out-Null
    Sql 'postgres' "drop database $DB" | Out-Null
    Sql 'postgres' "create database $DB template $SEMILLA" | Out-Null
    Roles; Servicios; Paso "datos restaurados a la foto inicial"
  }
  'detener' {
    DetenerServicios
    if ($IncluirPostgres) { docker.exe stop $PG | Out-Null }
    Paso "detenido (solo $($CONTENEDORES -join ', ')$(if ($IncluirPostgres) { " y $PG" }))"
  }
  'estado' {
    docker.exe ps -a --filter "label=$ETIQUETA" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    Write-Host "pg304: $(if (PgCorriendo) { 'corriendo' } else { 'detenido' }) · entorno #43/#60: $(if (EntornoAjenoArriba) { 'ARRIBA' } else { 'detenido' })"
    if (PgCorriendo) { Write-Host "base de la revisión: $(if (ExisteBase $DB) { $DB } else { 'no existe' }) · foto: $(if (ExisteBase $SEMILLA) { $SEMILLA } else { 'no existe' })" }
  }
  { $_ -in 'construir', 'prod', 'start' } {
    $c = Config; PreflightApp
    if ($Accion -eq 'construir') {
      AsegurarMemoria $REQ_BUILD 'build'
      $st = EjecutarNext $c 'build' $MEM_BUILD
      if ($st -ne 0) { exit $st }
      Huella escribir
      Paso "build listo y huella guardada (no se arranca la app)"; exit 0
    }
    if ($Accion -eq 'prod') {
      AsegurarMemoria $REQ_BUILD 'build'
      $st = EjecutarNext $c 'build' $MEM_BUILD
      if ($st -ne 0) { exit $st }
      Huella escribir
    } else {
      Huella comprobar
      if ($LASTEXITCODE -ne 0) { Fallo "el build no corresponde al código actual: corre 'prod'." }
    }
    AsegurarMemoria $REQ_START 'start'
    exit (EjecutarNext $c 'start' $MEM_START)
  }
  'limpiar' {
    if ($PROTEGIDAS -contains $DB -or $PROTEGIDAS -contains $SEMILLA) { Fallo "nombre de base protegido." }
    Paso "comprobando nombres antes de borrar"
    foreach ($n in $CONTENEDORES) {
      if (Existe $n) {
        $et = docker.exe inspect -f '{{index .Config.Labels \"dspacios.rev-revision\"}}' $n
        if ($et -ne '1') { Fallo "$n no tiene la etiqueta de la revisión: no se borra." }
        DockerOk rm -f $n | Out-Null; Write-Host "borrado contenedor $n"
      }
    }
    if (docker.exe network ls -q --filter "name=^${RED}$") {
      if ((docker.exe network inspect -f '{{index .Labels \"dspacios.rev-revision\"}}' $RED) -ne '1') { Fallo "la red $RED no es de la revisión." }
      if (PgCorriendo) { docker.exe network disconnect $RED $PG 2>$null | Out-Null }
      DockerOk network rm $RED | Out-Null; Write-Host "borrada red $RED"
    }
    if (PgCorriendo) {
      foreach ($b in @($DB, $SEMILLA)) { if (ExisteBase $b) {
        Sql 'postgres' "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$b' and pid <> pg_backend_pid()" | Out-Null
        Sql 'postgres' "drop database $b" | Out-Null; Write-Host "borrada base $b" } }
      Sql 'postgres' "drop role if exists $ROL_REST; drop role if exists $ROL_AUTH; drop role if exists $ROL_STOR;" | Out-Null; Write-Host "borrados roles de la revisión"
    } else { Write-Host "pg304 detenido: las bases y roles de la revisión quedan; repite 'limpiar' con pg304 encendido." -ForegroundColor Yellow }
    if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force; Write-Host "borrada configuración local $Dir" }
  }
}
