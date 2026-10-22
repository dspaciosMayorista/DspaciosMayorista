-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 226 · tarifa de infante (0 a 1,99 años). SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 226. Una fila por dato: codigo | nivel | cantidad | detalle.
-- CUENTA lo existente y NO bloquea: ningún nivel es BLOQUEANTE (la migración valida sus propios prerrequisitos y
-- aborta sola). Niveles: INFO · REVISAR (conviene conocer el caso antes de aplicar).
--
-- Qué hace la 226: agrega columnas (fee_infante del Bloqueo, precio_infante de servicios/temporadas,
-- precio_pvp_menor2 del tarifario), reemplaza el publicador, crear_bloqueo, 3 triggers de invalidación y 2 vistas.
-- NO regenera tarifarios ni toca contratos, pagos, cuentas por pagar ni cotizaciones.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with chequeos as (
  select 'P1' as codigo, 'INFO' as nivel,
         (to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is not null
          and to_regprocedure('public.crear_bloqueo(jsonb, integer)') is not null
          and to_regclass('public.tarifario_resultado_publicable') is not null
          and to_regclass('public.tarifario_resumen') is not null
          and to_regprocedure('public.tarifario_trg_bump_servicio_catalogo()') is not null)::int as cantidad,
         'Prerrequisitos: publicador (181), crear_bloqueo (195), vistas (162/182) y funciones de trigger presentes (1 = sí)' as detalle
  union all
  select 'P2', 'INFO',
         (select count(*) from information_schema.columns
           where table_schema = 'public'
             and ((table_name = 'bloqueos_vuelo' and column_name = 'fee_infante')
               or (table_name = 'servicios_adicionales' and column_name = 'precio_infante')
               or (table_name = 'servicio_temporadas' and column_name = 'precio_infante')
               or (table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2')))::int,
         '226 ya aplicada: columnas nuevas existentes (0 = ninguna, la migración las crea; 4 = ya aplicada, es idempotente)'
  union all
  select 'P3', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Servicios con tarifa por persona (precio_persona) y SIN precio de infante: hasta que se configure (NULL ≠ $0) el infante pagará como adulto en ellos. Total de servicios: '
         || (select count(*) from public.servicios_adicionales)
    from public.servicios_adicionales where precio_persona is not null
  union all
  select 'P4', 'INFO', count(*)::int,
         'Servicios que usan hoy los paquetes ACTIVOS (armado_servicios): hay que configurar su precio de infante antes de regenerar sus tarifarios'
    from (select distinct s.servicio_id from public.armado_servicios s join public.armado_paquetes p on p.id = s.paquete_id where p.activo) x
  union all
  select 'P5', 'INFO', count(*)::int,
         'Temporadas de servicios (servicio_temporadas): su precio_infante nace NULL = hereda el de la tarifa GENERAL'
    from public.servicio_temporadas
  union all
  select 'P6', 'INFO', count(*)::int,
         'Records (bloqueos_vuelo): su fee_infante nace en 0 (infante gratis en el vuelo) hasta que se edite'
    from public.bloqueos_vuelo
  union all
  select 'P7', 'INFO',
         ((select count(*) from public.empaquetados where fee_infante = 0) + (select count(*) from public.salidas_dinamicas where fee_infante = 0))::int,
         'Empaquetados / salidas dinámicas con fee_infante = 0 hoy (el fee ya existía, pero solo entraba al COSTO; desde la 226 entra también al PRECIO): '
         || (select count(*) from public.empaquetados where fee_infante = 0) || ' empaquetados y '
         || (select count(*) from public.salidas_dinamicas where fee_infante = 0) || ' salidas en 0'
  union all
  select 'P8', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Paquetes ACTIVOS con tarifario publicado: tras la 226 sus filas NO traen precio_pvp_menor2 y la reserva con infantes pedirá REGENERAR (manual, por paquete, con el botón existente)'
    from public.armado_paquetes p
   where p.activo and exists (select 1 from public.tarifario_resultado r where r.paquete_id = p.id)
  union all
  select 'P9', 'INFO', count(*)::int,
         'Filas publicadas de infante (acomodacion = infante) que hoy llevan el vuelo y los servicios de adulto (el defecto que la 226 corrige al regenerar)'
    from public.tarifario_resultado where acomodacion = 'infante'
  union all
  select 'P10', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Cotizaciones ABIERTAS (no convertidas ni descartadas): si se convierten después de regenerar, el precio del infante BAJA (es el precio correcto; no se extiende la guarda de precio)'
    from public.cotizaciones where estado = 'abierta'
  union all
  select 'P11', 'INFO', count(*)::int,
         'Triggers de invalidación del tarifario sobre servicios_adicionales/bloqueos_vuelo/empaquetados (la 226 los reemplaza): '
         || coalesce(string_agg(tgname, ', ' order by tgname), 'ninguno')
    from pg_trigger where not tgisinternal and tgname in ('tarifario_trg_servicios_adicionales', 'tarifario_trg_bloqueos_vuelo', 'tarifario_trg_empaquetados')
  union all
  select 'P12', case when count(*) > 0 then 'REVISAR' else 'INFO' end, count(*)::int,
         'Columnas con el nombre de las nuevas en OTRAS tablas distintas de las esperadas: '
         || coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name), 'ninguna')
    from information_schema.columns
   where table_schema = 'public'
     and ((column_name = 'precio_infante' and table_name not in ('servicios_adicionales', 'servicio_temporadas'))
       or (column_name = 'precio_pvp_menor2' and table_name not in ('tarifario_resultado'))
       or (column_name = 'fee_infante' and table_name not in ('bloqueos_vuelo', 'empaquetados', 'salidas_dinamicas')))
)
select codigo, nivel, cantidad, detalle from chequeos order by length(codigo), codigo;

rollback;
