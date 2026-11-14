-- POSTCHECK de la migración 305 (#14-A). SOLO LECTURA. UNA consulta integral: pegar completa DESPUÉS de aplicarla. Si algún control dice REVISAR, ejecutar rollback_305_recobro_comision_reserva.sql.
select * from (
  select 1 as o, 'registrar_comision_b2b_reserva es la versión 305' as control,
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)')), 'NO EXISTE') as valor,
         'c2bb76e8dd4e3ce2814112ce6549fcd5' as esperado,
         case when (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.registrar_comision_b2b_reserva(text,bigint)')) = 'c2bb76e8dd4e3ce2814112ce6549fcd5' then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Permisos conservados (EXECUTE authenticated y service_role; no anon) y SECURITY DEFINER',
         (has_function_privilege('authenticated', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and has_function_privilege('service_role', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and not has_function_privilege('anon', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute')
           and (select prosecdef from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure))::text, 'true',
         case when has_function_privilege('authenticated', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and has_function_privilege('service_role', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute') and not has_function_privilege('anon', 'public.registrar_comision_b2b_reserva(text,bigint)', 'execute')
               and (select prosecdef from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 3, 'La función lee el recobro de la venta (regla #97) y conserva sus validaciones de rol, tenant, duplicado y estado',
         (select (position('recobro_total' in prosrc) > 0 and position('Un aliado solo registra su propia comisión' in prosrc) > 0 and position('ya tiene comisión B2B' in prosrc) > 0)::text from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure), 'true',
         case when (select position('recobro_total' in prosrc) > 0 and position('Un aliado solo registra su propia comisión' in prosrc) > 0 and position('ya tiene comisión B2B' in prosrc) > 0 from pg_proc where oid = 'public.registrar_comision_b2b_reserva(text,bigint)'::regprocedure) then 'OK' else 'REVISAR' end
  union all select 4, 'Los planes y filas de comisión existentes NO cambian (la 305 no modifica datos): conteos informativos',
         (select count(*)::text from public.comision_plan) || '|' || (select count(*)::text from public.aliados_b2b), '(los mismos que antes)', 'INFO'
) q order by o;
