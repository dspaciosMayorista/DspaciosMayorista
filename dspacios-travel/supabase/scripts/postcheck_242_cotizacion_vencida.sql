-- ───────────────────────────────────────────────────────────────────────────
-- 242 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 242. Columnas: control · valor · esperado · estado.
--   Los INFO se comparan a mano con el preflight (mismos totales, mismas vencidas, misma huella: la 242 no escribe datos).
-- ───────────────────────────────────────────────────────────────────────────
with
cot as (select id, estado, vigencia_hasta, numero_contrato from public.cotizaciones),
g as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.p40_exigir_cotizacion_vigente(bigint)')),
fm as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')),
fa as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)')),
fb as (select p.prosrc, p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)')),
acl as (
  select
    has_function_privilege('service_role', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as g_sr,
    has_function_privilege('authenticated', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as g_au,
    has_function_privilege('anon', 'public.p40_exigir_cotizacion_vigente(bigint)', 'EXECUTE') as g_an,
    has_function_privilege('service_role', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE') as m_sr,
    has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE') as m_au,
    has_function_privilege('anon', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE') as m_an,
    has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as a_sr,
    has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as a_au,
    has_function_privilege('anon', 'public.aceptar_oferta_63(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as a_an,
    has_function_privilege('service_role', 'public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as b_sr,
    has_function_privilege('authenticated', 'public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as b_au,
    has_function_privilege('anon', 'public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)', 'EXECUTE') as b_an
),
c(orden, control, valor, esperado, ok) as (
  select 1, 'guarda_existe_security_definer_y_usa_fecha_negocio',
         coalesce(((select prosecdef from g) and (select prosrc from g) ~ 'fecha_negocio\(\)' and (select prosrc from g) ~ 'COTIZACION_VENCIDA')::text, 'no existe'), 'true',
         coalesce((select prosecdef from g) and (select prosrc from g) ~ 'fecha_negocio\(\)' and (select prosrc from g) ~ 'COTIZACION_VENCIDA', false)
  union all
  select 2, 'guarda_solo_service_role', (select (g_sr and not g_au and not g_an)::text from acl), 'true', (select g_sr and not g_au and not g_an from acl)
  union all
  select 3, 'wrapper_manual_llama_la_guarda_antes_de_validar_y_emitir',
         coalesce((position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) > 0
                   and position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) < position('validar_conversion' in (select prosrc from fm))
                   and position('validar_conversion' in (select prosrc from fm)) < position('p39_priv.emitir' in (select prosrc from fm)))::text, 'no existe'), 'true',
         coalesce(position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) > 0
                  and position('p40_exigir_cotizacion_vigente' in (select prosrc from fm)) < position('validar_conversion' in (select prosrc from fm))
                  and position('validar_conversion' in (select prosrc from fm)) < position('p39_priv.emitir' in (select prosrc from fm)), false)
  union all
  select 4, 'wrapper_manual_conserva_guardas_de_la_241 (comparativa, completar_conversion, cerrar, copia del tipo)',
         coalesce(((select prosrc from fm) ~ 'COMPARATIVA_NO_COBRABLE' and (select prosrc from fm) ~ 'completar_conversion' and (select prosrc from fm) ~ 'p39_priv.cerrar' and (select prosrc from fm) ~ 'cliente_tipo_documento')::text, 'no existe'), 'true',
         coalesce((select prosrc from fm) ~ 'COMPARATIVA_NO_COBRABLE' and (select prosrc from fm) ~ 'completar_conversion' and (select prosrc from fm) ~ 'p39_priv.cerrar' and (select prosrc from fm) ~ 'cliente_tipo_documento', false)
  union all
  select 5, 'wrapper_manual_sigue_invoker_y_solo_service_role',
         coalesce(((not (select prosecdef from fm)) and (select m_sr and not m_au and not m_an from acl))::text, 'no existe'), 'true',
         coalesce((not (select prosecdef from fm)) and (select m_sr and not m_au and not m_an from acl), false)
  union all
  select 6, 'aceptar_oferta_63_es_envoltura_security_definer_que_llama_guarda_y_base',
         coalesce(((select prosecdef from fa) and (select prosrc from fa) ~ 'p40_exigir_cotizacion_vigente' and (select prosrc from fa) ~ 'p40_aceptar_oferta_63_base')::text, 'no existe'), 'true',
         coalesce((select prosecdef from fa) and (select prosrc from fa) ~ 'p40_exigir_cotizacion_vigente' and (select prosrc from fa) ~ 'p40_aceptar_oferta_63_base', false)
  union all
  select 7, 'aceptar_oferta_63_solo_service_role', (select (a_sr and not a_au and not a_an)::text from acl), 'true', (select a_sr and not a_au and not a_an from acl)
  union all
  select 8, 'base_renombrada_conserva_el_cuerpo_de_la_235_y_nadie_la_ejecuta_directo',
         coalesce(((select prosecdef from fb) and (select prosrc from fb) ~ 'p63_oferta_cerrada' and (select prosrc from fb) ~ 'p63_cobro_cambio' and (select not b_sr and not b_au and not b_an from acl))::text, 'no existe'), 'true',
         coalesce((select prosecdef from fb) and (select prosrc from fb) ~ 'p63_oferta_cerrada' and (select prosrc from fb) ~ 'p63_cobro_cambio' and (select not b_sr and not b_au and not b_an from acl), false)
  union all
  select 9, 'una_sola_firma_de_aceptar_oferta_63', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'aceptar_oferta_63')::text, '1',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'aceptar_oferta_63') = 1
),
controles(orden, control, valor, esperado, estado) as (
  select orden, control, valor, esperado, case when ok then 'OK' else 'REVISAR' end from c
  union all
  select 10, 'cotizaciones_total', (select count(*) from cot)::text, 'igual al preflight', 'INFO'
  union all
  select 11, 'abiertas_total', (select count(*) from cot where estado = 'abierta')::text, 'igual al preflight', 'INFO'
  union all
  select 12, 'abiertas_vencidas_hoy', (select count(*) from cot where estado = 'abierta' and vigencia_hasta < public.fecha_negocio())::text, 'igual al preflight (si el dia no cambio)', 'INFO'
  union all
  select 13, 'abiertas_con_vigencia_nula', (select count(*) from cot where estado = 'abierta' and vigencia_hasta is null)::text, 'igual al preflight', 'INFO'
  union all
  select 14, 'huella_de_cotizaciones_que_la_242_no_debe_tocar',
         md5(coalesce((select string_agg(id || ':' || estado || ':' || coalesce(vigencia_hasta::text, '') || ':' || coalesce(numero_contrato, ''), '|' order by id) from cot), '')),
         'igual al preflight', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
