#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# 233 · FASES (solo bases desechables): fixture previa → preflight → aplicar → postcheck → batería → no re-aplicar → rollback → reaplicar.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_233_fases.sh <contenedor> <plantilla>
#   <plantilla> = base creada por preparar_esquema_local.sh <contenedor> 232 <plantilla> (esquema 001-232).
# Cierre esperado: "TEST 233 FASES: TODO OK". Cada fase imprime OK/FALLO y la corrida se detiene en el primer FALLO.
# ──────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:-}"; PLANTILLA="${2:-}"
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_233_fases.sh <contenedor> <plantilla>" >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^plantilla[a-z0-9_]*$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
BD="t233fases"
psqlc() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; shift; [ $# -gt 0 ] && echo "$@" | head -40; exit 1; }

# F0 · base desechable desde la plantilla
psqlc -d template1 -c "drop database if exists $BD" >/dev/null 2>&1
for i in 1 2 3 4 5 6; do
  psqlc -d template1 -t -A -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
  psqlc -d template1 -c "create database $BD template $PLANTILLA" >/dev/null 2>&1 && break; sleep 1
done
psqlc -d "$BD" -t -A -c "select 1" >/dev/null 2>&1 || fallo "F0 no se pudo crear la base desde la plantilla"
ok "F0 base $BD creada desde $PLANTILLA"

# F1 · fixture previa (commit)
out="$(psqlc -d "$BD" < "$AQUI/test_233_fixture_previa.sql" 2>&1)" || fallo "F1 fixture previa" "$out"
ok "F1 fixture previa (6 paquetes con tarifario publicado por el publicador vigente)"

PRE="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_233_moneda_publicacion.sql" 2>&1)" || fallo "F2 el preflight no se ejecutó" "$PRE"
echo "$PRE" | grep -q '^migracion_233_estructura|pendiente|aplicada|REVISAR$' || fallo "F2.1 el preflight debe marcar la estructura como pendiente" "$PRE"
ok "F2.1 preflight antes de la 233: estructura 'pendiente'"
echo "$PRE" | grep -q '^paquetes_publicados_con_fuentes_en_otra_moneda|1|0|REVISAR$' || fallo "F2.2 el preflight debe detectar el paquete publicado en COP con un hotel en USD" "$PRE"
ok "F2.2 el preflight detecta 1 paquete publicado con una fuente en otra moneda (233906)"
echo "$PRE" | grep -q '^paquetes_63_total / con_fuentes_en_usd / sin_ninguna_fuente_en_usd|2 / 0 / 2|dato|INFO$' || fallo "F2.3 conteo de paquetes 63" "$PRE"
ok "F2.3 paquetes en modo 63: 2 (ninguno con fuentes en USD)"
PUB_ANTES="$(echo "$PRE" | grep '^tarifarios_publicables' | cut -d'|' -f2)"
[ -n "$PUB_ANTES" ] || fallo "F2.4 no se pudo leer 'tarifarios_publicables'" "$PRE"
ok "F2.4 tarifarios publicables antes: $PUB_ANTES"
# Se resuelve la decisión del preflight (el paquete con la fuente en otra moneda) antes de aplicar: como haría el dueño.
psqlc -d "$BD" -c "delete from public.armado_hoteles where paquete_id = 233906" >/dev/null || fallo "F2.5"
PUB_ANTES="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_233_moneda_publicacion.sql" 2>&1 | grep '^tarifarios_publicables' | cut -d'|' -f2)"
ok "F2.5 decisión aplicada (233906 sin la fuente discordante); tarifarios publicables: $PUB_ANTES"

# F3 · aplicar la 233
out="$(psqlc -d "$BD" -1 < "$APP/supabase/migrations/20260601000233_moneda_publicacion_trm_condicional.sql" 2>&1)" || fallo "F3.1 la 233 no aplicó" "$out"
ok "F3.1 la 233 aplicó en una transacción"

POST="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_233_moneda_publicacion.sql" 2>&1)" || fallo "F3.2 el postcheck no se ejecutó" "$POST"
echo "$POST" | grep -q '|REVISAR$' && fallo "F3.2 el postcheck tiene controles REVISAR" "$POST"
echo "$POST" | grep -q '^migracion_233_estructura|aplicada|aplicada|OK$' || fallo "F3.3 estructura aplicada" "$POST"
ok "F3.2 postcheck integral: 0 REVISAR, estructura aplicada"
PUB_DESPUES="$(echo "$POST" | grep '^tarifarios_publicables' | cut -d'|' -f2)"
[ "$PUB_ANTES" = "$PUB_DESPUES" ] || fallo "F3.4 la 233 cambió los tarifarios publicables ($PUB_ANTES -> $PUB_DESPUES)" "$POST"
ok "F3.4 los tarifarios publicables no cambiaron ($PUB_ANTES -> $PUB_DESPUES): el backfill no invalida"
bf="$(psqlc -d "$BD" -t -A -F '|' -c "select id, moneda_publicacion from public.armado_paquetes where id between 233901 and 233906 order by id" 2>&1)"
[ "$bf" = "$(printf '233901|USD\n233902|COP\n233903|\n233904|COP\n233905|COP\n233906|COP')" ] || fallo "F3.5 backfill inesperado" "$bf"
ok "F3.5 backfill: USD / COP / (sin elegir) / COP / COP / COP, solo desde hechos registrados"

# F4 · batería SQL
out="$(psqlc -d "$BD" < "$AQUI/test_233_moneda_publicacion.sql" 2>&1)" || { echo "$out" | grep -E 'FALLO|ERROR' | head -20; fallo "F4 batería SQL" "$(echo "$out" | tail -15)"; }
echo "$out" | grep -q 'FALLO' && fallo "F4 la batería tiene FALLO" "$(echo "$out" | grep FALLO)"
echo "$out" | grep -q 'TEST 233 SQL: TODO OK' || fallo "F4 sin el cierre 'TEST 233 SQL: TODO OK'" "$(echo "$out" | tail -10)"
ok "F4 batería: $(echo "$out" | grep -o 'TEST 233 SQL: TODO OK ([0-9]* afirmaciones)')"

# F5 · no re-aplicar
out="$(psqlc -d "$BD" -1 < "$APP/supabase/migrations/20260601000233_moneda_publicacion_trm_condicional.sql" 2>&1)" && fallo "F5 la 233 se re-aplicó" "$out"
echo "$out" | grep -q '233 ya aplicada' || fallo "F5 mensaje de no re-aplicar" "$out"
ok "F5 la 233 se niega a re-aplicarse"

# F6 · rollback: se niega con datos que el esquema anterior no admite
psqlc -d "$BD" -c "update public.armado_paquetes set trm_oferta = null where id = 233904" >/dev/null || fallo "F6.0"
out="$(psqlc -d "$BD" -1 < "$AQUI/rollback_233_moneda_publicacion.sql" 2>&1)" && fallo "F6.1 el rollback se ejecutó con un paquete 63 sin TRM" "$out"
echo "$out" | grep -q 'ROLLBACK 233 ABORTADO' || fallo "F6.1 mensaje de aborto" "$out"
ok "F6.1 el rollback se niega con un paquete en modo 63 sin TRM"
psqlc -d "$BD" -c "update public.armado_paquetes set trm_oferta = 4000 where id = 233904" >/dev/null || fallo "F6.2"
out="$(psqlc -d "$BD" -1 < "$AQUI/rollback_233_moneda_publicacion.sql" 2>&1)" || fallo "F6.3 el rollback falló" "$out"
ok "F6.3 el rollback ejecutó"
n="$(psqlc -d "$BD" -t -A -c "select (select count(*) from information_schema.columns where table_name='armado_paquetes' and column_name='moneda_publicacion') + (select count(*) from pg_proc where proname='p63_requiere_trm')")"
[ "$n" = "0" ] || fallo "F6.4 el rollback dejó objetos de la 233" "$n"
ok "F6.4 sin columna ni función de la 233"
# El texto de las funciones vuelve EXACTAMENTE al de la 227/230 (sin contar los CR del checkout CRLF): se compara contra una base desde la plantilla (sin 233).
psqlc -d template1 -c "drop database if exists ${BD}_ref" >/dev/null 2>&1
psqlc -d template1 -t -A -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
psqlc -d template1 -c "create database ${BD}_ref template $PLANTILLA" >/dev/null || fallo "F6.5 base de referencia"
SQLH="select md5(string_agg(replace(pg_get_functiondef(p.oid), chr(13), ''), '' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('publicar_tarifario_resultado_63','crear_cotizacion_oferta_63','aceptar_oferta_63','p63_registrar_financiero')"
H_REF="$(psqlc -d "${BD}_ref" -t -A -c "$SQLH")"
H_RB="$(psqlc -d "$BD" -t -A -c "$SQLH")"
[ -n "$H_REF" ] && [ "$H_REF" = "$H_RB" ] || fallo "F6.5 las funciones restauradas no son idénticas a las de la 227/230" "ref=$H_REF rollback=$H_RB"
ok "F6.5 las 4 funciones restauradas son idénticas (md5) a las de la 227/230"
psqlc -d template1 -c "drop database if exists ${BD}_ref" >/dev/null 2>&1

# F7 · reaplicar tras el rollback
out="$(psqlc -d "$BD" -1 < "$APP/supabase/migrations/20260601000233_moneda_publicacion_trm_condicional.sql" 2>&1)" || fallo "F7.1 la 233 no reaplicó" "$out"
POST2="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_233_moneda_publicacion.sql" 2>&1)"
echo "$POST2" | grep -q '|REVISAR$' && fallo "F7.2 el postcheck tras reaplicar tiene REVISAR" "$POST2"
ok "F7 reaplicada tras el rollback; postcheck 0 REVISAR"

psqlc -d template1 -c "drop database if exists $BD" >/dev/null 2>&1
echo "TEST 233 FASES: TODO OK"
