-- ───────────────────────────────────────────────────────────────────────────
-- 242 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 242. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No imprime filas de negocio: solo conteos y huellas.
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select id, estado, vigencia_hasta, numero_contrato from public.cotizaciones),
fm as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')),
fa as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)')),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'migracion_241_aplicada (ventas.titular_tipo_documento)',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_tipo_documento')::text, 'true',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'titular_tipo_documento') then 'OK' else 'REVISAR' end
  union all
  select 2, 'fecha_negocio_disponible (198)', (to_regprocedure('public.fecha_negocio(timestamptz)') is not null)::text, 'true',
         case when to_regprocedure('public.fecha_negocio(timestamptz)') is not null then 'OK' else 'REVISAR' end
  union all
  select 3, 'aceptar_oferta_63_es_el_cuerpo_de_la_235 (aun sin envoltura)', coalesce(((select prosrc from fa) !~ 'p40_')::text, 'no existe'), 'true',
         case when (select prosrc from fa) !~ 'p40_' then 'OK' else 'REVISAR' end
  union all
  select 4, 'wrapper_manual_es_el_de_la_241 (aun sin guarda)', coalesce(((select prosrc from fm) ~ 'cliente_tipo_documento' and (select prosrc from fm) !~ 'p40_')::text, 'no existe'), 'true',
         case when (select prosrc from fm) ~ 'cliente_tipo_documento' and (select prosrc from fm) !~ 'p40_' then 'OK' else 'REVISAR' end
  union all
  select 5, 'migracion_242_no_aplicada (sin guarda ni base renombrada)',
         (to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') is null
          and to_regprocedure('public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)') is null)::text, 'true',
         case when to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)') is null
               and to_regprocedure('public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)') is null then 'OK' else 'REVISAR' end
  union all
  select 6, 'cotizaciones_total', (select count(*) from cot)::text, 'igual en el postcheck', 'INFO'
  union all
  select 7, 'abiertas_total', (select count(*) from cot where estado = 'abierta')::text, 'igual en el postcheck', 'INFO'
  union all
  select 8, 'abiertas_vencidas_hoy (la 242 las rechazara al convertir; no se modifican)', (select count(*) from cot where estado = 'abierta' and vigencia_hasta < public.fecha_negocio())::text, 'igual en el postcheck', 'INFO'
  union all
  select 9, 'abiertas_con_vigencia_nula (historicas: no vencen por inferencia)', (select count(*) from cot where estado = 'abierta' and vigencia_hasta is null)::text, 'igual en el postcheck', 'INFO'
  union all
  select 10, 'huella_de_cotizaciones_que_la_242_no_debe_tocar',
         md5(coalesce((select string_agg(id || ':' || estado || ':' || coalesce(vigencia_hasta::text, '') || ':' || coalesce(numero_contrato, ''), '|' order by id) from cot), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
