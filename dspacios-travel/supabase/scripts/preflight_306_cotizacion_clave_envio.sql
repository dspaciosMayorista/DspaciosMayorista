-- PREFLIGHT de la migración 306. SOLO LECTURA. UNA consulta integral: pegar completa ANTES de aplicarla. Si algún control dice REVISAR, NO aplicar.
select * from (
  select 1 as o, 'La tabla cotizaciones existe' as control, (to_regclass('public.cotizaciones') is not null)::text as valor, 'true' as esperado,
         case when to_regclass('public.cotizaciones') is not null then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Las columnas clave_envio / huella_envio / actor_envio NO existen todavía (si existen, la 306 ya se aplicó)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('clave_envio', 'huella_envio', 'actor_envio')), '0',
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name in ('clave_envio', 'huella_envio', 'actor_envio')) = 0 then 'OK' else 'REVISAR' end
  union all select 3, 'DIAGNÓSTICO: cotizaciones existentes (no se tocan)', (select count(*)::text from public.cotizaciones), '(informativo)', 'INFO'
) q order by o;
