#!/bin/sh
# #97 · concurrencia de la materialización: N sesiones simultáneas llaman a public.materializar_comision_b2b sobre el MISMO contrato confirmado
# → exactamente UNA fila exigible, y todas devuelven el mismo id. SOLO base LOCAL desechable con la 286 aplicada.
#   sh supabase/scripts/test_97_materializar_carrera.sh <base> [contenedor=pg97] [sesiones=8]
set -eu
DB="${1:?indica la base local desechable con la 286}"; CT="${2:-pg97}"; N="${3:-8}"
case "$DB" in postgres|plantilla*) echo "Base no permitida: $DB" >&2; exit 2;; esac
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="${TMPDIR:-/tmp}/m97_$$"; mkdir -p "$TMP"; trap 'rm -rf "$TMP"' EXIT
NUM="DTM-9990"
$PS <<SQL
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (970931, 'T97 carrera', 'agencia', 0.10, '900970931') on conflict (id) do nothing;
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('$NUM', 'C', 'mayorista', 1000000, 'COP', 'pendiente', 'B2B', 'agencia', 970931, 'comisionable', 100000, 'pendiente', 0, 'completo');
insert into public.comision_plan (cotizacion_id, numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total, recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado)
  values (null, '$NUM', (select contrato_uid from public.ventas where numero_contrato = '$NUM'), 1, 'mayorista', 0, 970931, 'agencia', 'COP', 1000000, 0, 0, 0, 1000000, 0.1000, 'aliado', 100000, 100000);
update public.ventas set estado = 'confirmado' where numero_contrato = '$NUM';
SQL
i=1
while [ "$i" -le "$N" ]; do
  ( echo "select public.materializar_comision_b2b('$NUM')" | $PS > "$TMP/r$i" 2>&1 ) &
  i=$((i + 1))
done
wait
filas="$($PS -c "select count(*) from public.aliados_b2b where numero_contrato = '$NUM'")"
ids="$(cat "$TMP"/r* | sort -u | tr '\n' ',')"
distintos="$(cat "$TMP"/r* | sort -u | wc -l | tr -d ' ')"
errores="$(grep -ci 'error' "$TMP"/r* | awk -F: '{s+=$2} END {print s+0}')"
echo "sesiones=$N filas=$filas ids_devueltos=[$ids] errores=$errores"
# limpieza (el plan es de solo inserción: se desactivan los triggers de usuario solo en esta sesión)
$PS <<SQL
set session_replication_role = replica;
delete from public.aliados_b2b where numero_contrato = '$NUM';
delete from public.comision_plan where numero_contrato = '$NUM';
delete from public.ventas where numero_contrato = '$NUM';
SQL
if [ "$filas" = "1" ] && [ "$distintos" = "1" ] && [ "$errores" = "0" ]; then echo "OK: una sola fila, mismo id en todas las sesiones, sin errores"; else echo "FALLA"; exit 1; fi
