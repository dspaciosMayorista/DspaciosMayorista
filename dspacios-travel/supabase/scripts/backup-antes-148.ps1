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
      1. Docker Desktop instalado Y CORRIENDO. La Supabase CLI ejecuta pg_dump
         dentro de un contenedor: sin Docker, `db dump` no funciona.
      2. Supabase CLI:   scoop install supabase
      3. Sesión iniciada: supabase login
      4. La cadena de conexión del botón "Connect" de Supabase, modo
         **Session pooler**. Se pega TAL CUAL viene, con el marcador
         [YOUR-PASSWORD] adentro — ese texto no es un secreto.

    FUNCIONA DESDE CUALQUIER CARPETA, incluida Descargas. No necesita el
    repositorio: para el diff de auth/storage se crea un proyecto Supabase
    temporal y VACÍO en %TEMP%, y se borra al terminar. Ver la nota larga junto
    a ese bloque — hacerlo desde el repositorio daría un resultado INCORRECTO.

    COMPATIBILIDAD: Windows PowerShell 5.1 (el `powershell` de toda la vida) o
    PowerShell 7 (`pwsh`). El script comprueba la versión al arrancar.

    USO
      powershell -ExecutionPolicy Bypass -File .\backup-antes-148.ps1

    Cada ejecución crea su propia carpeta con fecha y hora. Nunca sobrescribe
    un backup anterior.

    CÓDIGO DE SALIDA
      0 = backup generado Y verificado.  Cualquier otro = no sirve, no correr
      la migración 148.
#>

[CmdletBinding()]
param(
    # Carpeta CONTENEDORA. Adentro se crea `antes-migracion-148-<fecha>-<hora>`.
    [string]$Destino = "C:\Users\Asus\Documents\Backups\Dspacios"
)

#Requires -Version 5.1

$ErrorActionPreference = "Stop"

# El comando documentado es `powershell` (Windows PowerShell 5.1), no `pwsh`.
# El script está escrito para 5.1 a propósito; si algún día alguien lo corre en
# una máquina con 3.0/4.0, mejor un mensaje claro que un error de sintaxis.
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host "Este script necesita Windows PowerShell 5.1 o superior." -ForegroundColor Red
    Write-Host "Tienes la version $($PSVersionTable.PSVersion). Actualiza Windows PowerShell," -ForegroundColor Red
    Write-Host "o instala PowerShell 7 (winget install Microsoft.PowerShell) y usa 'pwsh'." -ForegroundColor Red
    exit 1
}

function Titulo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   [OK]    $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "   [AVISO] $t" -ForegroundColor Yellow }
function Falla($t)  { Write-Host "   [FALLA] $t" -ForegroundColor Red }

# ── Utilidades ───────────────────────────────────────────────────────────────

# Ruta absoluta sin exigir que exista (Resolve-Path falla si no existe).
function Ruta-Absoluta([string]$p) {
    if ([IO.Path]::IsPathRooted($p)) { return [IO.Path]::GetFullPath($p) }
    return [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $p))
}

# ¿$hijo está dentro de $padre? Compara rutas normalizadas, sin distinguir
# mayúsculas (Windows) y exigiendo separador para que `...\Datos2` no cuente
# como dentro de `...\Datos`.
function Dentro-De([string]$hijo, [string]$padre) {
    $sep = [IO.Path]::DirectorySeparatorChar
    $h = (Ruta-Absoluta $hijo).TrimEnd($sep)
    $p = (Ruta-Absoluta $padre).TrimEnd($sep)
    if ($h.Equals($p, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $h.StartsWith($p + $sep, [StringComparison]::OrdinalIgnoreCase)
}

# Sube por los directorios padres buscando `.git`. Es el respaldo por si `git`
# no está en el PATH o el destino pertenece a OTRO repositorio.
function Buscar-RepoArriba([string]$desde) {
    $d = Ruta-Absoluta $desde
    while ($d) {
        if (Test-Path (Join-Path $d ".git")) { return $d }
        $padre = [IO.Path]::GetDirectoryName($d)
        if (-not $padre -or $padre -eq $d) { break }
        $d = $padre
    }
    return $null
}

# Escribe UTF-8 SIN BOM. `Set-Content -Encoding UTF8` en Windows PowerShell 5.1
# escribe CON BOM (en PowerShell 7 no), y un BOM al principio de un .sql hace
# que psql se atragante con la primera linea al restaurar.
function Escribir-Texto([string]$ruta, $contenido) {
    $texto = if ($contenido -is [array]) { ($contenido -join "`r`n") + "`r`n" } else { [string]$contenido }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($ruta, $texto, $enc)
}

# Lee el archivo POR STREAMING. `data.sql` puede pesar decenas o cientos de MB
# (en la ejecucion real fueron 21 MB): cargarlo entero en memoria —y peor, dos
# veces— revienta la maquina justo cuando mas importa que el backup termine.
function Contiene-Texto([string]$ruta, [string]$patron) {
    if (-not (Test-Path $ruta)) { return $false }
    return [bool](Select-String -Path $ruta -Pattern $patron -SimpleMatch -Quiet)
}

# Busca una tabla calificada (esquema.tabla) TOLERANDO COMILLAS, porque pg_dump
# escribe los identificadores entrecomillados: `"public"."ventas"`.
function Contiene-Tabla([string]$ruta, [string]$calificado) {
    if (-not (Test-Path $ruta)) { return $false }
    $partes = $calificado.Split('.')
    $pat = '"?' + [regex]::Escape($partes[0]) + '"?\."?' + [regex]::Escape($partes[1]) + '"?'
    return [bool](Select-String -Path $ruta -Pattern $pat -Quiet)
}

# ¿Es esta linea el encabezado del bloque COPY de $tabla (formato esquema.tabla)?
#
# ⚠️ pg_dump ENTRECOMILLA los identificadores. La Supabase CLI 2.114.0 escribe:
#       COPY "public"."ventas" ("numero_contrato", ...) FROM stdin;
# y no:
#       COPY public.ventas (numero_contrato, ...) FROM stdin;
# Buscar el texto plano `COPY public.ventas` daba CERO coincidencias contra un
# volcado perfectamente bueno: el verificador reportaba -1 contratos y marcaba
# el backup como INCOMPLETO. Pasó de verdad, con un data.sql de 21 MB y 121
# contratos dentro.
#
# Se acepta cualquier combinación de comillas quitandolas del nombre, pero SOLO
# de la parte del nombre —hasta el `(` de las columnas o el ` FROM `—, para no
# tocar los datos. La comparacion es por igualdad EXACTA del nombre completo,
# asi que `public.ventas_historico` y `otro.ventas` no se confunden con
# `public.ventas`.
function Es-EncabezadoCopy([string]$linea, [string]$tabla) {
    if (-not $linea.StartsWith("COPY ", [StringComparison]::Ordinal)) { return $false }
    $resto = $linea.Substring(5)
    $fin  = -1
    $iPar = $resto.IndexOf("(", [StringComparison]::Ordinal)
    $iFrm = $resto.IndexOf(" FROM ", [StringComparison]::Ordinal)
    if ($iPar -ge 0) { $fin = $iPar }
    if ($iFrm -ge 0 -and ($fin -lt 0 -or $iFrm -lt $fin)) { $fin = $iFrm }
    if ($fin -ge 0) { $resto = $resto.Substring(0, $fin) }
    $nombre = ($resto -replace '"', '').Trim()
    return $nombre -eq $tabla
}

# Cuenta las filas de VARIAS tablas en UNA sola pasada. Devuelve una tabla hash
# nombre -> filas, con -1 si esa tabla no aparece en el volcado: no es lo mismo
# "no esta la tabla" que "esta con 0 filas", y esa diferencia decide si el
# backup sirve.
function Contar-FilasCopy([string]$ruta, [string[]]$tablas) {
    $res = @{}
    foreach ($t in $tablas) { $res[$t] = -1 }
    if (-not (Test-Path $ruta)) { return $res }

    $sr = [IO.StreamReader]::new($ruta)
    try {
        $actual = $null
        $n = 0
        while ($null -ne ($l = $sr.ReadLine())) {
            if ($null -eq $actual) {
                if ($l.StartsWith("COPY ", [StringComparison]::Ordinal)) {
                    foreach ($t in $tablas) {
                        if (Es-EncabezadoCopy $l $t) { $actual = $t; $n = 0; break }
                    }
                }
            }
            elseif ($l -eq '\.') { $res[$actual] = $n; $actual = $null }
            else { $n++ }
        }
        # Bloque sin cerrar: el volcado quedo cortado a mitad.
        if ($null -ne $actual) { $res[$actual] = $n }
        return $res
    } finally { $sr.Dispose() }
}

$plano    = $null
$urlCon   = $null
$tempProy = $null
$hubo     = $false
$salida   = 1

try {
    # ═════════════════════════════════════════════════════════════════════════
    # 1. Docker — antes de crear NADA
    # ═════════════════════════════════════════════════════════════════════════
    # La Supabase CLI corre pg_dump dentro de un contenedor. Si Docker no está,
    # `db dump` falla a mitad y deja archivos truncados que parecen válidos. Por
    # eso se comprueba antes de tocar el disco.
    Titulo "Docker"
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker no está instalado (o no está en el PATH). La Supabase CLI lo necesita para 'db dump'. Instala Docker Desktop y vuelve a intentar. NO se creó ningún archivo."
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker está instalado pero no está corriendo. Abre Docker Desktop, espera a que diga 'Engine running' y vuelve a ejecutar. NO se creó ningún archivo."
    }
    Ok "Docker instalado y corriendo"

    # ═════════════════════════════════════════════════════════════════════════
    # 2. Supabase CLI
    # ═════════════════════════════════════════════════════════════════════════
    Titulo "Supabase CLI"
    if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
        throw "No encuentro la Supabase CLI en el PATH. Instálala con 'scoop install supabase'. NO se creó ningún archivo."
    }
    $cliVer = (supabase --version) -join " "
    Ok "Supabase CLI: $cliVer"

    # ═════════════════════════════════════════════════════════════════════════
    # 3. Destino — que NO caiga dentro de un repositorio git
    # ═════════════════════════════════════════════════════════════════════════
    # El volcado lleva datos reales de clientes (documentos, teléfonos, pagos).
    # No se comprueba por el NOMBRE de la carpeta —renombrar el repo burlaría
    # esa comprobación— sino preguntándole a git dónde está la raíz, y además
    # subiendo por los padres del destino a buscar un `.git`.
    Titulo "Carpeta de destino"
    $base = Ruta-Absoluta $Destino

    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    $repoRaiz = $null
    Push-Location $scriptDir
    try {
        $r = & git rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $r) { $repoRaiz = Ruta-Absoluta ($r -join "") }
    } catch { }
    finally { Pop-Location }

    if ($repoRaiz) {
        Ok "Repositorio detectado en: $repoRaiz"
        if (Dentro-De $base $repoRaiz) {
            throw "El destino '$base' está DENTRO del repositorio '$repoRaiz'. El volcado lleva datos de clientes: elige una ruta fuera de git. NO se creó ningún archivo."
        }
    } else {
        Aviso "No pude preguntarle a git por la raíz del repositorio; se usa solo la búsqueda por directorios padres."
    }

    # Respaldo: el destino puede pertenecer a OTRO repositorio, que `git
    # rev-parse` desde el script nunca vería.
    $repoDestino = Buscar-RepoArriba $base
    if ($repoDestino) {
        throw "El destino '$base' está dentro de un repositorio git ('$repoDestino'). Elige una ruta fuera de git. NO se creó ningún archivo."
    }
    Ok "El destino está fuera de cualquier repositorio git"

    # ═════════════════════════════════════════════════════════════════════════
    # 4. Carpeta con fecha y hora — nunca se sobrescribe un backup anterior
    # ═════════════════════════════════════════════════════════════════════════
    $sello   = Get-Date -Format "yyyyMMdd-HHmmss"
    $carpeta = Join-Path $base "antes-migracion-148-$sello"

    $roles  = Join-Path $carpeta "roles.sql"
    $schema = Join-Path $carpeta "schema.sql"
    $data   = Join-Path $carpeta "data.sql"
    $authst = Join-Path $carpeta "auth_storage_changes.sql"
    $manif  = Join-Path $carpeta "MANIFEST.txt"
    $leeme  = Join-Path $carpeta "LEEME.txt"

    foreach ($f in @($roles, $schema, $data, $authst, $manif, $leeme)) {
        if (Test-Path $f) {
            throw "Ya existe '$f'. Este script NUNCA sobrescribe un backup. Mueve o borra esa carpeta y vuelve a intentar."
        }
    }
    New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
    Ok "Carpeta de este backup: $carpeta"

    # ═════════════════════════════════════════════════════════════════════════
    # 5. Cadena de conexión (sin contraseña) y contraseña oculta
    # ═════════════════════════════════════════════════════════════════════════
    Titulo "Cadena de conexión"
    Write-Host "   En Supabase: boton 'Connect' -> pestana 'Session pooler' -> copiar la URI." -ForegroundColor Gray
    Write-Host "   Pegala TAL CUAL, con el texto [YOUR-PASSWORD] adentro (eso no es un secreto)." -ForegroundColor Gray
    $plantilla = Read-Host "   URI"

    if ($plantilla -notmatch '^postgres(ql)?://') { throw "Eso no parece una URI de PostgreSQL." }
    if ($plantilla -notmatch '\[YOUR-PASSWORD\]') {
        throw "La URI no trae el marcador [YOUR-PASSWORD]. Pega la plantilla sin reemplazar la contraseña: el script la inserta solo."
    }

    $projectRef = $null
    if ($plantilla -match '://postgres\.([a-z0-9]+):') { $projectRef = $Matches[1] }
    if ($projectRef) { Ok "Proyecto detectado: $projectRef" }
    else { Aviso "No pude deducir el project-ref de la URI." }

    Titulo "Contraseña de la base de datos"
    Write-Host "   No se muestra en pantalla, no se guarda y no queda en el historial." -ForegroundColor Gray
    $segura = Read-Host "   Contrasena" -AsSecureString
    if (-not $segura -or $segura.Length -eq 0) { throw "No escribiste ninguna contraseña." }

    # NetworkCredential funciona igual en Windows PowerShell 5.1 y PowerShell 7.
    $plano = [System.Net.NetworkCredential]::new("", $segura).Password
    if ([string]::IsNullOrEmpty($plano)) { throw "No escribiste ninguna contraseña." }

    # Se codifica para la URL: una contraseña con @ # / : ? & rompería la URI en
    # silencio, y el error que sale ("host desconocido") no apunta a esto.
    $urlCon = $plantilla -replace '\[YOUR-PASSWORD\]', [uri]::EscapeDataString($plano)
    Ok "Contraseña recibida ($($plano.Length) caracteres)"

    # ═════════════════════════════════════════════════════════════════════════
    # 6. Volcados
    # ═════════════════════════════════════════════════════════════════════════
    Titulo "Volcado de roles"
    supabase db dump --db-url $urlCon -f $roles --role-only
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado de roles (codigo $LASTEXITCODE)." }
    Ok "roles.sql"

    Titulo "Volcado del esquema (tablas, vistas, policies, funciones)"
    supabase db dump --db-url $urlCon -f $schema
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado del esquema (codigo $LASTEXITCODE)." }
    Ok "schema.sql"

    Titulo "Volcado de datos"
    Write-Host "   Este es el que demora. No cierres la ventana." -ForegroundColor Gray
    supabase db dump --db-url $urlCon -f $data --use-copy --data-only `
        -x "storage.buckets_vectors" -x "storage.vector_indexes"
    if ($LASTEXITCODE -ne 0) { throw "Falló el volcado de datos (codigo $LASTEXITCODE)." }
    Ok "data.sql"

    # ── Cambios propios en auth y storage ────────────────────────────────────
    #
    # ⚠️ ESTO **NO** SE PUEDE CORRER DESDE LA CARPETA DEL REPOSITORIO.
    #
    # `supabase db diff --linked` no compara contra la nada: levanta una "shadow
    # database" aplicando LAS MIGRACIONES LOCALES de la carpeta desde la que se
    # invoca, y reporta la diferencia entre ESO y la base remota.
    #
    # Corriéndolo dentro del repositorio, la shadow saldría con las 149
    # migraciones aplicadas — incluidas la 148 y la 149, que TODAVÍA NO están en
    # producción. Las policies de Storage que la 148 crea estarían en los dos
    # lados de la comparación, así que el diff diría "no hay diferencias" y el
    # archivo saldría vacío. El backup perdería justo lo que se quiere guardar:
    # el estado ANTERIOR a la 148. Un archivo vacío que parece correcto.
    #
    # Y desde Descargas —que es de donde se va a ejecutar este script— no hay
    # `supabase/config.toml`, así que `link` y `diff` fallarían sin más.
    #
    # Solución: un proyecto Supabase temporal, VACÍO y fuera del repositorio.
    # Sin migraciones locales, la shadow queda como una base Supabase recién
    # creada, y el diff devuelve exactamente lo que se busca: los cambios
    # PROPIOS sobre auth/storage respecto de lo que trae Supabase de fábrica.
    # Se borra en el `finally`, termine bien o mal.
    Titulo "Cambios propios en auth y storage"
    $authOk = $false
    if (-not $projectRef) {
        Falla "Sin project-ref no se puede generar auth_storage_changes.sql. El backup queda INCOMPLETO."
        Escribir-Texto $authst "-- NO GENERADO: no se pudo deducir el project-ref de la URI."
        $hubo = $true
    } else {
        $tempProy = Join-Path ([IO.Path]::GetTempPath()) ("dspacios-diff-" + [Guid]::NewGuid().ToString("N").Substring(0, 12))
        New-Item -ItemType Directory -Force -Path $tempProy | Out-Null
        Write-Host "   Proyecto temporal: $tempProy" -ForegroundColor Gray

        Push-Location $tempProy
        $volver = $true
        try {
            # La cadena vacía responde con el valor por defecto a cualquier
            # pregunta que `init` haga (settings de VS Code / IntelliJ) sin
            # dejar el script colgado esperando.
            "" | supabase init --force *> $null
            $codigoInit = $LASTEXITCODE

            $cfg     = Join-Path $tempProy "supabase\config.toml"
            $migDir  = Join-Path $tempProy "supabase\migrations"
            $migs    = @()
            if (Test-Path $migDir) { $migs = @(Get-ChildItem -Path $migDir -Filter *.sql -File -ErrorAction SilentlyContinue) }

            if ($codigoInit -ne 0 -or -not (Test-Path $cfg)) {
                Falla "'supabase init' no creó el proyecto temporal (codigo $codigoInit). El backup queda INCOMPLETO."
                Escribir-Texto $authst "-- NO GENERADO: 'supabase init' fallo con codigo $codigoInit."
                $hubo = $true
            }
            elseif ($migs.Count -gt 0) {
                # No debería pasar nunca: el proyecto se acaba de crear en una
                # carpeta vacía. Si pasa, algo está mal y es preferible fallar a
                # generar un diff contra un estado equivocado.
                Falla "El proyecto temporal tiene $($migs.Count) migracion(es) locales. Se aborta: el diff saldria contra un estado que no es el de produccion."
                Escribir-Texto $authst "-- NO GENERADO: el proyecto temporal no estaba vacio."
                $hubo = $true
            }
            else {
                Ok "Proyecto temporal vacio (0 migraciones locales)"

                # La contraseña va por variable de entorno del PROCESO, no como
                # argumento: así no aparece en la tabla de procesos.
                $env:SUPABASE_DB_PASSWORD = $plano
                supabase link --project-ref $projectRef *> $null
                $codigoLink = $LASTEXITCODE

                if ($codigoLink -ne 0) {
                    Falla "'supabase link' falló (codigo $codigoLink). ¿Corriste 'supabase login'? El backup queda INCOMPLETO."
                    Escribir-Texto $authst "-- NO GENERADO: 'supabase link' fallo con codigo $codigoLink."
                    $hubo = $true
                } else {
                    $diff = supabase db diff --linked --schema auth,storage
                    $codigoDiff = $LASTEXITCODE
                    if ($codigoDiff -ne 0) {
                        Falla "'supabase db diff' falló (codigo $codigoDiff). El backup queda INCOMPLETO."
                        Escribir-Texto $authst "-- NO GENERADO: 'supabase db diff' fallo con codigo $codigoDiff."
                        $hubo = $true
                    } else {
                        $cab = @(
                            "-- Cambios propios sobre los esquemas auth y storage.",
                            "-- Generado con 'supabase db diff --linked --schema auth,storage' desde un",
                            "-- proyecto Supabase temporal y VACIO (sin migraciones locales), para que la",
                            "-- comparacion sea contra una base Supabase de fabrica y no contra el estado",
                            "-- del repositorio, que ya incluye las migraciones 148 y 149 sin desplegar.",
                            ""
                        )
                        Escribir-Texto $authst ($cab + @($diff))
                        $authOk = $true
                        Ok "auth_storage_changes.sql (diff hecho desde proyecto temporal vacio)"
                    }
                }
            }
        }
        finally {
            Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
            if ($volver) { Pop-Location }
        }
    }

    # ═════════════════════════════════════════════════════════════════════════
    # 7. Verificación: que los archivos SIRVAN, no solo que existan
    # ═════════════════════════════════════════════════════════════════════════
    Titulo "Verificación del contenido"

    # Las comprobaciones de contenido toleran comillas: pg_dump escribe
    # `"public"."ventas"`, no `public.ventas`.
    $checks = @(
        @{ f = $roles;  min = 200;   nombre = "roles.sql";
           texto = @("ROLE"); tablas = @() },
        @{ f = $schema; min = 50000; nombre = "schema.sql";
           texto = @("CREATE TABLE"); tablas = @("public.ventas", "public.abonos", "public.ventas_basica") },
        @{ f = $data;   min = 1000;  nombre = "data.sql";
           texto = @(); tablas = @() }
    )

    foreach ($c in $checks) {
        if (-not (Test-Path $c.f)) { Falla "$($c.nombre): no existe"; $hubo = $true; continue }
        $len = (Get-Item $c.f).Length
        if ($len -lt $c.min) {
            Falla "$($c.nombre): solo $len bytes, se esperaban al menos $($c.min). El volcado quedo incompleto."
            $hubo = $true; continue
        }
        $faltan = @()
        foreach ($t in $c.texto)  { if (-not (Contiene-Texto $c.f $t))  { $faltan += $t } }
        foreach ($t in $c.tablas) { if (-not (Contiene-Tabla $c.f $t)) { $faltan += $t } }
        if ($faltan.Count -gt 0) {
            Falla "$($c.nombre): no contiene $($faltan -join ', ')"
            $hubo = $true
        } else {
            Ok "$($c.nombre) - $([math]::Round($len/1MB,2)) MB, contenido esperado presente"
        }
    }

    # ── Que trae REALMENTE el volcado de datos ──────────────────────────────
    # Se cuentan las tres tablas que importan en UNA sola pasada. Nada de esto
    # se da por supuesto: se mide y se escribe tal cual en MANIFEST y LEEME.
    #
    # Sobre auth y storage: una version anterior de este script AFIRMABA que
    # `db dump` siempre los excluye por ser esquemas administrados. La ejecucion
    # real con la CLI 2.114.0 los trajo (9 usuarios de Auth y 1761 filas de
    # storage.objects), asi que la afirmacion era falsa. Depende de la version
    # de la CLI y de las banderas. Por eso ahora no se afirma: se comprueba.
    $conteos = Contar-FilasCopy $data @("public.ventas", "auth.users", "storage.objects")
    $nContratos = $conteos["public.ventas"]
    $nAuth      = $conteos["auth.users"]
    $nStorage   = $conteos["storage.objects"]

    # El numero de contratos es el dato que se compara contra lo que muestra la
    # app. Un backup que "existe" pero con 0 contratos no sirve, y sin este
    # conteo no se notaria.
    if ($nContratos -gt 0) { Ok "Contratos en el volcado (public.ventas): $nContratos" }
    elseif ($nContratos -eq 0) { Falla "El bloque COPY de 'ventas' esta VACIO: el volcado no trae contratos."; $hubo = $true }
    else { Falla "El volcado no trae la tabla 'ventas'."; $hubo = $true }

    if ($nAuth -ge 0) {
        Ok "Usuarios de Auth en el volcado (auth.users): $nAuth"
    } else {
        Aviso "El volcado NO trae 'auth.users'. Al restaurar en un proyecto nuevo habria que recrear los usuarios a mano."
    }

    if ($nStorage -ge 0) {
        Ok "Metadata de Storage en el volcado (storage.objects): $nStorage archivo(s) catalogado(s)"
        Aviso "Ojo: eso es la LISTA de archivos, no los archivos. Los ficheros fisicos de Storage NUNCA estan en un volcado de base de datos."
    } else {
        Aviso "El volcado NO trae 'storage.objects': ni la lista de archivos ni los archivos."
    }

    if ($authOk) {
        $lenA = (Get-Item $authst).Length
        if ($lenA -lt 20) {
            Aviso "auth_storage_changes.sql esta practicamente vacio. Puede ser correcto (sin cambios propios) - abrelo y confirmalo antes de darlo por bueno."
        } else {
            Ok "auth_storage_changes.sql - $lenA bytes"
        }
    }

    # ═════════════════════════════════════════════════════════════════════════
    # 8. MANIFEST.txt y LEEME.txt
    # ═════════════════════════════════════════════════════════════════════════
    Titulo "MANIFEST.txt"
    $m = @()
    $m += "Backup de la base de D'spacios - ANTES de la migracion 148"
    $m += "Generado: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    $m += "Maquina:  $env:COMPUTERNAME"
    $m += "Proyecto: $projectRef"
    $m += "CLI:      $cliVer"
    $m += "Estado:   " + $(if ($hubo) { "INCOMPLETO - NO USAR" } else { "VERIFICADO" })
    $m += ""
    $m += "CONTENIDO MEDIDO DE data.sql (no supuesto):"
    $m += ("  public.ventas    : " + $(if ($nContratos -ge 0) { "$nContratos fila(s)" } else { "AUSENTE" }))
    $m += ("  auth.users       : " + $(if ($nAuth      -ge 0) { "$nAuth fila(s)" }      else { "AUSENTE" }))
    $m += ("  storage.objects  : " + $(if ($nStorage   -ge 0) { "$nStorage fila(s) (LISTA de archivos, no los archivos)" } else { "AUSENTE" }))
    $m += ""
    $m += "*** data.sql CONTIENE DATOS PERSONALES. NO COMPARTIR, NO SUBIR A GITHUB. ***"
    $m += "Ver LEEME.txt. Los archivos FISICOS de Storage no estan aqui."
    $m += ""
    $m += ("{0,-28} {1,14}  {2}" -f "ARCHIVO", "BYTES", "SHA256")
    foreach ($f in @($roles, $schema, $data, $authst)) {
        if (Test-Path $f) {
            $it = Get-Item $f
            $h  = (Get-FileHash $f -Algorithm SHA256).Hash
            $m += ("{0,-28} {1,14}  {2}" -f $it.Name, $it.Length, $h)
        }
    }
    Escribir-Texto $manif $m
    Ok "MANIFEST.txt con fecha, tamaño y SHA256 de cada archivo"

    Titulo "LEEME.txt"
    # Todo lo de abajo se arma con lo que el volcado trae DE VERDAD, medido
    # arriba. Nada de frases fijas del tipo "Supabase siempre excluye auth":
    # eso ya resulto ser falso una vez.
    $lineaVentas  = if ($nContratos -ge 0) { "$nContratos fila(s)" } else { "AUSENTE" }
    $lineaAuth    = if ($nAuth      -ge 0) { "$nAuth fila(s)" }      else { "AUSENTE" }
    $lineaStorage = if ($nStorage   -ge 0) { "$nStorage fila(s)" }   else { "AUSENTE" }

    $l = @()
    $l += "==========================================================="
    $l += " BACKUP DE LA BASE DE D'SPACIOS - ANTES DE LA MIGRACION 148"
    $l += "==========================================================="
    $l += ""
    $l += "Fecha:     $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
    $l += "Proyecto:  $projectRef"
    $l += "Estado:    " + $(if ($hubo) { "INCOMPLETO - NO USAR ESTE BACKUP" } else { "VERIFICADO" })
    $l += ""
    $l += "###########################################################"
    $l += "#  ESTA CARPETA CONTIENE DATOS PERSONALES.                #"
    $l += "#  NO SUBIR A GITHUB. NO ENVIAR POR CORREO NI WHATSAPP.   #"
    $l += "#  NO GUARDAR EN CARPETAS COMPARTIDAS NI SINCRONIZADAS.   #"
    $l += "###########################################################"
    $l += ""
    $l += "data.sql es el archivo delicado. Segun lo MEDIDO en este volcado"
    $l += "concreto, trae:"
    $l += "  public.ventas    : $lineaVentas"
    $l += "                     nombre del cliente, documento, telefono, correo,"
    $l += "                     direccion y precio de cada contrato."
    $l += "  auth.users       : $lineaAuth"
    $l += "                     usuarios del sistema con su correo y el hash de"
    $l += "                     su contrasena."
    $l += "  storage.objects  : $lineaStorage"
    $l += "                     la LISTA de archivos subidos: rutas con el numero"
    $l += "                     de contrato, nombres de las cedulas y soportes."
    $l += "Ademas: contrato_pasajeros (documento y fecha de nacimiento de cada"
    $l += "pasajero), abonos, cuentas por pagar y comisiones."
    $l += ""
    $l += "Si esta carpeta se filtra, se filtra la base de clientes entera."
    $l += "Guardala en el disco de la maquina, no en OneDrive/Drive/Dropbox, y"
    $l += "borrala cuando ya no haga falta."
    $l += ""
    $l += "-- QUE INCLUYE ------------------------------------------"
    $l += "  roles.sql                 Roles de base de datos."
    $l += "  schema.sql                Tablas, vistas, policies (RLS), funciones,"
    $l += "                            triggers e indices."
    $l += "  data.sql                  Los DATOS (ver arriba)."
    $l += "  auth_storage_changes.sql  Cambios propios sobre auth y storage."
    $l += "  MANIFEST.txt              Tamano y SHA256 de cada archivo."
    $l += ""
    $l += "-- QUE **NO** INCLUYE -----------------------------------"
    $l += ""
    $l += "1) LOS ARCHIVOS FISICOS DE SUPABASE STORAGE. Es lo mas importante."
    if ($nStorage -ge 0) {
        $l += "   Este volcado SI trae 'storage.objects' ($nStorage filas): es el"
        $l += "   CATALOGO de archivos (rutas, nombres, tamanos), no los archivos."
        $l += "   Restaurado en un proyecto nuevo quedaria un catalogo apuntando a"
        $l += "   cedulas y soportes de pago que no estan."
    } else {
        $l += "   Este volcado NO trae 'storage.objects': no esta ni el catalogo de"
        $l += "   archivos ni los archivos."
    }
    $l += "   Los ficheros viven en el almacenamiento de objetos, que no es"
    $l += "   Postgres, y NUNCA salen en un volcado de base de datos."
    $l += "   Buckets afectados:"
    $l += "     contratos       Cedulas y soportes de pago de clientes, y los"
    $l += "                     contratos laborales de empleados (pe-empleados/)."
    $l += "     programas       Flyers, historias, portadas."
    $l += "     crm             Material de difusion."
    $l += "     web-cms         Imagenes del sitio publico."
    $l += "     hotel-fotos     Fotos de hoteles."
    $l += "     servicio-fotos  Fotos de receptivos."
    $l += "   Para copiarlos hay que descargarlos aparte, desde el panel de"
    $l += "   Storage o con la API."
    $l += "   Para la migracion 148 esto NO bloquea nada: la 148 solo cambia"
    $l += "   policies y crea vistas, no toca ni mueve ni borra un solo archivo."
    $l += ""
    if ($nAuth -ge 0) {
        $l += "2) Los usuarios de Auth SI estan ($nAuth), pero restaurarlos en otro"
        $l += "   proyecto no es copiar y pegar: hay que comprobar que los UUID"
        $l += "   coincidan con usuarios.id, o nadie podra entrar."
    } else {
        $l += "2) LOS USUARIOS DE AUTH (auth.users) NO estan en este volcado. Hay"
        $l += "   que recrearlos; las contrasenas no se recuperan desde aqui."
    }
    $l += ""
    $l += "3) Secretos y variables de entorno (Vercel y Supabase), cron jobs,"
    $l += "   webhooks y configuracion del proyecto."
    $l += ""
    $l += "-- COMO SE RESTAURA EN UN PROYECTO NUEVO ----------------"
    $l += ""
    $l += "Metodo oficial de Supabase. Los tres archivos van en UNA sola"
    $l += "invocacion, en una sola transaccion y parando al primer error: si se"
    $l += "corren por separado y el segundo falla, queda una base a medio"
    $l += "restaurar que parece haber terminado bien."
    $l += ""
    $l += '  psql --single-transaction --variable ON_ERROR_STOP=1 `'
    $l += '    --file roles.sql --file schema.sql `'
    $l += '    --command "SET session_replication_role = replica;" `'
    $l += '    --file data.sql --dbname "$URL_DEL_PROYECTO_NUEVO"'
    $l += ""
    $l += "  session_replication_role = replica desactiva triggers y validacion"
    $l += "  de llaves foraneas mientras entran los datos: sin eso, el orden de"
    $l += "  las tablas hace fallar la carga."
    $l += ""
    $l += "Despues, y esto no lo hace el volcado:"
    $l += "  1. Volver a subir los archivos de Storage a sus buckets con la ruta"
    $l += "     EXACTA. 'contratos' usa {numero_contrato}/{tipo}-{ts}.{ext}, y"
    $l += "     las policies de la 148 dependen de que el primer segmento sea el"
    $l += "     numero de contrato."
    $l += "  2. Recrear los usuarios de Auth. usuarios.id apunta a auth.users(id):"
    $l += "     si los UUID no coinciden, nadie entra."
    $l += "  3. Apuntar las variables de entorno de Vercel al proyecto nuevo."
    $l += "  4. Correr supabase/scripts/test_rls_por_rol.sql para comprobar la RLS."
    $l += ""
    $l += "-- COMO REVERTIR SOLO LA MIGRACION 148 ------------------"
    $l += ""
    $l += "  1. Primero revertir el DESPLIEGUE en Vercel (deploy anterior)."
    $l += "  2. Despues: psql <URL> -f supabase/scripts/rollback_148.sql"
    $l += "  3. Comprobar: psql <URL> -f supabase/scripts/verificar_rollback_148.sql"
    $l += ""
    $l += "  Al reves, la app queda pidiendo vistas que el rollback elimina."
    $l += "  El rollback NO toca datos: la 148 es puro DDL."
    $l += ""
    Escribir-Texto $leeme $l
    Ok "LEEME.txt"

    # ═════════════════════════════════════════════════════════════════════════
    # 9. Resultado
    # ═════════════════════════════════════════════════════════════════════════
    Write-Host ""
    if ($hubo) {
        Write-Host "  BACKUP INCOMPLETO. No corras la migracion 148." -ForegroundColor Red
        Write-Host "  Revisa los [FALLA] de arriba y vuelve a ejecutar." -ForegroundColor Red
        Write-Host "  Carpeta: $carpeta" -ForegroundColor Red
        $salida = 1
    } else {
        Write-Host "  BACKUP VERIFICADO. Archivos en: $carpeta" -ForegroundColor Green
        Write-Host "  Lee LEEME.txt antes de continuar: hay cosas que esta copia NO cubre." -ForegroundColor Green
        $salida = 0
    }
}
catch {
    Write-Host ""
    Falla $_.Exception.Message
    Write-Host ""
    Write-Host "  BACKUP NO COMPLETADO. No corras la migracion 148." -ForegroundColor Red
    $salida = 1
}
finally {
    # Se limpia pase lo que pase, incluso si el script murió a mitad.
    $plano  = $null
    $urlCon = $null
    Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue

    # El proyecto Supabase temporal no puede quedar tirado en %TEMP%: `link`
    # deja ahí el project-ref y credenciales de sesión de la CLI.
    if ($tempProy -and (Test-Path $tempProy)) {
        try {
            Remove-Item -LiteralPath $tempProy -Recurse -Force -ErrorAction Stop
            Write-Host "   Proyecto temporal eliminado." -ForegroundColor Gray
        } catch {
            Write-Host "   [AVISO] No se pudo borrar el proyecto temporal: $tempProy" -ForegroundColor Yellow
            Write-Host "           Borralo a mano." -ForegroundColor Yellow
        }
    }
    [GC]::Collect()
}

exit $salida
