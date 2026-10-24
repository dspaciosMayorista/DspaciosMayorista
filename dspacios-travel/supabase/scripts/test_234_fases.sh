#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# 234 · FASES (solo bases desechables): fixture previa → preflight → aplicar → postcheck → batería → no re-aplicar → rollback → reaplicar.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_234_fases.sh <contenedor> <plantilla>
#   <plantilla> = base con el esquema 001-233 (preparar_esquema_local.sh <contenedor> 233 <plantilla>).
# Cierre esperado: "TEST 234 FASES: TODO OK". Cada fase imprime OK/FALLO y la corrida se detiene en el primer FALLO.
# ──────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:-}"; PLANTILLA="${2:-}"
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_234_fases.sh <contenedor> <plantilla>" >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^plantilla[a-z0-9_]*$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
BD="t234fases"
MIG="$APP/supabase/migrations/20260601000234_oferta_usd_trm.sql"
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
test -f "$MIG" || fallo "F0.1 falta la migración 234"

# F1 · fixture previa (commit)
out="$(psqlc -d "$BD" < "$AQUI/test_234_fixture_previa.sql" 2>&1)" || fallo "F1 fixture previa" "$out"
ok "F1 fixture previa (4 paquetes 63/legacy con tarifario publicado y una oferta COP abierta)"

# F2 · preflight antes de la 234
PRE="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_234_oferta_usd.sql" 2>&1)" || fallo "F2 el preflight no se ejecutó" "$PRE"
echo "$PRE" | grep -q '^migracion_234_estructura|pendiente|aplicada|REVISAR$' || fallo "F2.1 el preflight debe marcar la estructura como pendiente" "$PRE"
ok "F2.1 preflight antes de la 234: estructura 'pendiente'"
echo "$PRE" | grep -q '^ofertas_63_abiertas_cotizadas_en_otra_moneda_que_la_del_paquete|0|0|OK$' || fallo "F2.2 ofertas desfasadas" "$PRE"
echo "$PRE" | grep -q '^paquetes_63_total / en_cop / en_usd / sin_moneda_elegida (NULL = COP)|3 / 2 / 0 / 1|' || fallo "F2.3 conteo de paquetes 63" "$PRE"
ok "F2.2 preflight: 0 ofertas desfasadas; 3 paquetes 63 (2 COP, 0 USD, 1 sin moneda)"
PUB_ANTES="$(echo "$PRE" | grep '^tarifarios_publicables' | cut -d'|' -f2)"
[ -n "$PUB_ANTES" ] && [ "$PUB_ANTES" != "0" ] || fallo "F2.4 la fixture debe dejar tarifarios publicables" "$PRE"
ok "F2.4 tarifarios publicables antes: $PUB_ANTES"

# F3 · aplicar la 234
out="$(psqlc -d "$BD" < "$MIG" 2>&1)" || fallo "F3.1 la 234 no aplicó" "$out"
ok "F3.1 la 234 aplicó"
POST="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_234_oferta_usd.sql" 2>&1)" || fallo "F3.2 el postcheck no se ejecutó" "$POST"
echo "$POST" | grep -q '|REVISAR$' && fallo "F3.2 el postcheck tiene controles REVISAR" "$POST"
echo "$POST" | grep -q '^migracion_234_estructura|aplicada|aplicada|OK$' || fallo "F3.3 estructura aplicada" "$POST"
ok "F3.2 postcheck integral: 0 REVISAR, estructura aplicada"
PUB_DESPUES="$(echo "$POST" | grep '^tarifarios_publicables' | cut -d'|' -f2)"
[ "$PUB_ANTES" = "$PUB_DESPUES" ] || fallo "F3.4 la 234 cambió los tarifarios publicables ($PUB_ANTES -> $PUB_DESPUES)" "$POST"
ok "F3.4 los tarifarios publicables no cambiaron ($PUB_ANTES -> $PUB_DESPUES): la 234 no invalida nada"
# La oferta COP abierta cotizada ANTES de la 234 se sigue aceptando DESPUÉS (protección: nada de lo anterior se rompe).
acep="$(psqlc -d "$BD" -t -A -c "select public.aceptar_oferta_63(234990, 'mayorista', '00000000-0000-0000-0000-000000234006'::uuid, 'h-previa', 'f-previa')::text" 2>&1)" || fallo "F3.5 aceptar la oferta previa" "$acep"
echo "$acep" | grep -q '"estado": "preparada"' || fallo "F3.5 la oferta COP previa debe poder aceptarse" "$acep"
ok "F3.5 una oferta COP cotizada antes de la 234 se acepta después (snapshot con moneda COP)"
# Los paquetes anteriores no cambian de moneda ni de modo.
est="$(psqlc -d "$BD" -t -A -F '|' -c "select id, modo_oferta, moneda_publicacion, moneda from public.armado_paquetes where id between 234901 and 234904 order by id" 2>&1)"
[ "$est" = "$(printf '234901|cop_trm_63|COP|COP\n234902|cop_trm_63|COP|COP\n234903|legacy|USD|USD\n234904|cop_trm_63||COP')" ] || fallo "F3.6 los paquetes previos cambiaron" "$est"
ok "F3.6 los paquetes previos conservan modo y moneda (sin cambios de datos)"

# F4 · batería SQL
out="$(psqlc -d "$BD" < "$AQUI/test_234_oferta_usd.sql" 2>&1)" || { echo "$out" | grep -E 'FALLO|ERROR' | head -20; fallo "F4 batería SQL" "$(echo "$out" | tail -15)"; }
echo "$out" | grep -q 'FALLO' && fallo "F4 la batería tiene FALLO" "$(echo "$out" | grep FALLO)"
echo "$out" | grep -q 'TEST 234 SQL: TODO OK' || fallo "F4 sin el cierre 'TEST 234 SQL: TODO OK'" "$(echo "$out" | tail -10)"
ok "F4 batería: $(echo "$out" | grep -o 'TEST 234 SQL: TODO OK ([0-9]* afirmaciones)')"

# F5 · no re-aplicar
out="$(psqlc -d "$BD" -1 < "$MIG" 2>&1)" && fallo "F5 la 234 se re-aplicó" "$out"
echo "$out" | grep -q '234 ya aplicada' || fallo "F5 mensaje de no re-aplicar" "$out"
ok "F5 la 234 se niega a re-aplicarse"

# F6 · rollback: se niega con datos que el esquema anterior no admite
psqlc -d "$BD" -c "update public.armado_paquetes set moneda_publicacion = 'USD' where id = 234902" >/dev/null || fallo "F6.0"
out="$(psqlc -d "$BD" -1 < "$AQUI/rollback_234_oferta_usd.sql" 2>&1)" && fallo "F6.1 el rollback se ejecutó con un paquete 63 en USD" "$out"
echo "$out" | grep -q 'ROLLBACK 234 ABORTADO' || fallo "F6.1 mensaje de aborto" "$out"
ok "F6.1 el rollback se niega con un paquete en modo 63 que se publica en USD"
psqlc -d "$BD" -c "update public.armado_paquetes set moneda_publicacion = 'COP' where id = 234902" >/dev/null || fallo "F6.2"
out="$(psqlc -d "$BD" -1 < "$AQUI/rollback_234_oferta_usd.sql" 2>&1)" || fallo "F6.6 el rollback falló" "$out"
ok "F6.6 el rollback ejecutó"
n="$(psqlc -d "$BD" -t -A -c "select count(*) from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_moneda_chk'")"
[ "$n" = "1" ] || fallo "F6.7 el rollback no restauró el CHECK" "$n"
ok "F6.7 el CHECK que ata el modo 63 a COP quedó restaurado"
# El texto de las funciones vuelve EXACTAMENTE al de la 233 (sin contar los CR del checkout CRLF): se compara contra una base desde la plantilla (con la 233).
psqlc -d template1 -c "drop database if exists ${BD}_ref" >/dev/null 2>&1
psqlc -d template1 -t -A -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
psqlc -d template1 -c "create database ${BD}_ref template $PLANTILLA" >/dev/null || fallo "F6.8 base de referencia"
SQLH="select md5(string_agg(replace(pg_get_functiondef(p.oid), chr(13), ''), '' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('p63_requiere_trm','publicar_tarifario_resultado_63','crear_cotizacion_oferta_63','aceptar_oferta_63','publicar_tarifario_resultado')"
H_REF="$(psqlc -d "${BD}_ref" -t -A -c "$SQLH")"
H_RB="$(psqlc -d "$BD" -t -A -c "$SQLH")"
[ -n "$H_REF" ] && [ "$H_REF" = "$H_RB" ] || fallo "F6.8 las funciones restauradas no son idénticas a las de la 233" "ref=$H_REF rollback=$H_RB"
ok "F6.8 las 5 funciones restauradas son idénticas (md5) a las de la 233"
psqlc -d template1 -c "drop database if exists ${BD}_ref" >/dev/null 2>&1
n="$(psqlc -d "$BD" -t -A -c "select (to_regprocedure('public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)') is null)::text || '/' || has_table_privilege('authenticated', 'public.tarifario_resultado', 'INSERT')::text || '/' || has_table_privilege('anon', 'public.tarifario_resultado', 'DELETE')::text")"
[ "$n" = "true/true/true" ] || fallo "F6.9 el rollback no eliminó la función interna o no repuso los privilegios de la tabla" "$n"
ok "F6.9 el rollback elimina publicar_tarifario_resultado_interno y repone los privilegios de escritura de tarifario_resultado"

# F7 · reaplicar tras el rollback
out="$(psqlc -d "$BD" < "$MIG" 2>&1)" || fallo "F7.1 la 234 no reaplicó" "$out"
POST2="$(psqlc -d "$BD" -t -A -F '|' < "$AQUI/preflight_postcheck_234_oferta_usd.sql" 2>&1)"
echo "$POST2" | grep -q '|REVISAR$' && fallo "F7.2 el postcheck tras reaplicar tiene REVISAR" "$POST2"
ok "F7 reaplicada tras el rollback; postcheck 0 REVISAR"

# F8 · el rollback se niega con una oferta #63 cotizada en USD (creada por la RPC real; el snapshot es inmutable y no se retoca)
psqlc -d "$BD" -c "update public.armado_paquetes set moneda_publicacion = 'USD', trm_oferta = 4000 where id = 234902" >/dev/null || fallo "F8.0"
cot="$(psqlc -d "$BD" -t -A -c "select public.crear_cotizacion_oferta_63('00000000-0000-0000-0000-000000234006'::uuid, 'mayorista',
  jsonb_build_object('tenant','mayorista','payload','{}'::jsonb,'detalle','{}'::jsonb,'cliente','C','modulo','dinamico','pax',2,'precio_venta',1200,'moneda','USD','paquete_armado_id',234902),
  jsonb_build_object('v',1,'paquete_id',234902,'salida_id',null,'empaquetado_id',null,'trm',4000,'moneda','USD',
    'cabecera',jsonb_build_object('tipo_paquete','dinamico','moneda','USD','pax',2,'precio_venta',1200,'paquete_armado_id',234902,'n_tramos',0,'n_items',0,'n_hoteles',0,'tipo_asesor','interno','canal','B2C'),
    'b2b',null,'vigencias','[]'::jsonb,'financiero',jsonb_build_object('costos','{}'::jsonb,'cxp','[]'::jsonb)),
  'h-usd','f-usd',
  (select jsonb_build_object('rev_fuente',tarifario_revision_fuente,'rev_publicada',tarifario_revision_publicada,'gen_publicada',tarifario_generacion_publicada,'rev_costos',p63_rev_costos) from public.armado_paquetes where id = 234902))::text" 2>&1)" || fallo "F8.1 no se pudo cotizar la oferta USD" "$cot"
ok "F8.1 oferta #63 cotizada en USD (cotización $cot)"
psqlc -d "$BD" -c "update public.armado_paquetes set moneda_publicacion = 'COP', trm_oferta = null where id = 234902" >/dev/null || fallo "F8.2"
out="$(psqlc -d "$BD" -1 < "$AQUI/rollback_234_oferta_usd.sql" 2>&1)" && fallo "F8.3 el rollback se ejecutó con una oferta en USD" "$out"
echo "$out" | grep -q 'ROLLBACK 234 ABORTADO: hay ofertas #63 cotizadas en USD' || fallo "F8.3 mensaje de aborto (oferta USD)" "$out"
ok "F8.3 el rollback se niega con una oferta #63 cotizada en USD"

psqlc -d template1 -c "drop database if exists $BD" >/dev/null 2>&1
echo "TEST 234 FASES: TODO OK"
