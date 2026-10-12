#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# Prueba LOCAL de los conteos preparados de #14 / PR #353:
#   conteo_incluidos_sin_proveedor.sql · conteo_payload_costos_incluidos.sql
# SOLO base LOCAL DESECHABLE en Docker (nunca remota): levanta un
# contenedor postgres propio, siembra un esquema MÍNIMO con datos
# sintéticos y lo elimina al terminar.
#
#   Bordes cubiertos:
#     · modo NULL y modo desconocido en un incluido → `modo_no_valido`
#       (y el paquete aparece por el HAVING);
#     · paqueteId numérico FUERA DE RANGO de bigint, como texto y como
#       número JSON, junto a uno válido y solo → no aborta la consulta;
#     · payloads con forma inesperada (objeto en vez de arreglo, null,
#       paqueteId no numérico).
#   Comprueba los valores EXACTOS de ambas consultas y que no escriben:
#   misma huella md5 de las tablas antes y después.
#
# Uso:  sh supabase/scripts/test_conteos_incluidos.sh [imagen]   (desde dspacios-travel/)
# ──────────────────────────────────────────────────────────────────
set -eu
IMAGEN="${1:-postgres:16-alpine}"
CT="pg_conteos_incluidos_$$"
export MSYS_NO_PATHCONV=1
DIR="$(cd "$(dirname "$0")" && pwd)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT

docker run -d --rm --name "$CT" -e POSTGRES_PASSWORD=x "$IMAGEN" >/dev/null
until docker exec "$CT" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
SQL="docker exec -i $CT psql -U postgres -h 127.0.0.1 -X -q -t -A -F | -v ON_ERROR_STOP=1"

# ── Esquema mínimo y datos sintéticos (sin PII ni importes reales) ──
$SQL <<'EOF'
create table proveedores (id bigint primary key, nombre text not null);
create table armado_paquetes (id bigint primary key, activo boolean not null default true);
create table servicios_adicionales (id bigint primary key, precio_persona numeric, proveedor_id bigint references proveedores(id));
-- `modo` admite NULL aquí a propósito: simula una base con datos que no
-- respetan el default (la consulta no debe depender de la restricción).
create table armado_servicios (paquete_id bigint references armado_paquetes(id), servicio_id bigint references servicios_adicionales(id), modo text, incluido boolean not null default false);
create table servicio_tarifa_pax (servicio_id bigint references servicios_adicionales(id), temporada text not null default 'GENERAL', precio numeric not null default 0);
create table cotizaciones (id bigint primary key, tipo text, estado text, tenant text, created_at timestamptz, vigencia_hasta date, payload jsonb);
insert into proveedores values (5, 'P');
insert into armado_paquetes values (34, true), (35, true), (36, false), (37, true), (38, true), (39, true);
insert into servicios_adicionales values (9, 40000, 5), (10, 30000, null), (11, null, null), (12, 0, null), (13, 0, null), (14, 25000, null);
insert into armado_servicios values
  (34, 9, 'persona', true), (34, 10, 'persona', true),   -- 34: uno con costo sin proveedor
  (35, 11, 'grupo', true), (35, 12, 'persona', true),    -- 35: grupo sin proveedor con rango > 0
  (36, 13, 'raro', true),                                 -- 36 (inactivo): modo desconocido
  (37, 10, 'persona', false),                             -- 37: no incluido, no cuenta
  (38, 14, null, true),                                   -- 38: modo NULL (aunque tenga costo y sin proveedor)
  (39, 9, 'persona', true);                               -- 39: todo en orden, no aparece
insert into servicio_tarifa_pax values (11, 'GENERAL', 70000), (11, 'ALTA', 0);
insert into cotizaciones values
 (1,  'carrito', 'abierta',    'mayorista', '2026-09-10', '2030-01-01', '{"items":[{"paqueteId":34}],"serviciosIncluidos":[{"servicioId":9,"costoNeto":40000,"proveedorId":5,"paqueteId":34}]}'),
 (2,  'carrito', 'convertida', 'mayorista', '2026-09-11', '2026-09-20', '{"serviciosIncluidos":[{"servicioId":9,"paqueteId":34}]}'),
 (3,  'carrito', 'abierta',    'mayorista', '2026-10-01', '2030-01-01', '{"serviciosIncluidos":[{"servicioId":9,"huella":"x","huellaProveedor":"y","ref":"item-0","paqueteId":34}]}'),
 (4,  'carrito', 'abierta',    'mayorista', '2026-10-02', '2026-10-03', '{"items":[{"paqueteId":34},{"paqueteId":"abc"}],"serviciosIncluidos":[]}'),
 (5,  'carrito', 'abierta',    'mayorista', '2026-10-02', '2030-01-01', '{"items":"no-arreglo","serviciosIncluidos":{"raro":true}}'),
 (6,  'carrito', 'abierta',    'minorista', '2026-10-05', '2030-01-01', '{"items":[{"paqueteId":34,"modeloTarifario":"unidad"}]}'),
 (7,  'manual',  'abierta',    'mayorista', '2026-10-05', '2030-01-01', '{"serviciosIncluidos":[{"costoNeto":1}]}'),
 (8,  'carrito', 'abierta',    'mayorista', '2026-10-06', '2030-01-01', null),
 -- paqueteId fuera del rango de bigint (texto y número JSON) junto a uno válido: cuenta por el 35.
 (9,  'carrito', 'abierta',    'mayorista', '2026-10-07', '2030-01-01', '{"items":[{"paqueteId":"99999999999999999999"},{"paqueteId":99999999999999999999},{"paqueteId":35}],"serviciosIncluidos":[]}'),
 -- solo paqueteId fuera de rango: no cuenta y no aborta.
 (10, 'carrito', 'abierta',    'mayorista', '2026-10-08', '2030-01-01', '{"items":[{"paqueteId":"92233720368547758070"}]}');
EOF

huella() {
  $SQL -c "select md5(string_agg(t::text, ',' order by t::text)) from (
    select 'c'||c::text as t from cotizaciones c union all select 'a'||a::text from armado_servicios a
    union all select 's'||s::text from servicios_adicionales s union all select 'p'||p::text from armado_paquetes p) x;"
}
ANTES="$(huella)"

# ── 1) Incluidos con costo y sin proveedor ──────────────────────────
OBT="$($SQL < "$DIR/conteo_incluidos_sin_proveedor.sql" 2>&1)" || true   # un error SQL se reporta como FALLO
ESP="34|t|2|2|1|0|0
35|t|2|1|1|1|0
38|t|1|0|0|0|1
36|f|1|0|0|0|1"
if [ "$OBT" = "$ESP" ]; then ok "conteo_incluidos_sin_proveedor: valores exactos (modo NULL y desconocido cuentan como no válidos)"
else fallo "conteo_incluidos_sin_proveedor
--- esperado
$ESP
--- obtenido
$OBT"; fi

# ── 2) Payloads con costos y abiertas sin incluidos guardados ───────
OBT="$($SQL < "$DIR/conteo_payload_costos_incluidos.sql" 2>&1)" || true
ESP="mayorista|abierta|2026-09-01|1|1|1|0|0|0
mayorista|convertida|2026-09-01|1|0|0|0|1|1
mayorista|abierta|2026-10-01|1|0|0|1|0|0
mayorista|2026-10-01|2|1"
if [ "$OBT" = "$ESP" ]; then ok "conteo_payload_costos_incluidos: valores exactos (paqueteId fuera de rango no aborta ni cuenta)"
else fallo "conteo_payload_costos_incluidos
--- esperado
$ESP
--- obtenido
$OBT"; fi

# ── 3) No escriben nada ─────────────────────────────────────────────
DESPUES="$(huella)"
if [ "$ANTES" = "$DESPUES" ]; then ok "ninguna consulta modificó datos (misma huella md5)"; else fallo "las tablas cambiaron"; fi
if $SQL -c "begin read only; update cotizaciones set estado = 'x'; rollback;" >/dev/null 2>&1; then
  fallo "la transacción read only aceptó una escritura"
else ok "una escritura dentro de 'begin read only' se rechaza"; fi

[ "$FALLOS" -eq 0 ] && echo "TODO OK" || { echo "$FALLOS FALLO(S)"; exit 1; }
