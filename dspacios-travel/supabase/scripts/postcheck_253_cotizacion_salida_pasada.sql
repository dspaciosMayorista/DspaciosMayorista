-- ───────────────────────────────────────────────────────────────────────────
-- 253 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 253. Columnas: control · valor · esperado · estado.
--   Los INFO se comparan a mano con el preflight (mismos totales, misma huella: la 253 no escribe datos).
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select id, estado, vigencia_hasta, fecha_salida, numero_contrato from public.cotizaciones),
g as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')),
fm as (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')),
fa as (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)')),
acl as (
  select has_function_privilege('service_role', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as sr,
         has_function_privilege('authenticated', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as au,
         has_function_privilege('anon', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as an
),
c(orden, control, valor, esperado, ok) as (
  select 1, 'guarda_security_definer_con_fecha_negocio_y_ambos_rechazos',
         coalesce(((select prosecdef from g) and (select prosrc from g) ~ 'fecha_negocio\(\)' and (select prosrc from g) ~ 'COTIZACION_SALIDA_PASADA' and (select prosrc from g) ~ 'COTIZACION_VENCIDA')::text, 'no existe'), 'true',
         coalesce((select prosecdef from g) and (select prosrc from g) ~ 'fecha_negocio\(\)' and (select prosrc from g) ~ 'COTIZACION_SALIDA_PASADA' and (select prosrc from g) ~ 'COTIZACION_VENCIDA', false)
  union all
  select 2, 'salida_pasada_se_evalua_ANTES_que_vigencia_vencida',
         coalesce((position('COTIZACION_SALIDA_PASADA' in (select prosrc from g)) between 1 and position('COTIZACION_VENCIDA' in (select prosrc from g)) - 1)::text, 'no existe'), 'true',
         coalesce(position('COTIZACION_SALIDA_PASADA' in (select prosrc from g)) between 1 and position('COTIZACION_VENCIDA' in (select prosrc from g)) - 1, false)
  union all
  select 3, 'guarda_solo_service_role', (select (sr and not au and not an)::text from acl), 'true', (select sr and not au and not an from acl)
  union all
  select 4, 'wrapper_manual_sigue_llamando_la_guarda_antes_de_emitir',
         coalesce((position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) between 1 and position('p39_priv.emitir' in (select prosrc from fm)) - 1)::text, 'no existe'), 'true',
         coalesce(position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) between 1 and position('p39_priv.emitir' in (select prosrc from fm)) - 1, false)
  union all
  select 5, 'aceptar_oferta_63_sigue_llamando_la_guarda',
         coalesce(((select prosrc from fa) ~ 'p40_exigir_cotizacion_vigente' and (select prosrc from fa) ~ 'p40_aceptar_oferta_63_base')::text, 'no existe'), 'true',
         coalesce((select prosrc from fa) ~ 'p40_exigir_cotizacion_vigente' and (select prosrc from fa) ~ 'p40_aceptar_oferta_63_base', false)
  union all
  select 7, 'cuerpo_de_la_guarda_es_exactamente_el_de_la_253 (md5)', coalesce(md5(replace((select prosrc from g), chr(13), '')), 'no existe'), '96ba71a5a88766e69d9b1e2908b89c2c', coalesce(md5(replace((select prosrc from g), chr(13), '')) = '96ba71a5a88766e69d9b1e2908b89c2c', false)
  union all
  select 6, 'una_sola_firma_de_la_guarda', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'p40_exigir_cotizacion_vigente')::text, '1',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'p40_exigir_cotizacion_vigente') = 1
),
controles(orden, control, valor, esperado, estado) as (
  select orden, control, valor, esperado, case when ok then 'OK' else 'REVISAR' end from c
  union all
  select 8, 'cotizaciones_total', (select count(*) from cot)::text, 'igual al preflight', 'INFO'
  union all
  select 9, 'abiertas_total', (select count(*) from cot where estado = 'abierta')::text, 'igual al preflight', 'INFO'
  union all
  select 10, 'abiertas_con_salida_pasada_hoy', (select count(*) from cot where estado = 'abierta' and fecha_salida < public.fecha_negocio())::text, 'igual al preflight (si el dia no cambio)', 'INFO'
  union all
  select 11, 'abiertas_con_salida_pasada_Y_vigencia_vencida', (select count(*) from cot where estado = 'abierta' and fecha_salida < public.fecha_negocio() and vigencia_hasta < public.fecha_negocio())::text, 'igual al preflight (si el dia no cambio)', 'INFO'
  union all
  select 12, 'abiertas_con_salida_nula', (select count(*) from cot where estado = 'abierta' and fecha_salida is null)::text, 'igual al preflight', 'INFO'
  union all
  select 13, 'huella_de_cotizaciones_que_la_253_no_debe_tocar',
         md5(coalesce((select string_agg(id || ':' || estado || ':' || coalesce(vigencia_hasta::text, '') || ':' || coalesce(fecha_salida::text, '') || ':' || coalesce(numero_contrato, ''), '|' order by id) from cot), '')),
         'igual al preflight', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
