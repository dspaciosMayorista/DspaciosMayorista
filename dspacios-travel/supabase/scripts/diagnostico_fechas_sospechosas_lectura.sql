-- DIAGNÓSTICO HISTÓRICO DE FECHAS SOSPECHOSAS — SOLO LECTURA.
--
-- Solo sentencias SELECT: no corrige nada. Lista candidatos para que una
-- persona decida caso a caso. Contiene DOS consultas independientes; el editor
-- SQL de Supabase muestra solo el resultado de la última, así que selecciona y
-- ejecuta cada bloque por separado (A = resumen, B = detalle).
--
-- El defecto: hasta los cambios de "fecha de negocio" (lib/fechaNegocio.ts y
-- migración 198), varios "hoy" se calculaban en UTC. Entre las 19:00 y las
-- 23:59 de Bogotá el día UTC ya es el siguiente, así que esos registros pueden
-- tener la fecha de MAÑANA.
--
-- Criterio, por fila (fecha guardada vs. instante real de creación):
--   · franja_19_24 ......... creada entre 19:00 y 23:59 hora Bogotá
--   · SOSPECHOSA ........... franja_19_24 Y fecha = día UTC de la creación
--                            (= día de Bogotá + 1): el síntoma exacto del defecto
--   · ok ................... fecha = día de Bogotá de la creación
--   · otra_fecha ........... ninguna de las dos: atrasada/adelantada a propósito,
--                            importada o corregida — no es el síntoma
-- Origen de la fecha (qué tan probable es que la eligiera una persona):
--   · automatica ........... la fija el sistema, sin campo para el usuario
--                            → una SOSPECHOSA aquí es casi seguro el defecto
--   · prellenada_editable .. formulario con "hoy" por defecto que el usuario
--                            pudo cambiar → AMBIGUA (pudo elegir mañana adrede)
--   · heredada ............. copia la fecha de otro documento (revisar ese)
--   · editada_despues ...... la auditoría muestra que alguien cambió la fecha
--                            después de crearla → elegida a mano, no tocar
--
-- Limitaciones:
--   · created_at es la hora de INSERCIÓN; una fila reescrita por upsert
--     (reimportación) puede no conservar la creación original.
--   · contrato_facturacion.dian_fecha solo tiene updated_at (última edición):
--     su clasificación es indicativa, no concluyente.
--   · La auditoría no cubre filas anteriores a la migración 087.
--   · Para saber si los defaults `current_date` y las funciones SQL corrieron en
--     UTC en producción, medir primero con diagnostico_zona_horaria_lectura.sql.

-- ═══ A) RESUMEN por tabla, campo y origen de la fecha ═══════════════════════
with base as (
  select 'abonos'::text as tabla, a.id::text as id, a.numero_contrato as referencia,
         'fecha_abono'::text as campo, a.fecha_abono as fecha, a.created_at as creado,
         case
           when exists (select 1 from public.cotizacion_pagos_previos p where p.abono_id = a.id) then 'heredada'
           when exists (select 1 from public.auditoria au
                        where au.tabla = 'abonos' and upper(au.accion) = 'UPDATE'
                          and au.despues->>'id' = a.id::text and au.cambios ? 'fecha_abono') then 'editada_despues'
           else 'prellenada_editable'
         end as origen_fecha
  from public.abonos a
  union all
  select 'asientos_contables', s.id::text, coalesce(s.origen, '') || ' ' || coalesce(s.referencia, ''),
         'fecha', s.fecha, s.created_at,
         case
           when s.origen in ('facturacion', 'facturacion_reversion', 'cxp', 'pago_previo_aplicacion',
                             'pago_previo_reversion') then 'automatica'
           when s.origen in ('abono', 'pago_proveedor', 'retencion', 'pago_previo', 'conciliacion') then 'heredada'
           else 'prellenada_editable'
         end
  from public.asientos_contables s
  union all
  select 'cotizacion_pagos_previos', p.id::text, 'cotizacion ' || p.cotizacion_id, 'fecha_pago', p.fecha_pago, p.created_at,
         case when exists (select 1 from public.auditoria au
                           where au.tabla = 'cotizacion_pagos_previos' and upper(au.accion) = 'UPDATE'
                             and au.despues->>'id' = p.id::text and au.cambios ? 'fecha_pago') then 'editada_despues'
              else 'prellenada_editable' end
  from public.cotizacion_pagos_previos p
  union all
  select 'cuentas_por_pagar', c.id::text, c.numero_contrato, 'fecha_obligacion', c.fecha_obligacion, c.created_at, 'automatica'
  from public.cuentas_por_pagar c
  union all
  select 'cxp_pagos', x.id::text, 'cxp ' || x.cuenta_por_pagar_id, 'fecha', x.fecha, x.created_at, 'prellenada_editable'
  from public.cxp_pagos x
  union all
  select 'retenciones_cxp', r.id::text, 'cxp ' || r.cuenta_por_pagar_id, 'fecha_practica', r.fecha_practica, r.created_at, 'prellenada_editable'
  from public.retenciones_cxp r
  union all
  select 'comision_b2b_pagos', b.id::text, 'aliado_b2b ' || b.aliado_b2b_id, 'fecha', b.fecha, b.created_at, 'prellenada_editable'
  from public.comision_b2b_pagos b
  union all
  select 'contabilidad_movimientos', m.id::text, '', 'fecha', m.fecha, m.created_at, 'prellenada_editable'
  from public.contabilidad_movimientos m
  union all
  select 'ventas', v.numero_contrato, v.numero_contrato, 'fecha_emision', v.fecha_emision, v.created_at, 'prellenada_editable'
  from public.ventas v
  union all
  select 'contrato_facturacion', f.numero_contrato, f.numero_contrato, 'dian_fecha (vs updated_at)', f.dian_fecha, f.updated_at, 'automatica'
  from public.contrato_facturacion f where f.dian_fecha is not null
),
clasif as (
  select b.*,
         (b.creado at time zone 'UTC')::date <> (b.creado at time zone 'America/Bogota')::date as franja_19_24,
         case
           when b.fecha is null or b.creado is null then 'sin_dato'
           when (b.creado at time zone 'UTC')::date <> (b.creado at time zone 'America/Bogota')::date
                and b.fecha = (b.creado at time zone 'UTC')::date then 'SOSPECHOSA'
           when b.fecha = (b.creado at time zone 'America/Bogota')::date then 'ok'
           else 'otra_fecha'
         end as clasificacion
  from base b
)
select tabla, campo, origen_fecha,
       count(*) filter (where clasificacion = 'SOSPECHOSA') as sospechosas,
       count(*) filter (where franja_19_24)                as creadas_19_24,
       count(*) filter (where clasificacion = 'ok')        as ok,
       count(*) filter (where clasificacion = 'otra_fecha') as otra_fecha,
       count(*)                                            as total
from clasif
group by tabla, campo, origen_fecha
order by sospechosas desc, tabla, campo, origen_fecha;

-- ═══ B) DETALLE de sospechosas (primero las automáticas) ═══════════════════
-- Para abonos trae también la fecha de su asiento: abono, asiento y recibo deben
-- tener la MISMA fecha, así que se revisan juntos.
with base as (
  select 'abonos'::text as tabla, a.id::text as id, a.numero_contrato as referencia,
         'fecha_abono'::text as campo, a.fecha_abono as fecha, a.created_at as creado,
         case
           when exists (select 1 from public.cotizacion_pagos_previos p where p.abono_id = a.id) then 'heredada'
           when exists (select 1 from public.auditoria au
                        where au.tabla = 'abonos' and upper(au.accion) = 'UPDATE'
                          and au.despues->>'id' = a.id::text and au.cambios ? 'fecha_abono') then 'editada_despues'
           else 'prellenada_editable'
         end as origen_fecha,
         (select s.fecha from public.asientos_contables s
          where s.origen = 'abono' and s.referencia = 'abono:' || a.id
          order by s.id desc limit 1) as fecha_asiento_relacionado
  from public.abonos a
  union all
  select 'asientos_contables', s.id::text, coalesce(s.origen, '') || ' ' || coalesce(s.referencia, ''),
         'fecha', s.fecha, s.created_at,
         case
           when s.origen in ('facturacion', 'facturacion_reversion', 'cxp', 'pago_previo_aplicacion',
                             'pago_previo_reversion') then 'automatica'
           when s.origen in ('abono', 'pago_proveedor', 'retencion', 'pago_previo', 'conciliacion') then 'heredada'
           else 'prellenada_editable'
         end, null::date
  from public.asientos_contables s
  union all
  select 'cotizacion_pagos_previos', p.id::text, 'cotizacion ' || p.cotizacion_id, 'fecha_pago', p.fecha_pago, p.created_at,
         case when exists (select 1 from public.auditoria au
                           where au.tabla = 'cotizacion_pagos_previos' and upper(au.accion) = 'UPDATE'
                             and au.despues->>'id' = p.id::text and au.cambios ? 'fecha_pago') then 'editada_despues'
              else 'prellenada_editable' end,
         (select s.fecha from public.asientos_contables s
          where s.origen = 'pago_previo' and s.referencia = 'pago_previo:' || p.id
          order by s.id desc limit 1)
  from public.cotizacion_pagos_previos p
  union all
  select 'cuentas_por_pagar', c.id::text, c.numero_contrato, 'fecha_obligacion', c.fecha_obligacion, c.created_at, 'automatica',
         (select s.fecha from public.asientos_contables s where s.origen = 'cxp' and s.referencia = 'cxp:' || c.id
          order by s.id desc limit 1)
  from public.cuentas_por_pagar c
  union all
  select 'cxp_pagos', x.id::text, 'cxp ' || x.cuenta_por_pagar_id, 'fecha', x.fecha, x.created_at, 'prellenada_editable',
         (select s.fecha from public.asientos_contables s
          where s.origen = 'pago_proveedor' and s.referencia = 'pago:' || x.cuenta_por_pagar_id || ':' || x.id
          order by s.id desc limit 1)
  from public.cxp_pagos x
  union all
  select 'retenciones_cxp', r.id::text, 'cxp ' || r.cuenta_por_pagar_id, 'fecha_practica', r.fecha_practica, r.created_at, 'prellenada_editable',
         (select s.fecha from public.asientos_contables s where s.origen = 'retencion' and s.referencia = 'retencion:' || r.id
          order by s.id desc limit 1)
  from public.retenciones_cxp r
  union all
  select 'comision_b2b_pagos', b.id::text, 'aliado_b2b ' || b.aliado_b2b_id, 'fecha', b.fecha, b.created_at, 'prellenada_editable', null::date
  from public.comision_b2b_pagos b
  union all
  select 'contabilidad_movimientos', m.id::text, '', 'fecha', m.fecha, m.created_at, 'prellenada_editable', null::date
  from public.contabilidad_movimientos m
  union all
  select 'ventas', v.numero_contrato, v.numero_contrato, 'fecha_emision', v.fecha_emision, v.created_at, 'prellenada_editable', null::date
  from public.ventas v
  union all
  select 'contrato_facturacion', f.numero_contrato, f.numero_contrato, 'dian_fecha (vs updated_at)', f.dian_fecha, f.updated_at, 'automatica', null::date
  from public.contrato_facturacion f where f.dian_fecha is not null
)
select tabla, id, referencia, campo, fecha,
       to_char(creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as creado_hora_bogota,
       (creado at time zone 'America/Bogota')::date as dia_bogota_esperado,
       origen_fecha,
       fecha_asiento_relacionado
from base
where creado is not null and fecha is not null
  and (creado at time zone 'UTC')::date <> (creado at time zone 'America/Bogota')::date
  and fecha = (creado at time zone 'UTC')::date
order by (origen_fecha = 'automatica') desc, creado desc
limit 1000;
