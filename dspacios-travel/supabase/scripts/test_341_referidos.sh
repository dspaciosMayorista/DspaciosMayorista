#!/bin/sh
# Lanza las pruebas SQL de #76 (referidos, migración 341) y #78 (avisos, migración 340) sobre una base DESECHABLE creada desde una plantilla con la cadena hasta la 326.
# `psql` corre dentro del contenedor y no ve archivos del host, así que las fixtures de test_216 se unen al script por entrada estándar.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_341_referidos.sh <contenedor_pg> <plantilla> [341|340]      NUNCA contra una base real.
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; CUAL="${3:-341}"
D=supabase/scripts; M="${MIG_DIR:-supabase/migrations}"
hex() { od -An -N6 -tx1 /dev/urandom | tr -d ' \n'; }
DB="tref_$(hex)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -v ON_ERROR_STOP=1"
limpiar() { st=$?; $PS -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -q -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
MIGS="340_aviso_cotizacion_publica 341_referidos"; [ "$CUAL" = 342 ] && MIGS="$MIGS 342_registro_b2b_codigo_referido"
for m in $MIGS; do $PS -q -d "$DB" -1 -f - < "$M/20260601000$m.sql" >/dev/null 2>"/tmp/tref.$$.err" || { cat "/tmp/tref.$$.err" >&2; echo "FALLÓ la migración $m" >&2; exit 1; }; done
rm -f "/tmp/tref.$$.err"
case "$CUAL" in 341) NOM=referidos;; 342) NOM=registro_codigo_referido;; *) NOM=aviso_cotizacion_publica;; esac
SQL="$D/test_${CUAL}_$NOM.sql"
N="$(grep -n 'ir test_216_fixtures.sql' "$SQL" | head -1 | cut -d: -f1)"
{ head -n $((N - 1)) "$SQL"; cat "$D/test_216_fixtures.sql"; tail -n +$((N + 1)) "$SQL"; } > "/tmp/tref.$$.sql"
RC=0
$PS -d "$DB" -f - < "/tmp/tref.$$.sql" > "/tmp/tref.$$.out" 2>&1 || RC=$?
grep -E "NOTICE:  (OK|FALLO)|ERROR|DETAIL|CONTEXT|QUERY|aciertos|^ +[0-9]+ \| +[0-9]+ \| +[0-9]+" "/tmp/tref.$$.out" 
rm -f "/tmp/tref.$$.sql" "/tmp/tref.$$.out"
exit "$RC"
