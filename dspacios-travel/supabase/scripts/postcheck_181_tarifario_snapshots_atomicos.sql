-- Postcheck 181. Corre DESPUÉS de aplicar
-- 20260601000181_tarifario_snapshots_atomicos.sql.
--
-- Verifica FORMA (columnas, constraints, funciones, triggers, permisos) —
-- solo lectura, ninguna sección de este script modifica datos. El
-- comportamiento (camino feliz, rechazos, atomicidad) está en la batería
-- dedicada: supabase/scripts/test_181_tarifario_snapshots_atomicos.sql
-- (ejecutar ese script por separado, dentro de una transacción con ROLLBACK).

-- 1) Las 8 columnas nuevas existen con el tipo/nulabilidad/default esperado.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'armado_paquetes'
  and column_name in (
    'tarifario_revision_fuente', 'tarifario_revision_publicada',
    'tarifario_generacion', 'tarifario_generacion_publicada',
    'tarifario_estado', 'tarifario_error', 'tarifario_actualizado_en',
    'tarifario_snapshot_publicable'
  )
order by column_name;
-- Esperado: 8 filas.
--   tarifario_revision_fuente      bigint, NO, default 0
--   tarifario_revision_publicada   bigint, YES, default null
--   tarifario_generacion           bigint, NO, default 0
--   tarifario_generacion_publicada bigint, YES, default null
--   tarifario_estado               text,   NO, default 'pendiente'::text
--   tarifario_error                text,   YES, default null
--   tarifario_actualizado_en       timestamptz, YES, default null
--   tarifario_snapshot_publicable  boolean, NO, default true

-- 2) El CHECK de tarifario_estado existe con los 4 valores.
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.armado_paquetes'::regclass
  and conname = 'armado_paquetes_tarifario_estado_check';
-- Esperado: 1 fila, definición debe listar 'pendiente','recalculando','listo','fallido'.

-- 3) Ninguna fila existente quedó fuera del default esperado (sin backfill
--    manual — todas nacen con los defaults de la migración).
select
  count(*) filter (where tarifario_revision_fuente <> 0) as con_revision_no_cero,
  count(*) filter (where tarifario_generacion <> 0) as con_generacion_no_cero,
  count(*) filter (where tarifario_estado <> 'pendiente') as con_estado_no_pendiente,
  count(*) filter (where tarifario_snapshot_publicable is distinct from true) as con_publicable_no_true
from public.armado_paquetes;
-- Esperado: las 4 columnas en 0 (inmediatamente después de correr la migración,
-- antes de que cualquier trigger/RPC nuevo se dispare por primera vez).

-- 4) Las 14 funciones existen con el SECURITY esperado.
select proname,
       prosecdef as es_security_definer,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_puede,
       has_function_privilege('anon', oid, 'execute') as anon_puede
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'tarifario_invalidar', 'tarifario_trg_bump_por_hotel', 'tarifario_trg_bump_por_servicio',
    'tarifario_trg_bump_servicio_catalogo', 'tarifario_trg_bump_armado_directo',
    'tarifario_trg_bump_por_bloqueo', 'tarifario_trg_bump_por_empaquetado',
    'tarifario_trg_bump_salida_dinamica', 'tarifario_trg_bump_armado_paquetes',
    'tarifario_trg_bump_hotel_moneda_modelo', 'tarifario_trg_bump_destino_nombre',
    'iniciar_generacion_tarifario', 'publicar_tarifario_resultado', 'marcar_generacion_fallida'
  )
order by proname;
-- Esperado: 14 filas.
--   Las 11 funciones de trigger (tarifario_invalidar + los 10 tarifario_trg_*):
--     es_security_definer = true, authenticated_puede = false, anon_puede = false
--     (nunca invocables directo — solo se disparan como efecto de un trigger).
--   iniciar_generacion_tarifario / marcar_generacion_fallida:
--     es_security_definer = false, authenticated_puede = true, anon_puede = false.
--   publicar_tarifario_resultado:
--     es_security_definer = true, authenticated_puede = true, anon_puede = false.

-- 5) Los 15 triggers están adjuntados a sus 15 tablas (10 funciones de
--    trigger, algunas reusadas por más de una tabla: tarifario_trg_bump_
--    armado_directo la comparten armado_hoteles/armado_vuelos/
--    armado_servicios/armado_empaquetados; tarifario_trg_bump_por_hotel la
--    comparten tarifa_hotel/hotel_temporadas; tarifario_trg_bump_por_
--    servicio la comparten servicio_tarifa_pax/servicio_temporadas).
select c.relname as tabla, t.tgname as trigger
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and t.tgname like 'tarifario_trg_%'
order by c.relname, t.tgname;
-- Esperado: 15 filas — tarifa_hotel, hotel_temporadas, servicio_tarifa_pax,
--   servicio_temporadas, servicios_adicionales, armado_hoteles, armado_vuelos,
--   armado_servicios, armado_empaquetados, bloqueos_vuelo, empaquetados,
--   salidas_dinamicas, armado_paquetes, hoteles, destinos.

-- 6) Los triggers de armado_paquetes, hoteles, destinos y servicios_adicionales
--    están acotados por columna (evita disparar por cambios irrelevantes/
--    recursión) — confirmar que `tgattr` no está vacío para esos cuatro, y
--    que `moneda` YA NO forma parte de la lista de armado_paquetes (auditoría
--    de Fase 1, ronda 3 — ver conteo de columnas abajo).
select c.relname as tabla, t.tgname as trigger, t.tgattr,
       array_length(t.tgattr, 1) as cantidad_columnas_vigiladas
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and t.tgname in ('tarifario_trg_armado_paquetes', 'tarifario_trg_hoteles_moneda_modelo', 'tarifario_trg_servicios_adicionales', 'tarifario_trg_destinos_nombre');
-- Esperado: 4 filas, tgattr no vacío en ninguna.
--   tarifario_trg_armado_paquetes: 10 columnas (nombre, tipo, destino_id,
--     pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio,
--     fecha_viaje_fin, noches, activo — moneda YA NO está en la lista).
--   tarifario_trg_destinos_nombre: 1 columna (nombre).
--   tarifario_trg_hoteles_moneda_modelo: 3 columnas (nombre, moneda,
--     modelo_tarifario — `nombre` agregada en auditoría de Fase 1, ronda 4).
--   tarifario_trg_servicios_adicionales: 6 columnas (nombre, descripcion,
--     precio_persona, recargo_individual, liquidacion, moneda — `nombre` y
--     `descripcion` agregadas en auditoría de Fase 1, ronda 4).

-- 7) Confirmar explícitamente que `moneda` de armado_paquetes NO está vigilada
--    por ningún trigger de columnas (la única escritura autoritativa ocurre
--    dentro de publicar_tarifario_resultado, que no pasa por UPDATE OF).
select exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and c.relname = 'armado_paquetes'
    and t.tgname like 'tarifario_trg_%'
    and 'moneda' = any (
      select attname from pg_attribute where attrelid = c.oid and attnum = any(t.tgattr)
    )
) as moneda_vigilada_por_algun_trigger;
-- Esperado: false.
