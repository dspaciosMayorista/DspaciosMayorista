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
--
-- ⚠️ Revisión posterior (defecto confirmado y corregido): la versión anterior
-- de este script agrupaba por SOLO 7 columnas (modulo, paquete_id, bloqueo_id,
-- hotel_id, servicio_id, fecha_ida, fecha_regreso) — MENOS columnas que el
-- `group by` real de la vista 161 (20 columnas: incluye categoria, regimen,
-- noches, moneda, paquete_nombre, paquete_activo, bloqueo_label,
-- empaquetado_id, salida_id, hotel_nombre, servicio_nombre, destino_id,
-- destino_nombre). Agrupar por menos columnas SIEMPRE produce un conteo
-- IGUAL o MENOR al real (nunca mayor) — así que la preventiva vieja podía
-- reportar una reducción de magnitud más favorable de lo que la vista
-- realmente entrega, sin que nadie lo notara antes de aplicar la migración.
-- La consulta 1 de abajo usa AHORA exactamente las mismas 20 columnas y el
-- mismo `group by` que `create view public.tarifario_resumen` (migración
-- 161) — si alguna vez se edita el `group by` de la vista, este script debe
-- actualizarse en el mismo commit para no volver a desincronizarse.
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Magnitud real: filas de tarifario_resultado (vigentes) vs. combinaciones
--    distintas que tendría el resumen, usando EXACTAMENTE las mismas columnas
--    y el mismo `group by` que la vista (ver nota arriba). Debe ser un
--    múltiplo bajo de "hoteles/salidas", NUNCA cercano a las 17.197 filas
--    totales — si sale cercano, el resumen no está cumpliendo su propósito y
--    hay que revisar el `group by` antes de aplicar la migración. También es
--    el número de filas que se entregarían al cliente en la carga inicial —
--    esta versión de la app ya NO expande el resumen a filas sintéticas
--    (`expandirResumenAFilas()` se eliminó del transporte inicial), así que
--    "filas_resumen_estimadas" = "filas que de verdad viajan al navegador"
--    (antes de los filtros post-carga de vigencia/empaquetados, que corren en
--    TypeScript y no se pueden reproducir en SQL puro — ver
--    lib/tarifario/filtrosPostCarga.ts).
select
  (select count(*) from public.tarifario_resultado where paquete_activo = true) as filas_tarifario_resultado,
  count(*) as filas_resumen_estimadas,
  count(*) as filas_entregadas_cliente_sin_expansion_sintetica,
  count(distinct hotel_id) filter (where hotel_id is not null) as hoteles_distintos,
  count(distinct bloqueo_id) filter (where bloqueo_id is not null) as bloqueos_distintos,
  count(distinct paquete_id) as paquetes_distintos
from (
  select
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
  from public.tarifario_resultado
  where paquete_activo = true
  group by
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
) t;

-- 1.bis) CONTROL DE SINCRONÍA (correr DESPUÉS de aplicar la migración 161 en
--    el mismo entorno — local/staging, nunca antes de la autorización del
--    dueño en producción): compara el conteo calculado arriba a mano contra
--    el count(*) REAL de la vista ya creada. Deben coincidir EXACTAMENTE. Si
--    no coinciden, este script y la migración se desincronizaron — no confiar
--    en ninguno de los dos hasta reconciliarlos.
-- select count(*) as filas_vista_real from public.tarifario_resumen;

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
--    tabla/vista/función antes de crearlo (debe devolver 0 filas). La
--    migración 161 ya aborta sola si esto no es cierto (`to_regclass`), esta
--    consulta es solo para inspeccionar a mano antes de decidir aplicar.
select c.relname, c.relkind
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';
