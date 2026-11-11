-- COMPARAR contadores de escritura con la FOTO tomada al activar la ventana. SOLO LECTURA: una consulta, un resultado.
-- Pegar el JSON de foto_contadores_ventana.sql entre las comillas de la línea `with foto` (sustituye el marcador).
-- EVIDENCIA AUXILIAR: lista las tablas que recibieron escrituras desde la foto. NO es un veredicto automático: no distingue escrituras legítimas
-- (migración, validación, inicios de sesión) de indebidas en una misma tabla. Cada tabla listada se revisa a mano (qué contrato o proceso la tocó).
-- `stats_reset` cambia con un reinicio de toda la base (y, en la versión probada, PostgreSQL 15.8, también con el de una sola tabla); no se garantiza
-- que delate todo reinicio: además, un contador menor que en la foto se marca para revisión.
with foto as (select 'PEGAR_FOTO'::json as j),
antes as (select key as tabla, value::text::bigint as n from foto, json_each((j ->> 'tablas')::json)),
ahora as (select schemaname || '.' || relname as tabla, n_tup_ins + n_tup_upd + n_tup_del as n
            from pg_stat_user_tables where schemaname in ('public', 'storage', 'auth', 'mant_priv', 'cron')),
dif as (select coalesce(a.tabla, b.tabla) as tabla, coalesce(a.n, 0) - coalesce(b.n, 0) as escrituras
          from ahora a full join antes b on b.tabla = a.tabla)
select 0 as orden, 'stats_reset cambió desde la foto (hubo un reinicio de estadísticas; no se garantiza que detecte todos)' as control,
       ((select stats_reset from pg_stat_database where datname = current_database()) is distinct from ((select j ->> 'stats_reset' from foto))::timestamptz)::text as observado,
       'false' as esperado,
       case when ((select stats_reset from pg_stat_database where datname = current_database()) is distinct from ((select j ->> 'stats_reset' from foto))::timestamptz)
            then 'REVISAR: comparación no válida' else 'sin cambio en stats_reset' end as estado
union all
select 1, 'contadores MENORES que en la foto (posible reinicio de una tabla): la comparación de esas tablas no vale',
       coalesce((select string_agg(tabla || '=' || escrituras, ' ; ') from dif where escrituras < 0), '(ninguno)'), '(ninguno)',
       case when exists (select 1 from dif where escrituras < 0) then 'REVISAR' else 'sin indicios' end
union all
select 2, 'tablas con escrituras desde ' || (select j ->> 'tomada_en' from foto) || ' — REVISAR CADA UNA (no distingue legítimas de indebidas)',
       coalesce((select string_agg(tabla || '=' || escrituras, ' ; ' order by escrituras desc) from dif where escrituras > 0), '(ninguna)'), null,
       'requiere revisión humana'
order by orden;
