-- ═══════════════════════════════════════════════════════════════════════════
-- PRUEBA SQL 221 · Clientes de contratos en el CRM (#68), sobre la migración REAL.
-- SOLO base desechable (CI). Corre en UNA transacción y termina en ROLLBACK.
--
--   psql -v ON_ERROR_STOP=1 -f test_221_clientes_contratos_crm.sql <base>   (desde supabase/scripts: usa \ir)
--
-- Requiere la cadena integrada hasta la 219 más la 221 aplicada. Reutiliza SOLO COMO LECTURA los usuarios
-- de las fixtures de la 216 (superadmin, administración, gerencia, operaciones, dos venta, minorista, inactivo,
-- agencia y control_vuelo) y agrega los suyos. Datos 100% sintéticos.
-- Grupos: A autoridad por rol y tenant · V venta (propios y guarda de homónimos) · R roles sin acceso ·
-- F ficha · S búsqueda y paginación · E contrato de las funciones (ACL y columnas).
-- Límite: el actor se fija con request.jwt.claims en una sesión que ya puede hacer SET ROLE; prueba la LÓGICA
-- de autorización, no la autenticación (eso lo hace el bloque H del runner con PostgREST).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\ir test_216_fixtures.sql

do $$
begin
  if to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)') is null
     or to_regprocedure('public.crm_contrato_cliente_ficha(text)') is null then
    raise exception 'test_221 exige la 221 aplicada.';
  end if;
end $$;

create schema t221;

create function t221.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000221' || case p_k
    when 'ventaC' then '001' when 'ventaE' then '002' when 'ventaMinB' then '003' when 'freelance' then '004'
    when 'clientefinal' then '005' when 'gerenciaMin' then '006' when 'operMin' then '007' when 'fantasma' then '008'
    else '999' end)::uuid
$$;

insert into auth.users (id, email)
select t221.u(k), 'c221-' || k || '@x.test'
from unnest(array['ventaC', 'ventaE', 'ventaMinB', 'freelance', 'clientefinal', 'gerenciaMin', 'operMin']) k
on conflict do nothing;

-- ventaC: homónimo ACTIVO de ventaA en el mismo tenant (mismo nombre tras minúsculas y recorte).
-- ventaE: homónimo INACTIVO de ventaB en el mismo tenant. ventaMinB: homónimo de ventaB en OTRO tenant.
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t221.u(k), 'c221-' || k || '@x.test', n, r::rol_usuario, a, t
from (values ('ventaC', ' c216 VENTAA ', 'venta', true, 'mayorista'),
             ('ventaE', 'C216 ventaB', 'venta', false, 'mayorista'),
             ('ventaMinB', 'C216 ventaB', 'venta', true, 'minorista'),
             ('freelance', 'C221 freelance', 'freelance', true, 'mayorista'),
             ('clientefinal', 'C221 cliente final', 'cliente_final', true, 'mayorista'),
             ('gerenciaMin', 'C221 gerencia min', 'gerencia', true, 'minorista'),
             ('operMin', 'C221 oper min', 'operaciones', true, 'minorista')) v(k, n, r, a, t)
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol,
                               activo = excluded.activo, tenant = excluded.tenant;

-- ── Contratos sintéticos ───────────────────────────────────────────────────
insert into public.ventas (numero_contrato, fecha_venta, asesor, cliente, cliente_documento, cliente_email, cliente_telefono,
                           destino, fecha_salida, fecha_regreso, estado, tipo_asesor, agencia_nombre, freelance_nombre, tenant)
values
  ('DTM-6801', '2026-01-10', 'C216 ventaB',                  'Cliente68 Uno',    '10000001', 'uno68@example.test',    '3000000001', 'CARTAGENA',   '2026-03-01', '2026-03-04', 'activo',     'interno',   null,         null,      'mayorista'),
  ('DTM-6802', '2026-01-11', 'C216 ventaA',                  'Cliente68 Dos',    '10000002', 'dos68@example.test',    '3000000002', 'SAN ANDRES',  '2026-03-02', '2026-03-06', 'activo',     'interno',   null,         null,      'mayorista'),
  ('DTM-6803', '2026-01-12', 'c216-ventab@x.test',           'Cliente68 Tres',   '10000003', 'tres68@example.test',   '3000000003', 'SANTA MARTA', '2026-03-03', '2026-03-07', 'confirmado', 'agencia',   'Agencia 68', null,      'mayorista'),
  ('DTM-6804', '2026-01-13', null,                           'Cliente68 Cuatro', '10000004', 'cuatro68@example.test', '3000000004', 'CARTAGENA',   '2026-03-04', '2026-03-08', 'activo',     'interno',   null,         null,      'mayorista'),
  ('DTM-6806', '2026-01-14', 'Asesor Importado Sin Usuario', 'Cliente68 Seis',   '10000006', 'seis68@example.test',   '3000000006', 'CARTAGENA',   '2026-03-05', '2026-03-09', 'activo',     'interno',   null,         null,      'mayorista'),
  ('DTM-6807', '2026-01-15', 'C216 ventaB',                  'Cliente68 Siete',  null,       'siete68@example.test',  '3000000007', 'SAN ANDRES',  '2026-03-06', '2026-03-10', 'cancelado',  'freelance', null,         'Free 68', 'mayorista'),
  ('DTM-6808', '2026-01-16', null,                           'Cliente68 100%_Ocho', '10000008', 'ocho68@example.test', '3000000008', 'CARTAGENA',   '2026-03-07', '2026-03-11', 'activo',     'interno',   null,         null,      'mayorista'),
  ('MIN-68-0005', '2026-01-17', 'C216 ventaMin',            'Cliente68 Cinco',  '10000005', 'cinco68@example.test',  '3000000005', 'CARTAGENA',   '2026-03-08', '2026-03-12', 'activo',     'interno',   null,         null,      'minorista'),
  ('MIN-68-0009', '2026-01-18', 'C216 ventaB',              'Cliente68 Nueve',  '10000009', 'nueve68@example.test',  '3000000009', 'CARTAGENA',   '2026-03-09', '2026-03-13', 'activo',     'interno',   null,         null,      'minorista');

-- 55 contratos más (paginación): sin asesor, solo los ven los roles administrativos.
insert into public.ventas (numero_contrato, asesor, cliente, cliente_documento, tenant, estado)
select 'DTM-' || (7000 + g), null, 'Pagina68 ' || g, '2000' || g, 'mayorista', 'activo'
  from generate_series(0, 54) g;

-- ── Ayudantes ──────────────────────────────────────────────────────────────
-- Números de contrato de la lista, de mayor a menor, separados por coma ('' si no hay nada).
create function t221.lista(p_rol text, p_uid uuid, p_tenant text, p_q text default null, p_cursor text default null, p_tam integer default 50)
returns text language plpgsql as $$
begin
  return t216.escalar(p_rol, p_uid, format(
    'select coalesce(string_agg(numero_contrato, '','' order by numero_contrato desc), '''') from public.crm_contratos_clientes_buscar(%L, %L, %L, %s)',
    p_tenant, p_q, p_cursor, coalesce(p_tam::text, 'null')));
end $$;

-- Resumen de una página: filas|hay_mas|menor|mayor.
create function t221.pagina(p_rol text, p_uid uuid, p_tenant text, p_q text default null, p_cursor text default null, p_tam integer default 50)
returns text language plpgsql as $$
begin
  return t216.escalar(p_rol, p_uid, format(
    'select count(*) || ''|'' || coalesce(bool_or(hay_mas), false) || ''|'' || coalesce(min(numero_contrato), '''') || ''|'' || coalesce(max(numero_contrato), '''') from public.crm_contratos_clientes_buscar(%L, %L, %L, %s)',
    p_tenant, p_q, p_cursor, coalesce(p_tam::text, 'null')));
end $$;

create function t221.ficha(p_rol text, p_uid uuid, p_num text) returns text language plpgsql as $$
begin
  return t216.escalar(p_rol, p_uid, format(
    'select coalesce(string_agg(numero_contrato || '':'' || tenant, '','' order by numero_contrato), '''') from public.crm_contrato_cliente_ficha(%L)', p_num));
end $$;

create function t221.ficha_json(p_rol text, p_uid uuid, p_num text) returns text language plpgsql as $$
begin
  return t216.escalar(p_rol, p_uid, format(
    'select coalesce(jsonb_agg(to_jsonb(f)), ''[]''::jsonb)::text from public.crm_contrato_cliente_ficha(%L) f', p_num));
end $$;

create function t221.unico(p_rol text, p_uid uuid, p_num text, p_col text) returns text language plpgsql as $$
begin
  return t216.escalar(p_rol, p_uid, format(
    'select coalesce(max(%I::text), ''<null>'') from public.crm_contrato_cliente_ficha(%L)', p_col, p_num));
end $$;

-- Referencias de resultados esperados.
create function t221.m7() returns text language sql immutable as $$ select 'DTM-6808,DTM-6807,DTM-6806,DTM-6804,DTM-6803,DTM-6802,DTM-6801' $$;
create function t221.n2() returns text language sql immutable as $$ select 'MIN-68-0009,MIN-68-0005' $$;

-- ═══ A · autoridad por rol y tenant (p_tenant NO decide) ═══════════════════
do $$
declare ad uuid := t216.u('admin'); op uuid := t216.u('oper'); ge uuid := t216.u('gerencia'); su uuid := t216.u('super');
        adm uuid := t216.u('adminMin'); gem uuid := t221.u('gerenciaMin'); opm uuid := t221.u('operMin');
        r text;
begin
  perform t216.afirma('A1 administración (mayorista): sin p_tenant ve solo su tenant', t221.lista('authenticated', ad, null, 'Cliente68') = t221.m7(), t221.lista('authenticated', ad, null, 'Cliente68'));
  perform t216.afirma('A2 administración: p_tenant propio = lo mismo', t221.lista('authenticated', ad, 'mayorista', 'Cliente68') = t221.m7());
  perform t216.afirma('A3 administración pide el OTRO tenant: vacío', t221.lista('authenticated', ad, 'minorista', 'Cliente68') = '', t221.lista('authenticated', ad, 'minorista', 'Cliente68'));
  perform t216.afirma('A4 operaciones: su tenant sí, el otro vacío', t221.lista('authenticated', op, null, 'Cliente68') = t221.m7() and t221.lista('authenticated', op, 'minorista', 'Cliente68') = '');
  perform t216.afirma('A5 gerencia (mayorista): su tenant sí, el otro vacío (aunque puede_ver_tenant le abra ambos)',
    t221.lista('authenticated', ge, null, 'Cliente68') = t221.m7() and t221.lista('authenticated', ge, 'minorista', 'Cliente68') = '');
  r := t216.escalar('authenticated', ge, 'select count(*) from public.ventas_basica where tenant = ''minorista''');
  perform t216.afirma('A5.1 control: la VISTA sí le muestra a gerencia contratos de minorista; la función los recorta',
    r ~ '^[0-9]+$' and r::int >= 2, r);
  perform t216.afirma('A6 administración de minorista: su tenant sí, mayorista vacío',
    t221.lista('authenticated', adm, null, 'Cliente68') = t221.n2() and t221.lista('authenticated', adm, 'mayorista', 'Cliente68') = '');
  perform t216.afirma('A7 gerencia y operaciones de minorista: su tenant sí, mayorista vacío',
    t221.lista('authenticated', gem, null, 'Cliente68') = t221.n2() and t221.lista('authenticated', gem, 'mayorista', 'Cliente68') = ''
    and t221.lista('authenticated', opm, null, 'Cliente68') = t221.n2() and t221.lista('authenticated', opm, 'mayorista', 'Cliente68') = '');
  perform t216.afirma('A8 superadmin elige: mayorista, minorista; nulo o inválido = vacío',
    t221.lista('authenticated', su, 'mayorista', 'Cliente68') = t221.m7()
    and t221.lista('authenticated', su, 'minorista', 'Cliente68') = t221.n2()
    and t221.lista('authenticated', su, null, 'Cliente68') = ''
    and t221.lista('authenticated', su, 'x', 'Cliente68') = ''
    and t221.lista('authenticated', su, 'MAYORISTA', 'Cliente68') = ''
    and t221.lista('authenticated', su, 'mayorista'' or ''1''=''1', 'Cliente68') = '');
  perform t216.afirma('A9 p_tenant inválido para quien no es superadmin: vacío (no se ignora ni se amplía)',
    t221.lista('authenticated', ad, 'x', 'Cliente68') = '' and t221.lista('authenticated', ad, '', 'Cliente68') = ''
    and t221.lista('authenticated', ge, 'MAYORISTA', 'Cliente68') = '');
end $$;

-- ═══ V · venta: solo propios y guarda de homónimos ═════════════════════════
do $$
declare va uuid := t216.u('ventaA'); vb uuid := t216.u('ventaB'); vc uuid := t221.u('ventaC'); ve uuid := t221.u('ventaE');
        vm uuid := t216.u('ventaMin'); vmb uuid := t221.u('ventaMinB');
        r text;
begin
  perform t216.afirma('V1 ventaB ve SUS contratos (nombre exacto y correo) aunque haya un homónimo INACTIVO y otro en OTRO tenant',
    t221.lista('authenticated', vb, null, 'Cliente68') = 'DTM-6807,DTM-6803,DTM-6801', t221.lista('authenticated', vb, null, 'Cliente68'));
  perform t216.afirma('V2 ventaB pide el otro tenant: vacío', t221.lista('authenticated', vb, 'minorista', 'Cliente68') = '');
  perform t216.afirma('V3 ventaB no ve el contrato de minorista cuyo asesor se escribe igual que su nombre (otro tenant)',
    t221.lista('authenticated', vb, null, 'Nueve') = '' and t221.ficha('authenticated', vb, 'MIN-68-0009') = '');
  perform t216.afirma('V4 guarda de homónimos: ventaA y ventaC (mismo nombre, ambos activos, mismo tenant) no ven ese contrato',
    t221.lista('authenticated', va, null, 'Cliente68') = '' and t221.lista('authenticated', vc, null, 'Cliente68') = ''
    and t221.ficha('authenticated', va, 'DTM-6802') = '' and t221.ficha('authenticated', vc, 'DTM-6802') = '');
  perform t216.afirma('V4.1 los roles administrativos SÍ ven ese contrato',
    t221.ficha('authenticated', t216.u('admin'), 'DTM-6802') = 'DTM-6802:mayorista' and t221.ficha('authenticated', t216.u('gerencia'), 'DTM-6802') = 'DTM-6802:mayorista');
  perform t216.afirma('V5 ventaMin y ventaMinB ven cada uno el suyo en minorista',
    t221.lista('authenticated', vm, null, 'Cliente68') = 'MIN-68-0005' and t221.lista('authenticated', vmb, null, 'Cliente68') = 'MIN-68-0009');
  perform t216.afirma('V5.1 ventaMin pide mayorista: vacío', t221.lista('authenticated', vm, 'mayorista', 'Cliente68') = '');

  -- Dinámica de la guarda: un homónimo activo del mismo tenant oculta el contrato por nombre; el contrato escrito con el
  -- CORREO sigue siendo de ventaB (el correo no se repite).
  update public.usuarios set activo = true where id = ve;
  perform t216.afirma('V6 al activar al homónimo de ventaB en su tenant: ambos pierden los contratos escritos por nombre y ventaB conserva el del correo',
    t221.lista('authenticated', vb, null, 'Cliente68') = 'DTM-6803' and t221.lista('authenticated', ve, null, 'Cliente68') = '',
    t221.lista('authenticated', vb, null, 'Cliente68'));
  update public.usuarios set activo = false where id = ve;
  perform t216.afirma('V6.1 al desactivarlo, ventaB recupera sus tres contratos', t221.lista('authenticated', vb, null, 'Cliente68') = 'DTM-6807,DTM-6803,DTM-6801');

  update public.usuarios set tenant = 'mayorista' where id = vmb;
  perform t216.afirma('V7 un homónimo de OTRO tenant que pasa a mayorista vuelve ambiguo el contrato',
    t221.lista('authenticated', vb, null, 'Cliente68') = 'DTM-6803');
  update public.usuarios set tenant = 'minorista' where id = vmb;
  perform t216.afirma('V7.1 al volver a minorista, ventaB recupera sus tres contratos', t221.lista('authenticated', vb, null, 'Cliente68') = 'DTM-6807,DTM-6803,DTM-6801');

  perform t216.afirma('V8 ventaB ve SU documento sin enmascarar y sus datos de contacto',
    t221.unico('authenticated', vb, 'DTM-6801', 'cliente_documento') = '10000001'
    and t221.unico('authenticated', vb, 'DTM-6801', 'cliente_email') = 'uno68@example.test'
    and t221.unico('authenticated', vb, 'DTM-6801', 'cliente_telefono') = '3000000001');
  perform t216.afirma('V9 contrato propio SIN documento: una fila con documento nulo y su estado',
    t221.unico('authenticated', vb, 'DTM-6807', 'cliente_documento') = '<null>' and t221.unico('authenticated', vb, 'DTM-6807', 'estado') = 'cancelado');
  perform t216.afirma('V10 contrato sin asesor o con asesor sin usuario: venta no lo ve; administración sí',
    t221.ficha('authenticated', vb, 'DTM-6804') = '' and t221.ficha('authenticated', vb, 'DTM-6806') = ''
    and t221.ficha('authenticated', t216.u('admin'), 'DTM-6804') = 'DTM-6804:mayorista' and t221.ficha('authenticated', t216.u('admin'), 'DTM-6806') = 'DTM-6806:mayorista');
end $$;

-- ═══ R · roles y contextos sin acceso ══════════════════════════════════════
do $$
declare r text; ad uuid := t216.u('admin');
begin
  perform t216.afirma('R1 usuario INACTIVO (administración): vacío', t221.lista('authenticated', t216.u('inactivo'), null, 'Cliente68') = '' and t221.ficha('authenticated', t216.u('inactivo'), 'DTM-6801') = '');
  perform t216.afirma('R2 agencia, freelance y cliente final: vacío',
    t221.lista('authenticated', t216.u('agencia'), null, 'Cliente68') = '' and t221.lista('authenticated', t221.u('freelance'), null, 'Cliente68') = ''
    and t221.lista('authenticated', t221.u('clientefinal'), null, 'Cliente68') = '' and t221.ficha('authenticated', t216.u('agencia'), 'DTM-6801') = '');
  perform t216.afirma('R3 control_vuelo: vacío', t221.lista('authenticated', t216.u('vuelo'), null, 'Cliente68') = '' and t221.ficha('authenticated', t216.u('vuelo'), 'DTM-6801') = '');
  perform t216.afirma('R4 sub sin fila en usuarios (mi_tenant() caería a mayorista): vacío',
    t221.lista('authenticated', t221.u('fantasma'), null, 'Cliente68') = '' and t221.lista('authenticated', t221.u('fantasma'), 'mayorista', 'Cliente68') = ''
    and t221.ficha('authenticated', t221.u('fantasma'), 'DTM-6801') = '');
  perform t216.afirma('R5 sesión sin sub: vacío', t221.lista('authenticated', null, null, 'Cliente68') = '' and t221.ficha('authenticated', null, 'DTM-6801') = '');
  r := t221.lista('anon', null, null, 'Cliente68');
  perform t216.afirma('R6 anon no ejecuta la función (42501)', r like 'ERR 42501%', r);
  r := t221.ficha('anon', null, 'DTM-6801');
  perform t216.afirma('R6.1 anon no ejecuta la ficha (42501)', r like 'ERR 42501%', r);
  r := t221.lista('service_role', null, 'mayorista', 'Cliente68');
  perform t216.afirma('R7 service_role no ejecuta la función (42501)', r like 'ERR 42501%', r);
  r := t221.ficha('service_role', null, 'DTM-6801');
  perform t216.afirma('R7.1 service_role no ejecuta la ficha (42501)', r like 'ERR 42501%', r);

  -- Un tenant propio inválido (usuarios.tenant es NOT NULL, así que el nulo no es representable): vacío.
  update public.usuarios set tenant = 'otra' where id = ad;
  perform t216.afirma('R8 usuario con tenant propio inválido: vacío, no cae a mayorista',
    t221.lista('authenticated', ad, null, 'Cliente68') = '' and t221.lista('authenticated', ad, 'mayorista', 'Cliente68') = '' and t221.ficha('authenticated', ad, 'DTM-6801') = '');
  update public.usuarios set tenant = 'mayorista' where id = ad;
  perform t216.afirma('R8.1 restaurado, vuelve a ver su tenant', t221.lista('authenticated', ad, null, 'Cliente68') = t221.m7());

  update public.usuarios set activo = false where id = ad;
  perform t216.afirma('R9 un administrador que se desactiva pierde el acceso al instante', t221.lista('authenticated', ad, null, 'Cliente68') = '');
  update public.usuarios set activo = true where id = ad;
end $$;

-- ═══ F · ficha de un contrato ══════════════════════════════════════════════
do $$
declare vb uuid := t216.u('ventaB'); ad uuid := t216.u('admin'); adm uuid := t216.u('adminMin'); su uuid := t216.u('super'); ge uuid := t216.u('gerencia');
begin
  perform t216.afirma('F1 ventaB: su contrato sí', t221.ficha('authenticated', vb, 'DTM-6801') = 'DTM-6801:mayorista');
  perform t216.afirma('F2 ventaB: contrato de OTRO asesor (colega con homónimo), de otro tenant, sin asesor o inexistente: vacío',
    t221.ficha('authenticated', vb, 'DTM-6802') = '' and t221.ficha('authenticated', vb, 'MIN-68-0009') = ''
    and t221.ficha('authenticated', vb, 'DTM-6804') = '' and t221.ficha('authenticated', vb, '99-9999') = '');
  perform t216.afirma('F3 la respuesta para «ajeno» es IDÉNTICA byte a byte a la de «inexistente» y a la de «otro tenant»',
    t221.ficha_json('authenticated', vb, 'DTM-6802') = t221.ficha_json('authenticated', vb, '99-9999')
    and t221.ficha_json('authenticated', vb, 'MIN-68-0009') = t221.ficha_json('authenticated', vb, '99-9999')
    and t221.ficha_json('authenticated', vb, '99-9999') = '[]');
  perform t216.afirma('F4 administración de un tenant no ve contratos del otro',
    t221.ficha('authenticated', ad, 'MIN-68-0005') = '' and t221.ficha('authenticated', adm, 'DTM-6801') = ''
    and t221.ficha('authenticated', ge, 'MIN-68-0005') = '' and t221.ficha('authenticated', t221.u('gerenciaMin'), 'DTM-6801') = '');
  perform t216.afirma('F5 superadmin abre cualquiera de los dos tenants',
    t221.ficha('authenticated', su, 'DTM-6801') = 'DTM-6801:mayorista' and t221.ficha('authenticated', su, 'MIN-68-0005') = 'MIN-68-0005:minorista');
  perform t216.afirma('F6 entradas extremas: vacío, no error',
    t221.ficha('authenticated', ad, '') = '' and t221.ficha('authenticated', ad, repeat('9', 61)) = '' and t221.ficha('authenticated', ad, null) = ''
    and t221.ficha('authenticated', ad, 'DTM-6801'' or ''1''=''1') = '');
  perform t216.afirma('F7 la ficha no aplica comodines: un prefijo no encuentra nada', t221.ficha('authenticated', ad, 'DTM-680%') = '' and t221.ficha('authenticated', ad, 'DTM-680_') = '');
end $$;

-- ═══ S · búsqueda y paginación ═════════════════════════════════════════════
do $$
declare ad uuid := t216.u('admin'); vb uuid := t216.u('ventaB'); r text; p1 text; p2 text;
begin
  perform t216.afirma('S1 por nombre', t221.lista('authenticated', ad, null, 'Cliente68 Dos') = 'DTM-6802');
  perform t216.afirma('S2 por documento', t221.lista('authenticated', ad, null, '10000003') = 'DTM-6803');
  perform t216.afirma('S3 por correo', t221.lista('authenticated', ad, null, 'uno68@') = 'DTM-6801');
  perform t216.afirma('S4 por teléfono', t221.lista('authenticated', ad, null, '3000000007') = 'DTM-6807');
  perform t216.afirma('S5 por número de contrato', t221.lista('authenticated', ad, null, 'DTM-6806') = 'DTM-6806');
  perform t216.afirma('S6 los comodines son LITERALES: «100%_» solo encuentra el nombre que lo contiene; «1__», «%%%» y «___» no ensanchan',
    t221.lista('authenticated', ad, null, '100%_') = 'DTM-6808' and t221.lista('authenticated', ad, null, '1__') = ''
    and t221.lista('authenticated', ad, null, '%%%') = '' and t221.lista('authenticated', ad, null, '___') = ''
    and t221.lista('authenticated', ad, null, 'Cliente68 100%') = 'DTM-6808');
  perform t216.afirma('S7 búsqueda de 2 o de 101 caracteres: vacío (no error)',
    t221.lista('authenticated', ad, null, 'Cl') = '' and t221.lista('authenticated', ad, null, repeat('a', 101)) = '');
  perform t216.afirma('S7.1 100 caracteres: se acepta (sin coincidencias)', t221.lista('authenticated', ad, null, repeat('a', 100)) = '');
  p1 := t221.pagina('authenticated', ad, null, '   ');
  perform t216.afirma('S8 búsqueda en blanco = sin filtro: primera página de 50', p1 like '50|true|%', p1);

  perform t216.afirma('S9 venta NO encuentra datos ajenos por NINGÚN término (nombre, documento, correo, teléfono, número); igual que un término inexistente',
    t221.lista('authenticated', vb, null, 'Cliente68 Dos') = '' and t221.lista('authenticated', vb, null, '10000002') = ''
    and t221.lista('authenticated', vb, null, 'dos68@') = '' and t221.lista('authenticated', vb, null, '3000000002') = ''
    and t221.lista('authenticated', vb, null, 'DTM-6802') = '' and t221.lista('authenticated', vb, null, 'ZzNoExiste68') = ''
    and t221.lista('authenticated', vb, null, 'Pagina68') = '');
  perform t216.afirma('S9.1 sobre lo propio sí encuentra (documento, correo, teléfono)',
    t221.lista('authenticated', vb, null, '10000001') = 'DTM-6801' and t221.lista('authenticated', vb, null, 'tres68@') = 'DTM-6803'
    and t221.lista('authenticated', vb, null, '3000000007') = 'DTM-6807');

  -- Paginación por cursor sobre 55 contratos: sin repetir ni saltar.
  p1 := t221.pagina('authenticated', ad, null, 'Pagina68');
  p2 := t221.pagina('authenticated', ad, null, 'Pagina68', 'DTM-7005');
  perform t216.afirma('S10 primera página: 50 filas, hay más, de DTM-7005 a DTM-7054', p1 = '50|true|DTM-7005|DTM-7054', p1);
  perform t216.afirma('S10.1 segunda página con el cursor: 5 filas, sin más, de DTM-7000 a DTM-7004', p2 = '5|false|DTM-7000|DTM-7004', p2);
  perform t216.afirma('S10.2 sin solape: las 55 filas, una vez cada una',
    t216.escalar('authenticated', ad, 'select count(distinct numero_contrato) from (select numero_contrato from public.crm_contratos_clientes_buscar(null, ''Pagina68'', null, 50) union all select numero_contrato from public.crm_contratos_clientes_buscar(null, ''Pagina68'', ''DTM-7005'', 50)) x') = '55');
  perform t216.afirma('S11 p_tam: 0 se sube a 1; 1000 se baja a 50; nulo = 50',
    t221.pagina('authenticated', ad, null, 'Pagina68', null, 0) like '1|true|%' and t221.pagina('authenticated', ad, null, 'Pagina68', null, 1000) like '50|true|%'
    and t221.pagina('authenticated', ad, null, 'Pagina68', null, null) like '50|true|%');
  perform t216.afirma('S12 cursor de más de 60 caracteres: vacío; cursor alto no amplía el alcance de venta',
    t221.lista('authenticated', ad, null, 'Cliente68', repeat('z', 61)) = ''
    and t221.lista('authenticated', vb, null, 'Cliente68', 'zz') = 'DTM-6807,DTM-6803,DTM-6801');
  perform t216.afirma('S13 contrato cancelado e interno sin documento aparecen para administración',
    t221.lista('authenticated', ad, null, 'Siete') = 'DTM-6807');
end $$;

-- ═══ E · contrato de las funciones ════════════════════════════════════════
do $$
declare lista oid := to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)')::oid;
        ficha oid := to_regprocedure('public.crm_contrato_cliente_ficha(text)')::oid;
begin
  perform t216.afirma('E1 EXECUTE: authenticated sí; anon y service_role no',
    has_function_privilege('authenticated', lista, 'execute') and has_function_privilege('authenticated', ficha, 'execute')
    and not has_function_privilege('anon', lista, 'execute') and not has_function_privilege('anon', ficha, 'execute')
    and not has_function_privilege('service_role', lista, 'execute') and not has_function_privilege('service_role', ficha, 'execute'));
  perform t216.afirma('E2 la ficha tiene UN solo argumento y ninguno de tenant ni de usuario',
    (select pronargs from pg_proc where oid = ficha) = 1 and pg_get_function_arguments(ficha) = 'p_numero_contrato text');
  perform t216.afirma('E3 ninguna columna de precio, dirección, firma, share_token, costo ni comisión en el resultado',
    pg_get_function_result(lista) !~* '(precio|direccion|firma|share_token|costo|comision|asesor_firma)' and pg_get_function_result(ficha) !~* '(precio|direccion|firma|share_token|costo|comision|asesor_firma)'
    and pg_get_function_result(lista) !~* '\yasesor\y');
  perform t216.afirma('E4 SECURITY DEFINER, STABLE y search_path fijo en las dos',
    (select bool_and(prosecdef and provolatile = 's' and proconfig @> array['search_path=pg_catalog, pg_temp']) from pg_proc where oid in (lista, ficha)));
  perform t216.afirma('E5 las funciones no leen crm_contactos ni la tabla base ventas, ni usan los helpers de tenant como autoridad',
    not exists (select 1 from pg_proc p
                 where p.oid in (lista, ficha)
                   and (regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'crm_contactos|mi_tenant|puede_ver_tenant|public\.ventas[^_a-z]')));
end $$;

-- Cierre: ningún FALLO registrado.
do $$
declare n int; m int;
begin
  select count(*) filter (where not ok), count(*) into n, m from t216.res;
  if n > 0 then
    raise exception 'TEST 221 SQL: % FALLO(S) de % comprobaciones', n, m;
  end if;
  raise notice 'INFO  TEST 221 SQL: % comprobaciones', m;
end $$;

\echo 'TEST 221 SQL: TODO OK'
rollback;
