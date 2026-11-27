#!/bin/sh
# Medición LOCAL de la lectura de actividad (#11, migración 343) con un volumen sintético de auditoría: tiempo y plan de fn_actividad_reciente(7) con N filas de auditoría repartidas en 90 días.
# Copia DESECHABLE de la plantilla; nunca contra una base real. Uso (desde dspacios-travel/):  sh supabase/scripts/medir_343_actividad_volumen.sh <contenedor_pg> <plantilla> [filas=300000]
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PL="${2:?plantilla}"; N="${3:-300000}"; DB="med343_$$"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -v ON_ERROR_STOP=1"
trap '$PS -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
$PS -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PL' and pid <> pg_backend_pid()" >/dev/null
$PS -q -d postgres -c "create database $DB template $PL" >/dev/null
$PS -q -d "$DB" -1 -f - < supabase/migrations/20260601000343_presencia_y_avisos_compra.sql >/dev/null 2>&1
# La plantilla trae el auth.uid() original; se usa el mismo sustituto que test_pg_local.sh (lee el sub del JWT de la sesión) para que mi_rol() reconozca al superadmin.
$PS -q -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" >/dev/null
$PS -d "$DB" -q -t -A <<SQL
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000f' || lpad(g::text, 4, '0'))::uuid, 'm' || g || '@x.test' from generate_series(1, 16) g on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) select ('00000000-0000-0000-0000-0000000f' || lpad(g::text, 4, '0'))::uuid, 'm' || g || '@x.test', 'M ' || g, (case when g = 1 then 'superadmin' else 'venta' end)::public.rol_usuario, true, 'mayorista' from generate_series(1, 16) g on conflict (id) do update set rol = excluded.rol, activo = true;
insert into public.auditoria (creado_en, actor_id, actor_email, accion, tabla, registro_id)
  select now() - (random() * interval '90 days'), ('00000000-0000-0000-0000-0000000f' || lpad((1 + floor(random() * 16))::int::text, 4, '0'))::uuid, 'x', 'UPDATE', 'ventas', g::text from generate_series(1, $N) g;
analyze public.auditoria;
select 'filas auditoria: ' || count(*) || ' · en 7 días: ' || count(*) filter (where creado_en >= now() - interval '7 days') || ' · en 30 días: ' || count(*) filter (where creado_en >= now() - interval '30 days') from public.auditoria;
SQL
for ventana in 7 30; do
  echo "--- fn_actividad_reciente($ventana) como superadmin (3 corridas, ms)"
  for i in 1 2 3; do
    $PS -d "$DB" -q -t -A <<SQL
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000f0001', true);
\timing on
select count(*) from public.fn_actividad_reciente($ventana);
rollback;
SQL
  done 2>&1 | grep -E "^Time|ERROR|^[0-9]+$" | paste -sd " " | cut -c1-260
done
echo "--- plan de la consulta interna (ventana 7 días)"
$PS -d "$DB" -q -t -A -c "explain (analyze, buffers, costs off, timing off) select x.actor_id, max(x.creado_en), count(*) from public.auditoria x where x.creado_en >= now() - make_interval(days => 7) and x.actor_id is not null group by x.actor_id" | head -12 | cut -c1-200
