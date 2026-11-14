-- PREFLIGHT de la migración 305 (#14-A, recobro del carrito en la comisión B2B de reserva). SOLO LECTURA. UNA consulta integral: pegar completa ANTES de aplicarla. Si algún control dice REVISAR, NO aplicar.
select * from (
  select 1 as o, 'registrar_comision_b2b_reserva es EXACTAMENTE la de la 286 (md5)' as control,
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)')), 'NO EXISTE') as valor,
         'ebf1c8610d395d19b53d0e574e3bc365' as esperado,
         case when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)')) = 'ebf1c8610d395d19b53d0e574e3bc365' then 'OK'
              when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)')) = 'c2bb76e8dd4e3ce2814112ce6549fcd5' then 'YA APLICADA (305)'
              else 'REVISAR' end as estado
  union all select 2, 'La 286 (plan de comisión #97) está aplicada',
         (to_regclass('public.comision_plan') is not null)::text, 'true', case when to_regclass('public.comision_plan') is not null then 'OK' else 'REVISAR' end
  union all select 3, 'Las columnas de recobro de ventas existen (086)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name in ('recobro_total', 'recobro_empresa', 'recobro_aliado')), '3',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name in ('recobro_total', 'recobro_empresa', 'recobro_aliado')) = 3 then 'OK' else 'REVISAR' end
  union all select 4, 'Permisos actuales de la función (EXECUTE para authenticated y service_role, no para anon); la 305 los conserva',
         (has_function_privilege('authenticated', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and has_function_privilege('service_role', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and not has_function_privilege('anon', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute'))::text, 'true',
         case when has_function_privilege('authenticated', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and has_function_privilege('service_role', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and not has_function_privilege('anon', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') then 'OK' else 'REVISAR' end
  union all select 5, 'DIAGNÓSTICO: ventas B2B que HOY ya traen recobro (la 286 las trataba con recobro 0; la 305 solo cambia el registro de comisiones NUEVAS)',
         (select count(*)::text from public.ventas where tipo_asesor in ('agencia', 'freelance') and coalesce(recobro_total, 0) > 0), '(informativo)', 'INFO'
) q order by o;
