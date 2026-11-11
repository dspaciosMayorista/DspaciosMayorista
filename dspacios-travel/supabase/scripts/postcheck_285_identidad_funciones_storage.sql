-- POSTCHECK de la migración 285 (identidad: funciones, pendiente financiero y Storage, #75 entrega 2). SOLO LECTURA. UNA consulta integral.
-- Pegar completa DESPUÉS de aplicar la 285 y ANTES de desplegar el código. Columnas: control · valor · esperado · estado.
-- Complementa test_285_identidad_funciones_storage.sh y test_285_postgrest_storage.sh: NO demuestra que las acciones propaguen la identidad (eso lo cubre la suite de integración).
select * from (
  select 1 as o, 'contrato_financiero_pendiente.contrato_uid (uuid, nullable) y trigger de identidad habilitado' as control,
         coalesce((select data_type || ' / ' || is_nullable from information_schema.columns where table_schema='public' and table_name='contrato_financiero_pendiente' and column_name='contrato_uid'), 'NO EXISTE')
           || ' / trigger: ' || coalesce((select case when tgenabled = 'O' then 'habilitado' else 'DESHABILITADO' end from pg_trigger where tgname='trg_financiero_pendiente_identidad'), 'NO EXISTE') as valor,
         'uuid / YES / trigger: habilitado' as esperado,
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_financiero_pendiente' and column_name='contrato_uid' and data_type='uuid')
               and exists (select 1 from pg_trigger where tgname='trg_financiero_pendiente_identidad' and tgenabled='O') then 'OK' else 'REVISAR' end as estado
  union all select 2, 'Pendientes cuyo uid guardado NO coincide con el contrato vigente (debe ser 0: hoy ningún número se ha reutilizado)',
         (select count(*)::text from public.contrato_financiero_pendiente p where p.contrato_uid is distinct from (select v.contrato_uid from public.ventas v where v.numero_contrato = p.numero_contrato)), '0',
         case when not exists (select 1 from public.contrato_financiero_pendiente p where p.contrato_uid is distinct from (select v.contrato_uid from public.ventas v where v.numero_contrato = p.numero_contrato)) then 'OK' else 'REVISAR' end
  union all select 3, 'ventas_basica expone contrato_uid',
         (select count(*)::text from information_schema.columns where table_schema='public' and table_name='ventas_basica' and column_name='contrato_uid'), '1',
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas_basica' and column_name='contrato_uid') then 'OK' else 'REVISAR' end
  union all select 4, 'soporte_registrar / reemplazar / retirar ejecutan soporte_verificar_identidad antes de escribir',
         (select count(*)::text || ' de 3' from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
           where p.proname in ('soporte_registrar','soporte_reemplazar','soporte_retirar') and p.prosrc like '%soporte_verificar_identidad%'), '3 de 3',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
           where p.proname in ('soporte_registrar','soporte_reemplazar','soporte_retirar') and p.prosrc like '%soporte_verificar_identidad%') = 3 then 'OK' else 'REVISAR' end
  union all select 5, 'soporte_verificar_identidad: solo service_role puede ejecutarla',
         (select (has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))::text
            from pg_proc p where p.proname='soporte_verificar_identidad' and p.pronamespace='public'::regnamespace), 'true',
         case when (select has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
            from pg_proc p where p.proname='soporte_verificar_identidad' and p.pronamespace='public'::regnamespace) then 'OK' else 'REVISAR' end
  union all select 6, 'liberar_vencidas declara las identidades que leyó bajo bloqueo (tarea automática)',
         (select (p.prosrc like '%contrato_declarar_identidad%')::text from pg_proc p where p.proname='liberar_vencidas' and p.pronamespace='public'::regnamespace), 'true',
         case when (select p.prosrc like '%contrato_declarar_identidad%' from pg_proc p where p.proname='liberar_vencidas' and p.pronamespace='public'::regnamespace) then 'OK' else 'REVISAR' end
  union all select 7, 'Las 4 políticas del bucket «contratos» exigen contrato_identidad_ok_archivo además de acceso_archivo_contratos',
         (select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'contratos files:%'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%contrato_identidad_ok_archivo%' and (coalesce(qual,'')||coalesce(with_check,'')) like '%acceso_archivo_contratos%'), '4',
         case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'contratos files:%'
            and (coalesce(qual,'')||coalesce(with_check,'')) like '%contrato_identidad_ok_archivo%' and (coalesce(qual,'')||coalesce(with_check,'')) like '%acceso_archivo_contratos%') = 4 then 'OK' else 'REVISAR' end
  union all select 8, 'contrato_identidad_ok_archivo es VOLATILE (toma FOR KEY SHARE) y SECURITY DEFINER',
         (select p.provolatile::text || ' / ' || p.prosecdef::text from pg_proc p where p.proname='contrato_identidad_ok_archivo' and p.pronamespace='public'::regnamespace), 'v / true',
         case when (select p.provolatile = 'v' and p.prosecdef from pg_proc p where p.proname='contrato_identidad_ok_archivo' and p.pronamespace='public'::regnamespace) then 'OK' else 'REVISAR' end
  union all select 9, 'La 284 sigue íntegra (guardas instaladas sin deshabilitar)',
         (select count(*)::text || ' triggers, deshabilitados: ' || count(*) filter (where tgenabled <> 'O')::text from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal), '(>0, 0 deshabilitados)',
         case when (select count(*) from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal) > 0
               and not exists (select 1 from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal and tgenabled <> 'O') then 'OK' else 'REVISAR' end
  union all select 10, 'Las vistas ventas_vuelo_sistema y contrato_vuelos_editor exponen contrato_uid',
         (select count(*)::text || ' de 2' from information_schema.columns where table_schema='public' and table_name in ('ventas_vuelo_sistema','contrato_vuelos_editor') and column_name='contrato_uid'), '2 de 2',
         case when (select count(*) from information_schema.columns where table_schema='public' and table_name in ('ventas_vuelo_sistema','contrato_vuelos_editor') and column_name='contrato_uid') = 2 then 'OK' else 'REVISAR' end
) q order by o;
