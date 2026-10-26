-- SOLO base local/desechable con las migraciones hasta 243 (esquema real: vista
-- cupos_por_bloqueo, _silla_libre, RLS y grants verdaderos). Siempre termina en ROLLBACK.
-- #118: fn_dashboard_cupos_activos(p_hoy). Comprueba fronteras de fecha (pasado, hoy,
-- día 14, día 15, sin fecha), varios records, disponibilidad cero, que otros estados de
-- silla no cuentan, y los permisos/RLS por rol (anon, authenticated con y sin acceso,
-- service_role). Se mide por DIFERENCIA contra el estado previo (la base puede traer
-- datos), con p_hoy fijo en 2030-06-10 para no depender de la fecha de ejecución.
--   psql -h 127.0.0.1 -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f test_243_cupos_activos.sql
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK %', p_msg;
end $$;
-- Ejecuta una consulta como `p_rol` (claims de `p_uid`) y devuelve el texto de la primera
-- columna; un error se devuelve como 'ERROR: <mensaje>' para poder afirmarlo.
create function pg_temp.como(p_rol text, p_uid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol)::text, true);
  -- auth.uid() de esta imagen local lee la forma antigua; PostgREST fija ambas.
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('role', p_rol, true);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERROR: ' || sqlerrm;
  end;
  perform set_config('role', 'supabase_admin', true);
  return v;
end $$;
grant execute on function pg_temp.como(text, text, text) to public;

create temp table base_antes as
  select * from public.fn_dashboard_cupos_activos(date '2030-06-10');
grant select on base_antes to public;

-- ── Usuarios y catálogo ─────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d2431', 'op-r243@local.test'),
  ('00000000-0000-0000-0000-0000000d2432', 've-r243@local.test'),
  ('00000000-0000-0000-0000-0000000d2433', 'ag-r243@local.test');
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'Op r243'
 where id = '00000000-0000-0000-0000-0000000d2431';
update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, nombre = 'Ve r243'
 where id = '00000000-0000-0000-0000-0000000d2432';
update public.usuarios set rol = 'agencia', tenant = 'mayorista', activo = true, nombre = 'Ag r243'
 where id = '00000000-0000-0000-0000-0000000d2433';
insert into public.destinos (nombre) values ('DESTINO R243');
insert into public.proveedores (nombre) values ('PROVEEDOR R243');

-- Hoy de la prueba = 2030-06-10. Records (cupos_total / sillas disponibles reales):
--   P  pasado       2030-06-09  5 disp   → fuera de todo
--   H  hoy          2030-06-10  2 disp   → activo y próximo
--   D  día 14       2030-06-24  3 disp   → activo y próximo
--   Q  día 15       2030-06-25  4 disp   → activo, NO próximo
--   N  sin fecha                3 disp   → activo, NO próximo
--   Z  cero         2030-06-11  0 disp   → activo, no suma ni cuenta como record con sillas
--   H2 hoy (otro)   2030-06-10  1 disp   → dos records el mismo día
--   O  ocupadas     2030-06-12  1 disp + 2 en_plazo + 1 confirmada + 1 devuelta → solo la disponible suma
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
select r.record, d.id, p.id, r.fecha, 400000, r.cupos, 'serie'
  from (values
    ('R243P',  date '2030-06-09', 5), ('R243H',  date '2030-06-10', 2), ('R243D',  date '2030-06-24', 3),
    ('R243Q',  date '2030-06-25', 4), ('R243N',  null,              3), ('R243Z',  date '2030-06-11', 2),
    ('R243H2', date '2030-06-10', 1), ('R243O',  date '2030-06-12', 5)
  ) as r(record, fecha, cupos),
  (select id from public.destinos where nombre = 'DESTINO R243') d,
  (select id from public.proveedores where nombre = 'PROVEEDOR R243') p;

create function pg_temp.sillas(p_rec text, p_estado text, p_n int, p_desde int default 1) returns void language sql as $$
  insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, p_estado::public.estado_silla
    from public.bloqueos_vuelo b, generate_series(p_desde, p_desde + p_n - 1) g where b.record = p_rec
$$;
select pg_temp.sillas('R243P', 'disponible', 5);
select pg_temp.sillas('R243H', 'disponible', 2);
select pg_temp.sillas('R243D', 'disponible', 3);
select pg_temp.sillas('R243Q', 'disponible', 4);
select pg_temp.sillas('R243N', 'disponible', 3);
select pg_temp.sillas('R243Z', 'en_plazo', 2);          -- cero disponibles
select pg_temp.sillas('R243H2', 'disponible', 1);
select pg_temp.sillas('R243O', 'disponible', 1);
select pg_temp.sillas('R243O', 'en_plazo', 2, 2);
select pg_temp.sillas('R243O', 'confirmada', 1, 4);
select pg_temp.sillas('R243O', 'devuelta', 1, 5);

create temp table base_despues as
  select * from public.fn_dashboard_cupos_activos(date '2030-06-10');
grant select on base_despues to public;

-- ── Fronteras y agregación (esperado = suma de los records activos de arriba) ─
-- disponibles activos: H2 + D3 + Q4 + N3 + Z0 + H2' 1 + O1 = 2+3+4+3+0+1+1 = 14 (P pasado no suma)
-- records con sillas : H, D, Q, N, H2, O = 6 (Z no cuenta; P pasado no cuenta)
-- próximos (hoy..+14): H2 + D3 + Z0 + H2' 1 + O1 = 7 sillas en H, D, H2, O = 4 records
select pg_temp.ok((select disponibles - (select disponibles from base_antes) from base_despues) = 14,
  'sillas disponibles de records activos = 14 (el pasado no suma; Z en cero aporta 0; O solo su silla disponible)');
select pg_temp.ok((select records_disponibles - (select records_disponibles from base_antes) from base_despues) = 6,
  'records con sillas = 6 (cuenta cada record una vez; Z en cero y el pasado no cuentan)');
select pg_temp.ok((select proximos_disponibles - (select proximos_disponibles from base_antes) from base_despues) = 7,
  'próximos: 7 sillas (hoy, varios el mismo día y día 14 entran; día 15 y sin fecha no)');
select pg_temp.ok((select proximos_records - (select proximos_records from base_antes) from base_despues) = 4,
  'próximos: 4 records con sillas (H, H2, D, O); el cero no cuenta');
select pg_temp.ok((select capacidad - (select capacidad from base_antes) from base_despues) = 2 + 3 + 4 + 3 + 2 + 1 + 5,
  'capacidad = cupos_total de los records activos (sin el pasado)');
select pg_temp.ok((select ocupados - (select ocupados from base_antes) from base_despues) = 2 + 2 + 1,
  'ocupados = en_plazo + confirmada de los records activos (Z:2, O:2+1); devuelta no ocupa');

-- Un día después el record de hoy pasa a pasado y el día 15 entra al rango.
select pg_temp.ok(
  (select proximos_disponibles from public.fn_dashboard_cupos_activos(date '2030-06-11'))
  - (select proximos_disponibles from base_antes) = 3 + 4 + 1 - 0,
  'p_hoy+1 (06-11): hoy (H, H2) deja de contar; D(06-24, ya día 13), Q (06-25, día 14) entra, O sigue = 3+4+1');
select pg_temp.ok(
  (select disponibles from public.fn_dashboard_cupos_activos(date '2030-06-11')) -
  (select disponibles from base_antes) = 3 + 4 + 3 + 0 + 1,
  'p_hoy+1: los records de 06-10 salen de los activos (quedan D, Q, N, Z, O)');

-- ── Paridad con la vista real (no con una tabla sustituta) ───────────────────
select pg_temp.ok(
  (select disponibles from public.fn_dashboard_cupos_activos(date '2030-06-10')) =
  (select coalesce(sum(greatest(cupos_disponibles, 0)), 0) from public.cupos_por_bloqueo
    where fecha_ida is null or fecha_ida >= date '2030-06-10'),
  'la función coincide con la suma directa sobre public.cupos_por_bloqueo');
select pg_temp.ok((select count(*) from pg_class where relname = 'cupos_por_bloqueo' and relkind = 'v') = 1,
  'cupos_por_bloqueo es la vista real (relkind v), no una tabla');

-- ── Permisos y RLS (mismo mecanismo que PostgREST: rol + claims) ─────────────
select pg_temp.ok(pg_temp.como('anon', null, 'select disponibles from public.fn_dashboard_cupos_activos(date ''2030-06-10'')') like 'ERROR: permission denied%',
  'anon NO puede ejecutar la función');
select pg_temp.ok(pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000d2431',
    'select disponibles from public.fn_dashboard_cupos_activos(date ''2030-06-10'')')::bigint
  = (select disponibles from base_despues),
  'authenticated con rol operaciones ve las mismas cifras que el dueño');
select pg_temp.ok(pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000d2432',
    'select disponibles from public.fn_dashboard_cupos_activos(date ''2030-06-10'')')::bigint
  = (select disponibles from base_despues),
  'authenticated con rol venta (lectura operativa) ve las mismas cifras');
select pg_temp.ok(pg_temp.como('authenticated', '00000000-0000-0000-0000-0000000d2433',
    'select disponibles from public.fn_dashboard_cupos_activos(date ''2030-06-10'')')::bigint = 0,
  'authenticated con rol agencia (sin lectura operativa) recibe 0 por RLS: el Home interno no lo muestra');
select pg_temp.ok(pg_temp.como('service_role', null,
    'select disponibles from public.fn_dashboard_cupos_activos(date ''2030-06-10'')')::bigint
  = (select disponibles from base_despues),
  'service_role puede ejecutarla');
select pg_temp.ok(not has_function_privilege('anon', 'public.fn_dashboard_cupos_activos(date)', 'execute')
  and has_function_privilege('authenticated', 'public.fn_dashboard_cupos_activos(date)', 'execute')
  and has_function_privilege('service_role', 'public.fn_dashboard_cupos_activos(date)', 'execute'),
  'has_function_privilege: anon no, authenticated sí, service_role sí');
select pg_temp.ok((select not prosecdef from pg_proc where proname = 'fn_dashboard_cupos_activos'),
  'la función es SECURITY INVOKER');

rollback;
