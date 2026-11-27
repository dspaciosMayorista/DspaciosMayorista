#!/bin/sh
# Controles NEGATIVOS de la regla de base del referido (341, decisión del dueño 2026-11-25): cada mutante rompe UNA regla en una copia de la migración y la prueba SQL (test_341_referidos.sql) DEBE fallar;
# el original debe pasar. Uso (desde dspacios-travel/):  sh supabase/scripts/test_341_mutantes.sh <contenedor_pg> <plantilla>        Solo bases desechables.
set -u
CT="${1:?contenedor}"; PL="${2:?plantilla}"
T="$(mktemp -d)"; cp supabase/migrations/20260601000340_*.sql supabase/migrations/20260601000341_*.sql "$T"/
M41="$T/20260601000341_referidos.sql"; ORIG="$T/original.sql"; cp "$M41" "$ORIG"
corre() { MIG_DIR="$T" sh supabase/scripts/test_341_referidos.sh "$CT" "$PL" 341 2>&1 | grep -E "FALLO|aciertos|^ +[0-9]+ \||ERROR" | sed 's/NOTICE:  //; s/psql:<stdin>:[0-9]*: //' | head -4 | cut -c1-210; }
mutante() { # nombre, patrón sed (separador #)
  cp "$ORIG" "$M41"; sed -i "$2" "$M41"
  if cmp -s "$ORIG" "$M41"; then echo "[$1] el mutante NO cambió nada: revisar el patrón"; return; fi
  echo "== MUTANTE $1"; corre
}
echo "== ORIGINAL"; cp "$ORIG" "$M41"; corre
mutante "N1 base = lo cobrado (precio_venta − impuesto de ventas), no la base guardada de la comisión" "s#select case when a.base_explicita then coalesce(a.base_comision, coalesce(a.precio_venta, 0))#select greatest(0, (select v.precio_venta - coalesce(v.impuesto, 0) from public.ventas v where v.numero_contrato = a.numero_contrato)) + 0 * case when a.base_explicita then 0#"
mutante "N2 base = el monto de la comisión del aliado" "s#select case when a.base_explicita then coalesce(a.base_comision, coalesce(a.precio_venta, 0))#select coalesce(a.base_comision, 0) * coalesce(a.pct_comision, 0) + 0 * case when a.base_explicita then 0#"
mutante "N3 sin evidencia se muestra como CERO calculado" "s#when f.est in ('sin_base', 'cancelado') then 0::numeric else null end#else 0::numeric end#"
mutante "N4 en NETO cuenta cualquier fila (no solo la descontada)" "s#and case when b.comision_estado = 'descontada' then public.comision_b2b_descontada(x)#and case when false then public.comision_b2b_descontada(x)#"
mutante "N5 elegible sin exigir el pago completo" "s#when pag.n is not null then 'elegible'#when true then 'elegible'#"
mutante "N6 filas de solo recobro cuentan como base ordinaria" "s#else not (coalesce(x.recobro_total, 0) > 0 and coalesce(x.pct_comision, 0) = 0 and coalesce(x.comision_valor, 0) = 0) end#else true end#"
mutante "N7 una fila SIN aliado_id cuenta como evidencia (rama NULL permisiva restaurada)" "s#and x.aliado_id = b.aliado_id#and (x.aliado_id is null or x.aliado_id = b.aliado_id)#"
rm -rf "$T"
