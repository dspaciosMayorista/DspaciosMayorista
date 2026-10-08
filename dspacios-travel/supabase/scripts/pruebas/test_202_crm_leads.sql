-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA · migración 202 (CRM leads) — comportamiento real, NO estructura.
--
-- Corre SOLO contra una base LOCAL DESECHABLE con la cadena 1→201 + 203 + 202
-- aplicada (NUNCA Supabase real ni un entorno compartido). Ver
-- supabase/scripts/pruebas/test_202_crm_leads.sh, que la monta y la borra.
--
-- Crea usuarios reales en `auth.users`/`usuarios` con los ocho roles del enum y
-- en las dos agencias, se pone en su lugar con `request.jwt.claims` y ejecuta
-- DML y RPC REALES como `authenticated`. Cada aserción que falle lanza
-- excepción y psql sale con código ≠ 0. Todo dentro de una transacción que
-- termina en ROLLBACK: no deja datos ni cambios de permisos.
--
-- Matriz cubierta: superadmin, gerencia, administracion, venta, operaciones,
-- control_vuelo, externos (agencia/freelance/cliente_final), lead sin
-- responsable, asignacion a tercero y aislamiento entre tenants. Seccion 10:
-- identidad documental = tipo + numero (mismo numero con otro tipo entra; mismo
-- tipo + numero se rechaza sin fusionar; telefono/correo compartidos solo
-- avisan; documento ausente; otra agencia; duplicado ajeno sin revelar su id).
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
begin;

set local client_min_messages = notice;

-- Aserciones -----------------------------------------------------------------
create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $fn$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $fn$;

-- Ejecuta SQL esperando que FRENE con un texto; si no falla, o falla con otro
-- texto, la aserción falla.
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns text language plpgsql as $fn$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
    if position(p_patron in v_err) > 0 then
      raise notice 'OK   % -> «%»', p_msg, v_err;
      return v_err;
    end if;
    raise exception 'FALLO: % (error inesperado: %)', p_msg, v_err;
  end;
  raise exception 'FALLO: % (no fallo)', p_msg;
end $fn$;

-- Sesion simulada: mismo claim `sub` que deja PostgREST.
create function pg_temp.como(p_uid text) returns void language sql as $fn$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$fn$;

-- Tabla auxiliar de ids. Va en un esquema propio y no en `pg_temp` porque la
-- prueba hace DML con el rol `authenticated`: una tabla temporal vive en un
-- esquema cuyo nombre cambia por sesión y no es granting-able de forma estable.
create schema _t202;
create table _t202.fx (clave text primary key, id bigint);
grant usage on schema _t202 to authenticated, anon;
grant select, insert on _t202.fx to authenticated, anon;

create function pg_temp.id(p text) returns bigint language sql stable as $fn$
  select id from _t202.fx where clave = p
$fn$;

-- `crm_lead_actualizar` exige el FORMULARIO COMPLETO (las once claves). Las
-- pruebas que solo quieren cambiar un dato arman el payload igual que la
-- pantalla: los valores actuales del lead + el cambio. Se lee la fila como el
-- propietario (SECURITY DEFINER) para que el payload no dependa de si el actor
-- que prueba puede verla: lo que se comprueba es la RPC, no este armado.
create function pg_temp.form(p_id bigint, p_cambios jsonb) returns jsonb
language sql stable security definer as $fn$
  select jsonb_build_object(
           'canal', l.canal, 'nombre', l.nombre, 'telefono', l.telefono, 'email', l.email,
           'tipo_doc', l.tipo_doc, 'documento', l.documento, 'interes', l.interes,
           'origen_detalle', l.origen_detalle, 'notas', l.notas,
           'responsable_id', l.responsable_id::text, 'proxima_accion_at', l.proxima_accion_at::text)
         || coalesce(p_cambios, '{}'::jsonb)
    from public.crm_leads l
   where l.id = p_id
$fn$;

-- ── Usuarios reales: los ocho roles y las dos agencias ──────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c201', 'super-may@local.test'),
  ('00000000-0000-0000-0000-00000000c202', 'ger-may@local.test'),
  ('00000000-0000-0000-0000-00000000c203', 'ger-min@local.test'),
  ('00000000-0000-0000-0000-00000000c204', 'adm-may@local.test'),
  ('00000000-0000-0000-0000-00000000c205', 'adm-min@local.test'),
  ('00000000-0000-0000-0000-00000000c206', 'venta-a-may@local.test'),
  ('00000000-0000-0000-0000-00000000c207', 'venta-b-may@local.test'),
  ('00000000-0000-0000-0000-00000000c208', 'venta-may-inactivo@local.test'),
  ('00000000-0000-0000-0000-00000000c209', 'venta-min@local.test'),
  ('00000000-0000-0000-0000-00000000c20a', 'ops-may@local.test'),
  ('00000000-0000-0000-0000-00000000c20b', 'ctrl-may@local.test'),
  ('00000000-0000-0000-0000-00000000c20c', 'agencia-ext@local.test'),
  ('00000000-0000-0000-0000-00000000c20d', 'freelance-ext@local.test'),
  ('00000000-0000-0000-0000-00000000c20e', 'cliente-final-ext@local.test');

update public.usuarios set rol = 'superadmin',    tenant = 'mayorista', activo = true,  nombre = 'Super'      where id = '00000000-0000-0000-0000-00000000c201';
update public.usuarios set rol = 'gerencia',      tenant = 'mayorista', activo = true,  nombre = 'G May'      where id = '00000000-0000-0000-0000-00000000c202';
update public.usuarios set rol = 'gerencia',      tenant = 'minorista', activo = true,  nombre = 'G Min'      where id = '00000000-0000-0000-0000-00000000c203';
update public.usuarios set rol = 'administracion', tenant = 'mayorista', activo = true,  nombre = 'A May'      where id = '00000000-0000-0000-0000-00000000c204';
update public.usuarios set rol = 'administracion', tenant = 'minorista', activo = true,  nombre = 'A Min'      where id = '00000000-0000-0000-0000-00000000c205';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true,  nombre = 'Venta A'    where id = '00000000-0000-0000-0000-00000000c206';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true,  nombre = 'Venta B'    where id = '00000000-0000-0000-0000-00000000c207';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = false, nombre = 'Venta Off'  where id = '00000000-0000-0000-0000-00000000c208';
update public.usuarios set rol = 'venta',         tenant = 'minorista', activo = true,  nombre = 'Venta Min'  where id = '00000000-0000-0000-0000-00000000c209';
update public.usuarios set rol = 'operaciones',   tenant = 'mayorista', activo = true,  nombre = 'Ops'        where id = '00000000-0000-0000-0000-00000000c20a';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true,  nombre = 'Ctrl'       where id = '00000000-0000-0000-0000-00000000c20b';
update public.usuarios set rol = 'agencia',       tenant = 'mayorista', activo = true,  nombre = 'Agencia'    where id = '00000000-0000-0000-0000-00000000c20c';
update public.usuarios set rol = 'freelance',     tenant = 'mayorista', activo = true,  nombre = 'Freelance'  where id = '00000000-0000-0000-0000-00000000c20d';
update public.usuarios set rol = 'cliente_final', tenant = 'mayorista', activo = true,  nombre = 'Cliente'    where id = '00000000-0000-0000-0000-00000000c20e';

-- ── Escenario, montado SIENDO superadmin y por su RPC ──────────────────────
--  · L1 sin responsable, mayorista
--  · L2 sin responsable, MINORISTA (para el aislamiento entre agencias)
--  · L3 con responsable (venta A), mayorista
--  · L4 sin responsable, mayorista (el que compiten los dos asesores)
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
set local role authenticated;

select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'whatsapp', 'nombre', 'Lead L1 sin dueno',
  'telefono', '3001110001', 'notas', 'Primera nota')) as _;
insert into _t202.fx select 'l1', id from public.crm_leads where nombre = 'Lead L1 sin dueno';

select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'canal', 'instagram', 'nombre', 'Lead L2 minorista',
  'telefono', '3002220002')) as _;
insert into _t202.fx select 'l2', id from public.crm_leads where nombre = 'Lead L2 minorista';

select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'whatsapp', 'nombre', 'Lead L3 asignado',
  'telefono', '3003330003', 'responsable_id', '00000000-0000-0000-0000-00000000c206')) as _;
insert into _t202.fx select 'l3', id from public.crm_leads where nombre = 'Lead L3 asignado';

select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'whatsapp', 'nombre', 'Lead L4 sin dueno',
  'telefono', '3004440004')) as _;
insert into _t202.fx select 'l4', id from public.crm_leads where nombre = 'Lead L4 sin dueno';

select pg_temp.ok((select count(*) = 4 from public.crm_leads), 'superadmin crea cuatro leads (dos agencias)');
select pg_temp.ok((select count(*) = 4 from public.crm_lead_actividades),
  'cada alta deja su actividad: 4 filas, sin duplicados');

-- ── 1. La auditoría genérica solo se instala en las tablas del CRM ─────────
select pg_temp.ok(not exists (
    select 1 from pg_trigger
     where not tgisinternal
       and tgname = 'trg_auditoria'
       and tgrelid in ('public.tarifa_hotel_historial'::regclass, 'public.hotel_temporadas_historial'::regclass)),
  'los historiales de la 203 siguen SIN trg_auditoria tras aplicar la 202');
select pg_temp.ok((select count(*) = 2 from pg_trigger
                    where not tgisinternal and tgname = 'trg_auditoria'
                      and tgrelid in ('public.crm_leads'::regclass, 'public.crm_lead_actividades'::regclass)),
  'trg_auditoria quedo en las DOS tablas de la 202 y en ninguna mas');

-- ── 2. superadmin ve las dos agencias ──────────────────────────────────────
select pg_temp.ok((select count(*) = 4 from public.crm_leads), 'superadmin ve los leads de ambas agencias');
select pg_temp.ok((select count(*) = 4 from public.crm_lead_actividades), 'y ve la bitacora de los cuatro');
select pg_temp.ok((select count(*) = 4 from public.auditoria
                    where tabla = 'crm_leads' and accion = 'INSERT'),
  'los cuatro altas quedan auditadas por fn_auditoria');

-- ── 3. gerencia: alcada transversal (misma regla que `puede_ver_tenant`) y
--      reasignación dentro de la agencia del lead ────────────────────────────
select pg_temp.como('00000000-0000-0000-0000-00000000c202');
select pg_temp.ok((select count(*) = 4 from public.crm_leads),
  'gerencia mayorista ve las dos agencias, igual que el resto del producto');
select public.crm_lead_actualizar(pg_temp.id('l1'), pg_temp.form(pg_temp.id('l1'), jsonb_build_object('responsable_id', '00000000-0000-0000-0000-00000000c207')));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c207'
                    from public.crm_leads where id = pg_temp.id('l1')),
  'gerencia reasigna a un asesor de la agencia del lead');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l1') and tipo = 'reasignacion'),
  'la reasignacion deja UNA actividad de tipo reasignacion');

select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select pg_temp.ok((select count(*) = 4 from public.crm_leads),
  'gerencia minorista tiene la misma alcada transversal');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c206'')))', pg_temp.id('l2')),
  'misma agencia',
  'gerencia tampoco puede asignar entre agencias: el responsable debe ser del tenant del lead');

-- ── 4. administracion: acotado a su tenant ────────────────────────────────
select pg_temp.como('00000000-0000-0000-0000-00000000c204');
select pg_temp.ok((select count(*) = 3 from public.crm_leads),
  'administracion mayorista ve los 3 leads de mayorista (y solo esos)');
select pg_temp.ok((select count(*) = 0 from public.crm_leads where tenant = 'minorista'),
  'administracion mayorista no ve el lead de minorista');
select pg_temp.ok((select public.crm_lead_puede_ver('minorista', null) = false),
  'y el helper de vista lo confirma para minorista');

select pg_temp.como('00000000-0000-0000-0000-00000000c205');
select pg_temp.ok((select count(*) = 1 from public.crm_leads), 'administracion minorista ve 1 lead, el suyo');
select pg_temp.ok((select public.crm_lead_puede_ver('mayorista', null) = false),
  'y no puede ver mayorista');
select pg_temp.falla(
  format('select public.crm_lead_cambiar_etapa(%s,''calificado'')', pg_temp.id('l1')),
  'Lead no encontrado o sin permiso',
  'administracion de una agencia no toca leads de la otra');

-- ── 5. operacion y control_vuelo quedan fuera del módulo ───────────────────
select pg_temp.como('00000000-0000-0000-0000-00000000c20a');
select pg_temp.ok((select count(*) = 0 from public.crm_leads), 'operaciones no ve ningun lead');
-- El rol se rechaza en `crm_lead_actor()`, antes de mirar el tenant: el mensaje
-- es el de rol, no el de agencia.
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''X'',''canal'',''otro''))',
  'Tu rol no tiene acceso',
  'operaciones no puede crear leads');

select pg_temp.como('00000000-0000-0000-0000-00000000c20b');
select pg_temp.ok((select count(*) = 0 from public.crm_leads), 'control_vuelo no ve ningun lead');
select pg_temp.falla(
  format('select public.crm_lead_registrar_actividad(%s,''nota'',''hola'',null)', pg_temp.id('l2')),
  'Tu rol no tiene acceso',
  'control_vuelo no registra actividad');

-- ── 6. externos: sin lectura ni escritura ──────────────────────────────────
-- Los ids se leen ANTES de convertirse en `authenticated`: en Supabase real
-- `auth.users` no es legible por la API, y la prueba no debe depender de eso.
do $fn$
declare
  v_externos text[] := array[
    '00000000-0000-0000-0000-00000000c20c',
    '00000000-0000-0000-0000-00000000c20d',
    '00000000-0000-0000-0000-00000000c20e'
  ];
  v_uid text;
begin
  foreach v_uid in array v_externos loop
    perform pg_temp.como(v_uid);
    perform pg_temp.ok((select count(*) = 0 from public.crm_leads),
      'externo ' || v_uid || ' no ve ningun lead');
  end loop;
end $fn$;
select pg_temp.como('00000000-0000-0000-0000-00000000c20c');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('l2')),
  'Tu rol no tiene acceso',
  'externo no puede tomar un lead');

-- ── 7. venta: ve los sin responsable y los suyos, y puede tomar ───────────
-- Estado: L1 es de venta B (lo reasigno gerencia), L2 sin responsable en
-- minorista, L3 es de venta A, L4 sin responsable en mayorista.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.ok((select count(*) = 2 from public.crm_leads),
  'venta A ve su lead y el sin responsable de su agencia; no ve el de venta B');
select pg_temp.ok((select count(*) = 0 from public.crm_leads where id = pg_temp.id('l2')),
  'venta mayorista no ve el lead de minorista aunque este sin responsable');

-- Toma el lead sin responsable: es el bloqueo 2 del PR, el asesor ve leads sin
-- dueño y no podia apropiarselos.
select public.crm_lead_tomar(pg_temp.id('l4'));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c206'
                    from public.crm_leads where id = pg_temp.id('l4')),
  'venta A toma el lead sin responsable de su agencia');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'reasignacion'),
  'tomar deja una sola actividad de reasignacion');

-- Una vez tomado, no puede quitarselo ni pasarselo a otro asesor.
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c207'')))', pg_temp.id('l4')),
  'No puedes cambiar el responsable',
  'venta A no puede pasarle su lead a venta B');

select pg_temp.como('00000000-0000-0000-0000-00000000c207');
select pg_temp.ok((select count(*) = 1 from public.crm_leads),
  'venta B solo ve el lead que ya tenia: L4 ya no esta sin responsable');
select pg_temp.ok(not has_function_privilege('authenticated',
                    'public.crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text)', 'EXECUTE'),
  'el helper de transición de responsable es interno: no se puede consultar');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('l4')),
  'ya tiene responsable o no te corresponde',
  'un asesor no puede tomar un lead que ya tiene responsable');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('l3')),
  'ya tiene responsable o no te corresponde',
  'un asesor no puede robar el lead de otro asesor');
-- Que el lead del otro asesor siga siendo suyo se comprueba arriba, con
-- superadmin: desde la sesion de venta B la RLS ni siquiera deja verlo, asi que
-- un SELECT aqui seria cero filas por RLS, no por exito.

-- Venta no puede crear en la otra agencia ni asignar a un tercero.
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''tenant'',''minorista'',''nombre'',''Intruso'',''canal'',''otro''))',
  'No puedes crear leads',
  'venta mayorista no crea leads en minorista');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Nuevo'',''canal'',''otro'',''responsable_id'',''00000000-0000-0000-0000-00000000c206''))',
  'No puedes crear leads',
  'venta no puede crear un lead asignado a otra persona');

-- Usuario inactivo: sin rol, fuera.
select pg_temp.como('00000000-0000-0000-0000-00000000c208');
select pg_temp.ok((select count(*) = 0 from public.crm_leads), 'usuario venta inactivo no ve leads');
-- Un usuario desactivado no tiene rol: lo detiene `crm_lead_actor()` antes de
-- mirar el lead, con su propio mensaje.
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('l2')),
  'Sesion no valida',
  'usuario inactivo no puede tomar leads');

-- ── 7b. Tomar: el actor debe ser responsable VALIDO de la agencia del lead ──
-- Tomarse un lead a si mismo no es una excepcion a la regla del responsable:
-- superadmin y gerencia tienen alcada transversal para VER las dos agencias, y
-- `permite_cambiar_responsable`/`permite_ver` les dan verde, asi que sin el
-- `crm_lead_responsable_valido` en el WHERE se quedaban como responsables de
-- leads de la otra agencia. Cada caso usa un lead sin responsable recien creado,
-- para que el rechazo no dependa del estado que dejaron los casos anteriores.
-- Los fixtures se crean como superadmin, con su propia sesion: el paso anterior
-- termino en un usuario inactivo y `reset role` no cambia el claim.
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
set local role authenticated;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'otro', 'nombre', 'Toma mayorista')) as _;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'canal', 'otro', 'nombre', 'Toma minorista')) as _;
insert into _t202.fx select 'toma_may', id from public.crm_leads where nombre = 'Toma mayorista';
insert into _t202.fx select 'toma_min', id from public.crm_leads where nombre = 'Toma minorista';

-- superadmin: ve las dos agencias, pero NO puede tomar ninguna. Su rol no esta
-- en la lista comercial de `crm_lead_responsable_valido`, asi que tomarse un
-- lead lo dejaria como responsable de algo que su rol no cubre. Puede ver y
-- puede reasignar al equipo correcto; tomar es para el equipo comercial.
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.ok((select count(*) = 1 from public.crm_leads where id = pg_temp.id('toma_min')),
  'superadmin ve el lead sin responsable de minorista');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('toma_min')),
  'ya tiene responsable o no te corresponde',
  'superadmin no puede tomar un lead de la OTRA agencia');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('toma_may')),
  'ya tiene responsable o no te corresponde',
  'superadmin tampoco puede tomar un lead de SU agencia: su rol no es comercial');
select pg_temp.ok((select bool_and(responsable_id is null) from public.crm_leads
                    where id in (pg_temp.id('toma_min'), pg_temp.id('toma_may'))),
  'ninguno de los dos rechazo dejo a superadmin como responsable');

-- gerencia de la otra agencia: mismo caso que superadmin, con la alcada
-- transversal propia de gerencia (ve ambas agencias). Gerencia MINORISTA contra
-- un lead de MAYORISTA: su rol le da verde en la transición y en la visibilidad,
-- pero su tenant no es el del lead, así que no puede quedarse con él.
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
set local role authenticated;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'otro', 'nombre', 'Toma gerencia cruzada')) as _;
insert into _t202.fx select 'toma_ger', id from public.crm_leads where nombre = 'Toma gerencia cruzada';
reset role;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select pg_temp.ok((select count(*) = 1 from public.crm_leads where id = pg_temp.id('toma_ger')),
  'gerencia minorista ve el lead sin responsable de la OTRA agencia');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('toma_ger')),
  'ya tiene responsable o no te corresponde',
  'gerencia no puede tomar un lead de la OTRA agencia');
select pg_temp.ok((select responsable_id is null from public.crm_leads where id = pg_temp.id('toma_ger')),
  'el rechazo no dejo a gerencia como responsable cruzado');

-- gerencia y administracion de la agencia del lead: si pueden.
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
set local role authenticated;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'canal', 'otro', 'nombre', 'Toma equipo minorista')) as _;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'mayorista', 'canal', 'otro', 'nombre', 'Toma equipo mayorista')) as _;
insert into _t202.fx select 'toma_equ_min', id from public.crm_leads where nombre = 'Toma equipo minorista';
insert into _t202.fx select 'toma_equ_may', id from public.crm_leads where nombre = 'Toma equipo mayorista';

select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select public.crm_lead_tomar(pg_temp.id('toma_equ_min'));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c203'
                    from public.crm_leads where id = pg_temp.id('toma_equ_min')),
  'gerencia de la agencia si puede tomar un lead sin responsable de su agencia');

select pg_temp.como('00000000-0000-0000-0000-00000000c205');
select public.crm_lead_tomar(pg_temp.id('toma_min'));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c205'
                    from public.crm_leads where id = pg_temp.id('toma_min')),
  'administracion de la agencia si puede tomar un lead sin responsable de su agencia');

select pg_temp.como('00000000-0000-0000-0000-00000000c202');
select public.crm_lead_tomar(pg_temp.id('toma_equ_may'));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c202'
                    from public.crm_leads where id = pg_temp.id('toma_equ_may')),
  'gerencia de mayorista toma el lead de mayorista');

-- Cada toma valida rol y tenant a la vez; se comprueba tambien que administracion
-- de una agencia no toma en la otra.
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
set local role authenticated;
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'canal', 'otro', 'nombre', 'Toma admin cruzada')) as _;
insert into _t202.fx select 'toma_adm', id from public.crm_leads where nombre = 'Toma admin cruzada';
reset role;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c204');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('toma_adm')),
  'ya tiene responsable o no te corresponde',
  'administracion tampoco puede tomar un lead de la otra agencia');
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.falla(
  format('select public.crm_lead_tomar(%s)', pg_temp.id('toma_adm')),
  'ya tiene responsable o no te corresponde',
  'venta tampoco puede tomar un lead de la otra agencia');
-- Que el lead sigue sin dueño se comprueba con superadmin: desde la sesion de
-- venta A la RLS ni siquiera deja ver esa fila, asi que un SELECT ahi seria
-- cero filas por RLS y no probaria nada sobre la toma.
reset role;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.ok((select responsable_id is null from public.crm_leads where id = pg_temp.id('toma_adm')),
  'ninguno de los tres roles dejo tomado el lead desde la otra agencia');

-- Y el criterio es inaccesible desde la sesion: `crm_lead_responsable_valido` y
-- `crm_lead_permite_cambiar_responsable` se ejecutan DENTRO del UPDATE
-- condicional, no se consultan. Que no sean consultables es parte del diseño:
-- si lo fueran, un cliente podria mapear la matriz de permisos del modulo.
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.falla(
  'select public.crm_lead_responsable_valido(''00000000-0000-0000-0000-00000000c201'', ''minorista'')',
  'permission denied for function',
  'el criterio de responsable valido no es consultable desde la sesion');
select pg_temp.falla(
  'select public.crm_lead_permite_cambiar_responsable(''minorista'', null, ''00000000-0000-0000-0000-00000000c201'', ''00000000-0000-0000-0000-00000000c201'', ''superadmin'', ''mayorista'')',
  'permission denied for function',
  'la matriz de transicion tampoco: superadmin tiene alcada transversal pero su rol no es comercial');

-- ── 8. El responsable tiene que ser del MISMO tenant del lead ───────────────
-- Se prueba por la RPC de escritura y también por DML directo: con el privilegio
-- de tabla restituido a propósito, para que se vea que la BASE lo rechaza y no
-- solo que el permiso falta (el caso normal está en 13b: sin privilegio).
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c209'')))', pg_temp.id('l3')),
  'misma agencia',
  'ni superadmin asigna a un venta de minorista un lead de mayorista');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c206'')))', pg_temp.id('l2')),
  'misma agencia',
  'un lead de minorista no admite un responsable de mayorista');
select pg_temp.ok((select responsable_id is null from public.crm_leads where id = pg_temp.id('l2')),
  'los rechazos entre agencias no dejaron responsable en ningun lado');

-- DML directo (sin RPC), con el privilegio restituido a propósito: la validación
-- del tenant tiene que estar en el dato, no solo en el permiso. El caso normal
-- —sin privilegio— está en 13b.
--
-- Con solo policies de SELECT, un UPDATE no da error: la RLS filtra la fila y
-- afecta cero. Eso ya es un denegado (nada cambia), y el mensaje "row-level
-- security" solo aparece en el INSERT, donde la policy de escritura es la que
-- revisa la fila nueva.
reset role;
grant insert, update on public.crm_leads to authenticated;
-- La secuencia también hace falta para un INSERT: `authenticated` no la tiene
-- (solo la usan las RPC), así que se restituye aquí para poder llegar a la policy.
grant usage, select on sequence public.crm_leads_id_seq to authenticated;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
-- Y se restituye también el de actividades, para comprobar que la política de
-- lectura es la unica que queda y que un INSERT directo no la atraviesa.
do $fn$
declare v_filas integer;
begin
  update public.crm_leads
     set responsable_id = '00000000-0000-0000-0000-00000000c206'
   where id = pg_temp.id('l2');
  get diagnostics v_filas = row_count;
  perform pg_temp.ok(v_filas = 0,
    'UPDATE directo asignando entre agencias: la RLS filtra la fila (cero filas)');
end $fn$;
select pg_temp.ok((select responsable_id is null from public.crm_leads where id = pg_temp.id('l2')),
  'el UPDATE directo rechazado no dejo el responsable cambiado');

-- Alta directa con responsable de otra agencia: aquí sí hay una policy que
-- revisa la fila nueva, y el error lo delata.
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, responsable_id) values (''minorista'', ''otro'', ''Lead cruzado'', ''00000000-0000-0000-0000-00000000c206'')',
  'row-level security',
  'INSERT directo con responsable de otra agencia: la RLS lo rechaza');
reset role;
revoke insert, update on public.crm_leads from authenticated;
revoke all on sequence public.crm_leads_id_seq from authenticated;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');

-- Los intentos de la sección 7 no movieron nada.
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c206'
                    from public.crm_leads where id = pg_temp.id('l3')),
  'el lead de venta A sigue siendo suyo tras los intentos de venta B');
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c206'
                    from public.crm_leads where id = pg_temp.id('l4')),
  'y el lead tomado por venta A sigue siendo suyo');

-- Y el caso válido: responsable del mismo tenant sí pasa. Se hace con L2, que
-- sigue sin responsable; así L3 conserva su reasignación de la sección 7.
select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select public.crm_lead_actualizar(pg_temp.id('l2'), pg_temp.form(pg_temp.id('l2'), jsonb_build_object('responsable_id', '00000000-0000-0000-0000-00000000c209')));
select pg_temp.ok((select responsable_id = '00000000-0000-0000-0000-00000000c209'
                    from public.crm_leads where id = pg_temp.id('l2')),
  'gerencia minorista si asigna a un venta de SU agencia');

-- Roles no comerciales y usuarios inactivos no son responsables validos.
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c20a'')))', pg_temp.id('l3')),
  'misma agencia',
  'operaciones no puede ser responsable de un lead');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c208'')))', pg_temp.id('l3')),
  'misma agencia',
  'un venta inactivo no puede ser responsable');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c20b'')))', pg_temp.id('l3')),
  'misma agencia',
  'control_vuelo no puede ser responsable de un lead');

-- ── 9. Cambio de negocio y bitácora en la misma operación ─────────────────
-- Se trabaja sobre L4: es de venta A y su unica reasignacion es la de "tomar".
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'reasignacion'),
  'L4 tiene exactamente una actividad de reasignacion (la de tomarlo)');

-- Guardar SIN cambiar el responsable no debe crear otra reasignacion.
select public.crm_lead_actualizar(pg_temp.id('l4'), pg_temp.form(pg_temp.id('l4'), jsonb_build_object(
  'nombre', 'Lead L4 sin dueno', 'canal', 'whatsapp',
  'telefono', '3004440004', 'responsable_id', '00000000-0000-0000-0000-00000000c206')));
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'reasignacion'),
  'guardar sin cambiar de responsable NO duplica la actividad de reasignacion');

-- Un rechazo no deja rastro.
select pg_temp.falla(
  format('select public.crm_lead_cambiar_etapa(%s,''inventada'')', pg_temp.id('l4')),
  'Etapa invalida',
  'etapa inexistente: validacion');
select pg_temp.ok((select etapa = 'nuevo' from public.crm_leads where id = pg_temp.id('l4')),
  'tras el rechazo la etapa sigue como estaba');

-- Cambio de etapa: una sola bitacora, con el antes y el despues.
select public.crm_lead_cambiar_etapa(pg_temp.id('l4'), 'en_contacto');
select pg_temp.ok((select etapa = 'en_contacto' and cerrado_at is null
                    from public.crm_leads where id = pg_temp.id('l4')),
  'cambio de etapa actualiza la fila y no cierra el lead');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'cambio_etapa'
                      and cuerpo like '%nuevo -> en_contacto%'),
  'la bitacora del cambio de etapa existe UNA vez');

-- Repetir la misma etapa no duplica nada.
select public.crm_lead_cambiar_etapa(pg_temp.id('l4'), 'en_contacto');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'cambio_etapa'),
  'repetir la misma etapa NO duplica la bitacora');

-- Cierre: etapa terminal con cerrado_at y actividad de tipo cierre.
select public.crm_lead_cambiar_etapa(pg_temp.id('l4'), 'archivado');
select pg_temp.ok((select etapa = 'archivado' and cerrado_at is not null
                    from public.crm_leads where id = pg_temp.id('l4')),
  'archivar sella cerrado_at');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'cierre'),
  'el cierre deja una sola actividad de tipo cierre');

-- Actividad con proxima accion: la nota y el cambio del lead son la MISMA operacion.
select pg_temp.falla(
  format('select public.crm_lead_registrar_actividad(%s,''nota'','''',''2026-12-01T09:00:00Z'')', pg_temp.id('l4')),
  'La actividad necesita una nota',
  'actividad sin cuerpo: validacion, no escribe nada');
select pg_temp.ok((select count(*) = 0 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and coalesce(cuerpo, '') = ''),
  'no se guardo ninguna actividad vacia');

select public.crm_lead_registrar_actividad(
  pg_temp.id('l4'), 'llamada', 'Se confirmo la reserva por telefono.', '2026-12-01T09:00:00Z');
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l4') and tipo = 'llamada'),
  'la llamada quedo registrada');
select pg_temp.ok((select proxima_accion_at = '2026-12-01 09:00:00+00'::timestamptz
                    from public.crm_leads where id = pg_temp.id('l4')),
  'y la proxima accion del lead quedo actualizada en la MISMA operacion');

-- La coherencia se comprueba con un rechazo de verdad: si el lead desaparece
-- (por una via privilegiada, fuera del alcance de la app y de la RLS), la
-- actividad tampoco puede quedar guardada anunciando algo que no ocurrio.
-- El borrado forzado se hace como propietario de la tabla y con el trigger
-- anti-delete desactivado a proposito: la app no tiene esa via.
reset role;
alter table public.crm_leads disable trigger trg_crm_leads_bloquear_delete;
-- El ON DELETE CASCADE de la bitacora dispara su propio trigger append-only.
alter table public.crm_lead_actividades disable trigger trg_crm_lead_actividades_append_only_delete;
delete from public.crm_leads where id = pg_temp.id('l4');
alter table public.crm_leads enable trigger trg_crm_leads_bloquear_delete;
alter table public.crm_lead_actividades enable trigger trg_crm_lead_actividades_append_only_delete;
set local role authenticated;
select pg_temp.falla(
  format('select public.crm_lead_registrar_actividad(%s,''nota'',''nota huerfana'',''2026-12-02T09:00:00Z'')', pg_temp.id('l4')),
  'Lead no encontrado o sin permiso',
  'actividad sobre lead inexistente: falla en vez de devolver exito');
select pg_temp.ok(
  not exists (select 1 from public.crm_lead_actividades where cuerpo = 'nota huerfana'),
  'no quedo ninguna actividad huerfana');

-- Cero filas afectadas nunca es exito: sobre un lead que el actor NO puede ver,
-- la RLS filtra la fila y la funcion debe decirlo, no confirmar el cambio.
select pg_temp.como('00000000-0000-0000-0000-00000000c20b');
select pg_temp.falla(
  format('select public.crm_lead_cambiar_etapa(%s,''calificado'')', pg_temp.id('l1')),
  'Tu rol no tiene acceso',
  'control_vuelo no cambia la etapa de un lead ajeno');

-- ── 10. Identidad documental (tipo + número) y coincidencias que no bloquean ─
-- Regla del dueño: la identidad documental es la pareja TIPO + NÚMERO. Mismo
-- tenant + mismo tipo + mismo número se rechaza (sin fusionar); el mismo número
-- con otro tipo es OTRA persona y entra. Teléfono y correo pueden compartirlos
-- varias personas: solo sugieren una coincidencia, nunca bloquean.

-- 10a. Teléfono compartido en el mismo tenant: entra, y la RPC avisa.
-- Venta A ve L3 (es suyo), así que el aviso puede nombrarlo.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'nombre', 'Hermana de L3', 'canal', 'whatsapp', 'telefono', '300 333 0003'));
  perform pg_temp.ok((r->>'id') is not null,
    'telefono repetido en el mismo tenant: el alta ENTRA (no es identidad)');
  perform pg_temp.ok(r->'coincidencias' @> jsonb_build_array(
      jsonb_build_object('id', pg_temp.id('l3'), 'por', jsonb_build_array('telefono'))),
    'y la RPC sugiere L3 como coincidencia por telefono');
  insert into _t202.fx values ('hermana', (r->>'id')::bigint);
end $fn$;
select pg_temp.ok((select count(*) = 2 from public.crm_leads
                    where telefono_norm = '573003330003' and tenant = 'mayorista'),
  'quedan DOS leads con el mismo telefono en mayorista: nada se fusiono');

-- 10b. Correo compartido (normalizado a minúsculas): entra, con aviso.
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select public.crm_lead_crear(jsonb_build_object(
  'nombre', 'Lead con correo', 'canal', 'otro', 'email', 'Familia@Local.Test')) as _;
insert into _t202.fx select 'correo1', id from public.crm_leads where nombre = 'Lead con correo';
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'nombre', 'Otro de la familia', 'canal', 'otro', 'email', 'FAMILIA@LOCAL.TEST'));
  perform pg_temp.ok((r->>'id') is not null,
    'correo repetido (normalizado) en el mismo tenant: el alta ENTRA');
  perform pg_temp.ok(r->'coincidencias' @> jsonb_build_array(
      jsonb_build_object('id', pg_temp.id('correo1'), 'por', jsonb_build_array('email'))),
    'y la RPC sugiere el lead con ese correo');
end $fn$;

-- 10c. Mismo tenant + mismo tipo + mismo número: se rechaza diciendo cuál es.
-- El titular lo crea superadmin sin responsable, así que venta A lo ve.
select public.crm_lead_crear(jsonb_build_object(
  'nombre', 'Titular CC', 'canal', 'whatsapp', 'tipo_doc', 'CC', 'documento', '1.020.304')) as _;
insert into _t202.fx select 'titular', id from public.crm_leads where nombre = 'Titular CC';
select pg_temp.ok((select tipo_doc = 'CC' and documento_norm = '1020304'
                    from public.crm_leads where id = pg_temp.id('titular')),
  'el tipo se guarda como codigo de catalogo y el numero normalizado');

select pg_temp.como('00000000-0000-0000-0000-00000000c206');
-- Tipo y número escritos distinto (" c.c. " y sin puntos) normalizan igual.
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Copia del titular'',''canal'',''otro'',''tipo_doc'','' c.c. '',''documento'',''1020304''))',
  'crm_lead_duplicado:' || pg_temp.id('titular'),
  'mismo tenant + mismo tipo + mismo numero (normalizados): rechazado diciendo cual lead es');
select pg_temp.ok((select count(*) = 1 from public.crm_leads
                    where tenant = 'mayorista' and tipo_doc = 'CC' and documento_norm = '1020304'),
  'sigue habiendo UN solo lead CC 1020304 en mayorista');
select pg_temp.ok((select nombre = 'Titular CC' from public.crm_leads where id = pg_temp.id('titular')),
  'el rechazo no fusiono ni toco el lead existente');

-- 10d. Mismo número con OTRO tipo: es otra persona, entra (con aviso).
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'nombre', 'Hijo con TI', 'canal', 'otro', 'tipo_doc', 'TI', 'documento', '1020304'));
  perform pg_temp.ok((r->>'id') is not null,
    'mismo numero con DISTINTO tipo en el mismo tenant: el alta ENTRA');
  perform pg_temp.ok(r->'coincidencias' @> jsonb_build_array(
      jsonb_build_object('id', pg_temp.id('titular'), 'por', jsonb_build_array('numero_documento'))),
    'y la RPC sugiere el lead con el mismo numero y otro tipo');
  insert into _t202.fx values ('hijo_ti', (r->>'id')::bigint);
end $fn$;
select pg_temp.ok((select count(*) = 2 from public.crm_leads
                    where tenant = 'mayorista' and documento_norm = '1020304'),
  'conviven CC 1020304 y TI 1020304 en la misma agencia');

-- 10e. Mismo tipo + número en la OTRA agencia: no es duplicado (aislamiento).
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.ok(public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'nombre', 'Titular CC en minorista', 'canal', 'otro',
  'tipo_doc', 'CC', 'documento', '1020304')) is not null,
  'el mismo CC 1020304 en la OTRA agencia no es duplicado');
-- El mismo teléfono en la otra agencia tampoco es coincidencia: el aviso no
-- cruza agencias.
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'tenant', 'minorista', 'nombre', 'Mismo telefono en minorista', 'canal', 'whatsapp',
    'telefono', '3003330003'));
  perform pg_temp.ok(r->'coincidencias' = '[]'::jsonb,
    'un telefono de la otra agencia no aparece como coincidencia');
end $fn$;

-- 10f. Documento incompleto: número sin tipo (no se asume CC), tipo sin número,
-- tipo fuera del catálogo y "número" sin letras ni dígitos. Nada se guarda.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Sin tipo'',''canal'',''otro'',''documento'',''55443322''))',
  'Indica el tipo de documento',
  'numero sin tipo: rechazado, no se asume CC');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Solo tipo'',''canal'',''otro'',''tipo_doc'',''CC''))',
  'Escribe el numero de documento',
  'tipo sin numero: rechazado');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Tipo raro'',''canal'',''otro'',''tipo_doc'',''XX'',''documento'',''123''))',
  'Tipo de documento invalido',
  'tipo fuera del catalogo: rechazado');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''Numero vacio'',''canal'',''otro'',''tipo_doc'',''CC'',''documento'',''.-.''))',
  'debe tener letras o digitos',
  'numero sin letras ni digitos: rechazado');
select pg_temp.ok(not exists (select 1 from public.crm_leads
                               where nombre in ('Sin tipo', 'Solo tipo', 'Tipo raro', 'Numero vacio')),
  'ningun alta con documento incompleto quedo guardada');

-- 10g. Sin documento: el lead sigue existiendo sin tipo ni número.
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object('nombre', 'Sin documento todavia', 'canal', 'instagram'));
  perform pg_temp.ok(exists (select 1 from public.crm_leads
                              where id = (r->>'id')::bigint and tipo_doc is null and documento is null),
    'un lead sin documento se crea sin tipo ni numero');
end $fn$;

-- 10h. Edición: llevar el TI al mismo CC del titular se rechaza y no cambia nada;
-- guardar el propio documento sin cambios no choca consigo mismo.
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''nombre'',''Hijo con TI'',''canal'',''otro'',''tipo_doc'',''CC'',''documento'',''1020304'')))', pg_temp.id('hijo_ti')),
  'crm_lead_duplicado:' || pg_temp.id('titular'),
  'editar a un tipo+numero que ya tiene otro lead del tenant: rechazado');
select pg_temp.ok((select tipo_doc = 'TI' from public.crm_leads where id = pg_temp.id('hijo_ti')),
  'el rechazo dejo el lead editado con su tipo original');
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_actualizar(pg_temp.id('hijo_ti'), pg_temp.form(pg_temp.id('hijo_ti'), jsonb_build_object(
    'nombre', 'Hijo con TI', 'canal', 'otro', 'tipo_doc', 'TI', 'documento', '1.020.304')));
  perform pg_temp.ok((r->>'id')::bigint = pg_temp.id('hijo_ti'),
    'guardar el mismo documento del propio lead no choca consigo mismo');
  perform pg_temp.ok(not (r->'coincidencias' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('hijo_ti')))),
    'un lead nunca aparece como coincidencia de si mismo');
end $fn$;
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''nombre'',''Hijo con TI'',''canal'',''otro'',''tipo_doc'','''',''documento'',''1020304'')))', pg_temp.id('hijo_ti')),
  'Indica el tipo de documento',
  'editar quitando el tipo y dejando el numero: rechazado');

-- 10i. Duplicado de OTRO asesor: el rechazo existe, pero sin revelar su id; y
-- un correo compartido con ese lead tampoco aparece como coincidencia.
select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select public.crm_lead_crear(jsonb_build_object(
  'tenant', 'minorista', 'nombre', 'Lead privado', 'canal', 'otro',
  'email', 'privado@minorista.test', 'tipo_doc', 'PAS', 'documento', 'AB123',
  'responsable_id', '00000000-0000-0000-0000-00000000c203')) as _;
select pg_temp.como('00000000-0000-0000-0000-00000000c209');
select pg_temp.ok((select count(*) = 0 from public.crm_leads where email = 'privado@minorista.test'),
  'venta minorista no ve el lead privado');
select pg_temp.ok(
  pg_temp.falla(
    'select public.crm_lead_crear(jsonb_build_object(''tenant'',''minorista'',''nombre'',''Copia'',''canal'',''otro'',''tipo_doc'',''pas'',''documento'',''ab-123''))',
    'crm_lead_duplicado:',
    'mismo tipo+numero de un lead de otro responsable: rechazado') = 'crm_lead_duplicado:',
  'y el mensaje NO revela el id del lead ajeno');
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'tenant', 'minorista', 'nombre', 'Comparte correo', 'canal', 'otro', 'email', 'PRIVADO@MINORISTA.TEST'));
  perform pg_temp.ok((r->>'id') is not null,
    'compartir el correo de un lead ajeno no bloquea el alta');
  perform pg_temp.ok(r->'coincidencias' = '[]'::jsonb,
    'y el aviso no revela el lead del otro asesor');
end $fn$;

-- 10j. Las reglas documentales viven en el DATO: sin RPC, como propietario
-- (que salta la RLS), la base rechaza lo mismo que la RPC.
reset role;
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, documento) values (''mayorista'', ''otro'', ''Directo sin tipo'', ''998877'')',
  'crm_leads_documento_con_tipo',
  'por fuera de la RPC: numero sin tipo rechazado por CHECK');
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, tipo_doc) values (''mayorista'', ''otro'', ''Directo solo tipo'', ''CC'')',
  'crm_leads_documento_con_tipo',
  'por fuera de la RPC: tipo sin numero rechazado por CHECK');
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, tipo_doc, documento) values (''mayorista'', ''otro'', ''Directo tipo raro'', ''cc'', ''998877'')',
  'crm_leads_tipo_doc_catalogo',
  'por fuera de la RPC: tipo sin normalizar o fuera del catalogo rechazado por CHECK');
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, tipo_doc, documento) values (''mayorista'', ''otro'', ''Directo numero vacio'', ''CC'', ''--'')',
  'crm_leads_documento_normalizable',
  'por fuera de la RPC: numero sin letras ni digitos rechazado por CHECK');
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre, tipo_doc, documento) values (''mayorista'', ''otro'', ''Directo duplicado'', ''CC'', ''1020304'')',
  'uq_crm_leads_tenant_tipo_documento',
  'por fuera de la RPC: mismo tenant+tipo+numero rechazado por el indice unico');
insert into public.crm_leads (tenant, canal, nombre, telefono, email, tipo_doc, documento)
  values ('mayorista', 'otro', 'Directo comparte todo menos tipo', '3003330003', 'familia@local.test', 'CE', '1020304');
select pg_temp.ok(exists (select 1 from public.crm_leads where nombre = 'Directo comparte todo menos tipo'),
  'por fuera de la RPC: mismo telefono, correo y numero con otro tipo SI entra (ningun unico los cubre)');
set local role authenticated;

-- 10k. Tipos mal formados: solo se admite la sigla con puntos ("c.c."). Lo
-- demas no se "limpia" hasta parecer un tipo valido: se rechaza.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
do $fn$
declare
  v_tipo text;
begin
  foreach v_tipo in array array['CC2', 'C-C', 'C C', '..CC', 'C..C', '.', 'CC/', 'cédula'] loop
    perform pg_temp.falla(
      format('select public.crm_lead_crear(jsonb_build_object(''nombre'',%L,''canal'',''otro'',''tipo_doc'',%L,''documento'',''445566''))',
             'Tipo malo ' || v_tipo, v_tipo),
      'Tipo de documento invalido',
      format('RPC crear: tipo mal formado %L rechazado', v_tipo));
  end loop;
end $fn$;
select pg_temp.ok(not exists (select 1 from public.crm_leads where nombre like 'Tipo malo %'),
  'ningun alta con tipo mal formado quedo guardada');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''tipo_doc'',''TI2'')))', pg_temp.id('hijo_ti')),
  'Tipo de documento invalido',
  'RPC actualizar: tipo mal formado TI2 rechazado');
select pg_temp.ok((select tipo_doc = 'TI' from public.crm_leads where id = pg_temp.id('hijo_ti')),
  'el rechazo no cambio el tipo guardado');
do $fn$
declare r jsonb;
begin
  r := public.crm_lead_crear(jsonb_build_object(
    'nombre', 'Sigla con puntos', 'canal', 'otro', 'tipo_doc', ' p.a.s. ', 'documento', 'XK-778899'));
  perform pg_temp.ok(exists (select 1 from public.crm_leads
                              where id = (r->>'id')::bigint and tipo_doc = 'PAS'),
    'la variante de puntuacion admitida (" p.a.s. ") se guarda como PAS');
end $fn$;

-- 10l. Payload parcial: `crm_lead_actualizar` exige el formulario completo y lo
-- rechaza SIN tocar la fila. Antes, mandar solo `responsable_id` vaciaba en
-- silencio telefono, correo, documento y notas.
reset role;
create table _t202.l3_foto as
  select l.*, (select count(*) from public.crm_lead_actividades a where a.lead_id = l.id) as n_act
    from public.crm_leads l where l.id = pg_temp.id('l3');
grant select on _t202.l3_foto to authenticated;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%s, jsonb_build_object(''responsable_id'',''00000000-0000-0000-0000-00000000c206''))', pg_temp.id('l3')),
  'crm_lead_payload_incompleto: faltan canal, documento, email, interes, nombre, notas, origen_detalle, proxima_accion_at, telefono, tipo_doc.',
  'payload con solo responsable_id: rechazado nombrando las claves que faltan');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, null) - ''notas'')', pg_temp.id('l3')),
  'crm_lead_payload_incompleto: faltan notas.',
  'payload al que le falta UNA clave: rechazado');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%s, ''[]''::jsonb)', pg_temp.id('l3')),
  'crm_lead_payload_incompleto: se esperaba un objeto',
  'payload que no es un objeto: rechazado');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%s, null)', pg_temp.id('l3')),
  'crm_lead_payload_incompleto: se esperaba un objeto',
  'payload nulo: rechazado');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''nombre'', 5, ''notas'', jsonb_build_array(''x''))))', pg_temp.id('l3')),
  'crm_lead_payload_invalido: nombre, notas deben ser texto o null.',
  'valores que no son texto: rechazados');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%1$s, pg_temp.form(%1$s, jsonb_build_object(''responsable_id'', 7)))', pg_temp.id('l3')),
  'crm_lead_payload_invalido: responsable_id deben ser texto o null.',
  'un responsable numerico no llega al cast: se rechaza como payload invalido');
select pg_temp.ok((select l.telefono is not distinct from f.telefono
                      and l.email is not distinct from f.email
                      and l.tipo_doc is not distinct from f.tipo_doc
                      and l.documento is not distinct from f.documento
                      and l.notas is not distinct from f.notas
                      and l.responsable_id is not distinct from f.responsable_id
                      and l.updated_at = f.updated_at
                      and (select count(*) from public.crm_lead_actividades a where a.lead_id = l.id) = f.n_act
                     from public.crm_leads l, _t202.l3_foto f
                    where l.id = f.id),
  'ningun payload rechazado modifico la fila (ni updated_at) ni escribio bitacora');
-- El rol se comprueba antes que el payload: un rol fuera del modulo recibe el
-- rechazo de rol, no la lista de claves.
select pg_temp.como('00000000-0000-0000-0000-00000000c20a');
select pg_temp.falla(
  format('select public.crm_lead_actualizar(%s, ''{}''::jsonb)', pg_temp.id('l3')),
  'Tu rol no tiene acceso',
  'payload parcial de un rol fuera del modulo: rechazado por rol primero');
-- Y el formulario completo sigue funcionando, con el mismo resultado de siempre.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select public.crm_lead_actualizar(pg_temp.id('l3'), pg_temp.form(pg_temp.id('l3'), jsonb_build_object('interes', 'Cartagena en diciembre')));
select pg_temp.ok((select l.interes = 'Cartagena en diciembre'
                      and l.telefono is not distinct from f.telefono
                      and l.responsable_id is not distinct from f.responsable_id
                     from public.crm_leads l, _t202.l3_foto f where l.id = f.id),
  'el formulario completo cambia solo lo que cambio y conserva el resto');

-- ── 11. Sin borrado físico y bitácora append-only ─────────────────────────
-- El borrado falla por DOS capas independientes, y se comprueba cada una:
-- `authenticated` no tiene el privilegio (ni siquiera puede intentarlo) y el
-- trigger cortafuegos se opone a quien sí lo tiene, como las RPC internas.
select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select pg_temp.ok((select count(*) = 1 from public.crm_leads where id = pg_temp.id('l2')),
  'el lead existe para gerencia minorista antes de intentar borrarlo');
select pg_temp.falla(
  format('delete from public.crm_leads where id = %s', pg_temp.id('l2')),
  'permission denied for table',
  'gerencia no puede borrar un lead: sin privilegio de tabla');

-- Capa 2: el trigger, comprobado con los privilegios de vuelta (como haría una
-- operación interna o un service_role), para que siga siendo un cortafuegos real
-- y no solo un permiso.
reset role;
grant delete on public.crm_leads to authenticated;
select pg_temp.falla(
  format('delete from public.crm_leads where id = %s', pg_temp.id('l2')),
  'no se eliminan fisicamente',
  'con el privilegio restituido, el trigger cortafuegos rechaza el DELETE');
revoke delete on public.crm_leads from authenticated;
select pg_temp.ok((select count(*) = 1 from public.crm_leads where id = pg_temp.id('l2')),
  'tras el rechazo el lead sigue existiendo');

-- Misma doble capa en la bitácora: sin privilegio no se intenta, y con el
-- privilegio aparece el trigger append-only.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c203');
select pg_temp.falla(
  format('update public.crm_lead_actividades set cuerpo = ''alterada'' where lead_id = %s', pg_temp.id('l2')),
  'permission denied for table',
  'no se puede reescribir la bitacora');
select pg_temp.falla(
  format('delete from public.crm_lead_actividades where lead_id = %s', pg_temp.id('l2')),
  'permission denied for table',
  'no se puede borrar de la bitacora');

reset role;
grant update, delete on public.crm_lead_actividades to authenticated;
select pg_temp.falla(
  format('update public.crm_lead_actividades set cuerpo = ''alterada'' where lead_id = %s', pg_temp.id('l2')),
  'append-only',
  'con el privilegio restituido, el trigger append-only rechaza el UPDATE de la bitacora');
select pg_temp.falla(
  format('delete from public.crm_lead_actividades where lead_id = %s', pg_temp.id('l2')),
  'append-only',
  'con el privilegio restituido, el trigger append-only rechaza el DELETE de la bitacora');
revoke update, delete on public.crm_lead_actividades from authenticated;
select pg_temp.ok((select count(*) > 0 from public.crm_lead_actividades where lead_id = pg_temp.id('l2')),
  'la bitacora de L2 sigue intacta');

-- ── 12. Aislamiento entre tenants para la bitácora ─────────────────────────
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c209');
select pg_temp.ok((select count(*) = 0 from public.crm_leads where tenant = 'mayorista'),
  'venta minorista no ve leads de mayorista');
select pg_temp.ok((select count(*) = 0 from public.crm_lead_actividades
                    where lead_id in (select id from public.crm_leads where tenant = 'mayorista')),
  'ni la bitacora de esos leads');
select pg_temp.falla(
  format('select public.crm_lead_cambiar_etapa(%s,''calificado'')', pg_temp.id('l1')),
  'Lead no encontrado o sin permiso',
  'ni puede cambiarles la etapa');

-- ── 13. El tenant de un lead es inmutable ─────────────────────────────────
-- El tenant se comprueba con el privilegio restituido: `authenticated` sin
-- privilegio no puede ni intentarlo (ver 13b). Con el privilegio, la RLS de
-- solo-SELECT filtra la fila, así que el UPDATE afecta cero y el trigger ni
-- siquiera llega a evaluarse; para ejercitar el trigger como cortafuegos real
-- hace falta desactivar la RLS en la segunda aserción.
reset role;
grant update on public.crm_leads to authenticated;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
do $fn$
declare v_filas integer;
begin
  -- L2 es de minorista, así que el intento es llevarlo a mayorista.
  update public.crm_leads set tenant = 'mayorista' where id = pg_temp.id('l2');
  get diagnostics v_filas = row_count;
  perform pg_temp.ok(v_filas = 0,
    'UPDATE directo cambiando el tenant: la RLS filtra la fila (cero filas)');
end $fn$;
select pg_temp.ok((select tenant = 'minorista' from public.crm_leads where id = pg_temp.id('l2')),
  'tras el rechazo el lead sigue en su agencia');

-- Con la RLS desactivada, el trigger corta el cambio de tenant aunque la fila
-- llegue hasta él.
reset role;
alter table public.crm_leads disable row level security;
select pg_temp.falla(
  format('update public.crm_leads set tenant = ''mayorista'' where id = %s', pg_temp.id('l2')),
  'No se puede cambiar el tenant',
  'con la RLS desactivada, el trigger rechaza cambiar el tenant de un lead');
alter table public.crm_leads enable row level security;
select pg_temp.ok((select tenant = 'minorista' from public.crm_leads where id = pg_temp.id('l2')),
  'el trigger impidió el cambio: el lead sigue en su agencia');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');

-- ── 13b. `authenticated` NO puede escribir directo: solo por las RPC ────────
-- Si esto pasara, un asesor podria editar un lead sin dejar actividad y escribir
-- en la bitacora con un `actor_email` inventado: es decir, fabricar la traza.
-- Se prueba como el usuario mas permisivo del modulo (superadmin, que ve las dos
-- agencias) y tambien como `venta` sobre SU propio lead: que no haya excepcion
-- por "es mi lead" es justo lo que hay que comprobar.
--
-- Primero se devuelve el privilegio que dejaron restituido las secciones 11, 12
-- y 13 para ejercitar los triggers: a partir de aqui empieza el estado real.
reset role;
revoke insert, update, delete on table public.crm_leads from authenticated;
revoke insert, update, delete on table public.crm_lead_actividades from authenticated;
revoke all on sequence public.crm_leads_id_seq from authenticated;
revoke all on sequence public.crm_lead_actividades_id_seq from authenticated;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c201');
select pg_temp.falla(
  'insert into public.crm_leads (tenant, canal, nombre) values (''mayorista'', ''otro'', ''Colado directo'')',
  'permission denied for table',
  'superadmin no puede hacer INSERT directo en crm_leads');
select pg_temp.falla(
  format('update public.crm_leads set nombre = ''nombre alterado'' where id = %s', pg_temp.id('l3')),
  'permission denied for table',
  'superadmin no puede hacer UPDATE directo en crm_leads');
select pg_temp.falla(
  format('delete from public.crm_leads where id = %s', pg_temp.id('l3')),
  'permission denied for table',
  'superadmin no puede hacer DELETE directo en crm_leads');
select pg_temp.falla(
  format('insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, actor_id, actor_email) values (%s, ''nota'', ''actividad fabricada'', ''00000000-0000-0000-0000-00000000c20a'', ''disfrazado@ejemplo.com'')', pg_temp.id('l3')),
  'permission denied for table',
  'no se puede insertar una actividad con actor_email arbitrario');

-- Mismo caso con un `venta` sobre un lead que le pertenece: sin excepcion.
select pg_temp.como('00000000-0000-0000-0000-00000000c206');
select pg_temp.ok((select count(*) = 1 from public.crm_leads where id = pg_temp.id('l3')),
  'antes del intento, venta A ve su propio lead');
select pg_temp.falla(
  format('update public.crm_leads set etapa = ''calificado'' where id = %s', pg_temp.id('l3')),
  'permission denied for table',
  'venta no puede cambiar la etapa de SU lead por DML directo');
select pg_temp.falla(
  format('insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, actor_id) values (%s, ''nota'', ''nota sin pasar por la RPC'', auth.uid())', pg_temp.id('l3')),
  'permission denied for table',
  'venta no puede escribir en la bitacora de SU lead por DML directo');
select pg_temp.ok((select etapa = 'nuevo' from public.crm_leads where id = pg_temp.id('l3')),
  'tras los rechazos el lead no cambio y la bitacora no crecio');
select pg_temp.ok(not exists (
    select 1 from public.crm_lead_actividades
     where lead_id = pg_temp.id('l3') and (cuerpo = 'actividad fabricada' or cuerpo = 'nota sin pasar por la RPC')),
  'ninguna actividad fabricada quedo registrada');

-- Y lo que sí debe funcionar: leer por SELECT y escribir por la RPC.
select pg_temp.ok((select count(*) >= 1 from public.crm_leads where id = pg_temp.id('l3')),
  'SELECT sigue permitido para authenticated');
select public.crm_lead_registrar_actividad(pg_temp.id('l3'), 'nota', 'Nota escrita por la RPC, que sí debe quedar.', null);
select pg_temp.ok((select count(*) = 1 from public.crm_lead_actividades
                    where lead_id = pg_temp.id('l3') and cuerpo = 'Nota escrita por la RPC, que sí debe quedar.'),
  'la misma operación por la RPC sí se registra y con el actor real');

-- Permisos declarados: solo SELECT, y las policies que quedan son de lectura.
select pg_temp.ok(
  has_table_privilege('authenticated', 'public.crm_leads', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crm_leads', 'DELETE')
  and has_table_privilege('authenticated', 'public.crm_lead_actividades', 'SELECT')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'INSERT')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.crm_lead_actividades', 'DELETE'),
  'authenticated tiene SELECT y nada mas sobre las dos tablas');
select pg_temp.ok((select count(*) = 2 from pg_policies
                    where schemaname = 'public'
                      and tablename in ('crm_leads', 'crm_lead_actividades')
                      and cmd = 'SELECT')
  and not exists (select 1 from pg_policies
                   where schemaname = 'public'
                     and tablename in ('crm_leads', 'crm_lead_actividades')
                     and cmd <> 'SELECT'),
  'las únicas policies de las dos tablas son de lectura');
select pg_temp.ok(not has_sequence_privilege('authenticated', 'public.crm_leads_id_seq', 'USAGE'),
  'authenticated no puede usar la secuencia de ids: solo las RPC los generan');

-- ── 13c. Las RPC son la única vía: cada una es SECURITY DEFINER y valida ────
select pg_temp.ok(coalesce((select bool_and(prosecdef) from pg_proc
                             where oid in (
                               to_regprocedure('public.crm_lead_crear(jsonb)'),
                               to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
                               to_regprocedure('public.crm_lead_tomar(bigint)'),
                               to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
                               to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))), false),
  'las cinco RPC de escritura son SECURITY DEFINER');
select pg_temp.ok((select count(*) = 5 from pg_proc
                    where oid in (
                      to_regprocedure('public.crm_lead_crear(jsonb)'),
                      to_regprocedure('public.crm_lead_actualizar(bigint, jsonb)'),
                      to_regprocedure('public.crm_lead_tomar(bigint)'),
                      to_regprocedure('public.crm_lead_cambiar_etapa(bigint, text)'),
                      to_regprocedure('public.crm_lead_registrar_actividad(bigint, text, text, timestamptz)'))
                      and prosrc like '%crm_lead_actor()%'),
  'las cinco validan al actor antes de escribir (usuario activo y rol permitido)');
select pg_temp.ok(exists (select 1 from pg_proc
                           where oid = to_regprocedure('public.crm_lead_actor()')
                             and prosrc like '%u.activo is true%'),
  'crm_lead_actor rechaza al usuario inactivo');

-- Como las RPC ya no dependen de la RLS, una sesion sin rol debe pararse en la
-- propia RPC, no por la policy.
select pg_temp.como('00000000-0000-0000-0000-00000000c208');
select pg_temp.falla(
  format('select public.crm_lead_cambiar_etapa(%s,''calificado'')', pg_temp.id('l3')),
  'Sesion no valida',
  'usuario inactivo: la RPC lo rechaza ella misma');
select pg_temp.como('00000000-0000-0000-0000-00000000c20a');
select pg_temp.falla(
  format('select public.crm_lead_registrar_actividad(%s,''nota'',''hola'',null)', pg_temp.id('l3')),
  'Tu rol no tiene acceso',
  'operaciones: la RPC lo rechaza ella misma');
select pg_temp.como('00000000-0000-0000-0000-00000000c20c');
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''X'',''canal'',''otro''))',
  'Tu rol no tiene acceso',
  'externo: la RPC lo rechaza ella misma');
-- Sin JWT (claims ausentes) no hay actor: tampoco entra.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select pg_temp.falla(
  'select public.crm_lead_crear(jsonb_build_object(''nombre'',''X'',''canal'',''otro''))',
  'Sesion no valida',
  'sin claim sub no hay actor identificado');

-- ── 14. Sin exfiltración por permisos de schema ────────────────────────────
select pg_temp.ok(not has_function_privilege('anon', 'public.crm_lead_crear(jsonb)', 'EXECUTE'),
  'anon no ejecuta las RPC de escritura');
select pg_temp.ok(not has_function_privilege('anon', 'public.crm_lead_tomar(bigint)', 'EXECUTE'),
  'anon no ejecuta crm_lead_tomar');
select pg_temp.ok(not has_table_privilege('anon', 'public.crm_leads', 'SELECT'),
  'anon no lee crm_leads');
select pg_temp.ok(not has_table_privilege('anon', 'public.crm_lead_actividades', 'SELECT'),
  'anon no lee crm_lead_actividades');

-- Los helpers internos son SECURITY DEFINER y NO son ejecutables por
-- `authenticated`: se llaman desde dentro de las RPC, que corren como el
-- propietario. El que devolvía el correo de cualquier usuario es el caso
-- importante: sin este permiso, `crm_lead_email_de` serviría para sacar el
-- correo de un asesor de la otra agencia.
select pg_temp.como('00000000-0000-0000-0000-00000000c209');
select pg_temp.falla(
  'select public.crm_lead_email_de(''00000000-0000-0000-0000-00000000c206'')',
  'permission denied for function',
  'authenticated no puede pedir el correo de un usuario de otro tenant');
select pg_temp.falla(
  'select public.crm_lead_responsable_email(''00000000-0000-0000-0000-00000000c206'')',
  'does not exist',
  'la función que exponía el correo de cualquiera ya no existe');
select pg_temp.falla(
  'select public.crm_lead_actor()',
  'permission denied for function',
  'authenticated no puede invocar el helper de identidad del actor');
select pg_temp.falla(
  'select public.crm_lead_duplicado_id(''mayorista'', ''CC'', ''1020304'', null::bigint, ''00000000-0000-0000-0000-00000000c209'', ''venta'', ''minorista'')',
  'permission denied for function',
  'authenticated no puede invocar el helper de duplicados');
-- Con las coincidencias pasa lo mismo: llamandolas con un rol inventado
-- (`superadmin`) se podria sondear la cartera de otro asesor por telefono.
select pg_temp.falla(
  'select public.crm_lead_coincidencias(''minorista'', ''573003330003'', null, null, null, null::bigint, ''00000000-0000-0000-0000-00000000c209'', ''superadmin'', ''minorista'')',
  'permission denied for function',
  'authenticated no puede invocar el helper de coincidencias');
select pg_temp.falla(
  'select public.crm_lead_tipo_doc_validado(''CC'', ''1'')',
  'permission denied for function',
  'authenticated no puede invocar el validador documental interno');
select pg_temp.falla(
  'select public.crm_lead_normalizar_tipo_doc(''cc'')',
  'permission denied for function',
  'el normalizador de tipo es interno: no alimenta columnas generadas');
select pg_temp.ok(to_regprocedure('public.crm_lead_duplicado_id(text, text, text, text, uuid, text, text)') is null,
  'no queda la firma antigua del helper de duplicados (sin tipo de documento)');
select pg_temp.ok(has_function_privilege('authenticated', 'public.crm_lead_puede_ver(text, uuid)', 'EXECUTE'),
  'el único helper expuesto es el de lectura, que necesitan las policies');
select pg_temp.ok(not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'crm_lead%'
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'ninguna funcion del modulo es ejecutable por anon');
-- Lo que `authenticated` puede ejecutar son las cinco RPC, el helper de lectura
-- que usan las policies y los tres normalizadores (columnas generadas y dedupe).
-- Cualquier otra cosa sería superficie de más.
select pg_temp.ok(not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'crm_lead%'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proname not in (
         'crm_lead_crear', 'crm_lead_actualizar', 'crm_lead_tomar',
         'crm_lead_cambiar_etapa', 'crm_lead_registrar_actividad',
         'crm_lead_puede_ver',
         'crm_lead_normalizar_telefono', 'crm_lead_normalizar_email', 'crm_lead_normalizar_documento')),
  'authenticated no ejecuta ninguna otra funcion del modulo');

reset role;
rollback;