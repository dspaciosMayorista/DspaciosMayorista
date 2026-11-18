-- PREFLIGHT 308 · personas de TODA cotización en el CRM (#1). SOLO LECTURA: UN único SELECT (sin BEGIN, ROLLBACK ni otra sentencia), una fila por control.
-- Correr ANTES de aplicar la 308, con el MISMO rol que la aplicará. Columnas: control · observado · esperado · veredicto.
--   veredicto OK       → listo para aplicar (o la 308 ya está aplicada: es idempotente).
--   veredicto REVISAR  → no aplicar hasta entender el valor observado.
--   veredicto INFO     → dato para el dueño, no bloquea.
-- No lee datos personales: solo catálogo y conteos.

with
f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_userbyid(p.proowner) as dueno
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('registrar_personas_cotizacion', 'sellar_creador_cotizacion')
),
dueno_personas as (select pg_get_userbyid(c.relowner) as rol from pg_class c where c.oid = to_regclass('public.personas')),
cols as (
  select count(*) as n from information_schema.columns
   where table_schema = 'public' and table_name = 'cotizaciones'
     and column_name in ('creado_por', 'creado_por_id', 'propietario_id', 'aliado_id', 'paquete_din_id', 'paquete_armado_id', 'estado', 'tipo')
),
sin_puesto as (
  select
    (select count(*) from public.cotizaciones c where c.estado = 'pendiente_tarifa'
        and not exists (select 1 from public.cotizacion_participantes cp where cp.cotizacion_id = c.id)) as pendientes_sin_puesto,
    (select count(*) from public.cotizaciones c where c.tipo = 'manual' and c.paquete_din_id is not null and c.creado_por_id is null
        and not exists (select 1 from public.cotizacion_participantes cp where cp.cotizacion_id = c.id)) as din_visitante_sin_puesto
)
select control, observado, esperado, veredicto from (
  select 1 as ord, '219 presente: registrar_personas_cotizacion y sellar_creador_cotizacion' as control,
         (select count(*) from f)::text as observado, '2' as esperado,
         case when (select count(*) from f) = 2 then 'OK' else 'REVISAR' end as veredicto
  union all
  select 2, 'p214_priv.cotizacion_anonima(text,text,uuid,uuid,bigint) presente',
         coalesce(to_regprocedure('p214_priv.cotizacion_anonima(text,text,uuid,uuid,bigint)')::text, 'ausente'),
         'p214_priv.cotizacion_anonima(text,text,uuid,uuid,bigint)',
         case when to_regprocedure('p214_priv.cotizacion_anonima(text,text,uuid,uuid,bigint)') is not null then 'OK' else 'REVISAR' end
  union all
  select 3, 'tabla cotizacion_participantes presente',
         coalesce(to_regclass('public.cotizacion_participantes')::text, 'ausente'), 'public.cotizacion_participantes',
         case when to_regclass('public.cotizacion_participantes') is not null then 'OK' else 'REVISAR' end
  union all
  select 4, 'columnas de cotizaciones que usa la 308 (creado_por, creado_por_id, propietario_id, aliado_id, paquete_din_id, paquete_armado_id, estado, tipo)',
         (select n from cols)::text, '8', case when (select n from cols) = 8 then 'OK' else 'REVISAR' end
  union all
  select 5, 'estado del texto de las dos fachadas',
         case when (select count(*) from f where prosrc like '%pendiente_tarifa%') = 2 then 'ya con 308'
              when (select count(*) from f where prosrc like '%pendiente_tarifa%') = 0 then 'texto de la 219 (sin 308)'
              else 'MEZCLA: una con 308 y otra sin' end,
         'texto de la 219 (sin 308) o ya con 308',
         case when (select count(*) from f where prosrc like '%pendiente_tarifa%') in (0, 2) then 'OK' else 'REVISAR' end
  union all
  select 6, 'las dos fachadas son SECURITY DEFINER con search_path fijo',
         (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%pg_catalog%pg_temp%'))::text, '2',
         case when (select count(*) from f where prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%pg_catalog%pg_temp%')) = 2 then 'OK' else 'REVISAR' end
  union all
  select 7, 'dueño de las fachadas = dueño de public.personas (la 308 conserva el dueño)',
         coalesce((select string_agg(distinct dueno, ',') from f), 'n/a') || ' / ' || coalesce((select rol from dueno_personas), 'n/a'),
         'el mismo rol',
         case when (select count(distinct dueno) from f) = 1 and (select min(dueno) from f) = (select rol from dueno_personas) then 'OK' else 'REVISAR' end
  union all
  select 8, 'privilegios actuales: solo service_role ejecuta las fachadas (anon y authenticated no)',
         (select count(*) from f where has_function_privilege('service_role', oid, 'execute')
                                      and not has_function_privilege('anon', oid, 'execute')
                                      and not has_function_privilege('authenticated', oid, 'execute'))::text, '2',
         case when (select count(*) from f where has_function_privilege('service_role', oid, 'execute')
                                              and not has_function_privilege('anon', oid, 'execute')
                                              and not has_function_privilege('authenticated', oid, 'execute')) = 2 then 'OK' else 'REVISAR' end
  union all
  select 9, 'rol actual puede reemplazar las fachadas (es el dueño o miembro de él)',
         current_user::text, 'dueño de las fachadas o miembro',
         case when (select bool_and(pg_has_role(current_user, dueno, 'member')) from f) then 'OK' else 'REVISAR' end
  union all
  select 10, 'INFORMATIVO: solicitudes de hotel pendientes de tarifa SIN puesto (la 308 no hace backfill)',
         (select pendientes_sin_puesto from sin_puesto)::text, 'cualquier valor (no se registran retroactivamente)', 'INFO'
  union all
  select 11, 'INFORMATIVO: cotizaciones de paquete dinámico de visitantes SIN puesto (la 308 no hace backfill)',
         (select din_visitante_sin_puesto from sin_puesto)::text, 'cualquier valor (no se registran retroactivamente)', 'INFO'
) t order by ord;
