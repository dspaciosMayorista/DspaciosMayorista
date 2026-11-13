-- PREFLIGHT 302 (#43/#60 entrega 6) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 302. Todo OK; los INFO se anotan y el
-- postcheck debe dar las mismas filas y la misma huella (la 302 no cambia ninguna fila).
with pre as (
  select
    (to_regclass('public.tarifario_manifiesto') is not null) as m260,
    (to_regclass('public.hotel_promocion_combinacion') is not null) as m301,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'desde_entrada')::int as col,
    (to_regprocedure('public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb)') is not null
     and to_regprocedure('public.tarifario_lote_agregar_i(bigint, bigint, integer, text)') is not null) as insertores,
    (select count(*) from public.tarifario_resultado)::bigint as filas,
    (select count(*) from public.tarifario_resultado where modulo = 'porcion_terrestre')::bigint as porcion,
    (select md5(coalesce(string_agg(r.id::text || ':' || r.precio_pvp::text, ',' order by r.id), '')) from public.tarifario_resultado r) as huella
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, '260 aplicada (publicación por lotes)' as control, m260::text as observado, 'true' as esperado, case when m260 then 'OK' else 'REVISAR' end as estado from pre
  union all select 2, '301 aplicada (acumulación)', m301::text, 'true', case when m301 then 'OK' else 'REVISAR' end from pre
  union all select 3, 'Columna desde_entrada aún no existe', col::text, '0', case when col = 0 then 'OK' else 'REVISAR' end from pre
  union all select 4, 'Insertores de la 256 y la 260 presentes', insertores::text, 'true', case when insertores then 'OK' else 'REVISAR' end from pre
  union all select 5, 'Filas del tarifario (igual en el postcheck)', filas::text, 'anotar', 'INFO' from pre
  union all select 6, 'Filas de porción terrestre', porcion::text, 'anotar', 'INFO' from pre
  union all select 7, 'Huella id:precio (igual en el postcheck)', huella, 'anotar', 'INFO' from pre
) r order by orden;
