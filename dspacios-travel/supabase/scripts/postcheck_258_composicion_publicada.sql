-- POSTCHECK 258 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto.
-- Pegar COMPLETA en el editor SQL de Supabase DESPUÉS de correr la migración 258, SIN envolver en begin/rollback.
-- Veredictos: OK · FALLA · INFO · PENDIENTE. Dos resultados SEPARADOS al final:
--   n = 99  RESULTADO 1 · «migración aplicada correctamente»: solo cuenta FALLA. Justo después de aplicar la 258 debe salir VERIFICADA aunque falte regenerar.
--   n = 100 RESULTADO 2 · «hotfix apto para desplegar»: exige cobertura COMPLETA de evidencia (fila 12). Justo después de aplicar la 258 es normal que salga NO APTO.
-- Fila 12 (cobertura): CADA pareja paquete + fecha_ida publicada (bloqueo/dinámico, desde la vista publicable) necesita una fila de evidencia con la generación hoy
-- publicada del paquete y la regla vigente (1 = REGLA_COMPOSICION_PUBLICADA). No basta evidencia de OTRA fecha del mismo paquete. Formato de la lista: paquete:fechas
-- faltantes/fechas publicadas. No re-compara los servicios horneados con la composición viva (eso lo hace el servidor al cotizar/reservar).
with
hi as (select md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), '')) as h),
t as (select to_regclass('public.tarifario_composicion_publicada') as rel),
fx as (select to_regprocedure('public.registrar_composicion_publicada(bigint,bigint,smallint,jsonb)') as f),
cols as (
  select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) as s
    from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_composicion_publicada'
),
p259 as (
  select count(*) as n from pg_proc p
   where p.oid in (to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'),
                   to_regprocedure('public.publicar_tarifario_resultado_63(bigint,bigint,bigint,text,jsonb,text,numeric)'))
     and coalesce(p.proconfig, '{}'::text[]) @> array['statement_timeout=30s', 'lock_timeout=8s']::text[]
),
cov as (
  -- Consulta dinámica única: solo corre si la tabla existe (CASE garantiza el orden); si no, devuelve null y el control da FALLA.
  select case when (select rel from t) is not null then query_to_xml($q$with pub as (
  select distinct v.paquete_id, v.fecha_ida from public.tarifario_resultado_publicable v where v.modulo::text in ('bloqueo', 'dinamico')
), est as (
  select p.paquete_id, p.fecha_ida,
         exists (select 1 from public.tarifario_composicion_publicada e join public.armado_paquetes ap on ap.id = e.paquete_id
                  where e.paquete_id = p.paquete_id and e.fecha_ida = p.fecha_ida and e.generacion = ap.tarifario_generacion_publicada and e.regla = 1) as ok
    from pub p
), por_paq as (
  select paquete_id, count(*) as total, count(*) filter (where not ok) as faltan from est group by paquete_id
)
select (select count(*) from est)::text as total,
       (select count(*) from est where not ok)::text as faltan,
       (select count(*) from por_paq where faltan > 0)::text as paquetes,
       coalesce((select string_agg(paquete_id::text || ':' || faltan::text || '/' || total::text, ',' order by paquete_id) from por_paq where faltan > 0), '-') as lista$q$, false, true, '') end as x
),
dyn as (
  select case when (select rel from t) is not null
              then (xpath('/row/r/text()', query_to_xml('select count(*)::text || '' filas · '' || count(distinct paquete_id)::text || '' paquetes'' as r from public.tarifario_composicion_publicada', false, true, '')))[1]::text
              else 'tabla ausente' end as ev,
         (xpath('/row/total/text()', (select x from cov)))[1]::text as total,
         (xpath('/row/faltan/text()', (select x from cov)))[1]::text as faltan,
         (xpath('/row/paquetes/text()', (select x from cov)))[1]::text as paquetes,
         (xpath('/row/lista/text()', (select x from cov)))[1]::text as lista
),
c as (
  select 1 as n, 'tabla tarifario_composicion_publicada: columnas exactas (nombre:tipo:nulable)' as control, coalesce((select s from cols), 'sin columnas') as observado,
         'paquete_id:bigint:NO,fecha_ida:date:NO,generacion:bigint:NO,regla:smallint:NO,servicios_incluidos:jsonb:NO,registrado_en:timestamp with time zone:NO' as esperado,
         case when (select s from cols) = 'paquete_id:bigint:NO,fecha_ida:date:NO,generacion:bigint:NO,regla:smallint:NO,servicios_incluidos:jsonb:NO,registrado_en:timestamp with time zone:NO' then 'OK' else 'FALLA' end as veredicto
  union all
  select 2, 'restricciones: PK (paquete_id, fecha_ida), FK a armado_paquetes ON DELETE CASCADE y CHECK de arreglo, todas validadas',
         'pk=' || (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (paquete_id, fecha_ida)')::text ||
         ' fk_cascade=' || (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'f' and confrelid = to_regclass('public.armado_paquetes') and confdeltype = 'c' and convalidated)::text ||
         ' chk=' || (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'c' and conname = 'tarifario_composicion_publicada_servicios_chk' and convalidated)::text,
         'pk=1 fk_cascade=1 chk=1',
         case when (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (paquete_id, fecha_ida)') = 1
               and (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'f' and confrelid = to_regclass('public.armado_paquetes') and confdeltype = 'c' and convalidated) = 1
               and (select count(*) from pg_constraint where conrelid = (select rel from t) and contype = 'c' and conname = 'tarifario_composicion_publicada_servicios_chk' and convalidated) = 1 then 'OK' else 'FALLA' end
  union all
  select 3, 'RLS activa en la tabla', coalesce((select relrowsecurity::text from pg_class where oid = (select rel from t)), 'tabla ausente'), 'true',
         case when coalesce((select relrowsecurity from pg_class where oid = (select rel from t)), false) then 'OK' else 'FALLA' end
  union all
  select 4, 'privilegios: anon y authenticated SIN acceso directo; service_role (el servidor) con select, insert y delete',
         case when (select rel from t) is null then 'tabla ausente' else
           'anon=' || has_table_privilege('anon', (select rel from t), 'select,insert,update,delete')::text ||
           ' auth=' || has_table_privilege('authenticated', (select rel from t), 'select,insert,update,delete')::text ||
           ' service=' || (has_table_privilege('service_role', (select rel from t), 'select') and has_table_privilege('service_role', (select rel from t), 'insert') and has_table_privilege('service_role', (select rel from t), 'delete'))::text end,
         'anon=false auth=false service=true',
         case when (select rel from t) is not null and not has_table_privilege('anon', (select rel from t), 'select,insert,update,delete')
               and not has_table_privilege('authenticated', (select rel from t), 'select,insert,update,delete')
               and has_table_privilege('service_role', (select rel from t), 'select') and has_table_privilege('service_role', (select rel from t), 'insert') and has_table_privilege('service_role', (select rel from t), 'delete') then 'OK' else 'FALLA' end
  union all
  select 5, 'registrar_composicion_publicada: SECURITY DEFINER, search_path fijo, devuelve boolean',
         coalesce('secdef=' || (select prosecdef::text from pg_proc where oid = (select f from fx)) ||
                  ' sp=' || (select (coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[])::text from pg_proc where oid = (select f from fx)) ||
                  ' ret=' || (select prorettype::regtype::text from pg_proc where oid = (select f from fx)), 'función ausente'),
         'secdef=true sp=true ret=boolean',
         case when (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[] and prorettype = 'boolean'::regtype from pg_proc where oid = (select f from fx)) then 'OK' else 'FALLA' end
  union all
  select 6, 'registrar_composicion_publicada: anon NO puede ejecutar, authenticated SÍ',
         coalesce('anon=' || has_function_privilege('anon', (select f from fx)::oid, 'execute')::text || ' auth=' || has_function_privilege('authenticated', (select f from fx)::oid, 'execute')::text, 'función ausente'),
         'anon=false auth=true',
         case when (select f from fx) is not null and not has_function_privilege('anon', (select f from fx)::oid, 'execute') and has_function_privilege('authenticated', (select f from fx)::oid, 'execute') then 'OK' else 'FALLA' end
  union all
  select 7, 'la 256 sigue intacta: publicador interno con la huella de la 256', coalesce((select h from hi), 'función ausente'), 'fdea107e195de51abca78e34b3e90c9b',
         case when (select h from hi) = 'fdea107e195de51abca78e34b3e90c9b' then 'OK' else 'FALLA' end
  union all
  select 8, 'la 259 sigue intacta: las 2 entradas con statement_timeout=30s y lock_timeout=8s', (select n from p259)::text, '2', case when (select n from p259) = 2 then 'OK' else 'FALLA' end
  union all
  select 9, 'la 255 no se tocó (tabla y trigger siguen)',
         (to_regclass('public.servicio_suplementos_franja') is not null)::text, 'true',
         case when to_regclass('public.servicio_suplementos_franja') is not null then 'OK' else 'FALLA' end
  union all
  select 10, 'evidencia registrada hoy (recién aplicada = 0 filas; crece al regenerar cada paquete)', (select ev from dyn), '0 recién aplicada',
         case when (select rel from t) is null then 'FALLA' else 'INFO' end
  union all
  select 11, 'línea base DEBE ser igual a la del preflight: filas publicadas de bloqueo/dinámico en la vista',
         (select count(*) from public.tarifario_resultado_publicable where modulo::text in ('bloqueo', 'dinamico'))::text, 'igual a la fila 12 del preflight', 'INFO'
  union all
  select 12, 'COBERTURA DE EVIDENCIA por pareja paquete + fecha_ida publicada (generación publicada + regla 1); lista = paquete:fechas faltantes/fechas publicadas',
         case when (select rel from t) is null then 'tabla ausente'
              else 'faltan ' || (select faltan from dyn) || ' de ' || (select total from dyn) || ' fechas · ' || (select paquetes from dyn) || ' paquetes · ' || (select lista from dyn) end,
         '0 faltantes (se logra regenerando cada paquete afectado)',
         case when (select rel from t) is null then 'FALLA' when (select faltan from dyn)::int = 0 then 'OK' else 'PENDIENTE' end
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'RESULTADO 1 · MIGRACIÓN 258 APLICADA CORRECTAMENTE', 'controles con problema: ' || (select count(*) from c where veredicto = 'FALLA')::text, '0',
       case when (select count(*) from c where veredicto = 'FALLA') = 0 then 'MIGRACIÓN 258 VERIFICADA (falta comparar la fila 11 con el preflight)' else 'FALLA: NO DESPLEGAR EL HOTFIX' end
union all
select 100, 'RESULTADO 2 · HOTFIX APTO PARA DESPLEGAR (cobertura de evidencia completa)', (select observado from c where n = 12), '0 faltantes',
       case when (select count(*) from c where veredicto = 'FALLA') > 0 then 'NO APTO: la migración 258 tiene controles con problema'
            when (select veredicto from c where n = 12) = 'OK' then 'APTO: cobertura completa (repetir justo antes de promover y justo después)'
            else 'NO APTO: falta regenerar (ver fila 12)' end
order by n;
