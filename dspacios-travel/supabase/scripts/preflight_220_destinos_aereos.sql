-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 220 · #67 destinos aéreos alternativos. SOLO LECTURA (termina en ROLLBACK).
-- Correr ANTES de aplicar la 220. Una fila por verificación: código | nivel | cantidad | detalle.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR (aplicar es seguro, pero conviene
-- conocer el caso) · INFO.  No corrige nada.
--
-- Qué hace la 220 con los datos existentes: NADA. No valida vínculos ya guardados. Pero el código
-- nuevo aplica la regla "destino comercial exacto" (check apagado) a TODOS los paquetes: un vuelo
-- vinculado cuyo destino difiera del destino del paquete (P4/P5/P6) deja de ofrecerse y de poder
-- venderse tras el despliegue. Este preflight los lista para decidir, ANTES, si se enciende el
-- check del paquete con esas alternativas o se desvincula el vuelo.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
v_incomp as (
  select av.paquete_id, b.id as fuente_id, b.record, b.destino_id as destino_fuente, p.destino_id as destino_paquete
    from public.armado_vuelos av
    join public.armado_paquetes p on p.id = av.paquete_id
    join public.bloqueos_vuelo b on b.id = av.bloqueo_id
   where b.destino_id is distinct from p.destino_id
),
e_incomp as (
  select ae.paquete_id, e.id as fuente_id, e.record, e.destino_id as destino_fuente, p.destino_id as destino_paquete
    from public.armado_empaquetados ae
    join public.armado_paquetes p on p.id = ae.paquete_id
    join public.empaquetados e on e.id = ae.empaquetado_id
   where e.destino_id is distinct from p.destino_id
),
chequeos as (
  select 'P1' as codigo,
         case when to_regclass('public.armado_paquetes') is null or to_regclass('public.armado_vuelos') is null
                or to_regclass('public.armado_empaquetados') is null or to_regclass('public.bloqueos_vuelo') is null
                or to_regclass('public.empaquetados') is null or to_regclass('public.destinos') is null
                or to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is null
                or to_regprocedure('public.mi_rol()') is null then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regclass('public.armado_paquetes') is not null)::int as cantidad,
         'Tablas del armado y funciones tarifario_invalidar (181) / mi_rol presentes' as detalle
  union all
  select 'P2', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'destinos' and column_name = 'pais')
                    then 'INFO' else 'BLOQUEANTE' end,
         (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'destinos' and column_name = 'pais'))::int,
         'destinos.pais existe (migración 050)'
  union all
  select 'P3', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'destinos_aereos_alternativos')
                      or to_regclass('public.armado_paquete_destinos_aereos') is not null then 'BLOQUEANTE' else 'INFO' end,
         (to_regclass('public.armado_paquete_destinos_aereos') is not null)::int,
         '220 aún no aplicada (ni la columna destinos_aereos_alternativos ni la tabla armado_paquete_destinos_aereos)'
  union all
  select 'P4', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Vuelos de Bloqueo vinculados con destino distinto al destino del paquete (dejarán de ofrecerse con el check apagado): '
         || coalesce((select string_agg('paquete ' || paquete_id || ' / ' || coalesce(record, 'sin record') || ' (destino ' || coalesce(destino_fuente::text, 'NULL') || ' vs ' || coalesce(destino_paquete::text, 'NULL') || ')', '; ')
                        from (select * from v_incomp order by paquete_id, fuente_id limit 15) x), 'ninguno')
    from v_incomp
  union all
  select 'P5', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Vuelos de Sistema (empaquetados) vinculados con destino distinto al destino del paquete: '
         || coalesce((select string_agg('paquete ' || paquete_id || ' / ' || coalesce(record, 'sin record') || ' (destino ' || coalesce(destino_fuente::text, 'NULL') || ' vs ' || coalesce(destino_paquete::text, 'NULL') || ')', '; ')
                        from (select * from e_incomp order by paquete_id, fuente_id limit 15) x), 'ninguno')
    from e_incomp
  union all
  select 'P6', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Paquetes SIN destino comercial con vuelos vinculados (no hay respaldo "todos los vuelos"; dejarán de ofrecerse): '
         || coalesce(string_agg(id::text, ', '), 'ninguno')
    from (select p.id from public.armado_paquetes p
           where p.destino_id is null
             and (exists (select 1 from public.armado_vuelos av where av.paquete_id = p.id)
               or exists (select 1 from public.armado_empaquetados ae where ae.paquete_id = p.id))) q
  union all
  select 'P7', 'INFO', count(*)::int,
         'Destinos activos SIN país (nunca podrán ser comercial con alternativas ni alternativa de otro): '
         || coalesce((select string_agg(nombre, ', ') from (select nombre from public.destinos where coalesce(activo, true) and (pais is null or btrim(pais) = '') order by nombre limit 15) x), 'ninguno')
    from public.destinos where coalesce(activo, true) and (pais is null or btrim(pais) = '')
  union all
  select 'P8', 'INFO', count(*)::int,
         'Valores distintos de destinos.pais (para revisar escrituras equivalentes; sin alias, "RD" no es "República Dominicana"): '
         || coalesce((select string_agg(pais || ' x' || n, ', ') from (select pais, count(*) n from public.destinos where pais is not null and btrim(pais) <> '' group by pais order by pais limit 30) x), 'ninguno')
    from (select distinct pais from public.destinos where pais is not null and btrim(pais) <> '') d
  union all
  select 'P9', case when count(*) = 0 then 'INFO' else 'REVISAR' end, count(*)::int,
         'Paquetes activos de Bloqueo/Sistema con vuelos vinculados que quedarán con tarifario por regenerar si se enciende el check (se regeneran al guardar): '
         || count(*)
    from public.armado_paquetes p
   where p.activo and (exists (select 1 from public.armado_vuelos av where av.paquete_id = p.id)
                    or exists (select 1 from public.armado_empaquetados ae where ae.paquete_id = p.id))
)
select codigo, nivel, cantidad, detalle from chequeos order by codigo;

rollback;
