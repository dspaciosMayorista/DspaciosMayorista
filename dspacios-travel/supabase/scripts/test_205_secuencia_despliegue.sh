#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SECUENCIA REAL DE DESPLIEGUE · migración 205 — SOLO base LOCAL DESECHABLE
# en Docker (nunca remota). Prueba el intervalo SQL → despliegue:
#
#   1. Base en 201 (sin 205) + CÓDIGO VIEJO: crea comisiones con sus
#      payloads exactos (contrato manual, pestaña) y edita una a base 0.
#   2. Se aplica la 205 con el código viejo todavía desplegado.
#   3. El CÓDIGO VIEJO sigue escribiendo: inserta una base 0, una NETO de
#      reservar, una de recobro (RPC de cotización dinámica) y edita otra a 0.
#   4. Se "despliega" el código nuevo: cada fila anterior debe dar EXACTAMENTE
#      el importe que daba el código viejo (calcComisionB2B de origin/main,
#      extraído con git show) — y el espejo SQL también.
#   5. El código nuevo crea una base 0 (pestaña y reservar) → comisión 0, y
#      una "por valor" 3.250.000 / 300.000 → 300.000.
#
# Uso:  sh test_205_secuencia_despliegue.sh [contenedor] [plantilla_201] [commit_viejo]
#       (desde dspacios-travel/; crea y borra la base c38_seq_205)
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-pg201_review}"
PLANTILLA="${2:-e201}"
VIEJO="${3:-9f775561}"
DB=c38_seq_205
export MSYS_NO_PATHCONV=1
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
TMP=pruebas/.tmp205   # dentro del repo: Node (Windows) no ve el /tmp de Git Bash
mkdir -p "$TMP"
trap 'rm -rf "$TMP"; $SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

$SQL -d postgres -c "drop database if exists $DB" >/dev/null
n=0; until $SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 12 ] && { echo "No se pudo clonar $PLANTILLA (¿en uso?)"; exit 2; }; sleep 5
done
[ "$($SQL -d $DB -c "select to_regclass('public.vuelos_cierre_firmas_201') is not null and not exists (select 1 from information_schema.columns where table_name='aliados_b2b' and column_name='base_explicita')")" = t ] \
  || { echo "La plantilla no está en 201 sin 205"; exit 2; }

ADMIN="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000940501\",\"role\":\"authenticated\"}', true); set local role authenticated;"

# ── Fixtures (usuario administración, contratos) ──
$SQL -d $DB <<'EOF' >/dev/null
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000940501', 'seq205@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000940501', 'seq205@x.test', 'Seq 205', 'administracion', true, 'mayorista')
on conflict (id) do update set rol = 'administracion', activo = true, tenant = 'mayorista';
insert into public.aliados (id, nombre, nit, tipo, pct_comision) values (9405, 'Seq Agencia', '9', 'agencia', 0.1);
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, financiero_estado) values
  ('DTM-9401', 'C', 'mayorista', 1000000, 200000, 'agencia', null, null, null, null, 'completo'),
  ('DTM-9402', 'C', 'mayorista',  920000, 200000, 'agencia', 9405, 'neta', 80000, 'descontada', 'completo'),
  ('DTM-9403', 'C', 'mayorista', 1000000, 1000000, 'agencia', 9405, 'comisionable', 0, 'pendiente', 'pendiente');
EOF

# ── 1. Base 201 + código viejo (payloads EXACTOS de origin/main) ──
$SQL -d $DB -c "begin; $ADMIN
  -- crearContrato viejo: base = PVP; % ajustado a mano para cuadrar.
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9401', 'mayorista', 'A pre205 manual', null, 1000000, 1000000, 0.0833, 0, 0, false, 0, 'pendiente');
  -- crearComisionB2B viejo (pestaña) y luego actualizarComisionB2B viejo a base 0.
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9401', 'mayorista', 'B pre205 pestana editada a 0', null, 'freelance', null, 1000000, 1000000, 0.1, 50000, 0.5, false, 0, 'pendiente');
  update public.aliados_b2b set base_comision = 0, pct_comision = 0.1, recobro_total = 50000, pct_recobro_aliado = 0.5 where aliado = 'B pre205 pestana editada a 0';
  commit;" >/dev/null

# ── 2. Se aplica la 205 (código viejo aún desplegado) ──
docker cp "${M205:-supabase/migrations/20260601000205_comisiones_b2b_integridad.sql}" "$CT":/tmp/m205_seq.sql
$SQL -d $DB -f /tmp/m205_seq.sql >/dev/null

# ── 3. El código viejo sigue escribiendo tras la 205 ──
$SQL -d $DB -c "begin; $ADMIN
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9401', 'mayorista', 'C ventana pestana base 0', null, 'freelance', null, 1000000, 0, 0.1, 0, 0.5, false, 0, 'pendiente');
  -- reservar viejo en neta: base = baseComisB2B || precioVenta, estado 'pagada'.
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9402', 'mayorista', 'D ventana reservar neta', '9', 1000000, 800000, 0.1, 0, 0, false, 0, 'pagada');
  -- actualizarComisionB2B viejo: la fila A se edita a base 0.
  update public.aliados_b2b set base_comision = 0, pct_comision = 0.0833, recobro_total = 0, pct_recobro_aliado = 0 where aliado = 'A pre205 manual';
  commit;" >/dev/null
# Fila de recobro como la inserta convertir_cotizacion_a_contrato (SQL, sin pct).
$SQL -d $DB -c "insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
  values ('DTM-9401', 'mayorista', 'F ventana recobro cotizacion', 'freelance', 1000000, 100000, 200000, 0.5, 'pendiente');" >/dev/null

# ── 5. Código nuevo ──
$SQL -d $DB -c "begin; $ADMIN
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9401', 'mayorista', 'G nuevo pestana base 0', 'freelance', 1000000, 0, true, 0.1, 0, 0.5, false, 0, 'pendiente');
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values ('DTM-9401', 'mayorista', 'I nuevo por valor', 'freelance', 4000000, 3250000, true, 300000, 0.0923, 0, 0.5, false, 0, 'pendiente');
  select public.registrar_comision_b2b_reserva('DTM-9403', 9405);
  commit;" >/dev/null
$SQL -d $DB -c "update public.aliados_b2b set aliado = 'H nuevo reservar base 0' where numero_contrato = 'DTM-9403';" >/dev/null

# ── Comparación ──
$SQL -d $DB -c "select json_agg(json_build_object(
    'id', a.id, 'numero_contrato', a.numero_contrato, 'caso', a.aliado,
    'precio_venta', a.precio_venta, 'base_comision', a.base_comision, 'base_explicita', a.base_explicita,
    'comision_valor', a.comision_valor, 'pct_comision', a.pct_comision, 'recobro_total', a.recobro_total,
    'pct_recobro_aliado', a.pct_recobro_aliado, 'aplica_retencion', a.aplica_retencion, 'pct_retencion', a.pct_retencion,
    'estado', a.estado, 'descontada_en_precio', a.descontada_en_precio,
    'total_sql', public.comision_b2b_total(a),
    'esperado', case when a.aliado like 'G %' or a.aliado like 'H %' then '0'
                     when a.aliado like 'I %' then '300000' else 'igual' end) order by a.aliado)
  from public.aliados_b2b a" > "$TMP/filas.json"

git show "$VIEJO":dspacios-travel/lib/calc/finanzas.ts > "$TMP/finanzas_viejo.ts"
FILAS_205="$TMP/filas.json" FINANZAS_VIEJO="$TMP/finanzas_viejo.ts" \
  node --experimental-strip-types --experimental-loader ./pruebas/support/aliasLoader.mjs \
  supabase/scripts/test_205_secuencia_despliegue.compara.ts 2>&1 | grep -vE "ExperimentalWarning|--import|trace-warnings|MODULE_TYPELESS|Reparsing|eliminate this|^\(Use"
