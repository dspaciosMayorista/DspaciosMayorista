#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · migración 205 — abonos a comisiones B2B contra borrado y
# edición concurrentes. DOS SESIONES REALES, SOLO base LOCAL DESECHABLE
# dentro de un contenedor Docker (nunca remota). Datos DTM-93xx,
# confirmados y borrados al final.
#
# Uso:  sh test_205_carrera_abonos.sh <base_desechable> [contenedor]
#
#   C1  A registra un abono (sin confirmar) · B borra la comisión  → B falla, el abono queda.
#   C2  A registra un abono (sin confirmar) · B cambia el %        → B falla, el total no cambia.
#   C3  A borra la comisión (sin confirmar) · B registra un abono  → B falla por la FK, sin huérfanos.
#   C4  A edita el % (sin confirmar, sin abonos) · B registra abono → B espera y entra sobre el total nuevo.
#   C5  A y B (asesor `venta`) registran a la vez la comisión de la MISMA reserva → una sola fila.
#   C6  A abona (sin confirmar) · B, el asesor `venta`, corrige SU comisión → B falla: ya tiene abonos.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg201_review}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  $PSQL -c "set session_replication_role = replica;
            delete from public.comision_b2b_pagos where aliado_b2b_id between 9305001 and 9305009;
            delete from public.aliados_b2b where id between 9305001 and 9305009 or numero_contrato = 'DTM-9302';
            delete from public.ventas where numero_contrato in ('DTM-9301', 'DTM-9302', 'DTM-9303');
            delete from public.aliados where id = 9305;
            delete from auth.users where id = '00000000-0000-0000-0000-000000930501';" >/dev/null
}
sembrar() {
  limpiar
  $PSQL -c "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9301','C','mayorista',1000000);
            insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision)
            values (9305001,'DTM-9301','mayorista','A',1000000,1000000,0.1);" >/dev/null
}
abonos() { $PSQL -c "select count(*) from public.comision_b2b_pagos where aliado_b2b_id = 9305001"; }

# ── C1 ──
sembrar
( $PSQL -c "begin; insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9305001, current_date, 50000, 'mayorista'); select pg_sleep(3); commit;" >"$TMP/a1" 2>&1 ) &
sleep 1
if $PSQL -c "delete from public.aliados_b2b where id = 9305001" >"$TMP/b1" 2>&1; then B1=paso; else B1=fallo; fi
wait
if [ "$B1" = fallo ] && grep -q "tiene abonos" "$TMP/b1" && [ "$(abonos)" = 1 ]; then ok "C1 borrar mientras se abona: rechazado, el abono queda"; else fallo "C1 ($B1) $(cat "$TMP/b1") abonos=$(abonos)"; fi

# ── C2 ──
sembrar
( $PSQL -c "begin; insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9305001, current_date, 50000, 'mayorista'); select pg_sleep(3); commit;" >"$TMP/a2" 2>&1 ) &
sleep 1
if $PSQL -c "update public.aliados_b2b set pct_comision = 0.2 where id = 9305001" >"$TMP/b2" 2>&1; then B2=paso; else B2=fallo; fi
wait
PCT=$($PSQL -c "select pct_comision from public.aliados_b2b where id = 9305001")
if [ "$B2" = fallo ] && grep -q "alteraría su total" "$TMP/b2" && [ "$PCT" = "0.1000" ]; then ok "C2 editar el % mientras se abona: rechazado, el total no cambia"; else fallo "C2 ($B2) $(cat "$TMP/b2") pct=$PCT"; fi

# ── C3 ──
sembrar
( $PSQL -c "begin; delete from public.aliados_b2b where id = 9305001; select pg_sleep(3); commit;" >"$TMP/a3" 2>&1 ) &
sleep 1
if $PSQL -c "insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9305001, current_date, 50000, 'mayorista')" >"$TMP/b3" 2>&1; then B3=paso; else B3=fallo; fi
wait
HUERF=$($PSQL -c "select count(*) from public.comision_b2b_pagos p where p.aliado_b2b_id = 9305001 and not exists (select 1 from public.aliados_b2b a where a.id = p.aliado_b2b_id)")
if [ "$B3" = fallo ] && [ "$HUERF" = 0 ]; then ok "C3 abonar mientras se borra: rechazado, sin abonos huérfanos"; else fallo "C3 ($B3) $(cat "$TMP/b3") huerfanos=$HUERF"; fi

# ── C4 ──
sembrar
( $PSQL -c "begin; update public.aliados_b2b set pct_comision = 0.2 where id = 9305001; select pg_sleep(3); commit;" >"$TMP/a4" 2>&1 ) &
sleep 1
if $PSQL -c "insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9305001, current_date, 50000, 'mayorista')" >"$TMP/b4" 2>&1; then B4=paso; else B4=fallo; fi
wait
TOTAL=$($PSQL -c "select round(public.comision_b2b_total(a)) from public.aliados_b2b a where id = 9305001")
if [ "$B4" = paso ] && [ "$(abonos)" = 1 ] && [ "$TOTAL" = 200000 ]; then ok "C4 abonar mientras se edita (sin abonos previos): espera y entra sobre el total nuevo"; else fallo "C4 ($B4) $(cat "$TMP/b4") total=$TOTAL"; fi

# ── C5 ──
limpiar
$PSQL -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000930501', 'c5-venta@x.test');
          insert into public.usuarios (id, email, nombre, rol, activo, tenant)
          values ('00000000-0000-0000-0000-000000930501', 'c5-venta@x.test', 'C5 Venta', 'venta', true, 'mayorista')
          on conflict (id) do update set rol = 'venta', activo = true, tenant = 'mayorista';
          insert into public.aliados (id, nombre, nit, tipo, pct_comision) values (9305, 'C5 Agencia', '9', 'agencia', 0.1);
          insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado)
          values ('DTM-9302', 'C', 'mayorista', 1000000, 200000, 'agencia', 9305, 'comisionable', 80000, 'pendiente', 'pendiente');" >/dev/null
COMO="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000930501\",\"role\":\"authenticated\"}', false); set role authenticated;"
( $PSQL -c "$COMO begin; select public.registrar_comision_b2b_reserva('DTM-9302', 9305); select pg_sleep(3); commit;" >"$TMP/a5" 2>&1 ) &
sleep 1
if $PSQL -c "$COMO select public.registrar_comision_b2b_reserva('DTM-9302', 9305);" >"$TMP/b5" 2>&1; then B5=paso; else B5=fallo; fi
wait
FILAS=$($PSQL -c "select count(*) from public.aliados_b2b where numero_contrato = 'DTM-9302'")
if [ "$B5" = fallo ] && grep -q "ya tiene comisión" "$TMP/b5" && [ "$FILAS" = 1 ] && ! grep -qi error "$TMP/a5"; then ok "C5 dos registros simultáneos de la misma reserva: uno entra, el otro se niega, una sola fila"; else fallo "C5 ($B5) $(cat "$TMP/a5" "$TMP/b5") filas=$FILAS"; fi

# ── C6 ──
limpiar
$PSQL -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000930501', 'c5-venta@x.test');
          insert into public.usuarios (id, email, nombre, rol, activo, tenant)
          values ('00000000-0000-0000-0000-000000930501', 'c5-venta@x.test', 'C5 Venta', 'venta', true, 'mayorista')
          on conflict (id) do update set nombre = 'C5 Venta', rol = 'venta', activo = true, tenant = 'mayorista';
          insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, asesor)
          values ('DTM-9303', 'C', 'mayorista', 1000000, 200000, 'agencia', 'C5 Venta');
          insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision)
          values (9305003, 'DTM-9303', 'mayorista', 'A', 1000000, 800000, true, 0.1);" >/dev/null
( $PSQL -c "begin; insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9305003, current_date, 10000, 'mayorista'); select pg_sleep(3); commit;" >"$TMP/a6" 2>&1 ) &
sleep 1
if $PSQL -c "$COMO update public.aliados_b2b set pct_comision = 0.2 where id = 9305003;" >"$TMP/b6" 2>&1; then B6=paso; else B6=fallo; fi
wait
PCT6=$($PSQL -c "select pct_comision from public.aliados_b2b where id = 9305003")
if [ "$B6" = fallo ] && grep -q "ya tiene abonos" "$TMP/b6" && [ "$PCT6" = "0.1000" ]; then ok "C6 el asesor corrige mientras se abona: espera y se rechaza, el % no cambia"; else fallo "C6 ($B6) $(cat "$TMP/b6") pct=$PCT6"; fi
$PSQL -c "set session_replication_role = replica; delete from public.comision_b2b_pagos where aliado_b2b_id = 9305003; delete from public.aliados_b2b where id = 9305003;" >/dev/null

limpiar
rm -rf "$TMP"
if [ "$FALLOS" = 0 ]; then echo "TODO OK (6 carreras)"; else echo "FALLOS: $FALLOS"; exit 1; fi
