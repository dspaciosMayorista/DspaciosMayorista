-- ============================================================================
-- Test 215 — Calendario tributario (#43-1a). Base LOCAL con la 215 aplicada.
-- Todo en UNA transaccion que termina en ROLLBACK. NO correr contra Supabase.
--
--   C01 administracion configura en su agencia y no en la otra.
--   C02 gerencia ve las dos agencias pero configura solo la suya.
--   C03 venta, operaciones y aliados externos no ven ni escriben nada.
--   C04 la base valida periodo, digitos y agencia de cada fecha.
--   C05 no se cambia periodicidad ni regla si deja fechas invalidas.
--   C06 constancias: administracion registra; venta no.
--   C07 roles contables (solo si la 204 ya creo los valores del enum).
--   C08 anon no ve nada ni ejecuta los helpers.
--   C09 borrar una obligacion arrastra sus fechas y constancias; la agencia
--       de una obligacion no cambia.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create function public.t215_ok(p_cond boolean, p_caso text) returns void language plpgsql as $$
begin
  if p_cond then raise notice 'OK   %', p_caso; else raise exception 'FALLO %', p_caso; end if;
end $$;

create function public.t215_como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

create function public.t215_debe_fallar(p_sql text, p_estado text, p_caso text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_estado then
      raise exception 'FALLO %: dio % (%) en vez de %', p_caso, sqlstate, sqlerrm, p_estado;
    end if;
    raise notice 'OK   %: % (%)', p_caso, sqlstate, sqlerrm;
    return;
  end;
  raise exception 'FALLO %: se esperaba % y no hubo error', p_caso, p_estado;
end $$;

grant execute on function public.t215_ok(boolean, text), public.t215_como(uuid),
  public.t215_debe_fallar(text, text, text) to anon, authenticated;

-- Usuarios de prueba. `handle_new_user` (193) crea la fila de `usuarios` al
-- insertar en auth.users; aqui solo se fija rol y agencia.
create function public.t215_usuario(p_n int, p_rol text, p_tenant text) returns uuid language plpgsql as $$
declare v uuid := ('00000000-0000-4000-8215-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  insert into auth.users (id, email) values (v, 't215_' || p_n || '@local.invalid') on conflict (id) do nothing;
  update public.usuarios set rol = p_rol::rol_usuario, tenant = p_tenant, activo = true where id = v;
  return v;
end $$;

select public.t215_usuario(1, 'administracion', 'mayorista'),
       public.t215_usuario(2, 'administracion', 'minorista'),
       public.t215_usuario(3, 'gerencia', 'mayorista'),
       public.t215_usuario(4, 'venta', 'mayorista'),
       public.t215_usuario(5, 'operaciones', 'mayorista'),
       public.t215_usuario(6, 'agencia', 'mayorista'),
       public.t215_usuario(7, 'superadmin', 'mayorista');

-- Datos de apoyo como propietario: una obligacion por agencia.
insert into public.obligacion_tributaria (tenant, nombre, periodicidad, regla_digitos)
values ('mayorista', 'T215 Retefuente', 'mensual', 1), ('minorista', 'T215 Retefuente', 'mensual', 1);
insert into public.obligacion_vencimiento (tenant, obligacion_id, anio, periodo, digitos, fecha)
select tenant, id, 2026, 10, '7', '2026-11-20' from public.obligacion_tributaria where nombre = 'T215 Retefuente';

\echo ''
\echo '--- C01: administracion configura su agencia, no la otra ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
do $$
declare v bigint; n int;
begin
  insert into public.obligacion_tributaria (tenant, nombre, periodicidad, regla_digitos, requiere_pago)
  values ('mayorista', 'T215 IVA', 'bimestral', 1, true) returning id into v;
  perform public.t215_ok(v is not null, 'C01 administracion crea una obligacion en su agencia');
  select count(*) into n from public.obligacion_tributaria where nombre like 'T215%';
  perform public.t215_ok(n = 2, 'C01 administracion ve solo las de su agencia');
end $$;
select public.t215_debe_fallar(
  $f$insert into public.obligacion_tributaria (tenant, nombre, periodicidad) values ('minorista', 'T215 X', 'anual')$f$,
  '42501', 'C01 administracion NO configura la otra agencia');
reset role;

\echo ''
\echo '--- C02: gerencia ve las dos, configura solo la suya ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000003');
do $$
declare n int; m int;
begin
  select count(*) into n from public.obligacion_tributaria where nombre = 'T215 Retefuente';
  perform public.t215_ok(n = 2, 'C02 gerencia ve ambas agencias');
  with u as (update public.obligacion_tributaria set dias_aviso = 15 where tenant = 'minorista' returning 1)
  select count(*) into m from u;
  perform public.t215_ok(m = 0, 'C02 gerencia NO modifica la otra agencia (el UPDATE no alcanza filas)');
end $$;
reset role;

\echo ''
\echo '--- C03: venta, operaciones y externos no ven ni escriben ---'
set local role authenticated;
do $$
declare u text; n int;
begin
  foreach u in array array['00000000-0000-4000-8215-000000000004', '00000000-0000-4000-8215-000000000005',
                           '00000000-0000-4000-8215-000000000006'] loop
    perform public.t215_como(u::uuid);
    select (select count(*) from public.obligacion_tributaria) + (select count(*) from public.obligacion_vencimiento)
         + (select count(*) from public.obligacion_cumplimiento) into n;
    perform public.t215_ok(n = 0, 'C03 ' || public.mi_rol()::text || ' no ve el calendario');
  end loop;
end $$;
select public.t215_como('00000000-0000-4000-8215-000000000004');
select public.t215_debe_fallar(
  $f$insert into public.obligacion_tributaria (tenant, nombre, periodicidad) values ('mayorista', 'T215 V', 'anual')$f$,
  '42501', 'C03 venta NO crea obligaciones');
reset role;

\echo ''
\echo '--- C04: la base valida periodo, digitos y agencia ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
select public.t215_debe_fallar(
  $f$insert into public.obligacion_vencimiento (tenant, obligacion_id, anio, periodo, digitos, fecha)
     select tenant, id, 2026, 7, '7', '2027-01-20' from public.obligacion_tributaria where nombre = 'T215 IVA'$f$,
  '23514', 'C04 periodo 7 en una bimestral rechazado');
select public.t215_debe_fallar(
  $f$insert into public.obligacion_vencimiento (tenant, obligacion_id, anio, periodo, digitos, fecha)
     select tenant, id, 2026, 1, '57', '2026-03-10' from public.obligacion_tributaria where nombre = 'T215 IVA'$f$,
  '23514', 'C04 dos digitos en regla de un digito rechazado');
reset role;
-- Agencia cruzada: aun como propietario (sin RLS) la FK compuesta lo impide.
select public.t215_debe_fallar(
  $f$insert into public.obligacion_vencimiento (tenant, obligacion_id, anio, periodo, digitos, fecha)
     select 'minorista', id, 2026, 1, '7', '2026-03-10' from public.obligacion_tributaria
      where nombre = 'T215 IVA' and tenant = 'mayorista'$f$,
  '23503', 'C04 una fecha no puede quedar en otra agencia que su obligacion');
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
do $$
declare n int;
begin
  insert into public.obligacion_vencimiento (tenant, obligacion_id, anio, periodo, digitos, fecha)
  select tenant, id, 2026, 6, d, '2027-01-12' from public.obligacion_tributaria,
         unnest(array['1','2','3','4','5','6','7','8','9','0']) d
   where nombre = 'T215 IVA';
  select count(*) into n from public.obligacion_vencimiento v join public.obligacion_tributaria o on o.id = v.obligacion_id
   where o.nombre = 'T215 IVA';
  perform public.t215_ok(n = 10, 'C04 se cargan las 10 fechas por digito de un periodo valido');
end $$;
reset role;

\echo ''
\echo '--- C05: periodicidad y regla protegidas ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
select public.t215_debe_fallar(
  $f$update public.obligacion_tributaria set periodicidad = 'cuatrimestral' where nombre = 'T215 IVA'$f$,
  '23514', 'C05 bimestral -> cuatrimestral bloqueado con el periodo 6 cargado');
select public.t215_debe_fallar(
  $f$update public.obligacion_tributaria set regla_digitos = 0 where nombre = 'T215 IVA'$f$,
  '23514', 'C05 cambiar la regla con fechas cargadas bloqueado');
do $$
begin
  update public.obligacion_tributaria set periodicidad = 'mensual' where nombre = 'T215 IVA';
  perform public.t215_ok(true, 'C05 bimestral -> mensual permitido: el periodo 6 cabe');
end $$;
reset role;

\echo ''
\echo '--- C06: constancias ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
do $$
declare v bigint;
begin
  insert into public.obligacion_cumplimiento (tenant, obligacion_id, anio, periodo, presentada_en)
  select tenant, id, 2026, 10, '2026-11-18' from public.obligacion_tributaria
   where nombre = 'T215 Retefuente' and tenant = 'mayorista' returning id into v;
  perform public.t215_ok(v is not null, 'C06 administracion registra la presentacion');
end $$;
select public.t215_debe_fallar(
  $f$insert into public.obligacion_cumplimiento (tenant, obligacion_id, anio, periodo, presentada_en)
     select tenant, id, 2026, 13, '2026-11-18' from public.obligacion_tributaria
      where nombre = 'T215 Retefuente' and tenant = 'mayorista'$f$,
  '23514', 'C06 constancia de un periodo inexistente rechazada');
reset role;
-- Id real tomado como propietario: `venta` no ve la obligacion.
create temp table t215_ids on commit drop as
  select id from public.obligacion_tributaria where nombre = 'T215 Retefuente' and tenant = 'mayorista';
grant select on t215_ids to authenticated;
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000004');
-- El trigger de validacion corre con los permisos de quien llama: para un rol
-- que no ve la obligacion responde "no existe" (23503) antes que la policy, sin
-- revelar si existe ni su periodicidad. Sigue siendo un rechazo.
select public.t215_debe_fallar(
  $f$insert into public.obligacion_cumplimiento (tenant, obligacion_id, anio, periodo, pagada_en)
     values ('mayorista', (select id from t215_ids), 2026, 9, '2026-10-10')$f$,
  '23503', 'C06 venta NO registra constancias (ni sabe si la obligacion existe)');
reset role;

\echo ''
\echo '--- C07: roles contables (si la 204 ya los creo) ---'
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'rol_usuario' and e.enumlabel = 'contador') then
    raise notice 'INFO C07 el enum aun no tiene roles contables (204 sin aplicar): se omite';
    return;
  end if;
  perform public.t215_usuario(8, 'contador', 'mayorista');
  perform public.t215_usuario(9, 'revisor_fiscal', 'mayorista');
  perform public.t215_usuario(10, 'admin_contable', 'minorista');
end $$;
set local role authenticated;
do $$
declare v bigint; n int;
begin
  -- Misma condicion que el montaje (pg_enum es legible; `usuarios` no, por RLS).
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'rol_usuario' and e.enumlabel = 'contador') then
    return;
  end if;
  perform public.t215_como('00000000-0000-4000-8215-000000000008');
  insert into public.obligacion_cumplimiento (tenant, obligacion_id, anio, periodo, pagada_en)
  select tenant, id, 2026, 9, '2026-10-10' from public.obligacion_tributaria
   where nombre = 'T215 Retefuente' and tenant = 'mayorista' returning id into v;
  perform public.t215_ok(v is not null, 'C07 contador registra el pago');
  begin
    insert into public.obligacion_tributaria (tenant, nombre, periodicidad) values ('mayorista', 'T215 C', 'anual');
    raise exception 'FALLO C07 el contador pudo configurar una obligacion';
  exception when insufficient_privilege then
    perform public.t215_ok(true, 'C07 contador NO configura obligaciones');
  end;
  perform public.t215_como('00000000-0000-4000-8215-000000000009');
  select count(*) into n from public.obligacion_tributaria where tenant = 'mayorista';
  perform public.t215_ok(n > 0, 'C07 revisor fiscal ve el calendario de su agencia');
  begin
    insert into public.obligacion_cumplimiento (tenant, obligacion_id, anio, periodo, pagada_en)
    select tenant, id, 2026, 8, '2026-09-10' from public.obligacion_tributaria
     where nombre = 'T215 Retefuente' and tenant = 'mayorista';
    raise exception 'FALLO C07 el revisor fiscal pudo registrar constancias';
  exception when insufficient_privilege then
    perform public.t215_ok(true, 'C07 revisor fiscal NO registra constancias (solo lectura)');
  end;
  perform public.t215_como('00000000-0000-4000-8215-000000000010');
  insert into public.obligacion_tributaria (tenant, nombre, periodicidad, regla_digitos)
  values ('minorista', 'T215 ICA', 'bimestral', 0) returning id into v;
  perform public.t215_ok(v is not null, 'C07 admin contable configura en su agencia');
  select count(*) into n from public.obligacion_tributaria where tenant = 'mayorista';
  perform public.t215_ok(n = 0, 'C07 admin contable NO ve la otra agencia');
end $$;
reset role;

\echo ''
\echo '--- C08: anon ---'
set local role anon;
select public.t215_debe_fallar($f$select count(*) from public.obligacion_tributaria$f$, '42501',
  'C08 anon no tiene privilegios sobre las tablas');
select public.t215_debe_fallar($f$select public.calendario_puede_ver('mayorista')$f$, '42501',
  'C08 anon no ejecuta los helpers');
reset role;

\echo ''
\echo '--- C09: cascada y agencia inmutable ---'
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
-- El trigger de inmutabilidad responde antes que la policy: rechazo igual.
select public.t215_debe_fallar(
  $f$update public.obligacion_tributaria set tenant = 'minorista' where nombre = 'T215 IVA'$f$,
  '23514', 'C09 administracion no mueve una obligacion a otra agencia');
reset role;
select public.t215_debe_fallar(
  $f$update public.obligacion_tributaria set tenant = 'minorista' where nombre = 'T215 IVA'$f$,
  '23514', 'C09 ni siquiera el propietario cambia la agencia de una obligacion');
set local role authenticated;
select public.t215_como('00000000-0000-4000-8215-000000000001');
do $$
declare n int;
begin
  delete from public.obligacion_tributaria where nombre = 'T215 Retefuente' and tenant = 'mayorista';
  select (select count(*) from public.obligacion_vencimiento v where v.tenant = 'mayorista'
            and not exists (select 1 from public.obligacion_tributaria o where o.id = v.obligacion_id))
       + (select count(*) from public.obligacion_cumplimiento c where c.tenant = 'mayorista'
            and not exists (select 1 from public.obligacion_tributaria o where o.id = c.obligacion_id)) into n;
  perform public.t215_ok(n = 0, 'C09 borrar la obligacion no deja fechas ni constancias huerfanas');
end $$;
reset role;

rollback;

\echo ''
\echo '=== FIN TEST 215 (rollback aplicado; la base quedo igual) ==='
