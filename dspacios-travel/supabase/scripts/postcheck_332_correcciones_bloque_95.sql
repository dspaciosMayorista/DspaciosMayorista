-- POSTCHECK 332 (correcciones del bloque #95/#61/#41/#42/#51/#33) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 332.
with f as (
  select p.proname, p.oid as fid, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('plan_cobro_fuentes', 'reemplazar_plan_cobro', 'duplicar_paquete_armado')
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existen las 3 funciones (una de cada)' as control, count(distinct proname)::text as observado, '3' as esperado, case when count(*) = 3 and count(distinct proname) = 3 then 'OK' else 'REVISAR' end as estado from f
  union all select 2, 'plan_cobro_fuentes es SECURITY DEFINER con search_path fijo (solo lee agregados y exige sesión + puede_ver_contrato)',
         coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') and prosrc like '%puede_ver_contrato%')::text from f where proname = 'plan_cobro_fuentes'), 'sin función'), 'true',
         case when coalesce((select (prosecdef and exists (select 1 from unnest(proconfig) x where x like 'search_path=%') and prosrc like '%puede_ver_contrato%') from f where proname = 'plan_cobro_fuentes'), false) then 'OK' else 'REVISAR' end
  union all select 3, 'reemplazar_plan_cobro es SECURITY INVOKER (rige la RLS de cuotas) con candado por contrato',
         coalesce((select ((not prosecdef) and prosrc like '%pg_advisory_xact_lock%' and prosrc like '%PLAN_COBRO_FUENTES_CAMBIARON%')::text from f where proname = 'reemplazar_plan_cobro'), 'sin función'), 'true',
         case when coalesce((select ((not prosecdef) and prosrc like '%pg_advisory_xact_lock%' and prosrc like '%PLAN_COBRO_FUENTES_CAMBIARON%') from f where proname = 'reemplazar_plan_cobro'), false) then 'OK' else 'REVISAR' end
  union all select 4, 'authenticated ejecuta; anon NO (las dos funciones del plan)',
         (select count(*) filter (where has_function_privilege('authenticated', fid, 'execute') and not has_function_privilege('anon', fid, 'execute'))::text from f where proname in ('plan_cobro_fuentes', 'reemplazar_plan_cobro')), '2',
         case when (select count(*) filter (where has_function_privilege('authenticated', fid, 'execute') and not has_function_privilege('anon', fid, 'execute')) from f where proname in ('plan_cobro_fuentes', 'reemplazar_plan_cobro')) = 2 then 'OK' else 'REVISAR' end
  union all select 5, 'duplicar_paquete_armado YA NO captura WHEN OTHERS y solo omite salida_vinculada_record',
         coalesce((select (prosrc not ilike '%when others%' and prosrc like '%salida_vinculada_record:%' and prosrc like '%when raise_exception%')::text from f where proname = 'duplicar_paquete_armado'), 'sin función'), 'true',
         case when coalesce((select (prosrc not ilike '%when others%' and prosrc like '%salida_vinculada_record:%' and prosrc like '%when raise_exception%') from f where proname = 'duplicar_paquete_armado'), false) then 'OK' else 'REVISAR' end
  union all select 6, 'duplicar_paquete_armado sigue SECURITY INVOKER, inactiva y sin generar tarifario',
         coalesce((select ((not prosecdef) and prosrc like '%o.moneda_publicacion, false%' and prosrc not ilike '%generar_tarifario%')::text from f where proname = 'duplicar_paquete_armado'), 'sin función'), 'true',
         case when coalesce((select ((not prosecdef) and prosrc like '%o.moneda_publicacion, false%' and prosrc not ilike '%generar_tarifario%') from f where proname = 'duplicar_paquete_armado'), false) then 'OK' else 'REVISAR' end
  union all select 8, 'R2-1: plan_cobro_fuentes deriva total y mínimo de la regla única (p75_priv.regla_confirmacion) y reemplazar_plan_cobro valida la suma contra el total de la base',
         coalesce((select ((select prosrc like '%p75_priv.regla_confirmacion%' and prosrc like '%pct_abono%' from f where proname = 'plan_cobro_fuentes') and (select prosrc like '%v_total := (v_act->>''total'')::numeric%' from f where proname = 'reemplazar_plan_cobro'))::text), 'sin función'), 'true',
         case when coalesce((select ((select prosrc like '%p75_priv.regla_confirmacion%' and prosrc like '%pct_abono%' from f where proname = 'plan_cobro_fuentes') and (select prosrc like '%v_total := (v_act->>''total'')::numeric%' from f where proname = 'reemplazar_plan_cobro'))), false) then 'OK' else 'REVISAR' end
  union all select 7, 'Cuotas existentes (debe ser igual al preflight: la 332 no crea ni borra cuotas por sí sola)', (select count(*) from public.cuotas)::text, 'igual que en el preflight', 'INFO'
) r order by orden;
