#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# PRUEBA DE CIERRE #43/#60: sin precios antiguos tras activar, actualizar o volver a todos los días (código real). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/cierre_43_precios_antiguos.sh <contenedor_pg> <plantilla> [paquetes=2]
# Base desechable (293 de la plantilla + 295 + 297 + 299 con sus fixtures) + N paquetes sintéticos de porción que usan el
# hotel 9301; el hotel 9303 no está en ningún paquete. PostgREST propio en red propia. Lo borra todo al final.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; NPAQ="${3:-2}"
IMAGEN_REST="${IMAGEN_REST:-public.ecr.aws/supabase/postgrest:v16.4}"
hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(hex 6)"; DB="c43_$TOKEN"; ROL="c43_auth_$TOKEN"; CLAVE="c$(hex 10)"; RED="redc43_$TOKEN"; REST="pgrstc43_$TOKEN"; SECRETO="local-c43-$(hex 24)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; docker rm -f "$REST" >/dev/null 2>&1 || true; docker network disconnect "$RED" "$CT" >/dev/null 2>&1 || true; docker network rm "$RED" >/dev/null 2>&1 || true
  $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; $PS -d postgres -c "drop role if exists $ROL" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
         supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql \
         supabase/migrations/20260601000298_calculadora_grupos_generales.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql supabase/scripts/fixture_299_grupos_dias_activacion.sql supabase/migrations/20260601000300_promociones_grupo.sql \
         supabase/migrations/20260601000301_promociones_acumulacion.sql supabase/migrations/20260601000302_desde_estadia_real.sql; do
  $PS -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
$PS -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
# Propuestas listas para aplicar (misma regla de edad en los grupos de ALTA) y PUENTE sin empate; N paquetes de porción con el hotel 9301.
$PS -d "$DB" >/dev/null <<EOF
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_sencilla, neto_doble, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
values ('00000000-0000-4000-8000-0000000c0001', 'Estándar', 'PAM', 150000, 95000, 0, 1, 2, 11);
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble) values ('00000000-0000-4000-8000-0000000c0003', 'Estándar', 'PAM', 90000);
update public.hotel_temporadas set prioridad = 2 where id = 930106;
insert into public.armado_paquetes (nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches)
  select 'C43 paquete ' || g, 9301, '2027-01-01', '2027-02-28', 0.2, 'porcion_terrestre', 3 from generate_series(1, $NPAQ) g;
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
  select id, 9301, array['Estándar'], array['PAM'] from public.armado_paquetes where nombre like 'C43 %';
-- Todos en COP: ningún fallo por moneda (el único motivo de no regenerar debe ser el de los grupos).
update public.armado_paquetes set moneda_publicacion = 'COP' where nombre like 'C43 %';
EOF
$PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" >/dev/null
$PS -d postgres -c "grant anon, authenticated, service_role to $ROL" >/dev/null
docker network create "$RED" >/dev/null; docker network connect "$RED" "$CT"
docker run -d --name "$REST" --network "$RED" -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" "$IMAGEN_REST" >/dev/null
URL="http://127.0.0.1:$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 30); do node -e "fetch('$URL/').then(()=>process.exit(0),()=>process.exit(1))" && break; node -e "setTimeout(()=>{},500)"; done
echo "PostgREST en $URL contra $DB · $NPAQ paquete(s) con el hotel 9301"
ARGS="--experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
TARIFARIO_PUBLICACION_POR_LOTES="${TARIFARIO_PUBLICACION_POR_LOTES:-}" C43_REST="$URL" C43_SECRETO="$SECRETO" C43_SQL="$PS -d $DB" node $ARGS supabase/scripts/cierre_43_precios_antiguos.mjs 2>&1 \
  | grep -v ExperimentalWarning | grep -v "^(node:" | grep -v "Use .node" | grep -v "register(" | grep -v "^--import"
