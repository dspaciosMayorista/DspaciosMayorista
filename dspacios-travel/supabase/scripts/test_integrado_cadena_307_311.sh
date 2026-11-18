#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SECUENCIA COMBINADA del lote integrado (#53, #1, #106, #125 y O3) sobre UNA base local DESECHABLE con datos sintéticos:
#   plantilla (303–306 se aplican aquí) → [preflight → migración → postcheck] de 307, 308, 309, 310 y 311, en ese orden numérico.
# Cada preflight/postcheck del dueño es UNA sola consulta de solo lectura (control · observado · esperado · veredicto); este script los ejecuta tal cual,
# imprime todas las filas y FALLA si alguna fila no termina en OK. Además comprueba que 308/309/310/311 no alteran los datos creados antes (huella de tablas clave).
# Uso (desde dspacios-travel/):  MSYS_NO_PATHCONV=1 sh supabase/scripts/test_integrado_cadena_307_311.sh [contenedor_pg=pg304] [plantilla=plantilla304]
# NUNCA contra una base real: crea una base propia y la borra al salir.
# ──────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:-pg304}"; PLANTILLA="${2:-plantilla304}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
DB="tpgchain_$(hex 6)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F | -v ON_ERROR_STOP=1"
limpiar() { st=$?; $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for n in 303 304 305 306; do $PS -d "$DB" < "$(ls supabase/migrations/20260601000${n}_*.sql)" >/dev/null || { echo "No se pudo aplicar $n"; exit 2; }; done
echo "base $DB lista con 303–306"
# Usuario sintético: el preflight de la 309 exige al menos un superadmin activo (en Producción ya existe; en una base vacía hay que crearlo).
$PS -d "$DB" -c "insert into auth.users(id,email) values ('cccccccc-9999-4999-8999-999999999991','su-cadena-integrado@t.l') on conflict do nothing; insert into public.usuarios(id,email,nombre,rol,activo,tenant) values ('cccccccc-9999-4999-8999-999999999991','su-cadena-integrado@t.l','Super cadena','superadmin',true,'mayorista') on conflict (id) do update set rol='superadmin', activo=true, tenant='mayorista'" >/dev/null
FALLAS=0
revisar() { # $1 etiqueta, $2 archivo de solo lectura
  SAL="$($PS -d "$DB" < "$2")" || { echo "ERROR ejecutando $2"; FALLAS=$((FALLAS+1)); return; }
  N=$(printf '%s\n' "$SAL" | grep -c .); MAL=$(printf '%s\n' "$SAL" | grep -Ev '\|(OK|INFO|LISTA PARA [0-9]+|[0-9]+ CORRECTA|[0-9]+ CORRECTO)$' | grep -c . || true)
  printf '%s\n' "$SAL" | sed "s/^/    /"
  if [ "$MAL" -gt 0 ]; then echo "  >>> $1: $MAL de $N controles NO están en OK"; FALLAS=$((FALLAS+1)); else echo "  $1: $N/$N controles OK"; fi
}
huella() { $PS -d "$DB" -c "select md5(coalesce((select string_agg(numero_contrato||estado||coalesce(precio_venta::text,''), ',' order by numero_contrato) from public.ventas),'')) || '/' || (select count(*) from public.hoteles) || '/' || (select count(*) from public.hotel_temporadas)"; }
for entrada in "307:minimo_vencimiento_voucher" "308:personas_cotizacion_fuentes" "309:gestion_contratos" "310:promocion_sigue_base" "311:hoteles_edades"; do
  n="${entrada%%:*}"; nombre="${entrada#*:}"
  echo "=== $n · preflight"; revisar "preflight $n" "supabase/scripts/preflight_${n}_${nombre}.sql"
  H0="$(huella)"
  echo "=== $n · aplicar"; $PS -d "$DB" < "$(ls supabase/migrations/20260601000${n}_*.sql)" >/dev/null || { echo "FALLÓ la migración $n"; FALLAS=$((FALLAS+1)); break; }
  echo "=== $n · postcheck"; revisar "postcheck $n" "supabase/scripts/postcheck_${n}_${nombre}.sql"
  [ "$(huella)" = "$H0" ] && echo "  $n no alteró los datos existentes (huella igual)" || { echo "  >>> $n ALTERÓ datos existentes"; FALLAS=$((FALLAS+1)); }
done
echo "=== resumen"; [ "$FALLAS" -eq 0 ] && echo "SECUENCIA 307 → 308 → 309 → 310 → 311: TODO OK" || echo "SECUENCIA CON $FALLAS ETAPA(S) EN FALLA"
exit "$FALLAS"
