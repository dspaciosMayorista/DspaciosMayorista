#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# 235 · FASES (solo bases desechables): fixture previa → preflight → aplicar → postcheck → batería → no re-aplicar → rollback → reaplicar.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_235_fases.sh <contenedor> <plantilla>
#   <plantilla> = base con el esquema 001-234 (preparar_esquema_local.sh <contenedor> 234 <plantilla>).
# Cierre esperado: "TEST 235 FASES: TODO OK". Cada fase imprime OK/FALLO y la corrida se detiene en el primer FALLO.
# ──────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:-}"; PLANTILLA="${2:-}"
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_235_fases.sh <contenedor> <plantilla>" >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^plantilla[a-z0-9_]*$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
BD="t235fases"; BD2="t235rollback"
MIG="$APP/supabase/migrations/20260601000235_moneda_cobro_contrato.sql"
RB="$AQUI/rollback_235_moneda_cobro.sql"
PF="$AQUI/preflight_postcheck_235_moneda_cobro.sql"
psqlc() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; shift; [ $# -gt 0 ] && echo "$@" | head -40; exit 1; }
crear() { # crear <base>
  psqlc -d template1 -c "drop database if exists $1" >/dev/null 2>&1
  for i in 1 2 3 4 5 6; do
    psqlc -d template1 -t -A -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
    psqlc -d template1 -c "create database $1 template $PLANTILLA" >/dev/null 2>&1 && break; sleep 1
  done
  psqlc -d "$1" -t -A -c "select 1" >/dev/null 2>&1
}

# F0 · base desechable desde la plantilla
crear "$BD" || fallo "F0 no se pudo crear la base desde la plantilla"
ok "F0 base $BD creada desde $PLANTILLA"
test -f "$MIG" && test -f "$RB" && test -f "$PF" || fallo "F0.1 faltan la migración, el rollback o el preflight/postcheck de la 235"

# F1 · fixture previa (la de la 234: 4 paquetes, tarifarios publicados y UNA oferta COP abierta cotizada ANTES de la 235) — commit
out="$(psqlc -d "$BD" < "$AQUI/test_235_fixture_previa.sql" 2>&1)" || fallo "F1 fixture previa" "$out"
ok "F1 fixture previa (paquetes con tarifario publicado y una oferta COP abierta cotizada antes de la 235)"

# F2 · preflight antes de la 235 (UNA consulta)
PRE="$(psqlc -d "$BD" -t -A -F '|' < "$PF" 2>&1)" || fallo "F2 el preflight no se ejecutó" "$PRE"
echo "$PRE" | grep -q '^migracion_235_estructura|pendiente|aplicada|REVISAR$' || fallo "F2.1 el preflight debe marcar la estructura como pendiente" "$PRE"
echo "$PRE" | grep -E '^(contratos_convertidos|contratos_63_cuya|abonos_de_contratos|ids_de_esos)' | grep -q 'REVISAR' && fallo "F2.2 los controles de DATOS no deben tener REVISAR" "$PRE"
[ "$(echo "$PRE" | grep -c '|')" = "24" ] || fallo "F2.3 el preflight debe devolver 24 controles en una sola consulta" "$PRE"
for f in aceptar_oferta_63_rechaza_sin_moneda_de_cobro trigger_trg_p63_aceptacion_cobro_requerido fn_dashboard_cartera_por_moneda_con_moneda f208_priv_importes_factura_rechaza_F4451 trigger_trg_p235_cf_cobro_guarda; do
  echo "$PRE" | grep -q "^${f}[a-zA-Z0-9_]*|false|true|REVISAR$" || fallo "F2.5 antes de la 235 el control '$f…' debe salir pendiente (false|true|REVISAR)" "$PRE"
done
HUELLA_ANTES="$(echo "$PRE" | grep '^huella_de_datos' | cut -d'|' -f2)"
PUB_ANTES="$(echo "$PRE" | grep '^tarifarios_publicables' | cut -d'|' -f2)"
[ -n "$HUELLA_ANTES" ] && [ -n "$PUB_ANTES" ] && [ "$PUB_ANTES" != "0" ] || fallo "F2.4 la fixture debe dejar huella y tarifarios publicables" "$PRE"
ok "F2 preflight antes de la 235: estructura 'pendiente' (incluidas las 5 guardas nuevas, pendientes), 24 controles, 0 REVISAR de datos, $PUB_ANTES tarifarios publicables"

# F3 · aplicar la 235
out="$(psqlc -d "$BD" < "$MIG" 2>&1)" || fallo "F3.1 la 235 no aplicó" "$out"
ok "F3.1 la 235 aplicó"
POST="$(psqlc -d "$BD" -t -A -F '|' < "$PF" 2>&1)" || fallo "F3.2 el postcheck no se ejecutó" "$POST"
echo "$POST" | grep -q '|REVISAR$' && fallo "F3.2 el postcheck tiene controles REVISAR" "$POST"
echo "$POST" | grep -q '^migracion_235_estructura|aplicada|aplicada|OK$' || fallo "F3.3 estructura aplicada" "$POST"
ok "F3.2 postcheck integral: 0 REVISAR, estructura aplicada"
[ "$(echo "$POST" | grep '^huella_de_datos' | cut -d'|' -f2)" = "$HUELLA_ANTES" ] || fallo "F3.4 la 235 alteró ofertas, cotizaciones o el tarifario publicado" "$POST"
[ "$(echo "$POST" | grep '^tarifarios_publicables' | cut -d'|' -f2)" = "$PUB_ANTES" ] || fallo "F3.4 cambió el conteo de tarifarios publicables" "$POST"
[ "$(echo "$POST" | grep '^ofertas_63 / cotizaciones' | cut -d'|' -f2)" = "$(echo "$PRE" | grep '^ofertas_63 / cotizaciones' | cut -d'|' -f2)" ] || fallo "F3.4 cambió el conteo de ofertas, cotizaciones o filas del tarifario"
ok "F3.4 la 235 no altera ofertas, cotizaciones ni el tarifario publicado (huella md5 idéntica; $PUB_ANTES tarifarios publicables intactos)"

# F3.5 · la oferta cotizada ANTES de la 235 se acepta DESPUÉS eligiendo una moneda de cobro expresa (COP 3.360.000 cobrado en USD a 4000 = 840)
acep="$(psqlc -d "$BD" -t -A -c "select public.aceptar_oferta_63(234990, 'mayorista', '00000000-0000-0000-0000-000000234006'::uuid, 'h-previa', 'f-previa', null, 'USD', 4000)::text" 2>&1)" || fallo "F3.5 aceptar la oferta previa con cobro" "$acep"
echo "$acep" | grep -q '"estado": "preparada"' || fallo "F3.5 la oferta previa debe poder aceptarse" "$acep"
echo "$acep" | grep -q '"total": 840' || fallo "F3.5 el total de cobro congelado debe ser 840" "$acep"
ok "F3.5 una oferta COP cotizada antes de la 235 se acepta con cobro en USD: total 840 congelado a TRM 4000 (el snapshot conserva COP)"
mon="$(psqlc -d "$BD" -t -A -c "select snapshot ->> 'moneda' || '/' || moneda_cobro || '/' || trm_cobro || '/' || total_cobro from public.p63_aceptacion where cotizacion_id = 234990")"
[ "$mon" = "COP/USD/4000.0000/840.00" ] || fallo "F3.6 la aceptación debe conservar COP y congelar el cobro USD" "$mon"
# Un reintento con OTRA elección no cambia lo congelado.
out="$(psqlc -d "$BD" -t -A -c "select public.aceptar_oferta_63(234990, 'mayorista', '00000000-0000-0000-0000-000000234006'::uuid, 'h-previa', 'f-previa', null, 'USD', 4300)::text" 2>&1)" && fallo "F3.7 el reintento con otra TRM de cobro se aceptó" "$out"
echo "$out" | grep -q 'p63_cobro_cambio' || fallo "F3.7 se esperaba p63_cobro_cambio" "$out"
ok "F3.6 el snapshot conserva COP y la aceptación congela USD/4000/840; F3.7 un reintento con otra TRM de cobro se rechaza (p63_cobro_cambio)"

# F4 · batería SQL (otra base de la misma plantilla ya con la 235: la anterior ya tiene una aceptación convertida committed)
crear "$BD2" || fallo "F4.0 base para la batería"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F4.0 la 235 no aplicó en la base de la batería"
out="$(psqlc -d "$BD2" < "$AQUI/test_235_moneda_cobro.sql" 2>&1)" || { echo "$out" | grep -E 'FALLO|ERROR' | head -20; fallo "F4 batería SQL" "$(echo "$out" | tail -15)"; }
echo "$out" | grep -q 'FALLO' && fallo "F4 la batería tiene FALLO" "$(echo "$out" | grep FALLO)"
echo "$out" | grep -q 'TEST 235 SQL: TODO OK' || fallo "F4 sin el cierre 'TEST 235 SQL: TODO OK'" "$(echo "$out" | tail -10)"
ok "F4 batería: $(echo "$out" | grep -o 'TEST 235 SQL: TODO OK ([0-9]* afirmaciones)')"

# F5 · no re-aplicar
out="$(psqlc -d "$BD" -1 < "$MIG" 2>&1)" && fallo "F5 la 235 se re-aplicó" "$out"
echo "$out" | grep -q '235 ya aplicada' || fallo "F5 mensaje de no re-aplicar" "$out"
ok "F5 la 235 se niega a re-aplicarse"

# F6 · el postcheck detecta lo incoherente (transacción revertida): total que no sale de la fórmula y un abono con TRM equivocada
NEGSQL="$(mktemp)"
{
  echo "begin;"
  echo "insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro) values ('DTM-9990', 'mayorista', 'x', 'dinamico', 'USD', 1200, 'COP', 4100, 1);"
  echo "insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono) values ('DTM-9990', 'mayorista', 100, 500000, 4100, current_date);"
  cat "$PF"
  echo "rollback;"
} > "$NEGSQL"
NEG="$(psqlc -d "$BD" -t -A -F '|' < "$NEGSQL" 2>&1)" || { rm -f "$NEGSQL"; fallo "F6.0 postcheck en el escenario incoherente" "$NEG"; }
rm -f "$NEGSQL"
echo "$NEG" | grep -q '^contratos_convertidos_con_total_o_TRM_incoherente_con_la_fórmula|1|0|REVISAR$' || fallo "F6.1 un total que no sale de la fórmula debe ser REVISAR" "$NEG"
echo "$NEG" | grep -q '^abonos_de_contratos_convertidos_incoherentes.*|1|0|REVISAR$' || fallo "F6.2 un abono con TRM equivocada debe ser REVISAR" "$NEG"
echo "$NEG" | grep -q '^contratos_convertidos_con_abonos_por_encima_del_total_a_cobrar.*|1|0|REVISAR$' || fallo "F6.3 un sobrepago debe ser REVISAR" "$NEG"
[ "$(psqlc -d "$BD" -t -A -c "select count(*) from public.ventas where numero_contrato = 'DTM-9990'")" = "0" ] || fallo "F6.4 el escenario no se revirtió"
ok "F6 el postcheck marca REVISAR un total fuera de fórmula, un abono con TRM equivocada y un sobrepago (escenario revertido)"

# F7 · rollback: se niega con una conversión de cobro congelada (la de F3.5)
out="$(psqlc -d "$BD" -1 < "$RB" 2>&1)" && fallo "F7.1 el rollback se ejecutó con una aceptación convertida" "$out"
echo "$out" | grep -q 'ROLLBACK 235 ABORTADO' || fallo "F7.1 mensaje de aborto" "$out"
ok "F7.1 el rollback se niega con una aceptación con conversión de cobro congelada"

# F8 · rollback en una base SIN conversiones: ejecuta, restaura las funciones y la vista EXACTAS, y se puede reaplicar
crear "$BD2" || fallo "F8.0 base para el rollback"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F8.0 la 235 no aplicó"
out="$(psqlc -d "$BD2" -1 < "$RB" 2>&1)" || fallo "F8.1 el rollback falló" "$out"
SQLH="select md5(string_agg(replace(pg_get_functiondef(p.oid), chr(13), ''), '' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('aceptar_oferta_63','trg_p63_inmutable','trg_ventas_aceptacion_63_ins','fn_dashboard_cartera_por_moneda')
  union all select md5(replace(pg_get_functiondef('f208_priv.importes_factura(text)'::regprocedure), chr(13), ''))"
crear "${BD2}_ref" || fallo "F8.2 base de referencia"
H_REF="$(psqlc -d "${BD2}_ref" -t -A -c "$SQLH")"
H_RB="$(psqlc -d "$BD2" -t -A -c "$SQLH")"
[ -n "$H_REF" ] && [ "$H_REF" = "$H_RB" ] || fallo "F8.2 las funciones restauradas no son idénticas a las de la 234" "ref=$H_REF rollback=$H_RB"
VH="select md5(pg_get_viewdef('public.ventas_basica'::regclass))"
[ "$(psqlc -d "$BD2" -t -A -c "$VH")" = "$(psqlc -d "${BD2}_ref" -t -A -c "$VH")" ] || fallo "F8.3 la vista restaurada no es idéntica a la anterior"
n="$(psqlc -d "$BD2" -t -A -c "select (select count(*) from information_schema.columns where table_name in ('ventas','p63_aceptacion') and column_name in ('moneda_cobro','trm_cobro','total_cobro'))::text || '/' || (to_regprocedure('public.p63_total_cobro(numeric, text, text, numeric)') is null)::text || '/' || (select count(*) from pg_trigger where tgname = 'trg_ventas_cobro_congelado')::text")"
[ "$n" = "0/true/0" ] || fallo "F8.4 el rollback dejó restos" "$n"
[ "$(psqlc -d "$BD2" -t -A -c "select (to_regprocedure('public.p235_cf_cobro_guarda()') is null)::text || '/' || (select count(*) from pg_trigger where tgname = 'trg_p235_cf_cobro_guarda')::text")" = "true/0" ] || fallo "F8.4b el rollback dejó la guarda de facturación"
PF_RB="$(psqlc -d "$BD2" -t -A -F '|' < "$PF" 2>&1)"; PF_REF="$(psqlc -d "${BD2}_ref" -t -A -F '|' < "$PF" 2>&1)"
[ -n "$PF_RB" ] && [ "$PF_RB" = "$PF_REF" ] || fallo "F8.4c tras el rollback el postcheck no vuelve al estado previo (igual al de una base sin la 235)" "rollback: $PF_RB
referencia: $PF_REF"
echo "$PF_RB" | grep -q '^migracion_235_estructura|pendiente|aplicada|REVISAR$' || fallo "F8.4d tras el rollback la estructura debe volver a 'pendiente'" "$PF_RB"
[ "$(echo "$PF_RB" | grep -c '^\(aceptar_oferta_63_rechaza\|trigger_trg_p63_aceptacion\|fn_dashboard_cartera\|f208_priv_importes\|trigger_trg_p235\).*|false|true|REVISAR$')" = "5" ] || fallo "F8.4e tras el rollback las 5 guardas deben volver a pendientes" "$PF_RB"
ok "F8 rollback: 4 funciones públicas, importes_factura y la vista idénticas (md5) a las de la 234 (la cartera del dashboard vuelve a la 186); sin columnas, fórmula ni trigger de la 235"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F8.5 la 235 no reaplicó tras el rollback"
POST2="$(psqlc -d "$BD2" -t -A -F '|' < "$PF" 2>&1)"
echo "$POST2" | grep -q '|REVISAR$' && fallo "F8.6 el postcheck tras reaplicar tiene REVISAR" "$POST2"
ok "F8.5 reaplicada tras el rollback; postcheck 0 REVISAR"

# F9 · el postcheck detecta la AUSENCIA de cada guarda (cada rotura en una transacción revertida, sobre la base con la 235 reaplicada en F8.5)
# Cada caso: se rompe UNA guarda, se corre el postcheck (UNA consulta) y debe marcar REVISAR exactamente esa fila (y ninguna otra de la estructura) y dejar la
# estructura 'pendiente'. Un caso de más de una sentencia usa \gexec para reescribir la definición vigente (no se copia texto de la migración).
guarda_falta() { # <fila> <descripción> <sentencias SQL de ruptura>
  local fila="$1" desc="$2" brk="$3" tmp out
  tmp="$(mktemp)"
  { echo "begin;"; printf '%s\n' "$brk"; cat "$PF"; echo "rollback;"; } > "$tmp"
  out="$(psqlc -d "$BD2" -t -A -F '|' < "$tmp" 2>&1)" || { rm -f "$tmp"; fallo "F9 postcheck con la guarda rota ($desc)" "$out"; }
  rm -f "$tmp"
  echo "$out" | grep -q "^${fila}|false|true|REVISAR$" || fallo "F9 el postcheck NO detectó la ausencia de la guarda: $desc" "$out"
  echo "$out" | grep -q '^migracion_235_estructura|pendiente|aplicada|REVISAR$' || fallo "F9 la estructura debía quedar 'pendiente': $desc" "$out"
  [ "$(echo "$out" | grep -c '|false|true|REVISAR$')" = "1" ] || fallo "F9 se marcó más de una fila de estructura: $desc" "$out"
  echo "ok-caso $desc"
}
FN_ACEPTAR="select replace(pg_get_functiondef(f.oid), '%s', '%s') from pg_proc f where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace and f.pronargs = 8 \\gexec"
FN_IMPORTES="select replace(pg_get_functiondef(f.oid), 'F4451', 'F4499') from pg_proc f where f.proname = 'importes_factura' and f.pronamespace = (select oid from pg_namespace where nspname = 'f208_priv') \\gexec"
FN_DASH="select replace(pg_get_functiondef(f.oid), 'v.moneda_cobro', 'v.moneda') from pg_proc f where f.proname = 'fn_dashboard_cartera_por_moneda' and f.pronamespace = 'public'::regnamespace \\gexec"
R1="aceptar_oferta_63_rechaza_sin_moneda_de_cobro_p63_cobro_requerido_antes_de_numerar_y_sin_valor_por_defecto"
R2="trigger_trg_p63_aceptacion_cobro_requerido_habilitado_antes_de_insertar"
R3="fn_dashboard_cartera_por_moneda_con_moneda_de_cobro_invoker_stable_y_permisos"
R4="f208_priv_importes_factura_rechaza_F4451_antes_de_calcular_y_solo_service_role"
R5="trigger_trg_p235_cf_cobro_guarda_habilitado_sobre_contrato_facturacion"
guarda_falta "$R1" "RPC sin el rechazo p63_cobro_requerido" "$(printf "$FN_ACEPTAR" 'p63_cobro_requerido' 'p63_cobro_roto')"
guarda_falta "$R1" "RPC con moneda de cobro por defecto (coalesce)" "$(printf "$FN_ACEPTAR" 'v_mc := p_moneda_cobro;' 'v_mc := coalesce(p_moneda_cobro, v_mo);')"
guarda_falta "$R2" "trigger de aceptación obligatoria ausente" "drop trigger trg_p63_aceptacion_cobro_requerido on public.p63_aceptacion;"
guarda_falta "$R2" "trigger de aceptación obligatoria deshabilitado" "alter table public.p63_aceptacion disable trigger trg_p63_aceptacion_cobro_requerido;"
guarda_falta "$R3" "cartera del dashboard sin la moneda de cobro" "$FN_DASH"
guarda_falta "$R3" "cartera del dashboard sin permiso para authenticated" "revoke execute on function public.fn_dashboard_cartera_por_moneda(text, date) from authenticated;"
guarda_falta "$R3" "cartera del dashboard expuesta a anon" "grant execute on function public.fn_dashboard_cartera_por_moneda(text, date) to anon;"
guarda_falta "$R4" "importes_factura sin el rechazo F4451" "$FN_IMPORTES"
guarda_falta "$R4" "importes_factura ejecutable por authenticated" "grant execute on function f208_priv.importes_factura(text) to authenticated;"
guarda_falta "$R5" "trigger de contrato_facturacion ausente" "drop trigger trg_p235_cf_cobro_guarda on public.contrato_facturacion;"
guarda_falta "$R5" "trigger de contrato_facturacion deshabilitado" "alter table public.contrato_facturacion disable trigger trg_p235_cf_cobro_guarda;"
ok "F9 el postcheck detecta, una por una, la ausencia de las 5 guardas (11 roturas en transacciones revertidas: definición, permisos, trigger ausente o deshabilitado)"
[ "$(psqlc -d "$BD2" -t -A -F '|' < "$PF" 2>&1 | grep -c '|REVISAR$')" = "0" ] || fallo "F9.1 las roturas no se revirtieron"
ok "F9.1 las roturas se revirtieron: el postcheck vuelve a 0 REVISAR"

for b in "$BD" "$BD2" "${BD2}_ref"; do psqlc -d template1 -c "drop database if exists $b" >/dev/null 2>&1; done
echo "TEST 235 FASES: TODO OK"
