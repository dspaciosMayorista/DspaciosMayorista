-- ───────────────────────────────────────────────────────────────────────────
-- 253 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 253. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No imprime filas de negocio: solo conteos y huellas. La 253 no escribe datos.
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select id, estado, vigencia_hasta, fecha_salida, numero_contrato from public.cotizaciones),
g as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'migracion_242_aplicada (existe la guarda p40_exigir_cotizacion_vigente)', (to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') is not null)::text, 'true',
         case when to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') is not null then 'OK' else 'REVISAR' end
  union all
  select 2, 'cuerpo_de_la_guarda_identico_al_de_la_242_auditada (md5 bfb315e6cf65f62a5da232bc5df45f19)', coalesce(md5(replace((select prosrc from g), chr(13), '')), 'no existe'), 'bfb315e6cf65f62a5da232bc5df45f19',
         case when md5(replace((select prosrc from g), chr(13), '')) = 'bfb315e6cf65f62a5da232bc5df45f19' then 'OK' else 'REVISAR' end
  union all
  select 3, 'migracion_253_no_aplicada', (not coalesce((select prosrc from g) ~ 'SALIDA_PASADA', false))::text, 'true',
         case when not coalesce((select prosrc from g) ~ 'SALIDA_PASADA', false) then 'OK' else 'REVISAR' end
  union all
  select 4, 'fecha_negocio_disponible (198)', (to_regprocedure('public.fecha_negocio(timestamptz)') is not null)::text, 'true',
         case when to_regprocedure('public.fecha_negocio(timestamptz)') is not null then 'OK' else 'REVISAR' end
  union all
  select 5, 'cotizaciones_total', (select count(*) from cot)::text, 'igual en el postcheck', 'INFO'
  union all
  select 6, 'abiertas_total', (select count(*) from cot where estado = 'abierta')::text, 'igual en el postcheck', 'INFO'
  union all
  select 7, 'abiertas_con_salida_pasada_hoy (la 253 las rechazara al convertir; no se modifican)', (select count(*) from cot where estado = 'abierta' and fecha_salida < public.fecha_negocio())::text, 'igual en el postcheck', 'INFO'
  union all
  select 8, 'abiertas_con_salida_pasada_Y_vigencia_vencida (el rechazo sera COTIZACION_SALIDA_PASADA)', (select count(*) from cot where estado = 'abierta' and fecha_salida < public.fecha_negocio() and vigencia_hasta < public.fecha_negocio())::text, 'igual en el postcheck', 'INFO'
  union all
  select 9, 'abiertas_con_salida_nula (historicas: no caducan por inferencia)', (select count(*) from cot where estado = 'abierta' and fecha_salida is null)::text, 'igual en el postcheck', 'INFO'
  union all
  select 10, 'huella_de_cotizaciones_que_la_253_no_debe_tocar',
         md5(coalesce((select string_agg(id || ':' || estado || ':' || coalesce(vigencia_hasta::text, '') || ':' || coalesce(fecha_salida::text, '') || ':' || coalesce(numero_contrato, ''), '|' order by id) from cot), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
