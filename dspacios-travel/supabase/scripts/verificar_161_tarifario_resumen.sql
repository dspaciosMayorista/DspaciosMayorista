-- ───────────────────────────────────────────────────────────────────────────
-- Consulta PREVENTIVA de solo lectura para la migración 161
-- (vista `tarifario_resumen`) — correr ANTES de aplicar la migración, sobre
-- el catálogo REAL, para confirmar que el resumen de verdad reduce la
-- magnitud del payload inicial (y no esconde un caso donde termina siendo
-- casi tan grande como `tarifario_resultado`). No escribe nada.
--
-- La migración en sí NO se ejecuta con este script — es diagnóstico previo.
-- Se pega en el editor SQL de Supabase (modo solo lectura / con `explain` si
-- se prefiere no comprometerse ni con la vista).
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Magnitud real: filas de tarifario_resultado (vigentes) vs. combinaciones
--    distintas (módulo, paquete, bloqueo, hotel, servicio, fecha) que tendría
--    el resumen. Debe ser un múltiplo bajo de "hoteles/salidas", NUNCA cercano
--    a las 17.197 filas totales — si sale cercano, el resumen no está
--    cumpliendo su propósito y hay que revisar el `group by` antes de aplicar
--    la migración.
select
  (select count(*) from public.tarifario_resultado where paquete_activo = true) as filas_tarifario_resultado,
  count(*) as filas_resumen_estimadas,
  count(distinct hotel_id) filter (where hotel_id is not null) as hoteles_distintos,
  count(distinct bloqueo_id) filter (where bloqueo_id is not null) as bloqueos_distintos,
  count(distinct paquete_id) as paquetes_distintos
from (
  select modulo, paquete_id, bloqueo_id, hotel_id, servicio_id, fecha_ida, fecha_regreso
  from public.tarifario_resultado
  where paquete_activo = true
  group by modulo, paquete_id, bloqueo_id, hotel_id, servicio_id, fecha_ida, fecha_regreso
) t;

-- 2) Combos con hotel_id pero SIN ningún precio de acomodación de adulto
--    (sencilla/doble/triple/multiple) — hoy esos hoteles ya se muestran como
--    "Consultar" (desde=null) en las tarjetas; confirma que el resumen
--    reproduce exactamente ese mismo caso, no lo esconde ni lo inventa.
select
  hotel_id, hotel_nombre, modulo, paquete_id, bloqueo_id,
  count(*) as filas_del_combo
from public.tarifario_resultado
where paquete_activo = true and hotel_id is not null
group by hotel_id, hotel_nombre, modulo, paquete_id, bloqueo_id
having bool_and(acomodacion not in ('sencilla', 'doble', 'triple', 'multiple') or precio_pvp <= 0)
limit 50;

-- 3) Colisión de nombre: confirma que `tarifario_resumen` no existe ya como
--    tabla/vista/función antes de crearlo (debe devolver 0 filas).
select c.relname, c.relkind
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';
