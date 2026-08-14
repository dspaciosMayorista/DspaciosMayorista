<#
    Backup lógico de la base de D'spacios ANTES de correr la migración 148.

    Se corre en la máquina del dueño (Windows + PowerShell). No ejecuta ninguna
    migración: solo LEE la base y escribe archivos en disco.

    LA CONTRASEÑA NUNCA:
      · se escribe en el chat,
      · se guarda en un archivo,
      · se pasa como argumento visible del script,
      · queda en el historial de PowerShell (Read-Host no lo alimenta).
    Se pide con Read-Host -AsSecureString, vive en memoria mientras corre el
    script y se limpia al final, incluso si algo falla.

    ÚNICA EXPOSICIÓN QUE SÍ QUEDA, y conviene saberla: `supabase db dump` recibe
    la cadena de conexión como argumento, así que durante el minuto que dura el
    volcado la contraseña es visible en la tabla de procesos de la máquina para
    quien tenga permisos de administrador LOCAL. No sale a la red ni a disco.

    REQUISITOS
      1. Supabase CLI instalada:   scoop install supabase
         (o ver https://supabase.com/docs/guides/local-development/cli/getting-started)
      2. Sesión iniciada:          supabase login
      3. La cadena de conexión del botón "Connect" de Supabase, modo
         **Session pooler**. Se pega TAL CUAL viene, con el marcador
         [YOUR-PASSWORD] adentro — ese texto no es un secreto.

    USO
      cd <carpeta donde esté este archivo>
      powershell -ExecutionPolicy Bypass -File .\backup-antes-148.ps1
#>

[CmdletBinding()]
param(
    [string]$Destino = "C:\Users\Asus\Documents\Backups\Dspacios\antes-migracion-148"
)

$ErrorActionPreference = "Stop"

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "   [AVISO] $t" -ForegroundColor Yellow }
function Falla($t)  { Write-Host "   [FALLA] $t" -ForegroundColor Red }

$plano   = $null
$urlCon  = $null
$hubo    = $false

try {
    # ── 0. Comprobaciones previas ────────────────────────────────────────────
    Titulo "Comprobaciones previas"

    if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
        throw "No encuentro la Supabase CLI en el PATH. Instálala con 'scoop install supabase' y vuelve a intentar."
    }
    Ok ("Supabase CLI: " + (supabase --version))

    New-Item -ItemType Directory -Force -Path $Destino | Out-Null
    Ok "Carpeta de destino: $Destino"

    # La carpeta va FUERA del repositorio a propósito. Si alguien cambiara el
    # parámetro y la apuntara dentro, el script se planta: un volcado con datos
    # de clientes no puede terminar en git por descuido.
    $rutaAbs = (Resolve-Path $Destino).Path
    if ($rutaAbs -match '\\DspaciosMayorista\\' -or (Test-Path (Join-Path $rutaAbs ".git"))) {
        throw "La carpeta de destino parece estar dentro del repositorio. El volcado lleva datos de clientes: elige una ruta fuera de git."
    }
    Ok "La carpeta está fuera del repositorio"

    # ── 1. Cadena de conexión (sin contraseña) ───────────────────────────────
    Titulo "Cadena de conexión"
    Write-Host "   En Supabase: boton 'Connect' -> pestana 'Session pooler' -> copiar la URI." -ForegroundColor Gray
    Write-Host "   Pegala TAL CUAL, con el texto [YOUR-PASSWORD] adentro (eso no es un secreto)." -ForegroundColor Gray
    $plantilla = Read-Host "   URI"

    if ($plantilla -notmatch '^postgres(ql)?://') { throw "Eso no parece una URI de PostgreSQL." }
    if ($plantilla -notmatch '\[YOUR-PASSWORD\]') {
        throw "La URI no trae el marcador [YOUR-PASSWORD]. Pega la plantilla sin reemplazar la contraseña: el script la inserta solo."
    }

    # El project-ref sale del usuario de la URI: postgres.<ref>
    $projectRef = $null
    if ($plantilla -match '://postgres\.([a-z0-9]+):') { $projectRef = $Matches[1] }
    if ($projectRef) { Ok "Proyecto detectado: $projectRef" }
    else { Aviso "No pude deducir el project-ref de la URI; el paso de auth/storage se saltará." }

    # ── 2. Contraseña, oculta ────────────────────────────────────────────────
    Titulo "Contraseña de la base de datos"
    Write-Host "   No se muestra en pantalla, no se guarda y no queda en el historial." -ForegroundColor Gray
    $segura = Read-Host "   Contrasena" -AsSecureString
    if ($segura.Length -eq 0) { throw "No escribiste ninguna contraseña." }

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try   { $plano = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

    # Se codifica para la URL: una contraseña con @ # / : ? & rompería la URI
    # en silencio y el error que sale ("host desconocido") no apunta a esto.
    $urlCon = $plantilla -replace '\[YOUR-PASSWORD\]', [uri]::EscapeDataString($plano)
    Ok "Contraseña recibida (longitud: $($plano.Length) caracteres)"

    # ── 3. Volcados ──────────────────────────────────────────────────────────
    $roles  = Join-Path $Destino "roles.sql"
    $schema = Join-Path $Destino "schema.sql"
    $data   = Join-Path $Destino "data.sql"
    $authst = Join-Path $Destino "auth_storage_changes.sql"

    Titulo "Volcado de roles"
    supabase db dump --db-url $urlCon -f $roles --role-only
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado de roles." }
    Ok "roles.sql"

    Titulo "Volcado del esquema (tablas, vistas, policies, funciones)"
    supabase db dump --db-url $urlCon -f $schema
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado del esquema." }
    Ok "schema.sql"

    Titulo "Volcado de datos"
    Write-Host "   Este es el que demora. No cierres la ventana." -ForegroundColor Gray
    supabase db dump --db-url $urlCon -f $data --use-copy --data-only `
        -x "storage.buckets_vectors" -x "storage.vector_indexes"
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado de datos." }
    Ok "data.sql"

    Titulo "Cambios propios en auth y storage"
    if ($projectRef) {
        # `supabase link` pide la contraseña. Se le pasa por variable de entorno
        # del proceso —no como argumento— para que no aparezca en la tabla de
        # procesos. Se borra unas líneas más abajo.
        $env:SUPABASE_DB_PASSWORD = $plano
        supabase link --project-ref $projectRef | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Aviso "No se pudo enlazar el proyecto. ¿Corriste 'supabase login'? Se salta este archivo."
            "-- No generado: falló 'supabase link'. Ver README del backup." | Set-Content -Path $authst -Encoding UTF8
        } else {
            supabase db diff --linked --schema auth,storage | Set-Content -Path $authst -Encoding UTF8
            Ok "auth_storage_changes.sql"
        }
        Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
    } else {
        "-- No generado: no se pudo deducir el project-ref." | Set-Content -Path $authst -Encoding UTF8
        Aviso "Saltado."
    }

    # ── 4. Verificación: que los archivos SIRVAN, no solo que existan ────────
    Titulo "Verificación del contenido"

    $checks = @(
        @{ f = $roles;  min = 200;    debe = @("ROLE");                                     nombre = "roles.sql"  },
        @{ f = $schema; min = 50000;  debe = @("CREATE TABLE", "public.ventas", "public.abonos", "ventas_basica"); nombre = "schema.sql" },
        @{ f = $data;   min = 1000;   debe = @("COPY public.ventas");                       nombre = "data.sql"   }
    )

    foreach ($c in $checks) {
        if (-not (Test-Path $c.f)) { Falla "$($c.nombre): no existe"; $hubo = $true; continue }
        $len = (Get-Item $c.f).Length
        if ($len -lt $c.min) {
            Falla "$($c.nombre): solo $len bytes, se esperaban al menos $($c.min). El volcado quedó incompleto."
            $hubo = $true; continue
        }
        $texto = Get-Content $c.f -Raw
        $faltan = @($c.debe | Where-Object { $texto -notmatch [regex]::Escape($_) })
        if ($faltan.Count -gt 0) {
            Falla "$($c.nombre): no contiene $($faltan -join ', ')"
            $hubo = $true
        } else {
            Ok "$($c.nombre) - $([math]::Round($len/1MB,2)) MB, contenido esperado presente"
        }
    }

    # Número real de contratos volcados: es el dato que el dueño puede comparar
    # contra lo que ve en la app. Un backup "que existe" pero con 0 contratos no
    # sirve, y sin este conteo no se notaría.
    if (Test-Path $data) {
        $lineas = Get-Content $data
        $i = 0; $n = 0; $dentro = $false
        foreach ($l in $lineas) {
            if ($l -match '^COPY public\.ventas ') { $dentro = $true; continue }
            if ($dentro) { if ($l -eq '\.') { break } else { $n++ } }
            $i++
        }
        if ($n -gt 0) { Ok "Contratos en el volcado (tabla ventas): $n" }
        else { Falla "El volcado no trae ninguna fila de 'ventas'."; $hubo = $true }
    }

    # auth/storage puede salir vacío LEGÍTIMAMENTE (si no hay cambios propios
    # sobre esos esquemas). No se marca como falla: se marca como "revísalo".
    if (Test-Path $authst) {
        $lenA = (Get-Item $authst).Length
        if ($lenA -lt 20) {
            Aviso "auth_storage_changes.sql está prácticamente vacío. Puede ser correcto (sin cambios propios en auth/storage) - ábrelo y confírmalo antes de darlo por bueno."
        } else {
            Ok "auth_storage_changes.sql - $lenA bytes"
        }
    }

    # ── 5. MANIFEST ──────────────────────────────────────────────────────────
    Titulo "MANIFEST.txt"
    $manifest = Join-Path $Destino "MANIFEST.txt"
    $lineasM = @()
    $lineasM += "Backup de la base de D'spacios - ANTES de la migracion 148"
    $lineasM += "Generado: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    $lineasM += "Maquina:  $env:COMPUTERNAME"
    $lineasM += "Proyecto: $projectRef"
    $lineasM += "CLI:      $(supabase --version)"
    $lineasM += ""
    $lineasM += "NO INCLUYE los archivos fisicos de Supabase Storage (buckets"
    $lineasM += "contratos, programas, crm, web-cms, hotel-fotos, servicio-fotos)."
    $lineasM += "Ver LEEME.txt."
    $lineasM += ""
    $lineasM += ("{0,-28} {1,14}  {2}" -f "ARCHIVO", "BYTES", "SHA256")
    foreach ($f in @($roles, $schema, $data, $authst)) {
        if (Test-Path $f) {
            $it = Get-Item $f
            $h  = (Get-FileHash $f -Algorithm SHA256).Hash
            $lineasM += ("{0,-28} {1,14}  {2}" -f $it.Name, $it.Length, $h)
        }
    }
    $lineasM | Set-Content -Path $manifest -Encoding UTF8
    Ok "MANIFEST.txt con fecha, tamaño y SHA256 de cada archivo"

    # ── 6. Resultado ─────────────────────────────────────────────────────────
    Write-Host ""
    if ($hubo) {
        Write-Host "  EL BACKUP NO PASO LA VERIFICACION. No corras la migracion 148." -ForegroundColor Red
        Write-Host "  Revisa los [FALLA] de arriba y vuelve a ejecutar este script." -ForegroundColor Red
        exit 1
    }
    Write-Host "  BACKUP VERIFICADO. Archivos en: $Destino" -ForegroundColor Green
    Write-Host "  Lee LEEME.txt antes de continuar: hay cosas que esta copia NO cubre." -ForegroundColor Green
}
finally {
    # Se limpia pase lo que pase, incluso si el script murió a mitad.
    if ($plano)  { $plano  = $null }
    if ($urlCon) { $urlCon = $null }
    Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
    [GC]::Collect()
}
