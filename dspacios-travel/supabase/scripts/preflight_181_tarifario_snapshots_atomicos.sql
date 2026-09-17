-- Preflight 181 — SOLO LECTURA. Corre ANTES de aplicar
-- 20260601000181_tarifario_snapshots_atomicos.sql.
-- Objetivo: confirmar que la migración (aditiva: columnas + funciones +
-- triggers) no pisa nada que ya exista con el mismo nombre, y dimensionar el
-- volumen de filas/tablas fuente que empezarán a disparar triggers.

-- 1) Las 8 columnas nuevas NO deben existir todavía en armado_paquetes.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'armado_paquetes'
  and column_name in (
    'tarifario_revision_fuente', 'tarifario_revision_publicada',
    'tarifario_generacion', 'tarifario_generacion_publicada',
    'tarifario_estado', 'tarifario_error', 'tarifario_actualizado_en',
    'tarifario_snapshot_publicable'
  );
-- Esperado: 0 filas.

-- 2) El CHECK de tarifario_estado no debe existir todavía.
select conname
from pg_constraint
where conrelid = 'public.armado_paquetes'::regclass
  and conname = 'armado_paquetes_tarifario_estado_check';
-- Esperado: 0 filas.

-- 3) Ninguna de las funciones nuevas debe existir todavía (evita un "ya
--    existe con otra firma" inesperado).
select proname, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'tarifario_invalidar', 'tarifario_trg_bump_por_hotel', 'tarifario_trg_bump_por_servicio',
    'tarifario_trg_bump_servicio_catalogo', 'tarifario_trg_bump_armado_directo',
    'tarifario_trg_bump_por_bloqueo', 'tarifario_trg_bump_por_empaquetado',
    'tarifario_trg_bump_salida_dinamica', 'tarifario_trg_bump_armado_paquetes',
    'tarifario_trg_bump_hotel_moneda_modelo', 'tarifario_trg_bump_destino_nombre',
    'iniciar_generacion_tarifario', 'publicar_tarifario_resultado', 'marcar_generacion_fallida'
  );
-- Esperado: 0 filas.

-- 4) Ninguno de los 15 triggers nuevos debe existir todavía en sus tablas.
select tgname, relname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and tgname like 'tarifario_trg_%';
-- Esperado: 0 filas.

-- 5) mi_rol() y los tipos enum que usa el RPC de publicación deben existir
--    (dependencias de migraciones anteriores).
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'mi_rol';
select typname from pg_type where typnamespace = 'public'::regnamespace and typname in ('tarifario_modulo', 'acomodacion_tipo');
-- Esperado: 1 fila para mi_rol, 2 filas para los tipos.

-- 6) Volumen actual de armado_paquetes y de cada tabla fuente que ganará un
--    trigger — ninguna fila se modifica, solo dimensiona el fan-out inicial.
select
  (select count(*) from public.armado_paquetes) as armado_paquetes,
  (select count(*) from public.tarifa_hotel) as tarifa_hotel,
  (select count(*) from public.hotel_temporadas) as hotel_temporadas,
  (select count(*) from public.armado_hoteles) as armado_hoteles,
  (select count(*) from public.armado_vuelos) as armado_vuelos,
  (select count(*) from public.armado_servicios) as armado_servicios,
  (select count(*) from public.armado_empaquetados) as armado_empaquetados,
  (select count(*) from public.bloqueos_vuelo) as bloqueos_vuelo,
  (select count(*) from public.empaquetados) as empaquetados,
  (select count(*) from public.salidas_dinamicas) as salidas_dinamicas,
  (select count(*) from public.servicios_adicionales) as servicios_adicionales,
  (select count(*) from public.servicio_tarifa_pax) as servicio_tarifa_pax,
  (select count(*) from public.servicio_temporadas) as servicio_temporadas,
  (select count(*) from public.destinos) as destinos;

-- 7) Confirmar el set de roles de escritura vigente en armado_paquetes y
--    tarifario_resultado (el candado de rol de los RPC nuevos debe coincidir
--    EXACTAMENTE con esto — superadmin/gerencia/administracion/operaciones).
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('armado_paquetes', 'tarifario_resultado')
order by tablename, policyname;
