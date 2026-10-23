-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 198 · Fecha de negocio (America/Bogota) — SOLO LECTURA.
--
-- Correr en producción ANTES de la migración 198. Es UNA sola consulta SELECT
-- sobre el catálogo: no crea, no modifica, no bloquea nada y no devuelve datos
-- de negocio, solo metadatos y huellas.
--
-- Resultado: una fila por verificación (`ok` + detalle) y una fila final
-- RESUMEN. Lectura del RESUMEN:
--   · "LISTA PARA APLICAR": las 5 funciones son exactamente las de la 164.
--   · "YA APLICADA": todo está en el estado de la 198 (no volver a correrla;
--     re-correrla sería inocuo, pero no hace falta).
--   · "NO APLICAR": alguna función no es ni la de la 164 ni la de la 198 (hubo
--     un cambio fuera del repositorio) o faltan prerequisitos. La propia 198
--     también abortaría en ese caso; esto lo dice antes.
--
-- Las huellas son md5 del cuerpo sin retornos de carro (chr(13)), medidas en
-- una base local con 1→197 aplicadas desde el repositorio. La 198 solo depende
-- de la 164 (y del PUC de la 126/127/129); no depende de 192–197 ni 199–200.
-- ───────────────────────────────────────────────────────────────────────────
with
esperado(fn, md5_164, md5_198) as (values
  ('_huella_pago_previo',               '1d415376a495f7b3a935c94fa8d867db', '817eb22ea6063273d60f1044e66b3329'),
  ('registrar_pago_previo',             'd75834909bed271b2044a047d1d2c5e9', '146d0275f5a97b9ecd6a52e11161b248'),
  ('anular_pago_previo',                '0c42d0d7b019a7b5c7022814d1245953', '49bb1f21f071141d30926ad426f87369'),
  ('transferir_pagos_previos_a_abonos', 'e41357168da15799542b5396387159c6', '4814691695eb7587c18628ede17f266f'),
  ('convertir_cotizacion_a_contrato',   'b90374ce124d588ad7f85457d1e8501d', 'edc9975010746e53e4af6a75ad9763dc')
),
fn as (
  select p.proname, count(*) as versiones, max(md5(replace(p.prosrc, chr(13), ''))) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select fn from esperado)
  group by p.proname
),
funciones as (
  select e.fn,
         case when f.proname is null then 'falta'
              when f.versiones > 1 then 'sobrecargada'
              when f.md5 = e.md5_164 then '164'
              when f.md5 = e.md5_198 then '198'
              else 'desconocida' end as estado
  from esperado e left join fn f on f.proname = e.fn
),
defaults as (
  select table_name || '.' || column_name as columna, coalesce(column_default, '(sin default)') as valor
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (('abonos', 'fecha_abono'), ('cotizacion_pagos_previos', 'fecha_pago'))
),
fecha_negocio as (
  select count(*) as n, max(md5(replace(p.prosrc, chr(13), ''))) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fecha_negocio'
),
prereq as (
  select count(*) filter (where to_regprocedure(x) is not null) as presentes, count(*) as total
  from unnest(array['public._siguiente_numero_asiento(text)', 'public._puc_id(text,text)',
                    'public._cuenta_disponible(text,text)', 'public._autorizado_pago_previo(uuid)']) x
),
checks(orden, verificacion, ok, detalle) as (
  select 10 + row_number() over (order by fn), 'funcion ' || fn,
         estado in ('164', '198'), 'estado: ' || estado
  from funciones
  union all
  select 20 + row_number() over (order by columna), 'default ' || columna,
         lower(valor) in ('current_date', 'fecha_negocio()', 'public.fecha_negocio()'), valor
  from defaults
  union all
  select 30, 'public.fecha_negocio',
         n = 0 or md5 = 'c3e4d7e4dda8eb6fc2d4dae61ee4327a',
         case when n = 0 then 'no existe (se crea en la 198)' when md5 = 'c3e4d7e4dda8eb6fc2d4dae61ee4327a' then 'ya existe con el cuerpo de la 198'
              else 'EXISTE CON OTRO CUERPO (' || n || ' versión/es) — revisar antes' end
  from fecha_negocio
  union all
  select 40, 'prerequisitos de la 164', presentes = total, presentes || '/' || total || ' funciones auxiliares'
  from prereq
  union all
  select 50, 'informativo: TimeZone de esta sesión', true, current_setting('TimeZone')
)
select orden, verificacion, ok, detalle from checks
union all
select 99, 'RESUMEN', bool_and(ok),
       case
         when not bool_and(ok) then 'NO APLICAR: revisar las filas con ok = false'
         when (select count(*) from funciones where estado = '198') = 5 then 'YA APLICADA'
         when (select count(*) from funciones where estado = '164') = 5 then 'LISTA PARA APLICAR'
         else 'NO APLICAR: estado mixto 164/198 (¿aplicación parcial?)'
       end
from checks
order by orden;
