-- ─────────────────────────────────────────────────────────────────────────
-- Conteo AGREGADO de cotizaciones de carrito cuyo payload conserva costos o
-- proveedores de servicios incluidos (formato anterior a PR #353).
--
-- ⚠️ NO EJECUTAR sin autorización explícita del usuario. Preparado, no corrido.
--
-- Contexto: hasta PR #353 el checkout guardaba en
-- `cotizaciones.payload.serviciosIncluidos[]` el `costoNeto` y el
-- `proveedorId` de cada servicio incluido. El rol `venta` puede leer
-- `cotizaciones` (RLS, migración 154). Desde #353 el payload nuevo solo lleva
-- identidad + `huella` (HMAC del costo, opaca).
--
-- Garantías de esta consulta:
--   · SOLO LECTURA (transacción `read only` + rollback).
--   · Devuelve únicamente conteos por agencia, estado y mes: sin PII
--     (cliente, documento, correo, creador), sin importes y sin payloads.
--   · No modifica, no sanea, no hace backfill. Cualquier saneamiento remoto
--     requiere una autorización separada; el plan (no aplicado) está en
--     docs/tecnico/incluidos-cotizados.md §6.
-- ─────────────────────────────────────────────────────────────────────────
begin read only;

-- Todo acceso a `payload` pasa por `case when jsonb_typeof(...) = 'array'`
-- y no hay casts sobre valores del payload: SQL no garantiza el orden de
-- evaluación de AND/OR, y un payload antiguo con otra forma no debe abortar
-- la consulta.

-- 1) Cotizaciones de carrito con incluidos guardados: cuántas exponen costo
--    o proveedor, cuántas ya están en el formato nuevo, cuántas NO podrán
--    convertirse con las reglas de #353 (formato anterior sin `costoNeto`
--    numérico o sin la clave `proveedorId`: no hay con qué verificar) y
--    cuántas tienen la vigencia vencida (insumo del plan de saneamiento).
select
  c.tenant,
  c.estado,
  date_trunc('month', c.created_at)::date as mes,
  count(*) as cotizaciones_con_incluidos,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) e
    where e ? 'costoNeto'
  )) as con_costo_neto,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) e
    where e ? 'proveedorId' and e -> 'proveedorId' <> 'null'::jsonb
  )) as con_proveedor,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) e
    where e ? 'huella'
  )) as formato_nuevo,
  count(*) filter (where exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) e
    where not (e ? 'huella')
      and (jsonb_typeof(e -> 'costoNeto') is distinct from 'number' or not (e ? 'proveedorId'))
  )) as anterior_no_verificable,
  count(*) filter (where c.vigencia_hasta < current_date) as vigencia_vencida
from public.cotizaciones c
where c.tipo = 'carrito'
  and jsonb_array_length(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) > 0
group by c.tenant, c.estado, date_trunc('month', c.created_at)
order by mes, c.tenant, c.estado;

-- 2) Cotizaciones ABIERTAS sin incluidos guardados cuyo paquete (hotel por
--    persona) SÍ tiene incluidos hoy — caso típico: creadas por un aliado B2B
--    antes de #353, cuando la lectura de incluidos devolvía vacío. Con #353
--    su conversión se detiene ("los servicios incluidos cambiaron"); hay que
--    regenerarlas. Solo conteos.
select
  c.tenant,
  date_trunc('month', c.created_at)::date as mes,
  count(*) as abiertas_sin_incluidos_guardados,
  count(*) filter (where c.vigencia_hasta < current_date) as de_ellas_vencidas
from public.cotizaciones c
where c.tipo = 'carrito'
  and c.estado = 'abierta'
  and jsonb_array_length(case when jsonb_typeof(c.payload -> 'serviciosIncluidos') = 'array' then c.payload -> 'serviciosIncluidos' else '[]'::jsonb end) = 0
  and exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(c.payload -> 'items') = 'array' then c.payload -> 'items' else '[]'::jsonb end) it
    join public.armado_servicios a
      on a.incluido = true
     -- Comparación como TEXTO, sin cast: un paqueteId no numérico o fuera
     -- del rango de bigint simplemente no coincide (nunca aborta la consulta).
     and a.paquete_id::text = it ->> 'paqueteId'
    where coalesce(it ->> 'modeloTarifario', '') <> 'unidad'
  )
group by c.tenant, date_trunc('month', c.created_at)
order by mes, c.tenant;

rollback;
