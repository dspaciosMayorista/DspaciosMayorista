#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PREFLIGHT · migración 205 — INFO de revisión manual y SOLO LECTURA.
# SOLO base LOCAL DESECHABLE en Docker (nunca remota). La base es la
# plantilla SIN 205 (es cuando corre el preflight).
#
#   Siembra, como datos HISTÓRICOS (triggers apagados):
#     DTM-9921  NETO con DOS filas B2B 'pagada' (una con 2 abonos, otra sin):
#               la firma legado no dice cuál fue la comisión descontada.
#     DTM-9922  NETO con una fila 'pagada' y otra 'pendiente' con 1 abono.
#     DTM-9923  NETO con una sola fila 'pagada' (sin ambigüedad).
#     DTM-9924  comisionable con dos filas (no es NETO).
#   Comprueba los valores EXACTOS de INFO 28–31 y que el preflight no
#   escribe nada: misma huella md5 de ventas / aliados_b2b /
#   comision_b2b_pagos antes y después, también forzando
#   default_transaction_read_only.
#
# Uso:  sh test_205_preflight.sh [contenedor] [plantilla_sin_205]   (desde dspacios-travel/)
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-pg201_review}"
PLANTILLA="${2:-e201}"
DB=c38_pf_205
export MSYS_NO_PATHCONV=1
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d $DB"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker exec -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "drop database if exists $DB" >/dev/null
n=0; until docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "create database $DB template $PLANTILLA" >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 12 ] && { echo "No se pudo clonar $PLANTILLA"; exit 2; }; sleep 5
done
[ "$($SQL -c "select exists(select 1 from information_schema.columns where table_name='aliados_b2b' and column_name='base_explicita')")" = f ] \
  || { echo "La plantilla ya tiene la 205: el preflight corre ANTES"; exit 2; }
docker cp supabase/scripts/preflight_205_comisiones_b2b.sql "$CT":/tmp/preflight_205_comisiones_b2b.sql

$SQL -c "set session_replication_role = replica;
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, modo_compra, comision_b2b, comision_estado) values
  ('DTM-9921', 'C', 'mayorista', 920000, 'neta', 80000, 'descontada'),
  ('DTM-9922', 'C', 'mayorista', 920000, 'neta', 80000, 'descontada'),
  ('DTM-9923', 'C', 'mayorista', 920000, 'neta', 80000, 'descontada'),
  ('DTM-9924', 'C', 'mayorista', 1000000, 'comisionable', 80000, 'pendiente');
insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, nit, precio_venta, base_comision, pct_comision, estado) values
  (99211, 'DTM-9921', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.10, 'pagada'),
  (99212, 'DTM-9921', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.05, 'pagada'),
  (99221, 'DTM-9922', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.10, 'pagada'),
  (99222, 'DTM-9922', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.05, 'pendiente'),
  (99231, 'DTM-9923', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.10, 'pagada'),
  (99241, 'DTM-9924', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.10, 'pendiente'),
  (99242, 'DTM-9924', 'mayorista', 'Nombre Privado', '900111222', 1000000, 800000, 0.05, 'pendiente');
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values
  (99211, current_date - 90, 80000, 'mayorista'), (99211, current_date - 80, 1, 'mayorista'),
  (99222, current_date - 60, 40000, 'mayorista');" >/dev/null

HUELLA="select md5(coalesce((select string_agg(t::text, '|' order by t::text) from public.ventas t), '') ||
                   coalesce((select string_agg(t::text, '|' order by t::text) from public.aliados_b2b t), '') ||
                   coalesce((select string_agg(t::text, '|' order by t::text) from public.comision_b2b_pagos t), ''))"
ANTES=$($SQL -c "$HUELLA")
PRE=$($SQL -f /tmp/preflight_205_comisiones_b2b.sql)
PRE_RO=$(docker exec -i -e PGPASSWORD=postgres -e PGOPTIONS='-c default_transaction_read_only=on' "$CT" \
  psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d $DB -v ON_ERROR_STOP=1 -f /tmp/preflight_205_comisiones_b2b.sql 2>&1) \
  && RO=ok || RO=fallo
DESPUES=$($SQL -c "$HUELLA")

info() { echo "$PRE" | grep "^$1|INFO|" | sed 's/^[0-9]*|INFO|//'; }

echo "$PRE" | grep -q "|FALLA|" && fallo "preflight con FALLA: $(echo "$PRE" | grep FALLA)" || ok "preflight sin FALLA"
[ "$ANTES" = "$DESPUES" ] && ok "solo lectura: misma huella de ventas/aliados_b2b/comision_b2b_pagos antes y después" || fallo "el preflight cambió datos"
[ "$RO" = ok ] && [ "$PRE_RO" = "$PRE" ] && ok "solo lectura: corre igual con default_transaction_read_only=on" || fallo "en solo lectura: $PRE_RO"
# 28: solo filas SIN la firma legado de descontada (estado <> 'pagada').
case "$(info 28)" in *": 0 / 1 / 1") ok "INFO 28 = 0 / 1 / 1 (solo la fila 'pendiente' de DTM-9922; las 'pagada' no las cuenta)";; *) fallo "INFO 28: $(info 28)";; esac
case "$(info 29)" in *": 99222@DTM-9922:1") ok "INFO 29 identifica 99222@DTM-9922:1";; *) fallo "INFO 29: $(info 29)";; esac
# 30/31: contratos NETO con 2+ filas B2B, INCLUIDAS las 'pagada'.
case "$(info 30)" in *": 2 / 4 / 1") ok "INFO 30 = 2 contratos / 4 filas / 1 con 2+ 'pagada' (ambiguo)";; *) fallo "INFO 30: $(info 30)";; esac
case "$(info 31)" in
  *": DTM-9921 [AMBIGUO] filas=2 pagada=2 con_abonos=1 ids=99211,99212; DTM-9922 filas=2 pagada=1 con_abonos=1 ids=99221,99222")
    ok "INFO 31 identifica DTM-9921 como AMBIGUO y DTM-9922; no lista DTM-9923 (una fila) ni DTM-9924 (no NETO)";;
  *) fallo "INFO 31: $(info 31)";;
esac
# Sin datos personales ni importes en ninguna INFO.
if echo "$PRE" | grep "|INFO|" | grep -q -e "Nombre Privado" -e "900111222" -e "80000" -e "40000"; then
  fallo "una INFO expone nombre, NIT o importes"; else ok "ninguna INFO trae nombres, NIT ni importes"; fi

if [ "$FALLOS" = 0 ]; then echo "TODO OK"; else echo "FALLOS: $FALLOS"; exit 1; fi
