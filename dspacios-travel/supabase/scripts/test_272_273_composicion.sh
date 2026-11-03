#!/bin/sh
# Migraciones 272 y 273 (composición interna del precio) contra PostgreSQL local DESECHABLE: aplicar, postcheck, publicadores monolítico y por lotes, medición, rollback y reaplicar.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_272_273_composicion.sh <base_nueva> [contenedor] [plantilla]
#   plantilla = base con 001-271 (preparar_esquema_local.sh <contenedor> 271 plantilla273). La base nueva ^t273_[a-z0-9_]{1,40}$ se crea desde ella y se borra al final.
set -eu
DB="${1:-}"; CT="${2:-pg273}"; PLANTILLA="${3:-plantilla273}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t273_[a-z0-9_]{1,40}$' || { echo "Base inválida (^t273_[a-z0-9_]{1,40}\$)." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
M272="$APP/supabase/migrations/20260601000272_cotizacion_composicion.sql"; M273="$APP/supabase/migrations/20260601000273_tarifario_resultado_composicion.sql"
R272="$AQUI/rollback_272_cotizacion_composicion.sql"; R273="$AQUI/rollback_273_tarifario_resultado_composicion.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
FALLAS=0
ok() { echo "  OK    $1"; }; fallo() { echo "  FALLA $1"; FALLAS=$((FALLAS + 1)); }
limpiar() { st=$?; [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; exit $st; }
trap limpiar EXIT INT TERM
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
$PS -d "$DB" < "$AQUI/test_259_semilla.sql" >/dev/null 2>&1 || { echo "La semilla falló."; exit 2; }
existe() { $PS -d "$DB" -c "select count(*) from pg_class where relname = '$1' and relnamespace = 'public'::regnamespace"; }

echo "== estado previo (271): las tablas no existen"
[ "$(existe cotizacion_composicion)" = 0 ] && [ "$(existe tarifario_resultado_composicion)" = 0 ] && ok "ninguna de las dos existe" || fallo "ya existían"
HUELLA="select md5(string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname)) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m') and c.relname not in ('cotizacion_composicion','tarifario_resultado_composicion','bench_payload','t_res','t_l260')"
H0="$($PS -d "$DB" -c "$HUELLA")"

echo "== aplicar 272 y 273 (cada una en UNA transacción, como la CLI)"
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -1 -v ON_ERROR_STOP=1 -d "$DB" < "$M272" >/dev/null 2>&1 && ok "272 aplicada" || fallo "272 falló"
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -1 -v ON_ERROR_STOP=1 -d "$DB" < "$M273" >/dev/null 2>&1 && ok "273 aplicada" || fallo "273 falló"
$PS -d "$DB" < "$M272" >/dev/null 2>&1 && fallo "reaplicar la 272 debía NEGARSE" || ok "reaplicar la 272 se niega (no pisa)"
$PS -d "$DB" < "$M273" >/dev/null 2>&1 && fallo "reaplicar la 273 debía NEGARSE" || ok "reaplicar la 273 se niega (no pisa)"
[ "$($PS -d "$DB" -c "$HUELLA")" = "$H0" ] && ok "el resto del esquema público quedó idéntico (huella de tablas y vistas)" || fallo "el esquema público cambió fuera de las dos tablas"

echo "== pruebas SQL (seguridad, publicador monolítico, por lotes, medición, cascada)"
LISTA="$(sed '/^-- ── Mundo/,$d' "$AQUI/test_260_cola.sql"; cat "$AQUI/test_272_273_composicion.sql")"
SAL="$(printf '%s\n' "$LISTA" | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -d "$DB" -v ON_ERROR_STOP=1 2>&1 || true)"
printf '%s\n' "$SAL" | grep -E "OK |FALLA|RESUMEN|ERROR" | sed 's/^psql:[^ ]* //'
printf '%s\n' "$SAL" | grep -q "RESUMEN: todo OK" && ok "pruebas SQL: todo OK" || fallo "pruebas SQL con FALLA o error"

echo "== rollback 273 → 272 (solo borra composición)"
V0="$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 73")"
$PS -d "$DB" < "$R273" >/dev/null 2>&1 && ok "rollback 273 ejecutado" || fallo "rollback 273 falló"
$PS -d "$DB" < "$R272" >/dev/null 2>&1 && ok "rollback 272 ejecutado" || fallo "rollback 272 falló"
[ "$(existe cotizacion_composicion)" = 0 ] && [ "$(existe tarifario_resultado_composicion)" = 0 ] && ok "las tablas ya no existen" || fallo "quedaron tablas"
[ "$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 73")" = "$V0" ] && ok "el tarifario publicado quedó intacto ($V0 filas visibles)" || fallo "el rollback alteró el tarifario"
[ "$($PS -d "$DB" -c "$HUELLA")" = "$H0" ] && ok "el esquema vuelve a la huella previa" || fallo "la huella no volvió"
$PS -d "$DB" < "$R273" >/dev/null 2>&1 && ok "el rollback es idempotente (if exists)" || fallo "el rollback repetido falló"

echo "== publicar SIN las tablas (la venta y el tarifario no dependen de ellas)"
O="$(printf '%s\n' "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); do \$\$ declare g bigint; r bigint; ok boolean; begin select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73); ok := public.publicar_tarifario_resultado(73, g, r, 'COP', public.bench_filas(3000, 73)); raise notice 'PUB %', ok; end \$\$;" | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -d "$DB" 2>&1 || true)"
printf '%s' "$O" | grep -q "PUB t" && ok "publica 3.000 filas sin las tablas de composición" || fallo "no publicó sin las tablas: $O"

echo "== reaplicar tras el rollback"
$PS -d "$DB" < "$M272" >/dev/null 2>&1 && $PS -d "$DB" < "$M273" >/dev/null 2>&1 && ok "272 y 273 se reaplican limpias" || fallo "no se reaplicaron"

echo
[ "$FALLAS" = 0 ] && echo "RESULTADO: todo OK" || { echo "RESULTADO: $FALLAS FALLAS"; exit 1; }
