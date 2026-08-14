#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Banco de pruebas de `backup-antes-148.ps1`.
#
# Comprueba lo que de verdad importa de un script de backup: que FALLE cuando
# tiene que fallar. Un backup que dice "VERIFICADO" cuando le falta una pieza es
# peor que uno que revienta, porque se corre la migración confiando en él.
#
# Cada escenario negativo debe terminar con código != 0 y SIN imprimir
# "BACKUP VERIFICADO".
#
# EL `supabase` SIMULADO ES EXIGENTE A PROPÓSITO:
#   · `link` y `db diff` FALLAN si no hay `supabase/config.toml` en el
#     directorio actual — igual que la CLI real. Un mock permisivo ocultaba que
#     el script no servía al ejecutarse desde Descargas.
#   · `db diff` FALLA si `supabase/migrations` tiene archivos. Esa es la trampa
#     de fondo: `db diff --linked` levanta su shadow database con las
#     migraciones LOCALES, así que corriéndolo dentro del repositorio la
#     comparación se haría contra un estado que ya incluye la 148 y la 149.
#   · `db diff` deja una huella con el directorio desde el que se le llamó, para
#     poder comprobar que NO fue el repositorio.
#   · `db dump --data-only` entrega un FIXTURE con los encabezados REALES de
#     pg_dump — con identificadores entrecomillados, `COPY "public"."ventas"`,
#     que es como los escribe la Supabase CLI 2.114.0. El mock anterior los
#     emitía sin comillas y por eso el banco de pruebas daba 21/21 mientras la
#     ejecución real fallaba: el verificador no reconocía ni un solo bloque.
#
# Requisitos: PowerShell (pwsh) y git. Se corre en Linux o macOS:
#   bash supabase/scripts/pruebas/probar-backup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u
BASE="$(mktemp -d)"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/backup-antes-148.ps1"
PWSH="${PWSH:-pwsh}"
FAKE=$BASE/fakebin
OUTBASE=$BASE/out
HUELLA=$BASE/huella-diff.txt
FIXTURES="$(cd "$(dirname "$0")" && pwd)/fixtures"
ok=0; mal=0

# Envoltorio: sustituye Read-Host (no se puede escribir en un prompt oculto
# desde una prueba) y llama al script real, sin modificarlo.
cat > $BASE/wrap.ps1 <<'EOF'
param([string]$Script, [string]$Destino)
function Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  if ($AsSecureString) { return (ConvertTo-SecureString $env:TEST_PASS -AsPlainText -Force) }
  return $env:TEST_URI
}
& $Script -Destino $Destino
exit $LASTEXITCODE
EOF

prep() {  # $1 = escenario
  rm -rf $FAKE; mkdir -p $FAKE $OUTBASE
  cat > $FAKE/docker <<EOF
#!/bin/bash
[ "\$1" = "info" ] && { [ "$1" = "docker-apagado" ] && exit 1; exit 0; }
exit 0
EOF
  cat > $FAKE/supabase <<EOF
#!/bin/bash
ESC="$1"
HUELLA="$HUELLA"
[ "\$1" = "--version" ] && { echo "2.0.0-fake"; exit 0; }

if [ "\$1" = "db" ] && [ "\$2" = "dump" ]; then
  f=""; for ((i=1;i<=\$#;i++)); do [ "\${!i}" = "-f" ] && { j=\$((i+1)); f="\${!j}"; }; done
  if [[ "\$*" == *"--role-only"* ]]; then
    printf 'CREATE ROLE anon;\nALTER ROLE anon SET x=1;\n%.0s' {1..20} > "\$f"
  elif [[ "\$*" == *"--data-only"* ]]; then
    if [ "\$ESC" = "datos-vacios" ]; then
      { echo 'COPY "public"."ventas" ("numero_contrato") FROM stdin;'; echo '\\.'; } > "\$f"
      head -c 2000 /dev/zero | tr '\0' '-' >> "\$f"
    elif [ "\$ESC" = "sin-comillas" ]; then
      cp "$FIXTURES/data-unquoted.sql" "\$f"
    else
      cp "$FIXTURES/data-quoted.sql" "\$f"
    fi
  else
    # El esquema tambien sale entrecomillado en la CLI real.
    { echo 'CREATE TABLE "public"."ventas" ("numero_contrato" text);'
      echo 'CREATE TABLE "public"."abonos" ("id" bigint);'
      echo 'CREATE VIEW "public"."ventas_basica" AS SELECT 1;'; } > "\$f"
    head -c 60000 /dev/zero | tr '\0' '-' >> "\$f"
  fi
  exit 0
fi

# init: crea la estructura mínima, igual que la CLI real.
if [ "\$1" = "init" ]; then
  [ "\$ESC" = "init-falla" ] && exit 3
  mkdir -p supabase/migrations
  printf 'project_id = "temporal"\n' > supabase/config.toml
  exit 0
fi

# link y diff EXIGEN estar dentro de un proyecto Supabase, igual que la CLI real.
if [ "\$1" = "link" ]; then
  [ -f supabase/config.toml ] || { echo "Cannot find project ref. Have you run supabase init?" >&2; exit 2; }
  [ "\$ESC" = "link-falla" ] && exit 7
  exit 0
fi

if [ "\$1" = "db" ] && [ "\$2" = "diff" ]; then
  [ -f supabase/config.toml ] || { echo "Cannot find supabase/config.toml" >&2; exit 2; }
  # Deja constancia de DONDE se le llamo y de cuantas migraciones locales habia.
  n=\$(ls supabase/migrations/*.sql 2>/dev/null | wc -l)
  echo "cwd=\$(pwd) migraciones=\$n" >> "\$HUELLA"
  if [ "\$n" -gt 0 ]; then
    echo "shadow database construida con \$n migraciones locales" >&2
    exit 5
  fi
  [ "\$ESC" = "diff-falla" ] && exit 9
  echo "-- sin cambios"
  exit 0
fi
exit 0
EOF
  chmod +x $FAKE/docker $FAKE/supabase
}

corre() { # $1=escenario  $2=destino  $3=cwd(opcional) -> "codigo|tieneVerificado"
  prep "$1"
  local cwd="${3:-$BASE}"
  mkdir -p "$cwd"
  out=$(cd "$cwd" && PATH="$FAKE:$PATH" \
        TEST_URI="postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
        TEST_PASS="p@ss#w0rd/x" $PWSH -NoProfile -File $BASE/wrap.ps1 -Script $SCRIPT -Destino "$2" 2>&1)
  code=$?
  echo "$out" > $BASE/last.log
  if echo "$out" | grep -q "BACKUP VERIFICADO"; then v="SI"; else v="NO"; fi
  echo "$code|$v"
}

check() { # $1=nombre  $2=resultado  $3=esperaCodigoCero(si/no)
  IFS='|' read -r code ver <<< "$2"
  if [ "$3" = "si" ]; then
    if [ "$code" = "0" ] && [ "$ver" = "SI" ]; then echo "  [OK]    $1 -> codigo 0, VERIFICADO"; ok=$((ok+1));
    else echo "  [FALLA] $1 -> codigo $code, VERIFICADO=$ver (se esperaba 0/SI)"; mal=$((mal+1)); fi
  else
    if [ "$code" != "0" ] && [ "$ver" = "NO" ]; then echo "  [OK]    $1 -> codigo $code, sin VERIFICADO"; ok=$((ok+1));
    else echo "  [FALLA] $1 -> codigo $code, VERIFICADO=$ver (se esperaba !=0 y sin VERIFICADO)"; mal=$((mal+1)); fi
  fi
}

afirma() { # $1=nombre  $2=condicion(0/1)  -> comprobacion suelta
  if [ "$2" = "0" ]; then echo "  [OK]    $1"; ok=$((ok+1));
  else echo "  [FALLA] $1"; mal=$((mal+1)); fi
}

echo "== Caso base: debe pasar =="
check "camino feliz" "$(corre feliz $OUTBASE/dest)" si

echo ""
echo "== Ejecutado desde una carpeta SIN repositorio y SIN config.toml =="
echo "   (es de donde se va a correr de verdad: la carpeta de Descargas)"
: > $HUELLA
DESCARGAS=$BASE/Descargas
mkdir -p $DESCARGAS
check "desde 'Descargas'" "$(corre feliz $OUTBASE/dest-desc $DESCARGAS)" si
grep -q "migraciones=0" $HUELLA; afirma "el diff se hizo con 0 migraciones locales" $?
grep -qv "cwd=$DESCARGAS " $HUELLA; afirma "el diff NO se hizo desde la carpeta de ejecucion" $?
grep -q "cwd=/tmp/" $HUELLA;        afirma "el diff se hizo desde un proyecto temporal en /tmp" $?
QUEDAN=$(ls -d /tmp/dspacios-diff-* 2>/dev/null | wc -l)
afirma "el proyecto temporal se elimino al terminar" $([ "$QUEDAN" = "0" ] && echo 0 || echo 1)

echo ""
echo "== Ejecutado DESDE el repositorio: el diff no puede usar sus migraciones =="
: > $HUELLA
REPO=$BASE/repo-falso
mkdir -p $REPO/supabase/migrations
git -C $REPO init -q
printf 'project_id = "real"\n' > $REPO/supabase/config.toml
for n in 147 148 149; do echo "-- migracion $n" > $REPO/supabase/migrations/2026060100$n.sql; done
check "desde el repositorio (destino fuera)" "$(corre feliz $OUTBASE/dest-repo $REPO)" si
grep -q "migraciones=0" $HUELLA; afirma "aun desde el repo, el diff uso 0 migraciones" $?
grep -q "cwd=$REPO " $HUELLA;    afirma "el diff NO se hizo dentro del repositorio" $([ $? = 1 ] && echo 0 || echo 1)

echo ""
echo "== Formato REAL de pg_dump: identificadores entrecomillados =="
echo "   COPY \"public\".\"ventas\"  (Supabase CLI 2.114.0)"
R=$(corre feliz $OUTBASE/dest-q); check "volcado con comillas" "$R" si
LOGQ=$(cat $BASE/last.log)
echo "$LOGQ" | grep -q "public.ventas): 121";        afirma "cuenta exactamente 121 contratos" $?
echo "$LOGQ" | grep -q "auth.users): 9";             afirma "cuenta exactamente 9 usuarios de Auth" $?
echo "$LOGQ" | grep -q "storage.objects): 17";       afirma "cuenta exactamente 17 filas de storage.objects" $?
MAN=$(cat $OUTBASE/dest-q/*/MANIFEST.txt)
echo "$MAN" | grep -q "public.ventas    : 121 fila"; afirma "MANIFEST registra 121 contratos" $?
echo "$MAN" | grep -q "auth.users       : 9 fila";   afirma "MANIFEST registra auth.users presente" $?
echo "$MAN" | grep -q "storage.objects  : 17 fila";  afirma "MANIFEST registra storage.objects presente" $?
echo "$MAN" | grep -q "NO COMPARTIR, NO SUBIR A GITHUB"; afirma "MANIFEST avisa que son datos personales" $?
LEE=$(cat $OUTBASE/dest-q/*/LEEME.txt)
echo "$LEE" | grep -q "CONTIENE DATOS PERSONALES";   afirma "LEEME avisa que son datos personales" $?
echo "$LEE" | grep -q "storage.objects  : 17 fila";  afirma "LEEME refleja lo MEDIDO, no una frase fija" $?
echo "$LEE" | grep -qi "siempre excluye";            afirma "LEEME no afirma que Supabase 'siempre excluye' auth/storage" $([ $? = 1 ] && echo 0 || echo 1)

echo ""
echo "== Mismo volcado SIN comillas: los dos formatos tienen que funcionar =="
R=$(corre sin-comillas $OUTBASE/dest-u); check "volcado sin comillas" "$R" si
LOGU=$(cat $BASE/last.log)
echo "$LOGU" | grep -q "public.ventas): 121";  afirma "sin comillas: cuenta 121 contratos" $?
echo "$LOGU" | grep -q "auth.users): 9";       afirma "sin comillas: cuenta 9 usuarios de Auth" $?
echo "$LOGU" | grep -q "storage.objects): 17"; afirma "sin comillas: cuenta 17 de storage.objects" $?

echo ""
echo "   (el fixture trae senuelos public.ventas_historico y otro.ventas: si el"
echo "    contador los confundiera, los numeros de arriba no cuadrarian)"

echo ""
echo "== Casos negativos: todos deben fallar =="
check "Docker apagado"                "$(corre docker-apagado $OUTBASE/dest)" no
check "'supabase init' falla"         "$(corre init-falla     $OUTBASE/dest)" no
check "'supabase link' falla"         "$(corre link-falla     $OUTBASE/dest)" no
check "'supabase db diff' falla"      "$(corre diff-falla     $OUTBASE/dest)" no
check "volcado de datos vacio"        "$(corre datos-vacios   $OUTBASE/dest)" no

# Destino dentro de un repo RENOMBRADO (el nombre no delata nada)
mkdir -p $OUTBASE/RepoConOtroNombre/sub/backups
git -C $OUTBASE/RepoConOtroNombre init -q
check "destino en repo renombrado"    "$(corre feliz $OUTBASE/RepoConOtroNombre/sub/backups)" no

# Backup ya existente. La carpeta lleva la hora hasta el segundo, asi que se
# ocupan de antemano los proximos segundos: sea cual sea el que le toque al
# script, ya esta tomado. Sin esto la prueba era una loteria — pasaba solo si el
# script arrancaba dentro del mismo segundo que el fixture.
mkdir -p $OUTBASE/dest2
for offset in 0 1 2 3 4 5; do
  D=$OUTBASE/dest2/antes-migracion-148-$(date -d "+$offset seconds" +%Y%m%d-%H%M%S 2>/dev/null || date -v+${offset}S +%Y%m%d-%H%M%S)
  mkdir -p "$D"; echo "backup viejo, no tocar" > "$D/data.sql"
done
check "backup ya existente"           "$(corre feliz $OUTBASE/dest2)" no
afirma "no sobrescribio el data.sql del backup viejo" \
  $(grep -lq "backup viejo, no tocar" $OUTBASE/dest2/*/data.sql >/dev/null 2>&1; ls $OUTBASE/dest2/*/data.sql | while read f; do grep -q "backup viejo" "$f" || echo MAL; done | grep -c MAL | grep -q '^0$' && echo 0 || echo 1)

echo ""
echo "== Sintaxis compatible con Windows PowerShell 5.1 =="
# No hay PSScriptAnalyzer disponible (PowerShell Gallery bloqueada), asi que se
# hace un lint mecanico de las construcciones EXCLUSIVAS de PowerShell 7 que
# reventarian en 5.1 con un error de sintaxis. No sustituye a un analizador
# completo: cubre lo que se puede comprobar sin el.
PS7ONLY=$(grep -nE '\?\?|\$PSStyle|ForEach-Object +-Parallel|Join-String|Get-Error|[^|]\|\| |[^&]&& ' "$SCRIPT" | grep -v '^\s*[0-9]*:\s*#' | wc -l)
afirma "sin operadores exclusivos de PowerShell 7 (?? \$PSStyle -Parallel && ||)" $([ "$PS7ONLY" = "0" ] && echo 0 || echo 1)
grep -q '#Requires -Version 5.1' "$SCRIPT"; afirma "declara #Requires -Version 5.1" $?
# El .ps1 DEBE llevar BOM: sin el, Windows PowerShell 5.1 lo lee como ANSI y los
# acentos salen corruptos ("VerificaciAn", "tamaAo"). Los .sql generados, en
# cambio, NO deben llevarlo.
head -c 3 "$SCRIPT" | od -An -tx1 | tr -d ' \n' | grep -q '^efbbbf$'
afirma "el .ps1 lleva BOM (si no, PowerShell 5.1 corrompe los acentos)" $?
grep -q 'UTF8Encoding($false)' "$SCRIPT"
afirma "Escribir-Texto sigue generando los .sql SIN BOM" $?
grep -q 'PSVersionTable.PSVersion.Major -lt 5' "$SCRIPT"; afirma "comprueba la version al arrancar" $?
grep -q 'Set-Content' <(grep -v '^#' "$SCRIPT" | grep -v 'Escribe UTF-8'); afirma "no usa Set-Content -Encoding UTF8 (mete BOM en 5.1)" $([ $? = 1 ] && echo 0 || echo 1)

echo ""
echo "RESULTADO: $ok correctas, $mal incorrectas"
rm -rf "$BASE"
[ $mal -eq 0 ] || exit 1
