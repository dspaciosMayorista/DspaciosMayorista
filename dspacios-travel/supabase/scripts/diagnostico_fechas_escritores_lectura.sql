-- DIAGNÓSTICO DE ESCRITORES DE FECHAS SOSPECHOSAS — SOLO LECTURA.
--
-- Complementa diagnostico_fechas_sospechosas_lectura.sql (bloques A/B): atribuye
-- cada fila sospechosa a su ESCRITOR concreto en el código y dice si la
-- corrección futura (migración 198 + código ya preparado) la previene.
-- Solo sentencias SELECT. El editor SQL de Supabase muestra solo el resultado
-- de la ÚLTIMA sentencia: selecciona y ejecuta cada bloque (C, D, E, F, G) por
-- separado.
--
-- "Sospechosa" = misma regla que el bloque B: creada entre 19:00 y 23:59 de
-- Bogotá y con la fecha igual al día UTC de su creación.
--
-- Cómo se identifica el escritor (sin adivinar por nombre de usuario):
--   · CxP: el texto que cada camino escribe en `observaciones`.
--   · Asientos: `origen` + la CxP/pago previo al que apuntan.
--   · Ventas: las columnas que SOLO llena cada inserción (ver bloque E).
--   · Momento exacto: `created_at` de cada fila (no depende de la auditoría).
--   · Actor e historial (ediciones, re-posteos): tabla `auditoria` (trigger de la
--     migración 087). OJO: el trigger se adjuntó a las tablas que existían en la
--     087; las creadas después (asientos_contables, contrato_facturacion,
--     cotizacion_pagos_previos, cxp_pagos, retenciones_cxp…) pueden NO tenerlo.
--     Correr primero el bloque H: donde no hay trigger, los conteos de auditoría
--     salen en 0 / "sin rastro" y eso NO significa que no hubo cambios.
--     actor_email NULL = escritura con service-role (servidor/cron).

-- ═══ C) 138 ASIENTOS AUTOMÁTICOS: escritor y cobertura ══════════════════════
with sosp as (
  select s.*
  from public.asientos_contables s
  where s.origen in ('facturacion', 'facturacion_reversion', 'cxp', 'pago_previo_aplicacion', 'pago_previo_reversion')
    and (s.created_at at time zone 'UTC')::date <> (s.created_at at time zone 'America/Bogota')::date
    and s.fecha = (s.created_at at time zone 'UTC')::date
),
det as (
  select s.id, s.origen, s.referencia, s.fecha, s.created_at,
         c.id as cxp_id, c.observaciones as cxp_obs, c.fecha_obligacion, c.created_at as cxp_creada,
         v.tipo_paquete, v.fecha_emision,
         (select au.actor_email from public.auditoria au
          where au.tabla = 'asientos_contables' and upper(au.accion) = 'INSERT' and au.despues->>'id' = s.id::text
          order by au.id limit 1) as actor_email
  from sosp s
  left join public.cuentas_por_pagar c on s.origen = 'cxp' and s.referencia = 'cxp:' || c.id
  left join public.ventas v on v.numero_contrato = c.numero_contrato
)
select
  case
    when origen = 'facturacion' then 'TS guardarFacturacion → asiento de factura'
    when origen = 'facturacion_reversion' then 'TS reversarYRegistrar (guardar/quitar facturación)'
    when origen = 'pago_previo_aplicacion' then 'SQL convertir_cotizacion_a_contrato / transferir_pagos_previos_a_abonos'
    when origen = 'pago_previo_reversion' then 'SQL anular_pago_previo'
    when cxp_id is null then 'cxp: la CxP ya no existe (asiento huérfano)'
    when cxp_obs = 'Generado automáticamente desde el tarifario' then 'cxp: reservarDesdeTarifario'
    when cxp_obs = 'Generado automáticamente desde el carrito (tarifario)' then 'cxp: convertirCotizacionCarrito'
    when cxp_obs = 'Generado automáticamente desde el tarifario (programa)' then 'cxp: reservarPrograma'
    when cxp_obs = 'Generado automáticamente desde cotización dinámica' then 'cxp: SQL convertir_cotizacion_a_contrato'
    when cxp_obs = 'Completado automáticamente (faltaba el proveedor)' then 'cxp: asegurarCuentasPorPagar'
    when cxp_obs = 'Generado automáticamente al editar los servicios del contrato' then 'cxp: actualizarServiciosContrato (alta)'
    when cxp_obs is null and fecha_obligacion is null then 'cxp: alta/edición manual (gestion-actions)'
    when cxp_obs is null and fecha_obligacion = fecha_emision then 'cxp: crearContrato (fecha = fecha de emisión del formulario)'
    else 'cxp: otro / editado después (revisar fila)'
  end as escritor,
  case
    when origen = 'facturacion' or origen = 'facturacion_reversion' then 'código preparado (ronda 1)'
    when origen in ('pago_previo_aplicacion', 'pago_previo_reversion') then 'migración 198'
    when cxp_obs = 'Generado automáticamente desde cotización dinámica' then 'migración 198'
    when cxp_obs = 'Completado automáticamente (faltaba el proveedor)' then 'código preparado (ronda 2)'
    when cxp_obs is null and fecha_obligacion is null then 'código preparado (ronda 2)'
    when cxp_obs = 'Generado automáticamente desde el carrito (tarifario)' then 'SIN COBERTURA: fecha_referencia_servidor() = current_date de la sesión'
    else 'PENDIENTE: archivo compartido (reservar/actions.ts o contratos/actions.ts)'
  end as cobertura,
  count(*) as asientos,
  count(*) filter (where actor_email is null) as por_service_role,
  min(created_at at time zone 'America/Bogota') as primero_bogota,
  max(created_at at time zone 'America/Bogota') as ultimo_bogota
from det
group by 1, 2
order by asientos desc;

-- ═══ D) 16 CUENTAS POR PAGAR: escritor, asiento y las 3 con fecha distinta ══
-- Una CxP nunca cambia `fecha_obligacion` después de creada (ningún camino de
-- la app la actualiza). Si su asiento tiene OTRA fecha, el asiento se escribió
-- en otro momento: re-posteo al editar (gestion-actions / actualizarServicios-
-- Contrato reemplazan el asiento con el día de la edición) o la reconciliación
-- financiera (reintento del payload o asiento faltante, con el día del reintento).
with sosp as (
  select c.*
  from public.cuentas_por_pagar c
  where c.fecha_obligacion is not null
    and (c.created_at at time zone 'UTC')::date <> (c.created_at at time zone 'America/Bogota')::date
    and c.fecha_obligacion = (c.created_at at time zone 'UTC')::date
)
select
  c.id as cxp_id, c.numero_contrato, c.tipo_proveedor, c.observaciones,
  c.fecha_obligacion,
  to_char(c.created_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS') as cxp_creada_bogota,
  a.fecha as fecha_asiento,
  to_char(a.created_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS') as asiento_creado_bogota,
  case when a.id is null then 'sin asiento'
       when a.fecha = c.fecha_obligacion then 'misma fecha'
       else 'FECHA DISTINTA' end as asiento_vs_cxp,
  round(extract(epoch from (a.created_at - c.created_at)) / 3600.0, 2) as horas_entre_cxp_y_asiento,
  -- Rastro en auditoría: cuántas veces se escribió/borró el asiento y si la CxP se editó.
  (select count(*) from public.auditoria au
   where au.tabla = 'asientos_contables' and upper(au.accion) = 'INSERT'
     and au.despues->>'referencia' = 'cxp:' || c.id) as asientos_insertados,
  (select count(*) from public.auditoria au
   where au.tabla = 'asientos_contables' and upper(au.accion) = 'DELETE'
     and au.antes->>'referencia' = 'cxp:' || c.id) as asientos_borrados,
  (select string_agg(distinct k, ',') from public.auditoria au, jsonb_object_keys(coalesce(au.cambios, '{}'::jsonb)) k
   where au.tabla = 'cuentas_por_pagar' and upper(au.accion) = 'UPDATE' and au.despues->>'id' = c.id::text) as campos_cxp_editados,
  (select coalesce(au.actor_email, '(service-role)') from public.auditoria au
   where au.tabla = 'asientos_contables' and upper(au.accion) = 'INSERT' and au.despues->>'id' = a.id::text
   order by au.id limit 1) as actor_asiento_vigente,
  exists (select 1 from public.contrato_financiero_pendiente p where p.numero_contrato = c.numero_contrato) as tiene_pendiente_financiero
from sosp c
left join lateral (
  select s.* from public.asientos_contables s
  where s.origen = 'cxp' and s.referencia = 'cxp:' || c.id
  order by s.id desc limit 1
) a on true
order by (a.id is not null and a.fecha <> c.fecha_obligacion) desc, c.created_at desc;

-- ═══ E) 106 FECHAS DE EMISIÓN (ventas): ¿editables de verdad o default? ═════
-- Solo el contrato manual (crearContrato) ENVÍA fecha_emision (prellenada en el
-- formulario, editable). Tarifario, carrito, programa, la conversión SQL de la
-- 164 y el importador NO la envían: queda el default `current_date` de la
-- tabla (y lo mismo `fecha_venta`). Columnas que solo llena cada camino:
--   programa → tipo_paquete='programa' · carrito → tipo_paquete='carrito'
--   tarifario → modo_compra / paquete_armado_id · conversión SQL → cotizacion_id
--   manual → asesor_firma_cargo/cc/tel (solo ese formulario los pide)
with sosp as (
  select v.*
  from public.ventas v
  where v.fecha_emision is not null
    and (v.created_at at time zone 'UTC')::date <> (v.created_at at time zone 'America/Bogota')::date
    and v.fecha_emision = (v.created_at at time zone 'UTC')::date
)
select
  case
    when tipo_paquete = 'programa' then 'reservarPrograma — default current_date'
    when tipo_paquete = 'carrito' then 'convertirCotizacionCarrito — default current_date'
    when modo_compra is not null or paquete_armado_id is not null then 'reservarDesdeTarifario — default current_date'
    when cotizacion_id is not null then 'SQL convertir_cotizacion_a_contrato — default current_date'
    when asesor_firma_cargo is not null or asesor_firma_cc is not null or asesor_firma_tel is not null
      then 'crearContrato (manual) — prellenada y editable'
    when tenant = 'minorista' then 'minorista sin firma: importador (default) o manual sin firma — revisar'
    else 'sin firma ni marcas: manual sin firma o camino no identificado — revisar'
  end as escritor_probable,
  count(*) as contratos,
  count(*) filter (where fecha_venta = fecha_emision) as fecha_venta_igual,
  min(created_at at time zone 'America/Bogota') as primero_bogota,
  max(created_at at time zone 'America/Bogota') as ultimo_bogota,
  -- Muchas filas en el mismo minuto = carga masiva (importador).
  max(lote) as max_contratos_mismo_minuto
from (
  select s.*, count(*) over (partition by date_trunc('minute', s.created_at)) as lote
  from sosp s
) x
group by 1
order by contratos desc;

-- ═══ F) FECHA DIAN: instante real en que se marcó (auditoría) ═══════════════
-- updated_at cambia con CUALQUIER edición posterior de la facturación, así que
-- no prueba nada. La auditoría guarda el instante exacto del cambio de dian_fecha.
select
  f.numero_contrato, f.dian_fecha,
  to_char(f.updated_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as updated_at_bogota,
  to_char(m.creado_en at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as marcada_bogota,
  (m.creado_en at time zone 'America/Bogota')::date as dia_bogota_al_marcar,
  coalesce(m.actor_email, '(sin rastro en auditoría)') as actor,
  case
    when m.creado_en is null then 'sin rastro: no concluyente'
    when f.dian_fecha = (m.creado_en at time zone 'America/Bogota')::date then 'ok (día de Bogotá al marcar)'
    when f.dian_fecha = (m.creado_en at time zone 'UTC')::date then 'DEFECTO: día UTC al marcar'
    else 'otra fecha (marcada otro día o editada)'
  end as veredicto
from public.contrato_facturacion f
left join lateral (
  select au.creado_en, au.actor_email from public.auditoria au
  where au.tabla = 'contrato_facturacion'
    and coalesce(au.despues->>'numero_contrato', au.antes->>'numero_contrato') = f.numero_contrato
    and coalesce(au.despues->>'dian_fecha', '') = coalesce(f.dian_fecha::text, '')
    and (upper(au.accion) = 'INSERT' or au.cambios ? 'dian_fecha')
  order by au.id desc limit 1
) m on true
where f.dian_fecha is not null
order by m.creado_en desc nulls last;

-- ═══ G) RESTO de las 270 (fuera de C, D, E, F), por tabla y origen ══════════
with b as (
  select 'abonos' as tabla, '' as origen, a.fecha_abono as fecha, a.created_at as creado from public.abonos a
  union all select 'asientos_contables', s.origen, s.fecha, s.created_at from public.asientos_contables s
    where s.origen not in ('facturacion', 'facturacion_reversion', 'cxp', 'pago_previo_aplicacion', 'pago_previo_reversion')
  union all select 'cotizacion_pagos_previos', '', p.fecha_pago, p.created_at from public.cotizacion_pagos_previos p
  union all select 'cxp_pagos', '', x.fecha, x.created_at from public.cxp_pagos x
  union all select 'retenciones_cxp', '', r.fecha_practica, r.created_at from public.retenciones_cxp r
  union all select 'comision_b2b_pagos', '', c.fecha, c.created_at from public.comision_b2b_pagos c
  union all select 'contabilidad_movimientos', '', m.fecha, m.created_at from public.contabilidad_movimientos m
)
select tabla, origen, count(*) as sospechosas
from b
where creado is not null and fecha is not null
  and (creado at time zone 'UTC')::date <> (creado at time zone 'America/Bogota')::date
  and fecha = (creado at time zone 'UTC')::date
group by tabla, origen
order by sospechosas desc;

-- ═══ H) ¿QUÉ TABLAS TIENEN AUDITORÍA? (correr primero) ═════════════════════
select c.relname as tabla,
       exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_auditoria') as tiene_trigger_auditoria,
       (select count(*) from public.auditoria au where au.tabla = c.relname) as filas_en_auditoria
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ventas', 'abonos', 'cuentas_por_pagar', 'asientos_contables', 'contrato_facturacion',
                    'cotizacion_pagos_previos', 'cxp_pagos', 'retenciones_cxp', 'comision_b2b_pagos',
                    'contabilidad_movimientos')
order by tiene_trigger_auditoria, tabla;
