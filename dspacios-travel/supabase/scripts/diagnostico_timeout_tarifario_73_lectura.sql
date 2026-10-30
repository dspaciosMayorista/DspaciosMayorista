-- Diagnóstico de SOLO LECTURA · timeout de generarTarifario · paquete 73 · UNA consulta, con columna de estado.
-- Pegar completa en el editor SQL de Supabase y devolver las filas tal cual. Acotada al paquete 73: no devuelve texto de sentencias, correos,
-- nombres de usuario ni datos de otros paquetes. Las secciones 12-14 son conteos/tiempos globales de la base (sin contenido de nadie).
-- Para otro paquete (p. ej. el 33), cambiar SOLO el 73 de la primera línea del CTE `p`; la consulta es idéntica.
with p as (select 73::bigint as id),
pq as (select a.* from public.armado_paquetes a join p on p.id = a.id),
hot as (  -- hoteles del paquete que SÍ generan filas legacy (los de modelo 'unidad' se excluyen del generador)
  select ah.hotel_id, ah.categorias, ah.regimenes, h.modelo_tarifario
  from public.armado_hoteles ah join p on p.id = ah.paquete_id join public.hoteles h on h.id = ah.hotel_id
),
combos as (  -- (categoría, régimen) con tarifa por hotel, respetando la ventana de categorías/regímenes del paquete
  select h.hotel_id, count(distinct (t.tipo_habitacion, t.alimentacion)) as n
  from hot h join public.tarifa_hotel t on t.hotel_id = h.hotel_id
  where coalesce(h.modelo_tarifario, '') <> 'unidad'
    and (h.categorias is null or cardinality(h.categorias) = 0 or t.tipo_habitacion = any (h.categorias))
    and (h.regimenes  is null or cardinality(h.regimenes)  = 0 or t.alimentacion   = any (h.regimenes))
  group by h.hotel_id
),
sal as (select s.* from public.salidas_dinamicas s join p on p.id = s.paquete_id),
mult as (  -- cuántas "estadías" liquida el generador según el tipo (salidas / vuelos+empaquetados / 1)
  select case (select tipo::text from pq)
           when 'dinamico' then (select count(*) from sal where activo and fecha_ida is not null and fecha_regreso is not null and fecha_ida >= (now() at time zone 'America/Bogota')::date)
           when 'bloqueo' then (select count(*) from public.armado_vuelos v join p on p.id = v.paquete_id) + (select count(*) from public.armado_empaquetados e join p on p.id = e.paquete_id)
           when 'porcion_terrestre' then 1
           else 0 end as m
),
srvfilas as (  -- filas de servicios NO incluidos: 1 por persona; 1 por rango de pax si es por grupo
  select coalesce(sum(case when s.modo = 'grupo' then (select count(*) from public.servicio_tarifa_pax g where g.servicio_id = s.servicio_id and g.temporada = 'GENERAL') else 1 end), 0) as n
  from public.armado_servicios s join p on p.id = s.paquete_id where not s.incluido
),
est as (select (select coalesce(sum(n), 0) from combos) * 7 * (select m from mult) + (select n from srvfilas) as filas_max),
res as (select r.* from public.tarifario_resultado r join p on p.id = r.paquete_id),
tab as (select * from pg_stat_user_tables where relid = 'public.tarifario_resultado'::regclass),
cfg as (
  select
    (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticated' and c like 'statement_timeout=%') as st_auth,
    (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticator'  and (c like 'statement_timeout=%' or c like 'lock_timeout=%')) as lt_authr,
    (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticator'  and c like 'pgrst.db_max_rows%') as maxrows,
    (select coalesce(string_agg(c, ' '), '-') from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) c where r.rolname = 'authenticated' and c like 'lock_timeout=%') as lt_auth
)
select * from (
  select 1 as n, 'estado de generación del paquete' as seccion,
         (select concat('tipo=', tipo, ' modo_oferta=', coalesce(modo_oferta, '-'), ' moneda_pub=', coalesce(moneda_publicacion, '-'), ' activo=', activo, ' estado=', tarifario_estado,
                        ' generacion=', tarifario_generacion, ' generacion_publicada=', coalesce(tarifario_generacion_publicada::text, 'NUNCA'),
                        ' revision_fuente=', tarifario_revision_fuente, ' revision_publicada=', coalesce(tarifario_revision_publicada::text, 'NUNCA'),
                        ' snapshot_publicable=', tarifario_snapshot_publicable, ' actualizado=', coalesce(tarifario_actualizado_en::text, '-')) from pq) as lectura,
         case when (select tarifario_generacion_publicada from pq) is null then 'REVISAR: ninguna generación se ha publicado nunca' else 'INFO' end as estado
  union all
  select 2, 'mensaje de error guardado (texto fijo de la app, no de Postgres)', (select coalesce(left(tarifario_error, 400), '(sin error)') from pq), 'INFO'
  union all
  select 3, 'fuentes: hoteles total / por unidad / servicios total / no incluidos / vuelos / empaquetados',
         (select concat((select count(*) from hot), ' / ', (select count(*) from hot where modelo_tarifario = 'unidad'), ' / ',
                        (select count(*) from public.armado_servicios s join p on p.id = s.paquete_id), ' / ',
                        (select count(*) from public.armado_servicios s join p on p.id = s.paquete_id where not s.incluido), ' / ',
                        (select count(*) from public.armado_vuelos v join p on p.id = v.paquete_id), ' / ',
                        (select count(*) from public.armado_empaquetados e join p on p.id = e.paquete_id))), 'INFO'
  union all
  select 4, 'salidas dinámicas: total / activas con viaje futuro / vinculadas a empaquetado',
         (select concat((select count(*) from sal), ' / ', (select m from mult), ' / ', (select count(*) from sal where empaquetado_id is not null))), 'INFO'
  union all
  select 5, 'tarifas de hotel que lee el generador (filas tarifa_hotel / temporadas de esos hoteles)',
         (select concat((select count(*) from public.tarifa_hotel t where t.hotel_id in (select hotel_id from hot where coalesce(modelo_tarifario, '') <> 'unidad')), ' / ',
                        (select count(*) from public.hotel_temporadas x where x.hotel_id in (select hotel_id from hot where coalesce(modelo_tarifario, '') <> 'unidad')))),
         case when (select count(*) from public.tarifa_hotel t where t.hotel_id in (select hotel_id from hot where coalesce(modelo_tarifario, '') <> 'unidad')) >= 1000
              then 'REVISAR: compara con max_rows (fila 11): el generador lee tarifa_hotel SIN paginar' else 'INFO' end
  union all
  select 6, 'combinaciones (categoría×régimen) con tarifa, sumadas sobre los hoteles', (select coalesce(sum(n), 0)::text from combos), 'INFO'
  union all
  select 7, 'ESTIMACIÓN: filas máximas que enviaría a publicar (combos × 7 acomodaciones × estadías + servicios)', (select filas_max::text from est),
         case when (select filas_max from est) > 20000 then 'REVISAR: volumen alto' else 'INFO' end
  union all
  select 8, 'filas publicadas hoy del paquete / bytes aprox. / mín y máx created_at',
         (select concat(count(*), ' / ', coalesce(sum(pg_column_size(res.*)), 0), ' / ', coalesce(min(created_at)::text, '-'), ' / ', coalesce(max(created_at)::text, '-')) from res),
         case when (select count(*) from res) = 0 then 'REVISAR: cero filas publicadas' else 'INFO' end
  union all
  select 9, 'filas publicadas por módulo y moneda', (select coalesce(string_agg(modulo::text || '/' || moneda || '=' || c, ', '), '-') from (select modulo, moneda, count(*) c from res group by 1, 2) q), 'INFO'
  union all
  select 10, 'tarifario_resultado (toda la tabla): filas vivas / muertas / tamaño total / último autovacuum',
         (select concat(n_live_tup, ' / ', n_dead_tup, ' / ', pg_size_pretty(pg_total_relation_size('public.tarifario_resultado')), ' / ', coalesce(last_autovacuum::text, 'nunca')) from tab),
         case when (select n_dead_tup from tab) > (select greatest(n_live_tup, 1) from tab) * 0.2 then 'REVISAR: más de 20% de tuplas muertas' else 'INFO' end
  union all
  select 11, 'límites: statement_timeout(authenticated) / timeouts(authenticator) / lock_timeout(authenticated) / pgrst.db_max_rows',
         (select concat(st_auth, ' / ', lt_authr, ' / ', lt_auth, ' / ', maxrows) from cfg), 'INFO'
  union all
  select 12, 'publicador instalado: fachada con interno (234) / cuerpo set-based "with ordinality" (229; false = bucle por fila de la 226)',
         (select concat(coalesce((select 'interno(234)' from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), 'sin interno (anterior a la 234)'), ' / ',
                        coalesce((select (prosrc ilike '%with ordinality%')::text from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')),
                                 (select (prosrc ilike '%with ordinality%')::text from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)'))))),
         case when coalesce((select prosrc ilike '%with ordinality%' from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')),
                            (select prosrc ilike '%with ordinality%' from pg_proc where oid = to_regprocedure('public.publicar_tarifario_resultado(bigint,bigint,bigint,text,jsonb)')), false)
              then 'INFO' else 'REVISAR: el publicador instalado NO es el set-based de la 229 (publica fila por fila)' end
  union all
  -- Línea de tiempo del paquete: cada intento deja 3 escrituras auditadas (iniciar → publicar|fallida). Solo fecha, acción y campos de generación.
  select 20 + row_number() over (order by a.creado_en desc), 'auditoría armado_paquetes del paquete consultado (más reciente primero): fecha | generacion | estado | tarifario_error (sí/no)',
         concat(a.creado_en, ' | gen ', coalesce(a.cambios->'tarifario_generacion'->>'despues', '·'), ' | ', coalesce(a.cambios->'tarifario_estado'->>'despues', '·'), ' | ',
                case when a.cambios ? 'tarifario_error' then (case when a.cambios->'tarifario_error'->>'despues' is null then 'error limpiado' else 'error escrito' end) else '·' end),
         'INFO'
  from public.auditoria a join p on a.registro_id = p.id::text
  where a.tabla = 'armado_paquetes' and a.accion = 'UPDATE' and (a.cambios ? 'tarifario_generacion' or a.cambios ? 'tarifario_estado')
    and a.creado_en > now() - interval '30 days'
  union all
  select 100, 'ahora: sesiones esperando un candado / transacciones "idle in transaction" > 30 s / consultas activas > 5 s',
         (select concat((select count(*) from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()), ' / ',
                        (select count(*) from pg_stat_activity where state like 'idle in transaction%' and xact_start < now() - interval '30 seconds' and datname = current_database()), ' / ',
                        (select count(*) from pg_stat_activity where state = 'active' and query_start < now() - interval '5 seconds' and pid <> pg_backend_pid() and datname = current_database()))),
         'INFO'
) t order by n;

-- OPCIONAL, APARTE (solo si existe pg_stat_statements). Solo agregados por función; NO devuelve texto de ninguna sentencia.
-- select case when query ilike '%publicar_tarifario_resultado_63%' then 'publicar_..._63'
--             when query ilike '%publicar_tarifario_resultado%' then 'publicar_tarifario_resultado'
--             when query ilike '%iniciar_generacion_tarifario%' then 'iniciar_generacion_tarifario'
--             else 'marcar_generacion_fallida' end as funcion,
--        sum(calls) as llamadas, round(avg(mean_exec_time))::int as media_ms, round(max(max_exec_time))::int as maximo_ms,
--        round(avg(rows)) as filas_media, round(avg(shared_blks_hit + shared_blks_read)) as bloques_por_llamada
--   from pg_stat_statements
--  where query ilike '%publicar_tarifario_resultado%' or query ilike '%iniciar_generacion_tarifario%' or query ilike '%marcar_generacion_fallida%'
--  group by 1 order by 4 desc;
