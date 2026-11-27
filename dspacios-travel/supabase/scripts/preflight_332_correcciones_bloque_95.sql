-- PREFLIGHT 332 (correcciones del bloque #95/#61/#41/#42/#51/#33) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 332 (y después de la 331 si ya se corrió).
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existen cuotas, abonos, contrato_minimo_acuerdo y ventas' as control,
         (select count(*) from unnest(array['cuotas','abonos','contrato_minimo_acuerdo','ventas']) t where to_regclass('public.' || t) is not null)::text as observado, '4' as esperado,
         case when (select count(*) from unnest(array['cuotas','abonos','contrato_minimo_acuerdo','ventas']) t where to_regclass('public.' || t) is not null) = 4 then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Existen puede_ver_contrato(text) y mi_rol()', (to_regprocedure('public.puede_ver_contrato(text)') is not null and to_regprocedure('public.mi_rol()') is not null)::text, 'true',
         case when to_regprocedure('public.puede_ver_contrato(text)') is not null and to_regprocedure('public.mi_rol()') is not null then 'OK' else 'REVISAR' end
  union all select 3, 'La 331 ya está (duplicar_paquete_armado existe; si falta, correr primero la 331)', (to_regprocedure('public.duplicar_paquete_armado(bigint)') is not null)::text, 'true',
         case when to_regprocedure('public.duplicar_paquete_armado(bigint)') is not null then 'OK' else 'REVISAR' end
  union all select 4, 'Las funciones nuevas aún NO existen (las crea la 332)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('plan_cobro_fuentes', 'reemplazar_plan_cobro'))::text, '0',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('plan_cobro_fuentes', 'reemplazar_plan_cobro')) = 0 then 'OK' else 'REVISAR' end
  union all select 5, 'duplicar_paquete_armado AÚN captura WHEN OTHERS (la 332 lo acota)',
         coalesce((select (prosrc ilike '%when others%')::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'duplicar_paquete_armado'), 'sin función'), 'true (antes de la 332)', 'INFO'
  union all select 8, 'La 307 ya está (p75_priv.regla_confirmacion existe: la 332 la usa para derivar el mínimo; si falta, NO correr la 332)', (to_regprocedure('p75_priv.regla_confirmacion(text)') is not null)::text, 'true',
         case when to_regprocedure('p75_priv.regla_confirmacion(text)') is not null then 'OK' else 'REVISAR' end
  union all select 6, 'Contratos con filas de cuotas repetidas por orden hoy (anotar; la 332 no los toca)',
         (select count(*) from (select numero_contrato, orden from public.cuotas group by 1, 2 having count(*) > 1) d)::text, 'anotar', 'INFO'
  union all select 7, 'Cuotas existentes (anotar; la 332 no las toca)', (select count(*) from public.cuotas)::text, 'anotar', 'INFO'
) r order by orden;
