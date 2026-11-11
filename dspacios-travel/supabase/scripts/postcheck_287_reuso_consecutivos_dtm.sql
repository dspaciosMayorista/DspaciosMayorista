-- POSTCHECK de la migración 287 (reutilización de consecutivos DTM, #75). SOLO LECTURA. UNA consulta integral.
-- Pegar completa en el editor SQL de Supabase DESPUÉS de aplicar la 287 y ANTES de desplegar el código.
-- Columnas: control · valor · esperado · estado (OK / REVISAR / INFO).
with
md as (select p.proname, md5(replace(p.prosrc, chr(13), '')) as m, p.prosecdef, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in ('eliminar_contrato','siguiente_numero_contrato_para_tenant','fn_renumerar_contrato','dtm_reuso_bloqueos','reservar_numero_contrato','contrato_reuso_preview','trg_ventas_reserva_dtm','dtm_valor_vacio'))
select * from (
  select 1 as o, 'Tabla numeros_dtm_liberados con RLS y 1 policy' as control,
         coalesce((select (c.relrowsecurity)::text || ' / ' || (select count(*) from pg_policy where polrelid = c.oid) from pg_class c where c.oid = to_regclass('public.numeros_dtm_liberados')), 'NO EXISTE') as valor, 'true / 1' as esperado,
         case when (select c.relrowsecurity and (select count(*) from pg_policy where polrelid = c.oid) = 1 from pg_class c where c.oid = to_regclass('public.numeros_dtm_liberados')) then 'OK' else 'REVISAR' end as estado
  union all select 2, 'anon sin ningún privilegio y authenticated solo SELECT sobre el pool',
         (select (not has_table_privilege('anon','public.numeros_dtm_liberados','select,insert,update,delete')
                  and has_table_privilege('authenticated','public.numeros_dtm_liberados','select')
                  and not has_table_privilege('authenticated','public.numeros_dtm_liberados','insert,update,delete'))::text), 'true',
         case when not has_table_privilege('anon','public.numeros_dtm_liberados','select,insert,update,delete') and has_table_privilege('authenticated','public.numeros_dtm_liberados','select') and not has_table_privilege('authenticated','public.numeros_dtm_liberados','insert,update,delete') then 'OK' else 'REVISAR' end
  union all select 3, 'ventas.reserva_token existe (uuid, nullable) y NINGUNA fila lo conserva',
         coalesce((select data_type || ' / ' || is_nullable from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='reserva_token'), 'NO EXISTE')
           || ' / filas con valor: ' || coalesce((select count(*)::text from public.ventas where reserva_token is not null), '?'), 'uuid / YES / filas con valor: 0',
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='reserva_token' and data_type='uuid' and is_nullable='YES')
               and (select count(*) from public.ventas where reserva_token is not null) = 0 then 'OK' else 'REVISAR' end
  union all select 4, 'Trigger trg_ventas_reserva_dtm (BEFORE INSERT, habilitado)',
         coalesce((select (case when tgenabled='O' then 'habilitado' else 'DESHABILITADO' end) || ' / ' || (case when tgtype & 2 = 2 then 'BEFORE' else 'AFTER' end) || ' / ' || (case when tgtype & 4 = 4 then 'INSERT' else '?' end)
                     from pg_trigger where tgname='trg_ventas_reserva_dtm' and tgrelid='public.ventas'::regclass), 'NO EXISTE'), 'habilitado / BEFORE / INSERT',
         case when exists (select 1 from pg_trigger where tgname='trg_ventas_reserva_dtm' and tgrelid='public.ventas'::regclass and tgenabled='O' and tgtype & 2 = 2 and tgtype & 4 = 4) then 'OK' else 'REVISAR' end
  union all select 5, 'Funciones nuevas SECURITY DEFINER: dtm_reuso_bloqueos, reservar_numero_contrato, contrato_reuso_preview, trg_ventas_reserva_dtm',
         (select count(*)::text || ' de 4' from md where proname in ('dtm_reuso_bloqueos','reservar_numero_contrato','contrato_reuso_preview','trg_ventas_reserva_dtm') and prosecdef), '4 de 4',
         case when (select count(*) from md where proname in ('dtm_reuso_bloqueos','reservar_numero_contrato','contrato_reuso_preview','trg_ventas_reserva_dtm') and prosecdef) = 4 then 'OK' else 'REVISAR' end
  union all select 6, 'dtm_reuso_bloqueos: sin EXECUTE para anon ni authenticated',
         (select (not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute'))::text from md where proname='dtm_reuso_bloqueos'), 'true',
         case when (select not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') from md where proname='dtm_reuso_bloqueos') then 'OK' else 'REVISAR' end
  union all select 7, 'reservar_numero_contrato: EXECUTE solo para service_role',
         (select (has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute'))::text from md where proname='reservar_numero_contrato'), 'true',
         case when (select has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') from md where proname='reservar_numero_contrato') then 'OK' else 'REVISAR' end
  union all select 8, 'contrato_reuso_preview: authenticated sí (el candado superadmin está dentro), anon no',
         (select (has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))::text from md where proname='contrato_reuso_preview'), 'true',
         case when (select has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') from md where proname='contrato_reuso_preview') then 'OK' else 'REVISAR' end
  union all select 9, 'eliminar_contrato es la versión de la 287 (md5) y conserva EXECUTE para authenticated',
         coalesce((select m from md where proname='eliminar_contrato'), 'NO EXISTE'), 'c7a510c064a67fd40e5cb84ea6a3d8d1',
         case when (select m from md where proname='eliminar_contrato') = 'c7a510c064a67fd40e5cb84ea6a3d8d1'
               and (select has_function_privilege('authenticated', oid, 'execute') from md where proname='eliminar_contrato') then 'OK' else 'REVISAR' end
  union all select 10, 'siguiente_numero_contrato_para_tenant NO cambió (md5 de la 159)',
         coalesce((select m from md where proname='siguiente_numero_contrato_para_tenant'), 'NO EXISTE'), '70f81595ac74f9e0c0b90bed19451d74',
         case when (select m from md where proname='siguiente_numero_contrato_para_tenant') = '70f81595ac74f9e0c0b90bed19451d74' then 'OK' else 'REVISAR' end
  union all select 11, 'fn_renumerar_contrato sigue siendo la de la 281 (la 287 no la toca)',
         (select (prosrc like '%f281%')::text from pg_proc where proname='fn_renumerar_contrato' limit 1), 'true',
         case when (select prosrc like '%f281%' from pg_proc where proname='fn_renumerar_contrato' limit 1) then 'OK' else 'REVISAR' end
  union all select 12, 'Prueba de humo de la elegibilidad (solo lectura): número inexistente | texto inválido | número libre al reutilizar',
         coalesce(array_to_string(public.dtm_reuso_bloqueos('DTM-0000', true), ','), '?') || ' | ' || coalesce(array_to_string(public.dtm_reuso_bloqueos('X', true), ','), '?')
           || ' | ' || coalesce(nullif(array_to_string(public.dtm_reuso_bloqueos('DTM-0000', false), ','), ''), 'sin motivos'),
         'NO_EXISTE | NO_ES_DTM | sin motivos',
         case when public.dtm_reuso_bloqueos('DTM-0000', true) = array['NO_EXISTE'] and public.dtm_reuso_bloqueos('X', true) = array['NO_ES_DTM']
               and cardinality(public.dtm_reuso_bloqueos('DTM-0000', false)) = 0 then 'OK' else 'REVISAR' end
  union all select 13, 'El escaneo no reporta lecturas fallidas sobre un número libre (ninguna tabla ilegible)',
         coalesce(nullif(array_to_string(array(select x from unnest(public.dtm_reuso_bloqueos('DTM-0000', false)) x where x like 'LECTURA_FALLIDA%'), ','), ''), 'ninguna'), 'ninguna',
         case when exists (select 1 from unnest(public.dtm_reuso_bloqueos('DTM-0000', false)) x where x like 'LECTURA_FALLIDA%') then 'REVISAR' else 'OK' end
  union all select 14, 'Pool de DTM liberados por estado (hoy)',
         coalesce((select string_agg(estado || '=' || n, ', ' order by estado) from (select estado, count(*) n from public.numeros_dtm_liberados group by estado) x), 'vacío'), 'vacío tras aplicar', 'INFO'
  union all select 15, 'Candidatos HOY: contratos mayorista pendientes cuyo ÚNICO motivo es REUSO_DESHABILITADO (cumplen las guardas; no es «seguro para reutilizar»)',
         (select count(*)::text from public.ventas v where v.tenant='mayorista' and v.estado='pendiente' and public.dtm_reuso_bloqueos(v.numero_contrato, true) <@ array['REUSO_DESHABILITADO']), '(informativo)', 'INFO'
  union all select 16, 'Pool de Minorista intacto (filas)', (select count(*)::text from public.numeros_contrato_liberados), '(igual que en el preflight)', 'INFO'
  union all select 17, 'Interruptor del reuso DTM (dtm_reuso_config.habilitado): DEBE seguir en false hasta que exista la protección contra escrituras de pantallas antiguas',
         coalesce((select habilitado::text from public.dtm_reuso_config limit 1), 'NO EXISTE'), 'false',
         case when (select habilitado from public.dtm_reuso_config limit 1) is false then 'OK' else 'REVISAR' end
  union all select 18, 'Con el interruptor apagado, la elegibilidad en vivo incluye REUSO_DESHABILITADO (probado con un contrato pendiente real, si existe)',
         coalesce((select array_to_string(public.dtm_reuso_bloqueos(v.numero_contrato, true), ',') like '%REUSO_DESHABILITADO%' from public.ventas v where v.tenant='mayorista' and v.estado='pendiente' order by v.numero_contrato limit 1)::text, 'sin contratos pendientes para probar'),
         'true', case when (select habilitado from public.dtm_reuso_config limit 1) is false and exists (select 1 from public.ventas v where v.tenant='mayorista' and v.estado='pendiente' and not ('REUSO_DESHABILITADO' = any (public.dtm_reuso_bloqueos(v.numero_contrato, true)))) then 'REVISAR' else 'OK' end
) q order by o;
