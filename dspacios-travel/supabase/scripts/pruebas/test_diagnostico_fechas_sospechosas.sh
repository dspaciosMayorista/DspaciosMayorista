#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA del diagnóstico histórico (supabase/scripts/diagnostico_fechas_
# sospechosas_lectura.sql). SOLO contra una base LOCAL DESECHABLE dentro del
# contenedor Docker de Supabase local — nunca remota.
#
# Siembra filas con created_at fijo dentro de UNA transacción, ejecuta las dos
# consultas del diagnóstico tal cual están en el archivo y hace ROLLBACK (no
# deja datos). Luego comprueba qué filas salieron como sospechosas.
#
# Uso:  sh test_diagnostico_fechas_sospechosas.sh <base_desechable> [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-supabase_db_sbqvrckukbjzhtzqpyzg}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
AQUI="$(cd "$(dirname "$0")" && pwd)"
DIAG="$AQUI/../diagnostico_fechas_sospechosas_lectura.sql"

SALIDA="$( {
  cat <<'SQL'
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '|'
\pset footer off
begin;
-- 19:30 Bogotá del 30-sep = 2026-10-01 00:30Z (día UTC 1-oct). 18:30 Bogotá = 23:30Z.
insert into public.ventas (numero_contrato, cliente, tenant, created_at, fecha_emision)
values ('DTM-7701', 'DIAG', 'mayorista', '2026-10-01 00:30:00+00', '2026-10-01');   -- V1 sospechosa (editable)
-- Abonos
insert into public.abonos (id, numero_contrato, valor_abono, fecha_abono, created_at, tenant) values
  (977001, 'DTM-7701', 1, '2026-10-01', '2026-10-01 00:30:00+00', 'mayorista'),  -- A1 SOSPECHOSA prellenada
  (977002, 'DTM-7701', 1, '2026-09-30', '2026-10-01 00:30:00+00', 'mayorista'),  -- A2 ok (19:30, día Bogotá)
  (977003, 'DTM-7701', 1, '2026-09-30', '2026-09-30 23:30:00+00', 'mayorista'),  -- A3 ok (18:30)
  (977004, 'DTM-7701', 1, '2026-09-15', '2026-10-01 00:30:00+00', 'mayorista'),  -- A4 otra_fecha (atrasada a mano)
  (977005, 'DTM-7701', 1, '2026-09-20', '2026-10-01 00:30:00+00', 'mayorista');  -- A5 se editará a 1-oct
update public.abonos set fecha_abono = '2026-10-01' where id = 977005;            -- auditoría: editada_despues
-- Asientos: automático sospechoso, heredado del abono A1, automático correcto.
insert into public.asientos_contables (id, numero, descripcion, fecha, origen, referencia, created_at, tenant) values
  (977101, 977101, 'diag', '2026-10-01', 'facturacion', 'facturacion:DTM-7701', '2026-10-01 01:00:00+00', 'mayorista'), -- S1 SOSPECHOSA automática
  (977102, 977102, 'diag', '2026-10-01', 'abono', 'abono:977001', '2026-10-01 00:30:00+00', 'mayorista'),               -- S2 SOSPECHOSA heredada
  (977103, 977103, 'diag', '2026-09-30', 'cxp', 'cxp:1', '2026-10-01 02:00:00+00', 'mayorista');                         -- S3 ok automática
-- CxP automática sospechosa (fecha de obligación = día UTC).
insert into public.cuentas_por_pagar (id, numero_contrato, fecha_obligacion, created_at, tenant)
values (977201, 'DTM-7701', '2026-10-01', '2026-10-01 03:00:00+00', 'mayorista');                                       -- C1 SOSPECHOSA automática
SQL
  echo '\echo ===A==='
  sed -n '/^-- ═══ A)/,/^-- ═══ B)/p' "$DIAG" | sed '$d'
  echo '\echo ===B==='
  sed -n '/^-- ═══ B)/,$p' "$DIAG"
  echo 'rollback;'
} | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q 2>&1 )"

echo "$SALIDA" | sed -n '/===A===/,$p'
FALLOS=0
espera() {  # espera <descripción> <patrón que DEBE aparecer en B>
  if echo "$SALIDA" | sed -n '/===B===/,$p' | grep -Eq "$2"; then echo "OK    $1"; else echo "FALLO $1"; FALLOS=$((FALLOS + 1)); fi
}
no_espera() {
  if echo "$SALIDA" | sed -n '/===B===/,$p' | grep -Eq "$2"; then echo "FALLO $1"; FALLOS=$((FALLOS + 1)); else echo "OK    $1"; fi
}
echo "$SALIDA" | grep -q "ERROR" && { echo "FALLO el diagnóstico lanzó ERROR"; FALLOS=$((FALLOS + 1)); }
espera    "A1 abono 19:30 con día UTC → SOSPECHOSA prellenada_editable, con su asiento" '^abonos\|977001\|.*\|prellenada_editable\|2026-10-01$'
no_espera "A2 abono 19:30 con día Bogotá → no listado"        '^abonos\|977002\|'
no_espera "A3 abono 18:30 → no listado"                       '^abonos\|977003\|'
no_espera "A4 abono atrasado a mano → no listado"             '^abonos\|977004\|'
espera    "A5 abono editado después → editada_despues"        '^abonos\|977005\|.*\|editada_despues\|'
espera    "S1 asiento de facturación → SOSPECHOSA automatica" '^asientos_contables\|977101\|.*\|automatica\|'
espera    "S2 asiento del abono → heredada"                   '^asientos_contables\|977102\|.*\|heredada\|'
no_espera "S3 asiento correcto → no listado"                  '^asientos_contables\|977103\|'
espera    "C1 CxP → SOSPECHOSA automatica"                    '^cuentas_por_pagar\|977201\|.*\|automatica\|'
espera    "V1 venta fecha_emision → SOSPECHOSA"               '^ventas\|DTM-7701\|'
# Resumen (bloque A): una sospechosa prellenada (A1) y una editada después (A5).
for o in prellenada_editable editada_despues; do
  if echo "$SALIDA" | sed -n '/===A===/,/===B===/p' | grep -Eq "^abonos\|fecha_abono\|$o\|1\|"; then echo "OK    resumen: abonos $o con 1 sospechosa"
  else echo "FALLO resumen: abonos $o con 1 sospechosa"; FALLOS=$((FALLOS + 1)); fi
done
if [ "$FALLOS" -gt 0 ]; then echo "RESULTADO: $FALLOS fallo(s)"; exit 1; fi
echo "RESULTADO: todo OK (sin datos persistidos: ROLLBACK)"
