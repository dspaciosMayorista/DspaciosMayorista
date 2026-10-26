-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 244 (programas por hotel y vigencia con noches
-- adicionales, #88). SOLO LECTURA. Correr DESPUÉS de aplicar la 244. Una sola
-- consulta con todos los controles como filas (control · valor · esperado ·
-- estado OK/REVISAR/INFO). Compatible con el SQL Editor de Supabase. Si la 244 NO
-- está aplicada, los controles marcan REVISAR (no falla): correrlo solo después.
-- ───────────────────────────────────────────────────────────────────────────
with
tablas as (
  select t.nombre, t.escritura_web
    from (values ('programa_hoteles', true), ('programa_hotel_precios', true), ('programa_hotel_noches', true),
                 ('contrato_programa_estancia', false), ('contrato_programa_estancia_costo', false)) as t(nombre, escritura_web)
),
est as (
  select t.nombre, t.escritura_web, c.oid, coalesce(c.relrowsecurity, false) as rls,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas,
         (select count(*) from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'trg_auditoria' and not g.tgisinternal) as auditoria
    from tablas t left join pg_class c on c.relname = t.nombre and c.relnamespace = 'public'::regnamespace
),
fn as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, pg_get_function_identity_arguments(p.oid) as argumentos
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guardar_programa_hoteles'
),
fn_publico as (
  select coalesce(bool_or(a.grantee = 0), false) as ejecuta
    from fn, aclexplode(coalesce(fn.proacl, acldefault('f', (select proowner from pg_proc where oid = fn.oid)))) a
   where a.privilege_type = 'EXECUTE'
),
cons as (
  select c.conname from pg_constraint c where c.connamespace = 'public'::regnamespace
),
esperadas as (
  select * from (values
    ('programa_hoteles_nombre_check'), ('programa_hoteles_max_pax_check'), ('programa_hoteles_max_menores_check'),
    ('programa_hotel_precios_vigencia_check'), ('programa_hotel_precios_modalidad_check'), ('programa_hotel_precios_netos_check'),
    ('programa_hotel_noches_vigencia_check'), ('programa_hotel_noches_unidad_check'), ('programa_hotel_noches_netos_check'),
    ('programa_hotel_noches_alguno_check'),
    ('contrato_programa_estancia_modalidad_check'), ('contrato_programa_estancia_noches_check'),
    ('contrato_programa_estancia_fechas_check'), ('contrato_programa_estancia_precios_check'),
    ('contrato_programa_estancia_costo_check')
  ) as e(conname)
),
cascada as (
  select c.conrelid::regclass::text as tabla, c.confdeltype
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.ventas'::regclass
     and c.conrelid::regclass::text in ('contrato_programa_estancia', 'contrato_programa_estancia_costo')
),
unidad_sin_default as (
  select count(*) as n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'programa_hotel_noches' and column_name = 'unidad_cobro'
     and is_nullable = 'NO' and column_default is null
),
controles as (
  select 10 + row_number() over (order by e.nombre) as orden, 'tabla ' || e.nombre || ' existe con RLS activa' as control,
         case when e.oid is null then 'no existe' when e.rls then 'existe, RLS activa' else 'existe, SIN RLS' end as valor,
         'existe, RLS activa'::text as esperado,
         case when e.oid is not null and e.rls then 'OK' else 'REVISAR' end as estado
    from est e
  union all
  select 30 + row_number() over (order by e.nombre), 'policies de ' || e.nombre, e.politicas::text, '>= 1',
         case when e.politicas >= 1 then 'OK' else 'REVISAR' end
    from est e
  union all
  select 40 + row_number() over (order by e.nombre), 'trigger de auditoría en ' || e.nombre, e.auditoria::text, '1',
         case when e.auditoria = 1 then 'OK' else 'REVISAR' end
    from est e
  union all
  select 50 + row_number() over (order by e.nombre), 'anon NO tiene ningún privilegio sobre ' || e.nombre,
         case when e.oid is null then 'n/d' when has_table_privilege('anon', e.oid, 'select,insert,update,delete') then 'tiene' else 'ninguno' end, 'ninguno',
         case when e.oid is not null and not has_table_privilege('anon', e.oid, 'select,insert,update,delete') then 'OK' else 'REVISAR' end
    from est e
  union all
  select 60 + row_number() over (order by e.nombre), 'authenticated ' ||
         case when e.escritura_web then 'puede escribir (la RLS filtra a roles internos) en ' else 'NO puede insertar/actualizar/borrar en ' end || e.nombre,
         case when e.oid is null then 'n/d'
              when has_table_privilege('authenticated', e.oid, 'insert') or has_table_privilege('authenticated', e.oid, 'update') or has_table_privilege('authenticated', e.oid, 'delete') then 'escribe'
              else 'solo lectura' end,
         case when e.escritura_web then 'escribe' else 'solo lectura' end,
         case when e.oid is null then 'REVISAR'
              when e.escritura_web = (has_table_privilege('authenticated', e.oid, 'insert') or has_table_privilege('authenticated', e.oid, 'update') or has_table_privilege('authenticated', e.oid, 'delete')) then 'OK'
              else 'REVISAR' end
    from est e
  union all
  select 70, 'existe exactamente una guardar_programa_hoteles', (select count(*)::text from fn), '1', case when (select count(*) from fn) = 1 then 'OK' else 'REVISAR' end
  union all
  select 71, 'firma: argumentos', coalesce((select argumentos from fn), 'n/d'), 'p_programa_id bigint, p_hoteles jsonb',
         case when (select argumentos from fn) = 'p_programa_id bigint, p_hoteles jsonb' then 'OK' else 'REVISAR' end
  union all
  select 72, 'SECURITY INVOKER (la RLS de quien llama manda)', coalesce((select case when prosecdef then 'DEFINER' else 'INVOKER' end from fn), 'n/d'), 'INVOKER',
         case when (select prosecdef from fn) is false then 'OK' else 'REVISAR' end
  union all
  select 73, 'search_path fijo', coalesce((select array_to_string(proconfig, ',') from fn), 'n/d'), 'search_path=public, pg_temp',
         case when (select array_to_string(proconfig, ',') from fn) like '%search_path=public, pg_temp%' then 'OK' else 'REVISAR' end
  union all
  select 74, 'PUBLIC/anon NO ejecutan; authenticated sí',
         case when not exists (select 1 from fn) then 'n/d'
              else 'public=' || (select ejecuta::text from fn_publico) || ' anon=' || has_function_privilege('anon', (select oid from fn), 'execute')::text
                   || ' authenticated=' || has_function_privilege('authenticated', (select oid from fn), 'execute')::text end,
         'public=false anon=false authenticated=true',
         case when exists (select 1 from fn) and not (select ejecuta from fn_publico) and not has_function_privilege('anon', (select oid from fn), 'execute')
                   and has_function_privilege('authenticated', (select oid from fn), 'execute') then 'OK' else 'REVISAR' end
  union all
  select 80 + row_number() over (order by e.conname), 'constraint ' || e.conname,
         case when exists (select 1 from cons c where c.conname = e.conname) then 'existe' else 'falta' end, 'existe',
         case when exists (select 1 from cons c where c.conname = e.conname) then 'OK' else 'REVISAR' end
    from esperadas e
  union all
  select 100 + row_number() over (order by c.tabla), 'FK a ventas en ' || c.tabla || ' con ON DELETE CASCADE',
         case c.confdeltype when 'c' then 'cascade' else c.confdeltype::text end, 'cascade', case when c.confdeltype = 'c' then 'OK' else 'REVISAR' end
    from cascada c
  union all
  select 110, 'las dos FK de los contratos hacia ventas existen', (select count(*)::text from cascada), '2', case when (select count(*) from cascada) = 2 then 'OK' else 'REVISAR' end
  union all
  select 111, 'unidad_cobro es NOT NULL y SIN valor por defecto (la unidad se elige de forma expresa)', (select n::text from unidad_sin_default), '1',
         case when (select n from unidad_sin_default) = 1 then 'OK' else 'REVISAR' end
  union all
  select 120, 'INFO hoteles cargados', (select count(*)::text from public.programa_hoteles), 'dato', 'INFO'
  union all
  select 121, 'INFO contratos con estancia congelada', (select count(*)::text from public.contrato_programa_estancia), 'dato', 'INFO'
  union all
  select 122, 'la 244 no cambió ningún programa: programas con modo_precio = hotel', (select count(*)::text from public.programas where modo_precio = 'hotel'), 'dato (0 hasta que alguien lo elija)', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
