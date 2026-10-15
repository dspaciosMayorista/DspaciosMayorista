-- POSTCHECK · #30 contrato manual NETO (migración 206, 20260601000206_contrato_manual_neto.sql) — SOLO LECTURA.
-- Correr DESPUÉS de aplicar la migración. Cualquier 'FALLA' es un problema.
begin;
set transaction read only;

with chequeos(orden, chequeo, ok) as (
  values
  (1, 'aplicar_neto_contrato_manual: SECURITY DEFINER con search_path fijo',
      exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.aplicar_neto_contrato_manual(text,bigint,numeric)')
                and p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=public, pg_temp%')),
  (2, 'aplicar_neto_contrato_manual: authenticated sí, anon y public no',
      has_function_privilege('authenticated', 'public.aplicar_neto_contrato_manual(text,bigint,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.aplicar_neto_contrato_manual(text,bigint,numeric)', 'execute')),
  (3, 'trigger de modalidad: activo, BEFORE UPDATE, función SECURITY INVOKER',
      exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
               where t.tgname = 'trg_ventas_modalidad_b2b_inmutable' and t.tgrelid = 'public.ventas'::regclass
                 and t.tgenabled = 'O' and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0 and (t.tgtype & 4) = 0
                 and not p.prosecdef)),
  (4, 'la 205 sigue intacta: registrar_comision_b2b_reserva / _manual y sus triggers',
      to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)') is not null
      and to_regprocedure('public.registrar_comision_b2b_manual(text,text,text,text,bigint,numeric,numeric,numeric,boolean,numeric)') is not null
      and (select count(*) from pg_trigger where tgname in ('trg_aliados_b2b_proteger_abonos','trg_comision_b2b_pagos_guardas',
            'trg_aliados_b2b_neto_no_borrar','trg_aliados_b2b_neto_sin_segunda')) = 4)
)
select orden, case when ok then 'OK' else 'FALLA' end as resultado, chequeo from chequeos order by 1;

rollback;
