#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA del preflight de solo lectura preflight_30_neto_desde_38.sql con datos
# sembrados de resultado conocido. SOLO en un contenedor Docker PROPIO y
# desechable (nunca remoto). Siembra, corre el preflight dos veces (debe dar lo
# mismo: no escribe), comprueba cada conteo y borra lo sembrado.
#
# Uso:  sh test_30_preflight_neto.sh <base_desechable_con_205> [contenedor]
#   Requiere /tmp/pre30.sql (el preflight) copiado en el contenedor.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg30_neto}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then echo "Indica una base desechable." >&2; exit 2; fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  $PSQL -c "set session_replication_role = replica;
            delete from public.abonos where numero_contrato like 'DTM-935%';
            delete from public.contrato_items where numero_contrato like 'DTM-935%';
            delete from public.aliados_b2b where numero_contrato like 'DTM-935%';
            delete from public.ventas where numero_contrato like 'DTM-935%';" >/dev/null
}
limpiar
# Mes anterior y mes actual en Bogotá.
$PSQL -c "set session_replication_role = replica;
  insert into public.ventas (numero_contrato, cliente, tenant, moneda, estado, fecha_venta, created_at, precio_venta, impuesto, tipo_asesor, modo_compra, comision_b2b, comision_estado) values
   -- N: reserva NETO correcta del mes actual, con su fila 205, ítems = PVP, pagada justo el total
   ('DTM-9351','C','mayorista','COP','confirmado', current_date, now(), 1840000, 400000, 'agencia', 'neta', 160000, 'descontada'),
   -- N: NETO del mes ANTERIOR (ya liquidable), sin fila, pagado a PVP (2.000.000 > 1.840.000)
   ('DTM-9352','C','mayorista','COP','activo', (date_trunc('month', current_date) - interval '10 days')::date, now(), 1840000, 400000, 'agencia', 'neta', 160000, 'descontada'),
   -- N: NETO pendiente (no liquidable), USD, legado sin modo_compra, ítems editados
   ('DTM-9353','C','mayorista','USD','pendiente', current_date, now() - interval '30 days', 920, 0, 'freelance', null, 80, 'descontada'),
   -- PVP comisionable: no cuenta
   ('DTM-9354','C','mayorista','COP','confirmado', current_date, now(), 2000000, 400000, 'agencia', 'comisionable', 160000, 'pendiente');
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio) values
   ('DTM-9351','mayorista','A',2000000,1600000,true,0.10,0,0,false,0,'pagada',true);
  insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden) values
   ('DTM-9351','Doble',2,0,1000000,0,0), ('DTM-9352','Doble',2,0,1000000,0,0), ('DTM-9353','Doble',2,0,400,0,0);
  insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values
   ('DTM-9351','mayorista',1840000,current_date), ('DTM-9352','mayorista',2000000,current_date);" >/dev/null

R1=$($PSQL -F '|' -f /tmp/pre30.sql)
R2=$($PSQL -F '|' -f /tmp/pre30.sql)
[ "$R1" = "$R2" ] && ok "P0 dos corridas idénticas (solo lectura)" || fallo "P0 corridas distintas"
val() { echo "$R1" | grep "^$1 " | cut -d'|' -f2; }
MESANT=$($PSQL -c "select to_char(date_trunc('month', current_date) - interval '10 days', 'YYYY-MM')")
[ "$(val N1)" = 3 ] && ok "N1 NETO total = 3" || fallo "N1 $(val N1)"
[ "$(val N2)" = 2 ] && ok "N2 NETO desde #38 = 2 (el de hace 30 días no)" || fallo "N2 $(val N2)"
[ "$(val N3)" = "1 / 2" ] && ok "N3 con fila 205 / sin ella = 1 / 2" || fallo "N3 $(val N3)"
[ "$(val N4)" = 1 ] && ok "N4 NETO sin modo_compra neta = 1" || fallo "N4 $(val N4)"
[ "$(val N5)" = 2 ] && ok "N5 NETO con 0 o 2+ filas = 2" || fallo "N5 $(val N5)"
[ "$(val N6)" = 1 ] && ok "N6 ítems ≠ precio + descuento = 1" || fallo "N6 $(val N6)"
[ "$(val N7)" = 1 ] && ok "N7 pagado > total exigible = 1" || fallo "N7 $(val N7)"
[ "$(val N8)" = "$MESANT: 1 · 160000" ] && ok "N8 meses anteriores = $MESANT: 1 · 160000" || fallo "N8 $(val N8) (esperaba $MESANT: 1 · 160000)"
[ "$(val N9)" = "1 · 160000" ] && ok "N9 mes actual = 1 · 160000 (el pendiente no liquida)" || fallo "N9 $(val N9)"
[ "$(val N10)" = "COP: 2, USD: 1" ] && ok "N10 por moneda = COP: 2, USD: 1" || fallo "N10 $(val N10)"
limpiar
if [ "$FALLOS" = 0 ]; then echo "TODO OK (11 comprobaciones)"; else echo "FALLOS: $FALLOS"; echo "$R1"; exit 1; fi
