#!/bin/sh
# Backfill + rollback proof for migration 338 on a DISPOSABLE database: 337 state with fixture data → preflight → 338 → postcheck + what the backfill did → rollback → 337 state again → 338 re-applied.
# Usage (from dspacios-travel/):  sh supabase/scripts/backfill_rollback_338.sh <pg_container> <template_db>      Output: stdout (redirect it to the evidence log).
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?container}"; PLANTILLA="${2:?template}"; DB="bf338_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -A -v ON_ERROR_STOP=1"
trap '$PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
M=supabase/migrations/20260601000
$PS -d postgres -t -c "create database $DB template $PLANTILLA" >/dev/null
for f in 334_destinos_aereos_alternativos_integridad 335_vuelos_sistema_exige_componente_aereo 336_conversion_cotizacion_reclamo 337_voucher_vuelo_atomico; do $PS -d "$DB" < "${M}${f}.sql" >/dev/null 2>&1; done
$PS -d "$DB" < supabase/scripts/fixture_backfill_338.sql >/dev/null
snap() { $PS -d "$DB" -t -c "select 'air vouchers: ' || count(*) || ' · md5 ' || coalesce(md5(string_agg(id || share_token::text || contenido::text, '|' order by id)), 'none') from public.vouchers where tipo = 'vuelo'"; }
echo "### state after 337 + fixture"; snap; ANTES="$(snap)"
echo; echo "### PREFLIGHT 338"; $PS -d "$DB" -F ' | ' < supabase/scripts/preflight_338_voucher_vuelo_servicios.sql
echo; echo "### APPLY 338"; $PS -d "$DB" < "${M}338_voucher_vuelo_por_servicio_y_revision.sql" >/dev/null; echo applied
echo; echo "### POSTCHECK 338"; $PS -d "$DB" -F ' | ' < supabase/scripts/postcheck_338_voucher_vuelo_servicios.sql
echo; echo "### WHAT THE BACKFILL DID (legs → service, vouchers → key/state)"
$PS -d "$DB" -F ' | ' -c "select numero_contrato, count(*) as legs, count(distinct servicio_aereo) as services, count(*) filter (where servicio_aereo is null) as unassociated from public.contrato_vuelos group by numero_contrato order by 1"
$PS -d "$DB" -F ' | ' -c "select v.numero_contrato, case when v.servicio_clave like 'legado-%' then 'legado-<id>' when v.servicio_clave = (select min(c.servicio_aereo::text) from public.contrato_vuelos c where c.numero_contrato = v.numero_contrato) then 'the contract''s only service' else '??' end as key, v.estado, v.revision from public.vouchers v where v.tipo = 'vuelo' order by 1"
echo; echo "### ROLLBACK 338"; $PS -d "$DB" < supabase/scripts/rollback_338_voucher_vuelo_servicios.sql >/dev/null; echo rolled-back
DESPUES="$(snap)"; echo "after rollback: $DESPUES"; [ "$ANTES" = "$DESPUES" ] && echo "VOUCHERS IDENTICAL BEFORE/AFTER (id, token, content)" || { echo "DIFFERENT"; exit 1; }
$PS -d "$DB" -t -c "select 'columns left: ' || count(*) from information_schema.columns where (table_name = 'vouchers' and column_name in ('servicio_clave','revision','actualizado_en','estado')) or (table_name in ('contrato_vuelos','contrato_vuelos_basica','contrato_vuelos_editor') and column_name = 'servicio_aereo')"
$PS -d "$DB" -t -c "select '337 function back: ' || (to_regprocedure('public.guardar_voucher_vuelo(text,jsonb)') is not null) || ' · 338 function gone: ' || (to_regprocedure('public.guardar_vouchers_vuelo(text,jsonb)') is null) || ' · editor returns ' || (select count(*) from pg_proc p, unnest(p.proargnames) a where p.proname = 'guardar_tramos_contrato' and a = 'servicio_aereo') || ' servicio_aereo column(s)'"
echo; echo "### RE-APPLY 338 after the rollback"; $PS -d "$DB" < "${M}338_voucher_vuelo_por_servicio_y_revision.sql" >/dev/null; echo re-applied; $PS -d "$DB" -F ' | ' < supabase/scripts/postcheck_338_voucher_vuelo_servicios.sql | grep -c "| OK$" | sed 's/^/postcheck OK rows: /'
