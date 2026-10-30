-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 225 · cierre de la lectura de netos de `empaquetados` para venta. SOLO LECTURA (ROLLBACK).
-- Correr ANTES de aplicar la 225 (después de la 224 y de DESPLEGAR el código). Una fila por dato:
-- codigo | nivel | cantidad | detalle. CUENTA lo existente y NO bloquea: ningún nivel es BLOQUEANTE
-- (la migración se niega sola si falta la vista de la 224). Niveles: INFO · REVISAR.
--
-- Qué hace la 225: reemplaza la policy de lectura de 6 roles por una de 5 (sin venta). Desde ese momento venta
-- lee los empaquetados SOLO por empaquetados_basica. Lo que este preflight NO puede comprobar desde la base de
-- datos es que el código desplegado ya lea la vista (P7 lo recuerda): se valida a mano con un usuario venta.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with chequeos as (
  select 'P1' as codigo, 'INFO' as nivel,
         (to_regclass('public.empaquetados_basica') is not null)::int as cantidad,
         'La vista empaquetados_basica de la 224 existe (1 = sí; si es 0 la 225 se niega a aplicarse)' as detalle
  union all
  select 'P2', 'INFO', (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'empaquetados' and policyname = 'empaquetados: lectura con costos'))::int,
         '225 aún no aplicada (0 = la policy de 5 roles no existe todavía; 1 = ya aplicada, la migración es idempotente)'
  union all
  select 'P3', 'INFO', count(*)::int,
         'Policies actuales sobre public.empaquetados: '
         || coalesce(string_agg(policyname || ' [' || cmd || '] ' || regexp_replace(coalesce(qual, ''), '\s+', ' ', 'g'), ' || ' order by policyname), 'ninguna')
    from pg_policies where schemaname = 'public' and tablename = 'empaquetados'
  union all
  select 'P4', case when count(*) filter (where (cmd in ('SELECT', 'ALL')) and qual like '%''venta''%') > 0 then 'REVISAR' else 'INFO' end,
         count(*) filter (where (cmd in ('SELECT', 'ALL')) and qual like '%''venta''%')::int,
         'Policies de lectura de empaquetados que nombran a venta HOY (la 225 las reemplaza: después debe quedar 0)'
    from pg_policies where schemaname = 'public' and tablename = 'empaquetados'
  union all
  select 'P5', 'INFO', count(*)::int,
         'Filas en empaquetados (' || count(*) filter (where tarifa_proveedor > 0) || ' con tarifa_proveedor > 0): lo que venta deja de poder leer por la tabla base'
    from public.empaquetados
  union all
  select 'P6', 'INFO', count(*)::int,
         'Usuarios activos por rol afectado: ' || coalesce(string_agg(rol::text || '=' || n, ', ' order by rol::text), 'ninguno')
    from (select rol, count(*) as n from public.usuarios where activo and rol::text in ('venta', 'control_vuelo') group by rol) u
  union all
  select 'P7', 'REVISAR', 1,
         'RECORDATORIO MANUAL: antes de aplicar la 225, el código desplegado en producción debe leer empaquetados_basica (lib/reservar/computo.ts). Prueba: reservar un vuelo de Sistema con un usuario venta real; si responde "El empaquetado seleccionado ya no existe" DESPUÉS de la 225, el código aún lee la tabla base'
)
select codigo, nivel, cantidad, detalle from chequeos order by length(codigo), codigo;

rollback;
