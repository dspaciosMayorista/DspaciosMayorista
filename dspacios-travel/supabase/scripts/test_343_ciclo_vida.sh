#!/bin/sh
# Ciclo de vida de la migración 343 en una copia DESECHABLE de una plantilla (cadena hasta la 326): preflight -> aplicar -> postcheck -> reaplicar (idempotente) -> rollback (limpio) -> aplicar -> generar un aviso real ->
# rollback (DEBE negarse mientras haya avisos de compra vigentes) -> archivar -> rollback (limpio, CHECK de tipos restablecido). NUNCA contra una base real.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_343_ciclo_vida.sh <contenedor_pg> <plantilla>
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PL="${2:?plantilla}"; DB="ciclo343_$$"
S=supabase/scripts; MIG=supabase/migrations/20260601000343_presencia_y_avisos_compra.sql
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -v ON_ERROR_STOP=1"
trap '$PS -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
$PS -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PL' and pid <> pg_backend_pid()" >/dev/null
$PS -q -d postgres -c "create database $DB template $PL" >/dev/null
run() { echo "--- $1"; $PS -d "$DB" -f - < "$2" 2>&1 | grep -v "^$" | cut -c1-250 | head -${3:-16}; }
q() { $PS -d "$DB" -q -t -A -c "$1" 2>&1 | head -3; }
run "preflight 343 (antes)" $S/preflight_343_presencia_avisos_compra.sql
echo "--- aplicar 343"; $PS -q -d "$DB" -1 -f - < $MIG 2>&1 | grep -v "already a transaction\|no transaction in progress\|^$" | head -3
run "postcheck 343" $S/postcheck_343_presencia_avisos_compra.sql
echo "--- reaplicar 343 (idempotente)"; $PS -q -d "$DB" -1 -f - < $MIG 2>&1 | grep -v "already a transaction\|no transaction in progress\|NOTICE\|^$" | head -3
run "preflight 343 tras aplicar (debe marcar REVISAR: ya existe)" $S/preflight_343_presencia_avisos_compra.sql
run "rollback 343 (limpio)" $S/rollback_343_presencia_avisos_compra.sql 3
echo "tras rollback: presencia ausente=$(q "select to_regclass('public.presencia_usuario') is null") columna ventana ausente=$(q "select count(*) = 0 from information_schema.columns where table_name = 'avisos' and column_name = 'ventana_tipo'") CHECK: $(q "select pg_get_constraintdef(oid) from pg_constraint where conname = 'avisos_tipo_check'")"
echo "--- aplicar 343 de nuevo + un aviso real"; $PS -q -d "$DB" -1 -f - < $MIG 2>&1 | grep -v "already a transaction\|no transaction in progress\|NOTICE\|^$" | head -3
q "insert into public.destinos (id, nombre) values (99001, 'CICLO') on conflict do nothing" >/dev/null
q "insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin) values (99001, 'Ciclo 343', 99001, true, 'porcion_terrestre', 3, public.fecha_negocio() + 1)" >/dev/null
q "insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000990001', 'c343@x.test') on conflict do nothing" >/dev/null
q "insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000990001', 'c343@x.test', 'C', 'superadmin', true, 'mayorista') on conflict (id) do update set rol = 'superadmin', activo = true" >/dev/null
echo "generar: $(q "select public.generar_avisos_compra()")"
echo "avisos vigentes: $(q "select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null")"
echo "--- rollback con avisos vigentes (debe negarse)"; $PS -d "$DB" -f - < $S/rollback_343_presencia_avisos_compra.sql 2>&1 | grep -E "ROLLBACK 343 detenido|ERROR" | head -2 | cut -c1-250
echo "la función sigue existiendo tras el rollback negado: $(q "select to_regprocedure('public.generar_avisos_compra(date,integer)') is not null")"
q "update public.avisos set archivado_en = now() where tipo = 'compra_por_vencer'" >/dev/null
run "rollback 343 con todo archivado (limpio)" $S/rollback_343_presencia_avisos_compra.sql 3
echo "CHECK restablecido sin el tipo nuevo: $(q "select pg_get_constraintdef(oid) from pg_constraint where conname = 'avisos_tipo_check'")"
echo "avisos de compra restantes: $(q "select count(*) from public.avisos where tipo = 'compra_por_vencer'")"
