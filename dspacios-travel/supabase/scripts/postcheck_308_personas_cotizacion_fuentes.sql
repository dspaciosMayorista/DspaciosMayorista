-- POSTCHECK 308 · personas de TODA cotización en el CRM (#1). SOLO LECTURA: UN único SELECT (sin BEGIN, ROLLBACK ni otra sentencia), una fila por control.
-- Correr DESPUÉS de aplicar la 308. Columnas: control · observado · esperado · veredicto (OK / FALLA / INFO). Todo debe dar OK.
-- No lee datos personales: solo catálogo y conteos.

with
f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_userbyid(p.proowner) as dueno
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('registrar_personas_cotizacion', 'sellar_creador_cotizacion')
),
otras as (
  select p.proname, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('actualizar_titular_cotizacion', 'crm_personas_cotizacion_buscar', 'buscar_personas_documento')
),
dueno_personas as (select pg_get_userbyid(c.relowner) as rol from pg_class c where c.oid = to_regclass('public.personas')),
dos as (select count(*) as n from f)
select control, observado, esperado, veredicto from (
  select 1 as ord, 'las dos fachadas existen (una sola firma cada una)' as control, (select n from dos)::text as observado, '2' as esperado,
         case when (select n from dos) = 2 then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'registrar_personas_cotizacion admite pendiente_tarifa',
         (select count(*) from f where proname = 'registrar_personas_cotizacion' and prosrc like '%not in (''abierta'', ''pendiente_tarifa'')%')::text, '1',
         case when (select count(*) from f where proname = 'registrar_personas_cotizacion' and prosrc like '%not in (''abierta'', ''pendiente_tarifa'')%') = 1 then 'OK' else 'FALLA' end
  union all
  select 3, 'registrar_personas_cotizacion define la anonimia de paquete dinámico y de solicitud de hotel',
         (select count(*) from f where proname = 'registrar_personas_cotizacion'
             and prosrc like '%q.tipo = ''manual'' and q.paquete_din_id is not null%'
             and prosrc like '%q.tipo = ''tarifario'' and q.creado_por is null and q.paquete_armado_id is not null%')::text, '1',
         case when (select count(*) from f where proname = 'registrar_personas_cotizacion'
             and prosrc like '%q.tipo = ''manual'' and q.paquete_din_id is not null%'
             and prosrc like '%q.tipo = ''tarifario'' and q.creado_por is null and q.paquete_armado_id is not null%') = 1 then 'OK' else 'FALLA' end
  union all
  select 4, 'sellar_creador_cotizacion admite pendiente_tarifa',
         (select count(*) from f where proname = 'sellar_creador_cotizacion' and prosrc like '%not in (''abierta'', ''pendiente_tarifa'')%')::text, '1',
         case when (select count(*) from f where proname = 'sellar_creador_cotizacion' and prosrc like '%not in (''abierta'', ''pendiente_tarifa'')%') = 1 then 'OK' else 'FALLA' end
  union all
  select 5, 'las dos fachadas siguen SECURITY DEFINER con search_path fijo',
         (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%pg_catalog%pg_temp%'))::text, '2',
         case when (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%pg_catalog%pg_temp%')) = 2 then 'OK' else 'FALLA' end
  union all
  select 6, 'privilegios: solo service_role ejecuta las fachadas (anon y authenticated no)',
         (select count(*) from f where has_function_privilege('service_role', oid, 'execute')
                                      and not has_function_privilege('anon', oid, 'execute')
                                      and not has_function_privilege('authenticated', oid, 'execute'))::text, '2',
         case when (select count(*) from f where has_function_privilege('service_role', oid, 'execute')
                                              and not has_function_privilege('anon', oid, 'execute')
                                              and not has_function_privilege('authenticated', oid, 'execute')) = 2 then 'OK' else 'FALLA' end
  union all
  select 7, 'dueño de las fachadas = dueño de public.personas',
         coalesce((select string_agg(distinct dueno, ',') from f), 'n/a') || ' / ' || coalesce((select rol from dueno_personas), 'n/a'), 'el mismo rol',
         case when (select count(distinct dueno) from f) = 1 and (select min(dueno) from f) = (select rol from dueno_personas) then 'OK' else 'FALLA' end
  union all
  select 8, 'actualizar_titular_cotizacion NO cambió (sigue solo para cotizaciones abiertas)',
         (select count(*) from otras where proname = 'actualizar_titular_cotizacion' and prosrc not like '%pendiente_tarifa%')::text, '1',
         case when (select count(*) from otras where proname = 'actualizar_titular_cotizacion' and prosrc not like '%pendiente_tarifa%') = 1 then 'OK' else 'FALLA' end
  union all
  select 9, 'la lista del CRM y la consulta por documento siguen presentes y sin tocar',
         (select count(*) from otras where proname in ('crm_personas_cotizacion_buscar', 'buscar_personas_documento') and prosrc not like '%pendiente_tarifa%')::text, '2',
         case when (select count(*) from otras where proname in ('crm_personas_cotizacion_buscar', 'buscar_personas_documento') and prosrc not like '%pendiente_tarifa%') = 2 then 'OK' else 'FALLA' end
  union all
  select 10, 'la 308 no creó tablas ni columnas: cotizacion_participantes conserva su RLS activa',
         coalesce((select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.cotizacion_participantes')), 'ausente'), 'true',
         case when coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.cotizacion_participantes')), false) then 'OK' else 'FALLA' end
  union all
  select 11, 'INFORMATIVO: puestos registrados por cotización de paquete dinámico de visitantes o solicitud de hotel (crece desde ahora)',
         (select count(*) from public.cotizacion_participantes cp join public.cotizaciones c on c.id = cp.cotizacion_id
           where (c.tipo = 'manual' and c.paquete_din_id is not null and c.creado_por_id is null)
              or (c.tipo = 'tarifario' and c.creado_por is null and c.paquete_armado_id is not null))::text,
         'cualquier valor', 'INFO'
) t order by ord;
