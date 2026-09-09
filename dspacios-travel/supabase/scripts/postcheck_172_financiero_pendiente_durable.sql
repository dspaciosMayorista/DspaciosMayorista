-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 172. SOLO LECTURA. Correr DESPUÉS de aplicarla.
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) columnas nuevas en ventas ==='
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='ventas' and column_name in ('financiero_estado','financiero_actualizado_en')
order by column_name;
\echo 'esperado: financiero_actualizado_en | timestamp with time zone | NO | now() ; financiero_estado | text | NO | ''completo''::text'

\echo '=== B) CHECK de financiero_estado ==='
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint where conname = 'ventas_financiero_estado_check';
\echo 'esperado: CHECK (financiero_estado = ANY (ARRAY[''pendiente''::text, ''completo''::text]))'

\echo '=== C) contrato_financiero_pendiente: columnas + FK + RLS activa sin policies ==='
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='contrato_financiero_pendiente'
order by ordinal_position;

select
  con.conname,
  pg_get_constraintdef(con.oid) as definicion
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'contrato_financiero_pendiente' and con.contype = 'f';
\echo 'esperado: FOREIGN KEY (numero_contrato) REFERENCES ventas(numero_contrato) ON DELETE CASCADE'

select relrowsecurity as rls_activa
from pg_class where relname = 'contrato_financiero_pendiente';
select count(*) as policies_definidas
from pg_policies where tablename = 'contrato_financiero_pendiente';
\echo 'esperado: rls_activa = t | policies_definidas = 0 (default-deny: solo service_role, que bypassa RLS)'

\echo '=== C2) un contrato financiero pendiente no puede recibir abonos ==='
select
  to_regprocedure('public.bloquear_abono_financiero_pendiente()') is not null as funcion_presente,
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_bloquear_abono_financiero_pendiente'
      and not tgisinternal
  ) as trigger_presente;
\echo 'esperado: t | t'

\echo '=== D) las dos funciones siguen solo para service_role ==='
select
  p.proname,
  has_function_privilege('anon',          p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
  has_function_privilege('service_role',  p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('registrar_financiero_contrato','revertir_contrato_incompleto')
order by p.proname;
\echo 'esperado: anon = f | authenticated = f | service_role = t (en las dos)'

\echo '=== E) revertir_contrato_incompleto usa el MISMO bypass que eliminar_contrato (166), no uno nuevo ==='
select prosrc ilike '%set local app.eliminando_contrato = ''true''%'
   and prosrc ilike '%set local app.eliminando_contrato = ''false''%' as usa_el_bypass_166
from pg_proc where proname = 'revertir_contrato_incompleto';
\echo 'esperado: t'

select prosrc ilike '%delete from public.aliados_b2b%' as borra_aliados_b2b
from pg_proc where proname = 'revertir_contrato_incompleto';
\echo 'esperado: t (bug B corregido)'

select prosrc ilike '%asesor = null, hotel = null, acomodacion = null%' as reset_completo_sillas
from pg_proc where proname = 'revertir_contrato_incompleto';
\echo 'esperado: t (bug C corregido)'

\echo '=== F) registrar_financiero_contrato marca completo + limpia el pendiente en la MISMA función ==='
select
  prosrc ilike '%financiero_estado = ''completo''%' as marca_completo,
  prosrc ilike '%delete from public.contrato_financiero_pendiente%' as limpia_pendiente
from pg_proc where proname = 'registrar_financiero_contrato';
\echo 'esperado: t | t'

\echo '=== G) la migración no tocó datos existentes ==='
select count(*) as ventas, count(*) filter (where financiero_estado='pendiente') as pendientes
from public.ventas;
\echo 'esperado: mismo conteo de ventas que el preflight, pendientes = 0 (default completo — ningún contrato preexistente queda marcado incompleto)'
