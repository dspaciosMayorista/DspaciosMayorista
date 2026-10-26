-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 244 (programas por hotel y vigencia con noches
-- adicionales, #88). SOLO LECTURA. Correr ANTES de aplicar la 244. Una sola
-- consulta: devuelve todos los controles como filas (control · valor · esperado
-- · estado). Estados: OK = cumple · REVISAR = no aplicar la 244 hasta entenderlo
-- · INFO = dato. Compatible con el SQL Editor de Supabase (una sentencia, sin
-- metacomandos).
-- ───────────────────────────────────────────────────────────────────────────
with
nuevas as (
  select t.nombre
    from (values ('programa_hoteles'), ('programa_hotel_precios'), ('programa_hotel_noches'),
                 ('contrato_programa_estancia'), ('contrato_programa_estancia_costo')) as t(nombre)
),
existentes as (
  select n.nombre, to_regclass('public.' || n.nombre) is not null as existe from nuevas n
),
deps as (
  select d.descr, d.ok
    from (values
      ('tabla public.programas',            to_regclass('public.programas') is not null),
      ('tabla public.proveedores',          to_regclass('public.proveedores') is not null),
      ('tabla public.ventas',               to_regclass('public.ventas') is not null),
      ('tabla public.cuentas_por_pagar',    to_regclass('public.cuentas_por_pagar') is not null),
      ('función mi_rol()',                  to_regprocedure('public.mi_rol()') is not null),
      ('función puede_ver_contrato(text)',  to_regprocedure('public.puede_ver_contrato(text)') is not null),
      ('función puede_ver_tenant(text)',    to_regprocedure('public.puede_ver_tenant(text)') is not null),
      ('función fn_auditoria()',            to_regprocedure('public.fn_auditoria()') is not null)
    ) as d(descr, ok)
),
pk_ventas as (
  select count(*) as n
    from pg_constraint c
   where c.conrelid = 'public.ventas'::regclass and c.contype in ('p', 'u')
     and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['numero_contrato']
),
modos as (
  select coalesce(modo_precio, '(null)') as modo, count(*) as n from public.programas group by 1
),
controles as (
  select 1 as orden, 'PostgreSQL >= 15'::text as control, current_setting('server_version_num') as valor, '>= 150000'::text as esperado,
         case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'REVISAR' end as estado
  union all
  select 10 + row_number() over (order by e.nombre), 'la tabla ' || e.nombre || ' aún NO existe',
         case when e.existe then 'ya existe' else 'no existe' end, 'no existe',
         case when e.existe then 'REVISAR' else 'OK' end
    from existentes e
  union all
  select 30, 'guardar_programa_hoteles(bigint, jsonb) aún NO existe',
         coalesce(to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)')::text, 'no existe'), 'no existe',
         case when to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)') is null then 'OK' else 'REVISAR' end
  union all
  select 40 + row_number() over (order by d.descr), 'dependencia: ' || d.descr, case when d.ok then 'existe' else 'falta' end, 'existe',
         case when d.ok then 'OK' else 'REVISAR' end
    from deps d
  union all
  select 60, 'ventas.numero_contrato es llave única (los hijos de la 244 la referencian)',
         (select n::text from pk_ventas), '>= 1', case when (select n from pk_ventas) >= 1 then 'OK' else 'REVISAR' end
  union all
  select 61, 'la 243 ya está aplicada (fn_dashboard_cupos_activos): la 244 va después',
         coalesce(to_regprocedure('public.fn_dashboard_cupos_activos(date)')::text, 'no'), 'existe',
         case when to_regprocedure('public.fn_dashboard_cupos_activos(date)') is not null then 'OK' else 'REVISAR' end
  union all
  select 62, 'programas.modo_precio existe (la 068) y no tiene CHECK que bloquee el valor «hotel»',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programas' and column_name = 'modo_precio')
                   and not exists (select 1 from pg_constraint c where c.conrelid = 'public.programas'::regclass and c.contype = 'c'
                                    and pg_get_constraintdef(c.oid) ilike '%modo_precio%')
              then 'sin CHECK' else 'REVISAR' end,
         'sin CHECK',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programas' and column_name = 'modo_precio')
                   and not exists (select 1 from pg_constraint c where c.conrelid = 'public.programas'::regclass and c.contype = 'c'
                                    and pg_get_constraintdef(c.oid) ilike '%modo_precio%')
              then 'OK' else 'REVISAR' end
  union all
  select 63, 'ningún programa usa ya modo_precio = hotel (la 244 no migra datos)',
         (select coalesce(sum(n), 0)::text from modos where modo = 'hotel'), '0',
         case when (select coalesce(sum(n), 0) from modos where modo = 'hotel') = 0 then 'OK' else 'REVISAR' end
  union all
  select 70 + row_number() over (order by m.modo), 'INFO programas con modo_precio = ' || m.modo, m.n::text, 'dato', 'INFO' from modos m
  union all
  select 80, 'INFO contratos (ventas) existentes: la 244 no los toca', (select count(*)::text from public.ventas), 'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
