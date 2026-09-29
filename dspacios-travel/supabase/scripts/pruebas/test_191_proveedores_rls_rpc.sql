-- ═══════════════════════════════════════════════════════════════════════════
-- Batería de la migración 191 (retiro de columnas legacy de proveedores).
--
-- Correr SOLO contra una base PostgreSQL DESECHABLE con las migraciones
-- 1→191 aplicadas (ver test_191_migracion.sh). NO correr en Supabase: crea
-- usuarios de prueba en auth.users. Todo va en una transacción que termina en
-- ROLLBACK, pero igual es para una base local.
--
-- Ejecución: psql -v ON_ERROR_STOP=1 -f test_191_proveedores_rls_rpc.sql
-- Cualquier aserción que no se cumpla lanza una excepción → psql sale ≠ 0.
--
-- Cubre: estructura (sin columnas/triggers legacy, sin TRUNCATE, policies
-- exactas), lectura del catálogo por rol y tenant (positiva y negativa),
-- lectura sensible sin cambios, escritura directa negada, RPC (alta, edición,
-- validaciones, permisos por rol/tenant, id inexistente), preservación de
-- datos_pago, carga CSV, atomicidad, borrado en cascada y auditoría redactada.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

begin;

create schema _t191;
grant usage on schema _t191 to authenticated, anon;

create function _t191.expect(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) = false then
    raise exception 'ASSERT %', p_msg;
  end if;
end $$;
grant execute on function _t191.expect(boolean, text) to authenticated, anon;

-- Se hace pasar por un usuario igual que PostgREST (claim sub del JWT).
create function _t191.como(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;
grant execute on function _t191.como(uuid) to authenticated, anon;

-- ── Actores ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('b1910000-0000-0000-0000-000000000001', 't191.super.may@t'),
  ('b1910000-0000-0000-0000-000000000002', 't191.ger.may@t'),
  ('b1910000-0000-0000-0000-000000000003', 't191.ger.min@t'),
  ('b1910000-0000-0000-0000-000000000004', 't191.adm.may@t'),
  ('b1910000-0000-0000-0000-000000000005', 't191.adm.min@t'),
  ('b1910000-0000-0000-0000-000000000006', 't191.ope.may@t'),
  ('b1910000-0000-0000-0000-000000000007', 't191.venta.may@t'),
  ('b1910000-0000-0000-0000-000000000008', 't191.venta.min@t'),
  ('b1910000-0000-0000-0000-000000000009', 't191.cv.may@t'),
  ('b1910000-0000-0000-0000-000000000010', 't191.agencia.may@t'),
  ('b1910000-0000-0000-0000-000000000011', 't191.freelance.may@t'),
  ('b1910000-0000-0000-0000-000000000012', 't191.agencia.min@t'),
  ('b1910000-0000-0000-0000-000000000013', 't191.cliente.may@t'),
  ('b1910000-0000-0000-0000-000000000014', 't191.super.inactivo@t'),
  ('b1910000-0000-0000-0000-000000000015', 't191.ope.min@t'),
  ('b1910000-0000-0000-0000-000000000016', 't191.freelance.min@t')
on conflict (id) do nothing;

insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('b1910000-0000-0000-0000-000000000001', 't191.super.may@t',      'T191 SUPER',     'superadmin',     true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000002', 't191.ger.may@t',        'T191 GER MAY',   'gerencia',       true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000003', 't191.ger.min@t',        'T191 GER MIN',   'gerencia',       true,  'minorista'),
  ('b1910000-0000-0000-0000-000000000004', 't191.adm.may@t',        'T191 ADM MAY',   'administracion', true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000005', 't191.adm.min@t',        'T191 ADM MIN',   'administracion', true,  'minorista'),
  ('b1910000-0000-0000-0000-000000000006', 't191.ope.may@t',        'T191 OPE MAY',   'operaciones',    true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000007', 't191.venta.may@t',      'T191 VENTA MAY', 'venta',          true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000008', 't191.venta.min@t',      'T191 VENTA MIN', 'venta',          true,  'minorista'),
  ('b1910000-0000-0000-0000-000000000009', 't191.cv.may@t',         'T191 CV MAY',    'control_vuelo',  true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000010', 't191.agencia.may@t',    'T191 AGE MAY',   'agencia',        true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000011', 't191.freelance.may@t',  'T191 FREE MAY',  'freelance',      true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000012', 't191.agencia.min@t',    'T191 AGE MIN',   'agencia',        true,  'minorista'),
  ('b1910000-0000-0000-0000-000000000013', 't191.cliente.may@t',    'T191 CLIENTE',   'cliente_final',  true,  'mayorista'),
  ('b1910000-0000-0000-0000-000000000014', 't191.super.inactivo@t', 'T191 INACTIVO',  'superadmin',     false, 'mayorista'),
  ('b1910000-0000-0000-0000-000000000015', 't191.ope.min@t',        'T191 OPE MIN',   'operaciones',    true,  'minorista'),
  ('b1910000-0000-0000-0000-000000000016', 't191.freelance.min@t',  'T191 FREE MIN',  'freelance',      true,  'minorista')
on conflict (id) do update set
  email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
  activo = excluded.activo, tenant = excluded.tenant;

-- Proveedor existente con datos_pago (solo se puede fijar fuera de la RPC).
insert into public.proveedores (tipo, nombre, ciudad, contacto, clasificacion)
values ('hotelero', 'T191 EXISTENTE', 'Cartagena', 'Contacto base', 'costo');
insert into public.proveedores_datos_sensibles (
  proveedor_id, tenant, nit, razon_social, datos_pago, banco, tipo_cuenta,
  numero_cuenta, politica_reservas, voucher_contacto
)
select id, 'mayorista', 'NIT_BASE', 'RAZON_BASE', 'PAGO ORIGINAL', 'BANCO_BASE',
       'Ahorros', 'CTA_BASE', 'POLITICA_BASE', 'VOUCHER_BASE'
from public.proveedores where nombre = 'T191 EXISTENTE';

select set_config('t191.total', (select count(*) from public.proveedores)::text, true);
select set_config('t191.existente', (select id from public.proveedores where nombre = 'T191 EXISTENTE')::text, true);
select set_config('t191.aud_inicio', coalesce((select max(id) from public.auditoria), 0)::text, true);

-- ── 1. Estructura ───────────────────────────────────────────────────────────
do $$
begin
  perform _t191.expect(not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proveedores'
      and column_name in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                          'numero_cuenta', 'politica_reservas', 'voucher_contacto')
  ), 'estructura: sin columnas legacy en proveedores');
  perform _t191.expect((
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'proveedores_datos_sensibles'
      and column_name in ('nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
                          'numero_cuenta', 'politica_reservas', 'voucher_contacto')
  ) = 8, 'estructura: la tabla sensible conserva las 8 columnas');
  perform _t191.expect(to_regprocedure('public.sincronizar_proveedor_sensible_legacy()') is null,
    'estructura: funcion legacy retirada');
  perform _t191.expect(not exists (
    select 1 from pg_trigger where tgrelid = 'public.proveedores'::regclass
      and tgname like 'proveedores_sensibles_legacy%'), 'estructura: triggers legacy retirados');
  perform _t191.expect(
    not has_table_privilege('authenticated', 'public.proveedores', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.proveedores', 'TRUNCATE'),
    'estructura: sin TRUNCATE en proveedores');
  perform _t191.expect((select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'proveedores' and cmd in ('SELECT', 'ALL')) = 1,
    'estructura: una sola policy que concede lectura del catalogo');
  perform _t191.expect(not (select prosecdef from pg_proc
    where oid = 'public.guardar_proveedor(jsonb, bigint)'::regprocedure),
    'estructura: guardar_proveedor sigue SECURITY INVOKER');
  perform _t191.expect(not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename in ('proveedores', 'proveedores_datos_sensibles')
      and cmd in ('SELECT', 'ALL') and coalesce(qual, '') ~ '(agencia|freelance|cliente_final)'),
    'estructura: ninguna lectura de proveedores menciona roles externos (busqueda de nombres; la prueba de acceso real es la seccion 2/3)');
end $$;

-- ── 2. Lectura del catálogo BASE por rol y tenant ───────────────────────────
set local role authenticated;
do $$
declare
  v_total bigint := current_setting('t191.total')::bigint;
  v_ver bigint;
  r record;
begin
  for r in
    select * from (values
      ('b1910000-0000-0000-0000-000000000001'::uuid, 'superadmin mayorista',     true),
      ('b1910000-0000-0000-0000-000000000002'::uuid, 'gerencia mayorista',       true),
      ('b1910000-0000-0000-0000-000000000003'::uuid, 'gerencia minorista',       true),
      ('b1910000-0000-0000-0000-000000000004'::uuid, 'administracion mayorista', true),
      ('b1910000-0000-0000-0000-000000000005'::uuid, 'administracion minorista', true),
      ('b1910000-0000-0000-0000-000000000006'::uuid, 'operaciones mayorista',    true),
      ('b1910000-0000-0000-0000-000000000015'::uuid, 'operaciones minorista',    true),
      ('b1910000-0000-0000-0000-000000000007'::uuid, 'venta mayorista',          true),
      ('b1910000-0000-0000-0000-000000000008'::uuid, 'venta minorista',          true),
      ('b1910000-0000-0000-0000-000000000009'::uuid, 'control_vuelo mayorista',  true),
      -- Uso interno: ningún rol externo lee el catálogo, en ningún tenant.
      ('b1910000-0000-0000-0000-000000000010'::uuid, 'agencia mayorista',        false),
      ('b1910000-0000-0000-0000-000000000011'::uuid, 'freelance mayorista',      false),
      ('b1910000-0000-0000-0000-000000000012'::uuid, 'agencia minorista',        false),
      ('b1910000-0000-0000-0000-000000000016'::uuid, 'freelance minorista',      false),
      ('b1910000-0000-0000-0000-000000000013'::uuid, 'cliente_final',            false),
      ('b1910000-0000-0000-0000-000000000014'::uuid, 'superadmin INACTIVO',      false),
      ('b1910000-0000-0000-0000-0000000000ff'::uuid, 'sin perfil en usuarios',   false)
    ) as t(id, etiqueta, ve)
  loop
    perform _t191.como(r.id);
    select count(*) into v_ver from public.proveedores;
    perform _t191.expect(v_ver = case when r.ve then v_total else 0 end,
      format('lectura catalogo %s: ve %s de %s', r.etiqueta, v_ver, v_total));
  end loop;
end $$;
reset role;

-- anon (sin sesión): nada.
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin
  perform _t191.expect((select count(*) from public.proveedores) = 0, 'lectura catalogo anon: 0');
  perform _t191.expect((select count(*) from public.proveedores_datos_sensibles) = 0, 'lectura sensible anon: 0');
end $$;
reset role;

-- ── 3. Lectura sensible: sin cambios respecto de 189 ────────────────────────
set local role authenticated;
do $$
declare r record; v_ver bigint;
begin
  for r in
    select * from (values
      ('b1910000-0000-0000-0000-000000000001'::uuid, 'superadmin',          true),
      ('b1910000-0000-0000-0000-000000000003'::uuid, 'gerencia minorista',  true),
      ('b1910000-0000-0000-0000-000000000007'::uuid, 'venta mayorista',     true),
      ('b1910000-0000-0000-0000-000000000009'::uuid, 'control_vuelo may',   true),
      ('b1910000-0000-0000-0000-000000000005'::uuid, 'administracion min',  false),
      ('b1910000-0000-0000-0000-000000000008'::uuid, 'venta minorista',     false),
      ('b1910000-0000-0000-0000-000000000010'::uuid, 'agencia mayorista',   false),
      ('b1910000-0000-0000-0000-000000000011'::uuid, 'freelance mayorista', false),
      ('b1910000-0000-0000-0000-000000000012'::uuid, 'agencia minorista',   false),
      ('b1910000-0000-0000-0000-000000000016'::uuid, 'freelance minorista', false),
      ('b1910000-0000-0000-0000-000000000013'::uuid, 'cliente_final',       false),
      ('b1910000-0000-0000-0000-000000000014'::uuid, 'superadmin INACTIVO', false)
    ) as t(id, etiqueta, ve)
  loop
    perform _t191.como(r.id);
    select count(*) into v_ver from public.proveedores_datos_sensibles
      where proveedor_id = current_setting('t191.existente')::bigint;
    perform _t191.expect(v_ver = case when r.ve then 1 else 0 end,
      format('lectura sensible %s: ve %s', r.etiqueta, v_ver));
  end loop;
end $$;

-- ── 4. Escritura directa negada fuera de Mayorista autorizado ───────────────
do $$
declare r record; v_n bigint; v_id bigint := current_setting('t191.existente')::bigint;
begin
  for r in
    select * from (values
      ('b1910000-0000-0000-0000-000000000007'::uuid, 'venta mayorista'),
      ('b1910000-0000-0000-0000-000000000009'::uuid, 'control_vuelo mayorista'),
      ('b1910000-0000-0000-0000-000000000003'::uuid, 'gerencia minorista'),
      ('b1910000-0000-0000-0000-000000000005'::uuid, 'administracion minorista'),
      ('b1910000-0000-0000-0000-000000000010'::uuid, 'agencia mayorista'),
      ('b1910000-0000-0000-0000-000000000011'::uuid, 'freelance mayorista'),
      ('b1910000-0000-0000-0000-000000000012'::uuid, 'agencia minorista'),
      ('b1910000-0000-0000-0000-000000000016'::uuid, 'freelance minorista'),
      ('b1910000-0000-0000-0000-000000000013'::uuid, 'cliente_final'),
      ('b1910000-0000-0000-0000-000000000014'::uuid, 'superadmin INACTIVO')
    ) as t(id, etiqueta)
  loop
    perform _t191.como(r.id);
    begin
      insert into public.proveedores (tipo, nombre) values ('hotelero', 'T191 INTRUSO');
      raise exception 'ASSERT insert directo permitido a %', r.etiqueta;
    exception when insufficient_privilege then null;
    end;
    update public.proveedores set nombre = 'T191 HACKEADO' where id = v_id;
    get diagnostics v_n = row_count;
    perform _t191.expect(v_n = 0, format('update directo negado a %s', r.etiqueta));
    delete from public.proveedores where id = v_id;
    get diagnostics v_n = row_count;
    perform _t191.expect(v_n = 0, format('delete directo negado a %s', r.etiqueta));
    begin
      insert into public.proveedores_datos_sensibles (proveedor_id, tenant, nit)
      values (v_id, 'minorista', 'X');
      raise exception 'ASSERT insert sensible permitido a %', r.etiqueta;
    exception when insufficient_privilege or unique_violation then null;
    end;
    update public.proveedores_datos_sensibles set nit = 'HACK' where proveedor_id = v_id;
    get diagnostics v_n = row_count;
    perform _t191.expect(v_n = 0, format('update sensible negado a %s', r.etiqueta));
    begin
      truncate public.proveedores;
      raise exception 'ASSERT TRUNCATE permitido a %', r.etiqueta;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- Incluso un rol autorizado de Mayorista no puede truncar.
  perform _t191.como('b1910000-0000-0000-0000-000000000001');
  begin
    truncate public.proveedores;
    raise exception 'ASSERT TRUNCATE permitido a superadmin';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  perform _t191.expect((select nombre from public.proveedores
    where id = current_setting('t191.existente')::bigint) = 'T191 EXISTENTE',
    'escritura directa: el proveedor existente sigue intacto');
  perform _t191.expect((select nit from public.proveedores_datos_sensibles
    where proveedor_id = current_setting('t191.existente')::bigint) = 'NIT_BASE',
    'escritura directa: el dato sensible sigue intacto');
end $$;

-- ── 5. RPC negada por rol, tenant y estado ─────────────────────────────────
set local role authenticated;
do $$
declare r record; v_id bigint := current_setting('t191.existente')::bigint;
begin
  for r in
    select * from (values
      ('b1910000-0000-0000-0000-000000000007'::uuid, 'venta mayorista'),
      ('b1910000-0000-0000-0000-000000000009'::uuid, 'control_vuelo mayorista'),
      ('b1910000-0000-0000-0000-000000000003'::uuid, 'gerencia minorista'),
      ('b1910000-0000-0000-0000-000000000005'::uuid, 'administracion minorista'),
      ('b1910000-0000-0000-0000-000000000015'::uuid, 'operaciones minorista'),
      ('b1910000-0000-0000-0000-000000000010'::uuid, 'agencia mayorista'),
      ('b1910000-0000-0000-0000-000000000011'::uuid, 'freelance mayorista'),
      ('b1910000-0000-0000-0000-000000000012'::uuid, 'agencia minorista'),
      ('b1910000-0000-0000-0000-000000000016'::uuid, 'freelance minorista'),
      ('b1910000-0000-0000-0000-000000000013'::uuid, 'cliente_final'),
      ('b1910000-0000-0000-0000-000000000014'::uuid, 'superadmin INACTIVO'),
      ('b1910000-0000-0000-0000-0000000000ff'::uuid, 'sin perfil')
    ) as t(id, etiqueta)
  loop
    perform _t191.como(r.id);
    -- Se exige el mensaje del candado de la RPC, no solo el 42501: así se
    -- prueba la RPC por sí misma y no solo la RLS que hay detrás.
    begin
      perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 RPC INTRUSO"}'::jsonb);
      raise exception 'ASSERT RPC alta permitida a %', r.etiqueta;
    exception when insufficient_privilege then
      perform _t191.expect(sqlerrm = 'No autorizado para guardar proveedores',
        format('RPC alta a %s negada por el candado de la RPC (fue: %s)', r.etiqueta, sqlerrm));
    end;
    begin
      perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 RPC HACK","nit":"HACK"}'::jsonb, v_id);
      raise exception 'ASSERT RPC edicion permitida a %', r.etiqueta;
    exception when insufficient_privilege then
      perform _t191.expect(sqlerrm = 'No autorizado para guardar proveedores',
        format('RPC edicion a %s negada por el candado de la RPC (fue: %s)', r.etiqueta, sqlerrm));
    end;
  end loop;
end $$;
reset role;

do $$ begin
  perform _t191.expect(not exists (select 1 from public.proveedores where nombre like 'T191 RPC%'),
    'RPC negada: no quedaron altas');
  perform _t191.expect((select nit from public.proveedores_datos_sensibles
    where proveedor_id = current_setting('t191.existente')::bigint) = 'NIT_BASE',
    'RPC negada: no cambio el dato sensible');
end $$;

-- anon no puede ejecutar la RPC.
set local role anon;
do $$ begin
  begin
    perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 ANON"}'::jsonb);
    raise exception 'ASSERT anon ejecuto guardar_proveedor';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── 6. RPC: alta, validaciones, edición y datos_pago ────────────────────────
set local role authenticated;
do $$
declare
  v_id bigint;
  v_existente bigint := current_setting('t191.existente')::bigint;
  s record;
  p record;
begin
  perform _t191.como('b1910000-0000-0000-0000-000000000001');  -- superadmin mayorista

  -- Alta completa, con espacios y con datos_pago en el JSON (se ignora, como en 190).
  v_id := public.guardar_proveedor(jsonb_build_object(
    'tipo', 'hotelero', 'nombre', '  T191 NUEVO  ', 'ciudad', ' Bogota ', 'contacto', ' Ana ',
    'aplica_retencion', true, 'pct_retencion', 0.025, 'clasificacion', 'irt',
    'nit', ' 900 ', 'razon_social', ' Nuevo SAS ', 'banco', ' Banco Uno ',
    'tipo_cuenta', ' Ahorros ', 'numero_cuenta', ' 987 ',
    'politica_reservas', E' Linea 1\nLinea 2 ', 'voucher_contacto', ' 300123 ',
    'datos_pago', 'NO DEBE GUARDARSE'));
  select * into p from public.proveedores where id = v_id;
  perform _t191.expect(p.nombre = 'T191 NUEVO' and p.ciudad = 'Bogota' and p.contacto = 'Ana'
    and p.aplica_retencion and p.pct_retencion = 0.025 and p.clasificacion = 'irt' and p.tipo = 'hotelero',
    'alta: campos generales en proveedores');
  select * into s from public.proveedores_datos_sensibles where proveedor_id = v_id and tenant = 'mayorista';
  perform _t191.expect(s.nit = '900' and s.razon_social = 'Nuevo SAS' and s.banco = 'Banco Uno'
    and s.tipo_cuenta = 'Ahorros' and s.numero_cuenta = '987'
    and s.politica_reservas = E'Linea 1\nLinea 2' and s.voucher_contacto = '300123',
    'alta: sensibles en la tabla sensible (trim y saltos de linea)');
  perform _t191.expect(s.datos_pago is null, 'alta: datos_pago queda NULL aunque venga en el JSON');
  perform _t191.expect((select count(*) from public.proveedores_datos_sensibles where proveedor_id = v_id) = 1,
    'alta: exactamente una fila sensible (tenant mayorista)');

  -- Validaciones (errcode 22023) y defaults.
  begin perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"   "}'::jsonb);
    raise exception 'ASSERT nombre vacio aceptado'; exception when invalid_parameter_value then null; end;
  begin perform public.guardar_proveedor('{"tipo":"crucero","nombre":"T191 X"}'::jsonb);
    raise exception 'ASSERT tipo invalido aceptado'; exception when invalid_parameter_value then null; end;
  begin perform public.guardar_proveedor('{"nombre":"T191 X"}'::jsonb);
    raise exception 'ASSERT tipo ausente aceptado'; exception when invalid_parameter_value then null; end;
  begin perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 X","clasificacion":"otro"}'::jsonb);
    raise exception 'ASSERT clasificacion invalida aceptada'; exception when invalid_parameter_value then null; end;
  perform _t191.expect(not exists (select 1 from public.proveedores where nombre = 'T191 X'),
    'validaciones: nada guardado');

  -- Id inexistente.
  begin perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 FANTASMA"}'::jsonb, -1);
    raise exception 'ASSERT edicion de id inexistente aceptada'; exception when insufficient_privilege then null; end;
  perform _t191.expect(not exists (select 1 from public.proveedores_datos_sensibles where proveedor_id = -1),
    'id inexistente: no crea fila sensible huerfana');

  -- Edición SIN datos_pago en el JSON (lo que envía la app): se conserva.
  perform _t191.como('b1910000-0000-0000-0000-000000000006');  -- operaciones mayorista
  perform _t191.expect(public.guardar_proveedor(jsonb_build_object(
    'tipo', 'servicios', 'nombre', 'T191 EXISTENTE EDITADO', 'clasificacion', 'costo',
    'nit', 'NIT_EDITADO', 'banco', '', 'politica_reservas', 'POLITICA_NUEVA'), v_existente) = v_existente,
    'edicion: devuelve el mismo id');
  select * into s from public.proveedores_datos_sensibles where proveedor_id = v_existente and tenant = 'mayorista';
  perform _t191.expect(s.datos_pago = 'PAGO ORIGINAL', 'edicion sin clave datos_pago: se conserva');
  perform _t191.expect(s.nit = 'NIT_EDITADO' and s.politica_reservas = 'POLITICA_NUEVA',
    'edicion: actualiza los sensibles enviados');
  perform _t191.expect(s.banco is null and s.razon_social is null and s.voucher_contacto is null,
    'edicion: vacio o ausente deja NULL (misma semantica que 190)');
  perform _t191.expect((select tipo = 'servicios' and nombre = 'T191 EXISTENTE EDITADO'
    and ciudad is null and contacto is null from public.proveedores where id = v_existente),
    'edicion: actualiza los campos generales');

  -- Edición CON datos_pago en el JSON: tampoco lo toca (paridad con 190).
  perform public.guardar_proveedor(jsonb_build_object(
    'tipo', 'servicios', 'nombre', 'T191 EXISTENTE EDITADO', 'datos_pago', 'INTENTO'), v_existente);
  perform _t191.expect((select datos_pago from public.proveedores_datos_sensibles
    where proveedor_id = v_existente) = 'PAGO ORIGINAL', 'edicion con clave datos_pago: se conserva');

  -- Edición con datos_pago explícitamente null: igual se conserva.
  perform public.guardar_proveedor('{"tipo":"servicios","nombre":"T191 EXISTENTE EDITADO","datos_pago":null}'::jsonb, v_existente);
  perform _t191.expect((select datos_pago from public.proveedores_datos_sensibles
    where proveedor_id = v_existente) = 'PAGO ORIGINAL', 'edicion con datos_pago null: se conserva');

  -- Gerencia y administración de Mayorista también pueden guardar.
  perform _t191.como('b1910000-0000-0000-0000-000000000002');
  perform public.guardar_proveedor('{"tipo":"aereo","nombre":"T191 GERENCIA"}'::jsonb);
  perform _t191.como('b1910000-0000-0000-0000-000000000004');
  perform public.guardar_proveedor('{"tipo":"programa","nombre":"T191 ADMINISTRACION"}'::jsonb);
  perform _t191.expect((select count(*) from public.proveedores pv
    join public.proveedores_datos_sensibles sv on sv.proveedor_id = pv.id and sv.tenant = 'mayorista'
    where pv.nombre in ('T191 GERENCIA', 'T191 ADMINISTRACION')) = 2,
    'gerencia/administracion mayorista: alta con su fila sensible');
end $$;

-- ── 7. Carga CSV: misma forma de payload que cargarProveedoresMasivo ────────
do $$
declare v_id bigint;
begin
  perform _t191.como('b1910000-0000-0000-0000-000000000004');
  v_id := public.guardar_proveedor(jsonb_build_object(
    'tipo', 'hotelero', 'nombre', 'T191 CSV', 'razon_social', null, 'nit', '111',
    'ciudad', null, 'contacto', null, 'banco', 'Banco CSV', 'tipo_cuenta', null,
    'numero_cuenta', null, 'politica_reservas', null,
    'aplica_retencion', true, 'pct_retencion', 0.025));
  perform _t191.expect((select clasificacion = 'costo' and aplica_retencion and pct_retencion = 0.025
    from public.proveedores where id = v_id), 'CSV: generales con clasificacion por defecto');
  perform _t191.expect((select nit = '111' and banco = 'Banco CSV' and voucher_contacto is null
    and datos_pago is null from public.proveedores_datos_sensibles where proveedor_id = v_id),
    'CSV: sensibles guardados, voucher y datos_pago NULL');
end $$;
reset role;

-- ── 8. Atomicidad: si falla la escritura sensible, no queda el catálogo ─────
create function _t191.falla_sensible() returns trigger language plpgsql as $$
begin
  if new.nit = 'FORZAR_FALLO' then raise exception 'fallo forzado' using errcode = 'P0191'; end if;
  return new;
end $$;
create trigger t191_falla before insert or update on public.proveedores_datos_sensibles
  for each row execute function _t191.falla_sensible();

set local role authenticated;
do $$
declare v_existente bigint := current_setting('t191.existente')::bigint;
begin
  perform _t191.como('b1910000-0000-0000-0000-000000000001');
  begin
    perform public.guardar_proveedor('{"tipo":"hotelero","nombre":"T191 ATOMICO","nit":"FORZAR_FALLO"}'::jsonb);
    raise exception 'ASSERT el fallo forzado no se propago';
  exception when sqlstate 'P0191' then null;
  end;
  perform _t191.expect(not exists (select 1 from public.proveedores where nombre = 'T191 ATOMICO'),
    'atomicidad alta: no queda fila de catalogo sin sensibles');

  begin
    perform public.guardar_proveedor('{"tipo":"aereo","nombre":"T191 ATOMICO EDIT","nit":"FORZAR_FALLO"}'::jsonb, v_existente);
    raise exception 'ASSERT el fallo forzado no se propago (edicion)';
  exception when sqlstate 'P0191' then null;
  end;
  perform _t191.expect((select nombre from public.proveedores where id = v_existente) = 'T191 EXISTENTE EDITADO',
    'atomicidad edicion: el catalogo no quedo a medias');
end $$;
reset role;
drop trigger t191_falla on public.proveedores_datos_sensibles;

-- ── 9. Auditoría: eventos presentes y sin valores sensibles ─────────────────
do $$
declare
  v_desde bigint := current_setting('t191.aud_inicio')::bigint;
  v_campos constant text[] := array['nit', 'razon_social', 'datos_pago', 'banco', 'tipo_cuenta',
    'numero_cuenta', 'politica_reservas', 'voucher_contacto'];
  v_nuevo text := (select id::text from public.proveedores where nombre = 'T191 NUEVO');
begin
  perform _t191.expect(exists (select 1 from public.auditoria where id > v_desde
      and tabla = 'proveedores' and accion = 'INSERT' and registro_id = v_nuevo),
    'auditoria: alta del catalogo registrada');
  perform _t191.expect(exists (select 1 from public.auditoria where id > v_desde
      and tabla = 'proveedores_datos_sensibles' and accion = 'INSERT' and registro_id = v_nuevo),
    'auditoria: alta sensible registrada con el id del proveedor');
  perform _t191.expect(exists (select 1 from public.auditoria where id > v_desde
      and tabla = 'proveedores_datos_sensibles' and accion = 'UPDATE'
      and registro_id = current_setting('t191.existente')
      and cambios ? 'nit' and cambios->'nit' = '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb),
    'auditoria: edicion sensible registra el campo cambiado, redactado');
  perform _t191.expect(not exists (
    select 1 from public.auditoria a
    where a.id > v_desde and a.tabla in ('proveedores', 'proveedores_datos_sensibles')
      and (coalesce(a.antes, '{}'::jsonb) ?| v_campos
           or coalesce(a.despues, '{}'::jsonb) ?| v_campos
           or exists (select 1 from jsonb_each(coalesce(a.cambios, '{}'::jsonb)) c(k, v)
                      where c.k = any(v_campos)
                        and c.v <> '{"antes":"[REDACTADO]","despues":"[REDACTADO]"}'::jsonb))
  ), 'auditoria: ningun valor sensible en antes/despues/cambios');
  perform _t191.expect(not exists (
    select 1 from public.auditoria a where a.id > v_desde
      and (a.antes::text like '%PAGO ORIGINAL%' or a.despues::text like '%PAGO ORIGINAL%'
           or a.cambios::text like '%NIT_EDITADO%' or a.despues::text like '%NIT_EDITADO%')
  ), 'auditoria: los valores de prueba no aparecen en ningun evento');
end $$;

-- ── 10. Borrado: la fila sensible cae en cascada ────────────────────────────
set local role authenticated;
do $$
declare v_id bigint; v_n bigint;
begin
  perform _t191.como('b1910000-0000-0000-0000-000000000006');
  select id into v_id from public.proveedores where nombre = 'T191 CSV';
  delete from public.proveedores where id = v_id;
  get diagnostics v_n = row_count;
  perform _t191.expect(v_n = 1, 'borrado: operaciones mayorista puede borrar');
  perform _t191.como('b1910000-0000-0000-0000-000000000001');
  perform _t191.expect(not exists (select 1 from public.proveedores_datos_sensibles where proveedor_id = v_id),
    'borrado: la fila sensible se elimina en cascada');
end $$;
reset role;

\echo 'test_191_proveedores_rls_rpc: TODAS LAS ASERCIONES PASARON'
rollback;
