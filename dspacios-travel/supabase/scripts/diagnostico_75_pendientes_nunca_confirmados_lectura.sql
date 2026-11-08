-- DIAGNÓSTICO DE SOLO LECTURA · #75 · Mayorista (DTM-): ¿qué números son reutilizables bajo el alcance
-- «contrato pendiente que nunca se confirmó ni tuvo pagos o movimientos»?
-- UNA sola consulta (pegar completa en el editor SQL de Supabase). No escribe nada. No ejecutada en remoto.
--
-- ALCANCE ACTUAL: solo Mayorista DTM hoy en estado «pendiente» y nunca confirmados. Los cancelados y los ya eliminados quedan fuera.
-- «APTO» significa ÚNICAMENTE «candidato que cumple las guardas»: NO es «seguro para reutilizar» (falta separar el historial de auditoría).
--
-- Universo: todo número DTM-#### que (a) existe hoy en `ventas`, (b) aparece en la auditoría de `ventas`
-- (contratos ya eliminados) o (c) fue emitido por la secuencia pero no deja rastro (huecos).
-- Clasificación (cada fila trae el motivo):
--   APTO (candidato)        contrato vivo en estado pendiente, historia de auditoría completa (hay evento INSERT), estados vistos solo
--                           «pendiente», y ningún bloqueo en las tablas vivas ni en la auditoría.
--   FUERA DE ALCANCE        contrato vivo cancelado (no se evalúa por ahora).
--   NO APTO                 hay evidencia POSITIVA de confirmación, pago, factura, documento emitido, archivo o
--                           movimiento operativo (lista exacta de códigos en `motivo`).
--   EVIDENCIA INSUFICIENTE  no hay evidencia positiva en contra, pero tampoco se puede demostrar el caso: contrato
--                           ya eliminado (pagos a proveedor, retenciones y emisión de vuelo se borran en cascada sin
--                           rastro), hueco sin rastro, o contrato sin evento de creación en la auditoría.
-- `dependencias` NO bloquea por sí sola salvo CAPTURA_PERSONAS (referencia sobreviviente por número).
with
sq as (select case when is_called then last_value else 0 end as n from public.contrato_seq_mayorista),
nums as (
  select numero from (
    select numero_contrato as numero from public.ventas where tenant = 'mayorista' and numero_contrato ~ '^DTM-[0-9]+$'
    union select registro_id from public.auditoria where tabla = 'ventas' and tenant = 'mayorista' and registro_id ~ '^DTM-[0-9]+$'
    union select 'DTM-' || lpad(g::text, 4, '0') from sq, generate_series(1, (select n from sq)) g
  ) x),
a as (
  select n.numero,
    bool_or(au.tabla = 'ventas' and au.accion = 'INSERT')                                   as ins,
    bool_or(au.tabla = 'ventas' and au.accion = 'DELETE')                                   as del,
    coalesce(array_agg(distinct s.e) filter (where au.tabla = 'ventas' and s.e is not null), '{}') as estados,
    coalesce(bool_or(au.tabla = 'sillas' and 'confirmada' in (au.antes->>'estado', au.despues->>'estado')), false) as silla_conf,
    coalesce(bool_or(au.tabla = 'abonos'), false)              as abonos_aud,
    coalesce(bool_or(au.tabla = 'facturacion'), false)         as factura_aud,
    coalesce(bool_or(au.tabla = 'vouchers'), false)            as voucher_aud,
    coalesce(bool_or(au.tabla = 'cuotas'), false)              as plan_aud,
    coalesce(bool_or(au.tabla = 'contrato_adjuntos'), false)   as adjunto_aud,
    coalesce(bool_or(au.tabla = 'movimientos_silla'), false)   as mov_aud,
    coalesce(bool_or(au.tabla = 'p63_aceptacion'), false)      as p63_aud,
    count(distinct au.id) filter (where au.tabla = 'contrato_pasajeros' and au.accion = 'INSERT') as pasajeros_capturados,
    coalesce(array_agg(distinct (coalesce(au.despues, au.antes)->>'id')::bigint) filter (where au.tabla = 'cotizaciones'), '{}') as cot_ids
  from nums n
  left join public.auditoria au on au.registro_id = n.numero and au.tenant = 'mayorista'
  left join lateral (select unnest(array[au.antes->>'estado', au.despues->>'estado']) as e) s on true
  group by n.numero),
f as (
  select n.numero,
    v.estado as estado_vivo, (v.numero_contrato is not null) as vivo,
    exists (select 1 from public.abonos x where x.numero_contrato = n.numero)                          as abonos_v,
    exists (select 1 from public.abonos_anulados x where x.numero_contrato = n.numero)                 as anulados_v,
    exists (select 1 from public.abono_operaciones x where x.numero_contrato = n.numero)               as abono_op_v,
    exists (select 1 from public.cotizacion_pagos_previos pp
              where pp.cotizacion_id in (select id from public.cotizaciones c where c.numero_contrato = n.numero)
                 or pp.cotizacion_id = any (coalesce((select a.cot_ids from a where a.numero = n.numero), '{}'::bigint[]))) as pago_previo_v,
    exists (select 1 from public.conciliacion_sistema x where x.numero_contrato = n.numero)            as concil_v,
    exists (select 1 from public.facturacion x where x.numero_contrato = n.numero)
      or exists (select 1 from public.factura_revision_fuera_libros x where x.numero_contrato = n.numero)
      or exists (select 1 from public.contrato_facturacion x where x.numero_contrato = n.numero)       as factura_v,
    exists (select 1 from public.cuentas_por_pagar c join public.cxp_pagos p on p.cuenta_por_pagar_id = c.id where c.numero_contrato = n.numero)        as pago_prov_v,
    exists (select 1 from public.cuentas_por_pagar c join public.retenciones_cxp r on r.cuenta_por_pagar_id = c.id where c.numero_contrato = n.numero)  as retencion_v,
    exists (select 1 from public.aliados_b2b b join public.comision_b2b_pagos p on p.aliado_b2b_id = b.id where b.numero_contrato = n.numero)          as pago_comision_v,
    exists (select 1 from public.liquidacion_descuentos x where x.numero_contrato = n.numero)          as descuento_v,
    exists (select 1 from public.vouchers x where x.numero_contrato = n.numero)                        as voucher_v,
    exists (select 1 from public.cuotas x where x.numero_contrato = n.numero)                          as plan_v,
    exists (select 1 from public.contrato_vuelo_control x where x.numero_contrato = n.numero and x.estado_emision = 'emitido') as vuelo_emitido_v,
    exists (select 1 from public.contrato_adjuntos x where x.numero_contrato = n.numero)
      or exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and starts_with(o.name, n.numero || '/'))
      or exists (select 1 from public.contrato_soportes_pago x where x.numero_contrato = n.numero)
      or exists (select 1 from public.avisos x where x.numero_contrato = n.numero)                     as archivo_v,
    exists (select 1 from public.movimientos_silla x where x.numero_contrato = n.numero)               as mov_v,
    exists (select 1 from public.p63_aceptacion x where x.numero_contrato = n.numero)                  as p63_v,
    exists (select 1 from public.sillas x where x.numero_contrato = n.numero and x.estado = 'confirmada') as silla_conf_v,
    (select count(*) from public.persona_capturas x where x.contrato_numero = n.numero)                as capturas_personas
  from nums n left join public.ventas v on v.numero_contrato = n.numero and v.tenant = 'mayorista'),
r as (
  select f.numero, f.vivo, f.estado_vivo, a.ins, a.del, a.estados, a.pasajeros_capturados, f.capturas_personas,
    array_remove(array[
      case when a.estados && array['confirmado','activo'] then 'ESTADO_CONFIRMADO_EN_HISTORIA' end,
      case when f.vivo and f.estado_vivo not in ('pendiente','cancelado') then 'ESTADO_ACTUAL_' || upper(coalesce(f.estado_vivo,'NULL')) end,
      case when a.silla_conf or f.silla_conf_v then 'SILLA_CONFIRMADA' end,
      case when a.abonos_aud or f.abonos_v then 'ABONOS' end,
      case when f.anulados_v or f.abono_op_v then 'ABONO_ANULADO_U_OPERACION' end,
      case when f.pago_previo_v then 'PAGO_PREVIO_COTIZACION' end,
      case when f.concil_v then 'CONCILIACION' end,
      case when a.factura_aud or f.factura_v then 'FACTURA_O_CONFIG_FACTURACION' end,
      case when f.pago_prov_v then 'PAGO_PROVEEDOR' end,
      case when f.retencion_v then 'RETENCION' end,
      case when f.pago_comision_v then 'PAGO_COMISION' end,
      case when f.descuento_v then 'DESCUENTO_LIQUIDACION' end,
      case when a.voucher_aud or f.voucher_v then 'VOUCHER_EMITIDO' end,
      case when a.plan_aud or f.plan_v then 'PLAN_DE_COBRO' end,
      case when f.vuelo_emitido_v then 'VUELO_EMITIDO' end,
      case when a.adjunto_aud or f.archivo_v then 'ARCHIVOS_O_SOPORTES' end,
      case when a.mov_aud or f.mov_v then 'MOVIMIENTO_SILLA' end,
      case when a.p63_aud or f.p63_v then 'ACEPTACION_EMPAQUETADO' end,
      case when f.capturas_personas > 0 then 'CAPTURA_PERSONAS' end
    ], null) as bloqueos
  from f join a using (numero))
select numero,
  case when vivo then 'vivo:' || coalesce(estado_vivo,'?') when coalesce(del,false) then 'eliminado' else 'hueco sin rastro' end as situacion,
  case when vivo and estado_vivo = 'cancelado' then 'FUERA DE ALCANCE'
       when cardinality(bloqueos) > 0 then 'NO APTO'
       when not vivo then 'EVIDENCIA INSUFICIENTE'
       when not coalesce(ins,false) then 'EVIDENCIA INSUFICIENTE'
       when not (estados <@ array['pendiente']) then 'EVIDENCIA INSUFICIENTE'
       else 'APTO' end as clasificacion,
  case when vivo and estado_vivo = 'cancelado' then 'contrato cancelado: excluido del alcance actual (solo pendientes nunca confirmados)'
       when cardinality(bloqueos) > 0 then array_to_string(bloqueos, ', ')
       when not vivo and coalesce(del,false) then 'eliminado: pagos a proveedor, retenciones y emisión de vuelo se borran en cascada sin rastro; no se puede demostrar su ausencia'
       when not vivo then 'hueco: la secuencia lo emitió pero no hay contrato ni rastro; no se puede demostrar que no se usó'
       when not coalesce(ins,false) then 'sin evento de creación en la auditoría: historia incompleta, no se puede acreditar que nunca se confirmó'
       when not (estados <@ array['pendiente']) then 'la historia muestra estados distintos de pendiente: no se puede acreditar que nunca se confirmó'
       else 'candidato: pendiente, sin confirmación ni movimiento en la historia ni en las tablas vivas; NO implica reutilización segura (falta separar el historial)' end as motivo,
  'pasajeros capturados (auditoría): ' || coalesce(pasajeros_capturados,0) || '; capturas de personas: ' || capturas_personas as dependencias
from r order by numero;
