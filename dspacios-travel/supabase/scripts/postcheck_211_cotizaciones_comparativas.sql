-- ═════════════════════════════════════════════════════════════════════════
-- POSTCHECK · 211 cotizaciones comparativas (#35). SOLO LECTURA.
-- Correr DESPUÉS de aplicar la 211. Devuelve UNA sola fila con una sola columna,
-- `resultado` (jsonb):
--   veredicto            'CORRECTO' | 'DETENER'
--   controles_total      19 (18 numerados + el 8.5)
--   controles_fallidos   cuántos controles dieron ok = false
--   fallidos             números (n) de los controles fallidos
--   controles            los 19 controles: n, comprobacion, ok, informativo, dato
--   nota                 qué hacer con el veredicto
-- Un control NULL cuenta como fallido. Ningún control es informativo.
-- ═════════════════════════════════════════════════════════════════════════
with c0 as (
  select 1 as n, 'RLS activo en las 4 tablas nuevas' as comprobacion,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
            and c.relname in ('cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_validaciones', 'cotizacion_comparativa_solicitudes')) = 4 as ok
  union all select 2, 'anon sin ningún privilegio en las 4 tablas',
         not exists (select 1 from unnest(array['cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_validaciones', 'cotizacion_comparativa_solicitudes']) t,
                           unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
                      where has_table_privilege('anon', 'public.' || t, p))
  union all select 3, 'authenticated: solo SELECT en opciones/eventos/solicitudes; NADA en validaciones',
         not exists (select 1 from unnest(array['cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_solicitudes']) t,
                           unnest(array['insert', 'update', 'delete', 'truncate']) p where has_table_privilege('authenticated', 'public.' || t, p))
         and not exists (select 1 from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
                          where has_table_privilege('authenticated', 'public.cotizacion_comparativa_validaciones', p))
         and has_table_privilege('authenticated', 'public.cotizacion_opciones', 'select')
  union all select 4, 'service_role: ninguna escritura directa en las 4 tablas',
         not exists (select 1 from unnest(array['cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_validaciones', 'cotizacion_comparativa_solicitudes']) t,
                           unnest(array['insert', 'update', 'delete', 'truncate']) p where has_table_privilege('service_role', 'public.' || t, p))
  union all select 5, '3 policies de lectura interna y NINGUNA en validaciones',
         (select count(*) from pg_policies where schemaname = 'public' and tablename in ('cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_solicitudes')) = 3
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cotizacion_comparativa_validaciones')
  union all select 6, 'las 7 RPC existen y ninguna es ejecutable por PUBLIC ni anon',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
            ('crear_cotizacion_comparativa', 'registrar_validacion_comparativa', 'elegir_opcion_comparativa_sesion', 'elegir_opcion_comparativa_publica',
             'registrar_solicitud_comparativa', 'resolver_solicitud_comparativa', 'comparativas_b2b_visibles')) = 7
         and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%comparativa%'
                           and (has_function_privilege('public', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
  union all select 7, 'RPC solo-servidor NO ejecutables por authenticated (crear, validar, elegir pública, solicitud)',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                       and p.proname in ('crear_cotizacion_comparativa', 'registrar_validacion_comparativa', 'elegir_opcion_comparativa_publica', 'registrar_solicitud_comparativa')
                       and has_function_privilege('authenticated', p.oid, 'execute'))
  union all select 8, 'RPC con sesión SÍ ejecutables por authenticated (elegir_sesion, resolver, listado B2B)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('elegir_opcion_comparativa_sesion', 'resolver_solicitud_comparativa', 'comparativas_b2b_visibles')
            and has_function_privilege('authenticated', p.oid, 'execute')) = 3
  union all select 8.5, 'RPC con sesión NO ejecutables por service_role (la identidad solo puede ser la de una sesión auténtica)',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                       and p.proname in ('elegir_opcion_comparativa_sesion', 'resolver_solicitud_comparativa', 'comparativas_b2b_visibles')
                       and has_function_privilege('service_role', p.oid, 'execute'))
  union all select 9, 'todas las RPC son SECURITY DEFINER con search_path fijo',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%comparativa%'
                       and (not p.prosecdef or coalesce(p.proconfig::text, '') not like '%search_path%'))
  union all select 10, 'f211_priv no es accesible a la API (ni usage ni execute)',
         not has_schema_privilege('anon', 'f211_priv', 'usage') and not has_schema_privilege('authenticated', 'f211_priv', 'usage')
         and not has_schema_privilege('service_role', 'f211_priv', 'usage')
  union all select 11, 'f211_priv no contiene tablas ni vistas (la Data API no tiene nada que exponer; verifica además que no esté en Settings > API > Exposed schemas)',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'f211_priv' and c.relkind in ('r', 'v', 'm'))
  union all select 12, 'triggers de protección presentes (10)',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
            ('trg_cotizaciones_comparativa_guarda', 'trg_cotizaciones_hija_descartada', 'trg_cot_servicios_comparativa_guarda', 'trg_madre_sin_pagos',
             'trg_madre_sin_condiciones', 'trg_madre_sin_venta', 'trg_opciones_inmutables', 'trg_eventos_inmutables', 'trg_solicitudes_guarda', 'trg_validaciones_guarda')) = 10
  union all select 13, 'ningún código de la 211 lee variables de sesión (sin GUC que falsificar)',
         not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where (n.nspname = 'f211_priv' or p.proname like '%comparativa%') and p.prosrc ilike '%current_setting%')
  union all select 14, 'índice único de hija activa presente',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_cotizaciones_hija_activa')
  union all select 15, 'no existe ningún estado elegida en cotizaciones',
         not exists (select 1 from public.cotizaciones where estado = 'elegida')
  union all select 16, 'las cotizaciones previas quedaron modo=simple sin columnas de comparativa',
         not exists (select 1 from public.cotizaciones where modo <> 'simple' and tipo not like 'comparativa\_%')
  union all select 17, 'RPC 198 INTACTO: mismo hash que en el preflight / main (edc9975010746e53e4af6a75ad9763dc)',
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')) = 'edc9975010746e53e4af6a75ad9763dc'
  union all select 18, 'registrar_pago_previo conserva su firma original',
         to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is not null
), c as (
  select n, comprobacion, ok, null::text as dato from c0
)
select jsonb_build_object(
  'veredicto', case when count(*) filter (where coalesce(ok, false) is not true) = 0 then 'CORRECTO' else 'DETENER' end,
  'controles_total', count(*),
  'controles_fallidos', count(*) filter (where coalesce(ok, false) is not true),
  'fallidos', coalesce(jsonb_agg(n order by n) filter (where coalesce(ok, false) is not true), '[]'::jsonb),
  'controles', jsonb_agg(jsonb_build_object(
      'n', n, 'comprobacion', comprobacion, 'ok', coalesce(ok, false),
      'informativo', n in (-1), 'dato', dato) order by n),
  'nota', 'CORRECTO = la 211 quedó bien aplicada: se puede desplegar el codigo. DETENER = no desplegar el codigo: revisar los controles con ok=false y avisar al Coordinador.'
) as resultado
from c;
