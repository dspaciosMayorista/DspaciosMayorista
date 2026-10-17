-- ═════════════════════════════════════════════════════════════════════════
-- PREFLIGHT · 211 cotizaciones comparativas (#35). SOLO LECTURA.
-- Correr en el editor SQL ANTES de aplicar la 211. Devuelve UNA sola fila con
-- una sola columna, `resultado` (jsonb):
--   veredicto            'APTO_PARA_APLICAR' | 'DETENER'
--   controles_total      14
--   controles_fallidos   cuántos controles dieron ok = false
--   fallidos             números (n) de los controles fallidos
--   controles            los 14 controles: n, comprobacion, ok, informativo, dato
--   nota                 qué hacer con el veredicto
-- Un control NULL cuenta como fallido (nunca se interpreta como "pasa").
-- No escribe nada, no crea objetos persistentes. Los controles 11, 13 y 14 son
-- informativos (ok fijo en true): solo aportan datos; el 11 guarda el hash del
-- RPC 198 que el postcheck vuelve a exigir.
-- ═════════════════════════════════════════════════════════════════════════
with c as (
  select 1 as n, '210 aplicada (financiero_registrado_en en ventas)' as comprobacion,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en') as ok,
         null::text as dato
  union all select 2, 'RPC 198 convertir_cotizacion_a_contrato presente',
         to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null, null
  union all select 3, 'RPC registrar_pago_previo presente',
         to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is not null, null
  union all select 4, 'fecha_negocio(timestamptz) presente (198)', to_regprocedure('public.fecha_negocio(timestamptz)') is not null, null
  union all select 5, 'puede_ver_tenant_cotizacion presente (154)', to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is not null, null
  union all select 6, 'f208_priv.importes_factura presente (208)', to_regprocedure('f208_priv.importes_factura(text)') is not null, null
  union all select 7, 'la 211 NO está aplicada: no existen las columnas nuevas de cotizaciones',
         not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones'
                        and column_name in ('modo', 'version', 'sello_economico', 'aliado_id', 'propietario_id', 'creado_por_id', 'cotizacion_origen_id')), null
  union all select 8, 'ninguna de las 4 tablas nuevas existe',
         not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
                       and c.relname in ('cotizacion_opciones', 'cotizacion_comparativa_eventos', 'cotizacion_comparativa_validaciones', 'cotizacion_comparativa_solicitudes')), null
  union all select 9, 'el esquema f211_priv no existe', not exists (select 1 from pg_namespace where nspname = 'f211_priv'), null
  union all select 10, 'ninguna cotización usa tipos comparativa_* (dato: conteo por estado actual)',
         not exists (select 1 from public.cotizaciones where tipo like 'comparativa\_%'),
         (select string_agg(estado || '=' || n, ', ') from (select estado, count(*) n from public.cotizaciones group by 1 order by 1) q)
  union all select 11, 'hash md5 del cuerpo del RPC 198 (el postcheck exige el MISMO valor)',
         true, (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)'))
  union all select 12, 'el hash del RPC 198 coincide con el de main 4aa2349b (edc9975010746e53e4af6a75ad9763dc)',
         (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')) = 'edc9975010746e53e4af6a75ad9763dc', null
  union all select 13, 'cotizaciones existentes (informativo)', true, (select count(*)::text from public.cotizaciones)
  union all select 14, 'cotizaciones abiertas ya vencidas (informativo; la 211 no las cambia)', true,
         (select count(*)::text from public.cotizaciones where estado = 'abierta' and vigencia_hasta < public.fecha_negocio())
)
select jsonb_build_object(
  'veredicto', case when count(*) filter (where coalesce(ok, false) is not true) = 0 then 'APTO_PARA_APLICAR' else 'DETENER' end,
  'controles_total', count(*),
  'controles_fallidos', count(*) filter (where coalesce(ok, false) is not true),
  'fallidos', coalesce(jsonb_agg(n order by n) filter (where coalesce(ok, false) is not true), '[]'::jsonb),
  'controles', jsonb_agg(jsonb_build_object(
      'n', n, 'comprobacion', comprobacion, 'ok', coalesce(ok, false),
      'informativo', n in (11, 13, 14), 'dato', dato) order by n),
  'nota', 'APTO_PARA_APLICAR = puede aplicarse la 211. DETENER = no aplicar: revisar los controles con ok=false y avisar al Coordinador.'
) as resultado
from c;
