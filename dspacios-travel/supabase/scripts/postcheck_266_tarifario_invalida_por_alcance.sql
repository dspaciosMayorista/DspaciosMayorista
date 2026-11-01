-- Postcheck 266 (solo lectura, UNA consulta; columna estado por control). Esperado: todo OK.
select * from (
  select 1 as n, 'disparador sobre servicio_precio_alcance' as control, (select count(*) from pg_trigger where tgname = 'tarifario_trg_servicio_precio_alcance' and tgrelid = 'public.servicio_precio_alcance'::regclass and not tgisinternal)::text as actual, '1' as esperado
  union all select 2, 'disparador sobre servicio_suplementos_franja', (select count(*) from pg_trigger where tgname = 'tarifario_trg_servicio_suplementos_franja' and tgrelid = 'public.servicio_suplementos_franja'::regclass and not tgisinternal)::text, '1'
  union all select 3, 'disparador sobre servicios_adicionales (tipo_receptivo / combo_*)', (select count(*) from pg_trigger where tgname = 'tarifario_trg_servicios_alcance_catalogo' and tgrelid = 'public.servicios_adicionales'::regclass and not tgisinternal)::text, '1'
  union all select 4, 'funciones SECURITY DEFINER sin EXECUTE para anon/authenticated/public',
    (select count(*) from pg_proc p where p.proname in ('tarifario_trg_bump_por_vigencia_servicio','tarifario_trg_bump_servicio_alcance_catalogo') and p.prosecdef
        and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute'))::text, '2'
  union all select 5, 'tarifario_invalidar(bigint[], boolean) presente', (to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is not null)::text, 'true'
) q cross join lateral (select case when q.actual = q.esperado then 'OK' else 'FALLA' end as estado) e order by n;
