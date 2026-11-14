-- DIAGNÓSTICO entrega L (#43/#60) — UNA sola consulta, SOLO LECTURA. La corre el dueño en el editor SQL de Supabase (Producción)
-- ANTES de implementar o desplegar el límite global de 30 noches. No escribe, no corrige nada y no toca históricos.
-- Duración = fecha de regreso − fecha de ida (la salida no cuenta como noche: 1 → 31 = 30 noches, válida).
-- Lectura: «PRODUCTO» = algo que se sigue OFRECIENDO hoy con más de 30 noches (el dueño decide, uno por uno, si se deja de ofrecer o
-- se corrige a mano; nunca automáticamente). «HISTORICO» = contratos y cotizaciones: solo se informan; seguirán consultándose,
-- imprimiéndose y editándose como hoy. Columna `detalle`: hasta 30 identificadores (id o record y sus noches) para revisarlos.
-- Es un único SELECT (el editor de Supabase muestra solo el resultado de la última sentencia); no abre transacción ni escribe.
with lim as (select 30 as max_noches, current_date as hoy),
bloq as (
  select b.id, b.record, (b.fecha_regreso - b.fecha_ida) as n from public.bloqueos_vuelo b, lim
  where b.fecha_ida >= lim.hoy and b.fecha_regreso - b.fecha_ida > lim.max_noches),
emp as (
  select e.id, e.record, (e.fecha_regreso - e.fecha_ida) as n from public.empaquetados e, lim
  where coalesce(e.activo, true) and e.fecha_ida >= lim.hoy and e.fecha_regreso - e.fecha_ida > lim.max_noches),
sal as (
  select s.id, s.paquete_id, (s.fecha_regreso - s.fecha_ida) as n from public.salidas_dinamicas s, lim
  where coalesce(s.activo, true) and s.fecha_ida >= lim.hoy and s.fecha_regreso - s.fecha_ida > lim.max_noches),
porc as (
  select p.id, p.nombre, p.noches as n from public.armado_paquetes p, lim
  where coalesce(p.activo, true) and p.tipo = 'porcion_terrestre' and p.noches > lim.max_noches
    and (p.fecha_viaje_fin is null or p.fecha_viaje_fin >= lim.hoy)),
prog as (
  select g.id, g.nombre, g.noches as n from public.programas g, lim
  where coalesce(g.activo, true) and g.noches > lim.max_noches and (g.vigencia_hasta is null or g.vigencia_hasta >= lim.hoy)),
prog_sal as (
  select ps.id, ps.programa_id, ps.noches as n from public.programa_salidas ps join public.programas g on g.id = ps.programa_id, lim
  where coalesce(g.activo, true) and ps.noches > lim.max_noches and coalesce(ps.fecha_hasta, ps.fecha_desde) >= lim.hoy),
cot as (
  select c.id, (c.fecha_regreso - c.fecha_salida) as n from public.cotizaciones c, lim
  where c.fecha_regreso - c.fecha_salida > lim.max_noches),
ven as (
  select v.numero_contrato, (v.fecha_regreso - v.fecha_salida) as n from public.ventas v, lim
  where v.fecha_regreso - v.fecha_salida > lim.max_noches)
select orden, control, observado, esperado, estado, detalle from (
  select 1 as orden, 'PRODUCTO bloqueos con ida desde hoy y más de 30 noches' as control, (select count(*) from bloq)::text as observado, '0' as esperado,
         case when (select count(*) from bloq) = 0 then 'OK' else 'REVISAR' end as estado,
         (select string_agg(format('%s (%s n)', coalesce(record, id::text), n), ', ' order by n desc) from (select * from bloq order by n desc limit 30) x) as detalle
  union all select 2, 'PRODUCTO empaquetados activos con ida desde hoy y más de 30 noches', (select count(*) from emp)::text, '0',
         case when (select count(*) from emp) = 0 then 'OK' else 'REVISAR' end,
         (select string_agg(format('%s (%s n)', coalesce(record, id::text), n), ', ' order by n desc) from (select * from emp order by n desc limit 30) x)
  union all select 3, 'PRODUCTO salidas dinámicas activas con ida desde hoy y más de 30 noches', (select count(*) from sal)::text, '0',
         case when (select count(*) from sal) = 0 then 'OK' else 'REVISAR' end,
         (select string_agg(format('salida %s / paquete %s (%s n)', id, paquete_id, n), ', ' order by n desc) from (select * from sal order by n desc limit 30) x)
  union all select 4, 'PRODUCTO paquetes de porción terrestre activos con más de 30 noches', (select count(*) from porc)::text, '0',
         case when (select count(*) from porc) = 0 then 'OK' else 'REVISAR' end,
         (select string_agg(format('%s «%s» (%s n)', id, nombre, n), ', ' order by n desc) from (select * from porc order by n desc limit 30) x)
  union all select 5, 'PRODUCTO programas activos con más de 30 noches', (select count(*) from prog)::text, '0',
         case when (select count(*) from prog) = 0 then 'OK' else 'REVISAR' end,
         (select string_agg(format('%s «%s» (%s n)', id, nombre, n), ', ' order by n desc) from (select * from prog order by n desc limit 30) x)
  union all select 6, 'PRODUCTO salidas de programa vigentes con más de 30 noches', (select count(*) from prog_sal)::text, '0',
         case when (select count(*) from prog_sal) = 0 then 'OK' else 'REVISAR' end,
         (select string_agg(format('salida %s / programa %s (%s n)', id, programa_id, n), ', ' order by n desc) from (select * from prog_sal order by n desc limit 30) x)
  union all select 7, 'HISTORICO cotizaciones con más de 30 noches (no se modifican)', (select count(*) from cot)::text, 'informativo', 'INFO',
         (select string_agg(format('%s (%s n)', id, n), ', ' order by n desc) from (select * from cot order by n desc limit 30) x)
  union all select 8, 'HISTORICO contratos con más de 30 noches (no se modifican)', (select count(*) from ven)::text, 'informativo', 'INFO',
         (select string_agg(format('%s (%s n)', numero_contrato, n), ', ' order by n desc) from (select * from ven order by n desc limit 30) x)
  union all select 9, 'Límite que se diagnosticó (noches)', (select max_noches from lim)::text, '30', 'INFO', null
) r order by orden;
