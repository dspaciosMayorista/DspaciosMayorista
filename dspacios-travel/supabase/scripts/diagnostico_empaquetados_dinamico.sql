-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO DE SOLO LECTURA — records/vuelos "por sistema" que ya existen
-- como CONTRATOS de tipo dinámico, para decidir cómo (y si) incorporarlos a
-- la pestaña EMPAQUETADOS (revisión de PR #268, defecto 3).
--
-- QUÉ PROBLEMA RESPONDE
--   El requerimiento original de EMPAQUETADOS era mostrar dos cosas: (a) las
--   tarifas promocionales cargadas a mano (tabla `empaquetados`, lo único
--   que la pestaña muestra hoy) y (b) records/vuelos "por sistema" que ya
--   viven en contratos reales tipo `dinamico` (reservados desde
--   `salidas_dinamicas`, sin cupo negociado — la MISMA idea de negocio que
--   un Empaquetado, en otra tabla). Antes de tocar la UI hace falta saber
--   CUÁNTOS contratos así existen, con qué tan completos están sus datos, y
--   qué tan ambiguos son para vincularlos — NO se debe inventar una relación
--   por coincidencia de record/nombre/ruta si el dato no alcanza para
--   distinguir un caso de otro.
--
-- HALLAZGO ESTRUCTURAL (confirmado en el código, no solo en los datos): un
-- contrato tipo dinámico NO llena `contrato_vuelos` — `reservarDesdeTarifarioInterno`
-- solo inserta esa tabla para origen bloqueo/empaquetado (ver
-- `lib/reservar/origen.ts` + el paso 7 de `reservar/actions.ts`). Los únicos
-- datos de vuelo que le quedan a un contrato dinámico en tablas reales son
-- `ventas.aerolinea`/`ventas.costo_aereo`/`ventas.fecha_salida`/
-- `ventas.fecha_regreso` — sin ruta IATA estructurada, sin número de vuelo,
-- sin horarios. El detalle completo (si existe) solo sobrevive en
-- `cotizaciones.payload->vuelosSnap` de la cotización que originó el
-- contrato, si esa cotización no fue purgada.
--
-- Solo LECTURA — no crea, modifica ni borra nada. Se pega en el editor SQL
-- de Supabase.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Volumen total de contratos dinámicos, por año — para dimensionar el
--    problema antes de diseñar cualquier UI (¿son 5 o son 5.000?).
select
  date_trunc('year', fecha_venta)::date as anio,
  count(*)                              as contratos,
  count(*) filter (where aerolinea is not null)     as con_aerolinea,
  count(*) filter (where costo_aereo > 0)           as con_costo_aereo,
  count(*) filter (where fecha_salida is not null)  as con_fecha_salida
from public.ventas
where tipo_paquete = 'dinamico'
group by 1
order by 1 desc;

-- 2) Cuántos de esos contratos dinámicos AÚN tienen su cotización de origen
--    con el snapshot de vuelo completo (`payload->vuelosSnap`) — esos son
--    los únicos candidatos con datos de vuelo "ricos" (ruta IATA, horarios,
--    número de vuelo); el resto solo tiene los 4 campos planos de `ventas`.
--    (El enlace cotización↔contrato no es una FK — se resuelve por
--    coincidencia de datos del payload al convertir, así que este conteo es
--    aproximado por diseño: cuenta cotizaciones "carrito"/dinámicas con
--    vuelosSnap no vacío, sin pretender emparejarlas 1:1 con el contrato.)
select
  count(*) as cotizaciones_con_snapshot_de_vuelo
from public.cotizaciones
where payload -> 'vuelosSnap' is not null
  and jsonb_array_length(coalesce(payload -> 'vuelosSnap', '[]'::jsonb)) > 0;

-- 3) Ambigüedad real de "record" para un backfill por texto: cuántos
--    contratos dinámicos comparten la MISMA combinación aerolínea+fecha de
--    salida (el único par de columnas planas disponible) — si el número es
--    alto, backfillear por coincidencia de texto sería adivinar cuál
--    contrato es cuál. Filas con conteo > 1 son genuinamente ambiguas.
select
  aerolinea, fecha_salida, count(*) as contratos_con_la_misma_combinacion,
  array_agg(numero_contrato order by numero_contrato) as numeros_contrato
from public.ventas
where tipo_paquete = 'dinamico' and aerolinea is not null and fecha_salida is not null
group by aerolinea, fecha_salida
having count(*) > 1
order by contratos_con_la_misma_combinacion desc
limit 50;

-- 4) Muestra de los 20 contratos dinámicos más recientes, con exactamente
--    los campos que HOY están disponibles sin inventar nada — esta es,
--    literalmente, la información completa que un "origen: Contrato" podría
--    mostrar en una lista unificada, sin backfill de ningún tipo.
select
  numero_contrato, fecha_venta, cliente, destino,
  aerolinea, costo_aereo, fecha_salida, fecha_regreso, estado, tenant
from public.ventas
where tipo_paquete = 'dinamico'
order by fecha_venta desc
limit 20;
