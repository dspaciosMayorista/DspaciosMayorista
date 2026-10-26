#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# 236 · FASES (solo bases desechables): fixture previa → preflight → aplicar → postcheck → batería → no re-aplicar → postcheck con roturas → rollback → reaplicar.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_236_fases.sh <contenedor> <plantilla>
#   <plantilla> = base con el esquema 001-235 (preparar_esquema_local.sh <contenedor> 235 <plantilla>).
# Cierre esperado: "TEST 236 FASES: TODO OK". Cada fase imprime OK/FALLO y la corrida se detiene en el primer FALLO.
# ──────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:-}"; PLANTILLA="${2:-}"
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_236_fases.sh <contenedor> <plantilla>" >&2; exit 2; }
printf '%s' "$PLANTILLA" | grep -Eq '^plantilla[a-z0-9_]*$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
BD="t236fases"; BD2="t236rollback"; BDREF="t236ref"
MIG="$APP/supabase/migrations/20260601000236_cxp_equivalente_costo_carrito.sql"
RB="$AQUI/rollback_236_cxp_equivalente_costo.sql"
PRE="$AQUI/preflight_236_cxp_equivalente_costo.sql"
POST="$AQUI/postcheck_236_cxp_equivalente_costo.sql"
BAT="$AQUI/test_236_cxp_equivalente_costo.sql"
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

test -f "$MIG" && test -f "$RB" && test -f "$PRE" && test -f "$POST" && test -f "$BAT" || fallo "F0.0 faltan la migración, el rollback, el preflight, el postcheck o la batería de la 236"

# F0 · base desechable desde la plantilla + fixture previa (CxP históricas, COMMIT): COP, USD nominal sin equivalente
crear "$BD" || fallo "F0 no se pudo crear la base desde la plantilla"
psqlc -d "$BD" >/dev/null <<'SQL' || fallo "F0.1 fixture previa"
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda) values
  ('DTM-923601', 'Histórico COP', 'mayorista', 1000000, 'activo', 'completo', 'COP'),
  ('DTM-923602', 'Histórico USD', 'mayorista', 1000, 'activo', 'completo', 'USD');
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda) values
  ('DTM-923601', 'P', 'hotel', 'Hotel COP', 420000, 'COP'),
  ('DTM-923602', 'P', 'hotel', 'Hotel USD nominal', 500, 'USD');
SQL
ok "F0 base $BD creada desde $PLANTILLA con 2 CxP históricas (una COP, una USD nominal sin equivalente)"

# F1 · preflight antes de la 236 (UNA consulta)
PREO="$(psqlc -d "$BD" -t -A -F '|' < "$PRE" 2>&1)" || fallo "F1 el preflight no se ejecutó" "$PREO"
[ "$(echo "$PREO" | grep -c '|')" = "16" ] || fallo "F1.1 el preflight debe devolver 16 controles en una sola consulta" "$PREO"
echo "$PREO" | grep -q '|REVISAR$' && fallo "F1.2 el preflight antes de la 236 no debe tener REVISAR" "$PREO"
echo "$PREO" | grep -q '^migracion_236_no_aplicada|true|true|OK$' || fallo "F1.3 la 236 no debe estar aplicada" "$PREO"
echo "$PREO" | grep -q '^rpc_registrar_financiero_es_la_227|true|true|OK$' || fallo "F1.4 la RPC vigente debe ser la de la 227" "$PREO"
echo "$PREO" | grep -q '^cxp_en_usd_sin_equivalente_historicas|1|' || fallo "F1.5 debe ver la CxP USD histórica sin equivalente" "$PREO"
HUELLA="$(echo "$PREO" | grep '^huella_de_cxp' | cut -d'|' -f2)"
[ -n "$HUELLA" ] && [ "$HUELLA" != "d41d8cd98f00b204e9800998ecf8427e" ] || fallo "F1.6 la huella debe cubrir las CxP de la fixture" "$PREO"
ok "F1 preflight antes de la 236: 16 controles, 0 REVISAR, la 236 sin aplicar y la RPC de la 227 vigente"

# F2 · aplicar la 236
out="$(psqlc -d "$BD" -1 < "$MIG" 2>&1)" || fallo "F2.1 la 236 no aplicó" "$out"
ok "F2.1 la 236 aplicó"

# F3 · postcheck (UNA consulta): 0 REVISAR, los datos de antes intactos
POSTO="$(psqlc -d "$BD" -t -A -F '|' < "$POST" 2>&1)" || fallo "F3.1 el postcheck no se ejecutó" "$POSTO"
[ "$(echo "$POSTO" | grep -c '|')" = "19" ] || fallo "F3.2 el postcheck debe devolver 19 controles en una sola consulta" "$POSTO"
echo "$POSTO" | grep -q '|REVISAR$' && fallo "F3.3 el postcheck tiene controles REVISAR" "$POSTO"
[ "$(echo "$POSTO" | grep '^huella_de_cxp' | cut -d'|' -f2)" = "$HUELLA" ] || fallo "F3.4 la 236 alteró las CxP existentes (huella distinta)" "$POSTO"
[ "$(echo "$POSTO" | grep '^cxp_total_filas' | cut -d'|' -f2)" = "$(echo "$PREO" | grep '^cxp_total_filas' | cut -d'|' -f2)" ] || fallo "F3.5 cambió el número de CxP" "$POSTO"
ok "F3 postcheck integral: 19 controles, 0 REVISAR; huella y conteo de las CxP existentes idénticos a los del preflight"

# F4 · batería SQL (otra base de la misma plantilla con la 236)
crear "$BD2" || fallo "F4.0 base para la batería"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F4.0 la 236 no aplicó en la base de la batería"
out="$(psqlc -d "$BD2" < "$BAT" 2>&1)" || { echo "$out" | grep -E 'FALLO|ERROR' | head -20; fallo "F4 batería SQL" "$(echo "$out" | tail -15)"; }
echo "$out" | grep -q 'FALLO' && fallo "F4 la batería tiene FALLO" "$(echo "$out" | grep FALLO)"
echo "$out" | grep -q 'TEST 236 SQL: TODO OK' || fallo "F4 sin el cierre 'TEST 236 SQL: TODO OK'" "$(echo "$out" | tail -10)"
ok "F4 batería: $(echo "$out" | grep -o 'TEST 236 SQL: TODO OK ([0-9]* comprobaciones)')"

# F5 · no re-aplicar
out="$(psqlc -d "$BD" -1 < "$MIG" 2>&1)" && fallo "F5 la 236 se re-aplicó" "$out"
echo "$out" | grep -q '236 ABORTADA' || fallo "F5 mensaje de no re-aplicar" "$out"
ok "F5 la 236 se niega a re-aplicarse"

# F6 · el postcheck detecta lo roto (cada rotura en una transacción revertida): el control correspondiente sale REVISAR
rotura() { # rotura <nombre> <control esperado> <sql de la rotura>
  local nombre="$1" control="$2" sqlr="$3" f res
  f="$(mktemp)"
  { echo "begin;"; echo "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda) values ('DTM-923690', 'x', 'mayorista', 1, 'activo', 'completo', 'USD');"
    echo "$sqlr"; cat "$POST"; echo "rollback;"; } > "$f"
  res="$(psqlc -d "$BD" -t -A -F '|' < "$f" 2>&1)" || { rm -f "$f"; fallo "F6.$nombre el postcheck no se ejecutó" "$res"; }
  rm -f "$f"
  echo "$res" | grep -q "^${control}|.*|REVISAR$" || fallo "F6.$nombre debe marcar REVISAR '$control'" "$res"
}
rotura 1 cxp_con_equivalente_incoherente "alter table public.cuentas_por_pagar drop constraint cuentas_por_pagar_cop_costo_chk; insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'rota', 210, 'USD', 999, 3900);"
rotura 2 contratos_con_mas_de_una_trm_de_costos "alter table public.cuentas_por_pagar drop constraint cuentas_por_pagar_cop_costo_chk; insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'a', 100, 'USD', 390000, 3900), ('DTM-923690', 'hotel', 'b', 100, 'USD', 400000, 4000);"
rotura 3 cxp_usd_sin_equivalente_en_contrato_que_si_lo_lleva "insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'a', 100, 'USD', 390000, 3900); insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda) values ('DTM-923690', 'hotel', 'b', 100, 'USD');"
rotura 4 contratos_con_equivalente_cuya_cabecera_no_es_usd "update public.ventas set moneda = 'COP' where numero_contrato = 'DTM-923690'; insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'a', 100, 'USD', 390000, 3900);"
rotura 5 cxp_con_equivalente_cuyo_asiento_no_debita_el_equivalente "insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'a', 100, 'USD', 390000, 3900); insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) select 'mayorista', 9990001, current_date, 'nominal', 'cxp', 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = 'DTM-923690'; insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, debe, haber) select 'mayorista', a.id, (select id from public.puc_cuentas where codigo = '613505' and tenant = 'mayorista'), 100, 0 from public.asientos_contables a where a.numero = 9990001;"
rotura 6 cxp_con_equivalente_sin_asiento_de_devengo "insert into public.cuentas_por_pagar (numero_contrato, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo) values ('DTM-923690', 'hotel', 'a', 100, 'USD', 390000, 3900);"
rotura 7 trigger_trg_cxp_costo_inmutable_habilitado_before_update "drop trigger trg_cxp_costo_inmutable on public.cuentas_por_pagar;"
rotura 8 check_cuentas_por_pagar_cop_costo_chk_validado "alter table public.cuentas_por_pagar drop constraint cuentas_por_pagar_cop_costo_chk;"
rotura 9 rpc_registrar_financiero_236 "create or replace function public.registrar_financiero_contrato(p_numero_contrato text, p_tenant text, p_costos jsonb, p_cxp jsonb) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$;"
rotura 10 rpc_solo_service_role "grant execute on function public.registrar_financiero_contrato(text, text, jsonb, jsonb) to authenticated;"
[ "$(psqlc -d "$BD" -t -A -c "select count(*) from public.ventas where numero_contrato = 'DTM-923690'")" = "0" ] || fallo "F6.11 las roturas no se revirtieron"
ok "F6 el postcheck marca REVISAR cada rotura: equivalente incoherente, dos TRM, devengo mixto, cabecera no USD, asiento nominal, asiento ausente, trigger, CHECK, RPC reemplazada, RPC expuesta (10 casos, revertidos)"

# F7 · rollback: se niega con CxP que llevan equivalente (una conversión real de la 236)
psqlc -d "$BD" >/dev/null <<'SQL' || fallo "F7.0 fixture del carrito"
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda) values ('DTM-923610', 'Carrito', 'mayorista', 1000, 'activo', 'pendiente', 'USD');
select public.registrar_financiero_contrato('DTM-923610', 'mayorista', '{"costo_hotel": 210}'::jsonb,
  '[{"tipo_proveedor":"hotel","servicio":"Hotel","proveedor":"P","valor_total":210,"moneda":"USD","valor_cop_costo":819000,"trm_costo":3900,"fecha_obligacion":"2026-10-24"}]'::jsonb);
SQL
out="$(psqlc -d "$BD" -1 < "$RB" 2>&1)" && fallo "F7.1 el rollback se ejecutó con CxP que llevan equivalente" "$out"
echo "$out" | grep -q 'ROLLBACK 236 ABORTADO' || fallo "F7.1 mensaje de aborto" "$out"
ok "F7 el rollback se niega con CxP que llevan equivalente de costos (su devengo depende de esas columnas)"

# F8 · rollback en una base SIN conversiones: ejecuta, restaura la RPC EXACTA de la 227, y se puede reaplicar
crear "$BD2" || fallo "F8.0 base para el rollback"
crear "$BDREF" || fallo "F8.0 base de referencia (sin la 236)"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F8.0 la 236 no aplicó"
out="$(psqlc -d "$BD2" -1 < "$RB" 2>&1)" || fallo "F8.1 el rollback falló" "$out"
SQLH="select md5(replace(pg_get_functiondef('public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure), chr(13), ''))"
[ "$(psqlc -d "$BD2" -t -A -c "$SQLH")" = "$(psqlc -d "$BDREF" -t -A -c "$SQLH")" ] || fallo "F8.2 la RPC restaurada no es idéntica a la de la 227 (md5)"
n="$(psqlc -d "$BD2" -t -A -c "select (select count(*) from information_schema.columns where table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_costo','trm_costo'))::text || '/' || (to_regprocedure('public.trg_cxp_costo_inmutable()') is null)::text || '/' || (select count(*) from pg_constraint where conname = 'cuentas_por_pagar_cop_costo_chk')::text")"
[ "$n" = "0/true/0" ] || fallo "F8.3 el rollback dejó restos" "$n"
PF_RB="$(psqlc -d "$BD2" -t -A -F '|' < "$PRE" 2>&1)"; PF_REF="$(psqlc -d "$BDREF" -t -A -F '|' < "$PRE" 2>&1)"
[ -n "$PF_RB" ] && [ "$PF_RB" = "$PF_REF" ] || fallo "F8.4 tras el rollback el preflight no vuelve al estado previo (igual al de una base sin la 236)" "rollback: $PF_RB
referencia: $PF_REF"
ok "F8 rollback: la RPC vuelve idéntica (md5) a la de la 227; sin columnas, trigger ni CHECK; el preflight vuelve a ser el de una base sin la 236"
psqlc -d "$BD2" -1 < "$MIG" >/dev/null 2>&1 || fallo "F8.5 la 236 no reaplicó tras el rollback"
POST2="$(psqlc -d "$BD2" -t -A -F '|' < "$POST" 2>&1)"
echo "$POST2" | grep -q '|REVISAR$' && fallo "F8.6 el postcheck tras reaplicar tiene REVISAR" "$POST2"
ok "F8.5 reaplicada tras el rollback; postcheck 0 REVISAR"

for b in "$BD" "$BD2" "$BDREF"; do psqlc -d template1 -c "drop database if exists $b" >/dev/null 2>&1; done
echo "TEST 236 FASES: TODO OK"
