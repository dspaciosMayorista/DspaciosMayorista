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
# Cómo funciona: pone en el PATH un `docker` y un `supabase` FALSOS que se
# comportan según el escenario, y sustituye `Read-Host` desde un envoltorio
# (no se puede escribir en un prompt oculto desde una prueba). El script real
# no se modifica ni se parametriza para la prueba.
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
ok=0; mal=0

# Envoltorio: sustituye Read-Host (no se puede escribir en un prompt oculto
# desde una prueba) y llama al script real, sin modificarlo.
cat > $BASE/wrap.ps1 <<'EOF'
param([string]$Script, [string]$Destino, [string]$Uri, [string]$Pass)
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
[ "\$1" = "--version" ] && { echo "2.0.0-fake"; exit 0; }
if [ "\$1" = "db" ] && [ "\$2" = "dump" ]; then
  f=""; for ((i=1;i<=\$#;i++)); do [ "\${!i}" = "-f" ] && { j=\$((i+1)); f="\${!j}"; }; done
  if [[ "\$*" == *"--role-only"* ]]; then
    printf 'CREATE ROLE anon;\nALTER ROLE anon SET x=1;\n%.0s' {1..20} > "\$f"
  elif [[ "\$*" == *"--data-only"* ]]; then
    if [ "\$ESC" = "datos-vacios" ]; then
      { echo "COPY public.ventas (numero_contrato) FROM stdin;"; echo '\\.'; } > "\$f"
      head -c 2000 /dev/zero | tr '\0' '-' >> "\$f"
    else
      { echo "COPY public.ventas (numero_contrato) FROM stdin;"
        for n in 1 2 3; do echo "00-000\$n"; done
        echo '\\.'; } > "\$f"
      head -c 2000 /dev/zero | tr '\0' '-' >> "\$f"
    fi
  else
    { echo "CREATE TABLE public.ventas (numero_contrato text);"
      echo "CREATE TABLE public.abonos (id bigint);"
      echo "CREATE VIEW public.ventas_basica AS SELECT 1;"; } > "\$f"
    head -c 60000 /dev/zero | tr '\0' '-' >> "\$f"
  fi
  exit 0
fi
if [ "\$1" = "link" ]; then [ "\$ESC" = "link-falla" ] && exit 7; exit 0; fi
if [ "\$1" = "db" ] && [ "\$2" = "diff" ]; then
  [ "\$ESC" = "diff-falla" ] && exit 9
  echo "-- sin cambios"; exit 0
fi
exit 0
EOF
  chmod +x $FAKE/docker $FAKE/supabase
}

corre() { # $1=escenario  $2=destino  -> imprime "codigo|tieneVerificado"
  prep "$1"
  out=$(PATH="$FAKE:$PATH" TEST_URI="postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
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

echo "== Caso base (todo bien): debe pasar =="
check "camino feliz" "$(corre feliz $OUTBASE/dest)" si

echo ""
echo "== Casos negativos: todos deben fallar =="
check "Docker apagado"                "$(corre docker-apagado $OUTBASE/dest)" no
check "'supabase link' falla"         "$(corre link-falla     $OUTBASE/dest)" no
check "'supabase db diff' falla"      "$(corre diff-falla     $OUTBASE/dest)" no
check "volcado de datos vacio"        "$(corre datos-vacios   $OUTBASE/dest)" no

# Destino dentro de un repo RENOMBRADO (el nombre no delata nada)
mkdir -p $OUTBASE/RepoConOtroNombre/sub/backups
git -C $OUTBASE/RepoConOtroNombre init -q
[ -d $OUTBASE/RepoConOtroNombre/.git ] && echo "  (fixture: .git creado)" || echo "  (fixture: FALLO git init)"
check "destino en repo renombrado"    "$(corre feliz $OUTBASE/RepoConOtroNombre/sub/backups)" no

# Backup ya existente
STAMPDIR=$OUTBASE/dest2/antes-migracion-148-$(date +%Y%m%d-%H%M%S)
mkdir -p $STAMPDIR; echo "viejo" > $STAMPDIR/data.sql
echo "  (fixture: backup previo en $(basename $STAMPDIR))"
check "backup ya existente"           "$(corre feliz $OUTBASE/dest2)" no

echo ""
echo "RESULTADO: $ok correctas, $mal incorrectas"
[ $mal -eq 0 ] || exit 1
