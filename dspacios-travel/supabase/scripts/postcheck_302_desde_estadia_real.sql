-- POSTCHECK 302 (#43/#60 entrega 6) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 302 y ANTES del código. Todo OK; los
-- controles 7 y 8 deben ser IDÉNTICOS a los 5 y 7 del preflight.
with post as (
  select
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'desde_entrada' and data_type = 'date')::int as col,
    exists (select 1 from pg_constraint where conname = 'tarifario_resultado_desde_entrada_302' and conrelid = 'public.tarifario_resultado'::regclass) as chk,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable' and column_name = 'desde_entrada') as vista,
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable' and column_name in ('generacion', 'revision_fuente', 'lote')) as vista_sin_internas,
    (position('desde_entrada' in (select prosrc from pg_proc where oid = 'public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)'::regprocedure)) > 0
     and position('desde_entrada' in (select prosrc from pg_proc where oid = 'public.tarifario_lote_agregar_i(bigint, bigint, integer, text)'::regprocedure)) > 0) as insertores,
    (not has_function_privilege('anon', 'public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.tarifario_lote_agregar_i(bigint, bigint, integer, text)', 'execute')
     and has_table_privilege('anon', 'public.tarifario_resultado_publicable', 'select')) as permisos,
    (select count(*) from public.tarifario_resultado)::bigint as filas,
    (select md5(coalesce(string_agg(r.id::text || ':' || r.precio_pvp::text, ',' order by r.id), '')) from public.tarifario_resultado r) as huella,
    (select count(*) from public.tarifario_resultado where desde_entrada is not null)::bigint as justificadas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Columna desde_entrada (date)' as control, col::text as observado, '1' as esperado, case when col = 1 then 'OK' else 'REVISAR' end as estado from post
  union all select 2, 'CHECK: solo porción y 1–30 noches', chk::text, 'true', case when chk then 'OK' else 'REVISAR' end from post
  union all select 3, 'La vista publicable expone desde_entrada', vista::text, 'true', case when vista then 'OK' else 'REVISAR' end from post
  union all select 4, 'La vista sigue sin columnas internas', vista_sin_internas::text, 'true', case when vista_sin_internas then 'OK' else 'REVISAR' end from post
  union all select 5, 'Los dos insertores escriben desde_entrada', insertores::text, 'true', case when insertores then 'OK' else 'REVISAR' end from post
  union all select 6, 'Permisos sin cambios (insertores cerrados, vista legible)', permisos::text, 'true', case when permisos then 'OK' else 'REVISAR' end from post
  union all select 7, 'Filas del tarifario (= preflight control 5)', filas::text, 'igual al preflight', 'INFO' from post
  union all select 8, 'Huella id:precio (= preflight control 7)', huella, 'igual al preflight', 'INFO' from post
  union all select 9, 'Filas con justificación tras aplicar', justificadas::text, '0', case when justificadas = 0 then 'OK' else 'REVISAR' end from post
) r order by orden;
