-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 197 (confirmar_venta: venta + sillas en UNA
-- transacción, con la RLS de quien llama). SOLO base LOCAL o DESECHABLE.
-- Datos propios; termina en ROLLBACK.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK   %', p_msg;
end $$;
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK   % → «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % → error inesperado «%» (se esperaba «%»)', p_msg, sqlerrm, p_patron;
  end;
  raise exception 'FALLO: % → no falló (se esperaba «%»)', p_msg, p_patron;
end $$;
create function pg_temp.como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.venta(p text) returns text language sql stable as $$ select estado from public.ventas where numero_contrato = p $$;
create function pg_temp.sillas(p text) returns text language sql stable as $$
  select string_agg(estado::text, ',' order by numero_silla) from public.sillas where numero_contrato = p $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c701', 'cv-super@local.test'),
  ('00000000-0000-0000-0000-00000000c702', 'cv-op-may@local.test'),
  ('00000000-0000-0000-0000-00000000c703', 'cv-op-min@local.test'),
  ('00000000-0000-0000-0000-00000000c704', 'cv-venta@local.test'),
  ('00000000-0000-0000-0000-00000000c705', 'cv-control@local.test'),
  ('00000000-0000-0000-0000-00000000c706', 'cv-inactivo@local.test');
update public.usuarios set rol = 'superadmin',    tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000c701';
update public.usuarios set rol = 'operaciones',   tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000c702';
update public.usuarios set rol = 'operaciones',   tenant = 'minorista', activo = true  where id = '00000000-0000-0000-0000-00000000c703';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000c704';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true  where id = '00000000-0000-0000-0000-00000000c705';
update public.usuarios set rol = 'operaciones',   tenant = 'mayorista', activo = false where id = '00000000-0000-0000-0000-00000000c706';

insert into public.bloqueos_vuelo (record, cupos_total) values ('CVY001', 12);
insert into public.sillas (bloqueo_id, numero_silla, estado) select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 12) g where b.record = 'CVY001';
insert into public.ventas (numero_contrato, cliente, tenant, estado, financiero_estado) values
  ('DTM-9961', 'cv', 'mayorista', 'pendiente', 'completo'),
  ('DTM-9962', 'cv', 'mayorista', 'pendiente', 'pendiente'),   -- escritura financiera incompleta
  ('DTM-9963', 'cv', 'mayorista', 'cancelado', 'completo'),
  ('DTM-9964', 'cv', 'mayorista', 'pendiente', 'completo'),
  ('DTM-9965', 'cv', 'mayorista', 'pendiente', 'completo'),
  ('DTM-9966', 'cv', 'mayorista', 'confirmado', 'completo'),      -- ajena, YA confirmada, silla aún en plazo
  ('MIN-DTM-9967', 'cv', 'minorista', 'confirmado', 'completo');  -- otra agencia, ídem
update public.sillas s set estado = 'en_plazo', numero_contrato = v.n
  from (values (1, 'DTM-9961'), (2, 'DTM-9961'), (3, 'DTM-9962'), (4, 'DTM-9963'), (5, 'DTM-9964'), (6, 'DTM-9965'),
               (7, 'DTM-9966'), (8, 'MIN-DTM-9967')) v(k, n)
 where s.bloqueo_id = (select id from public.bloqueos_vuelo where record = 'CVY001') and s.numero_silla = v.k;

-- ═══ Quién puede (misma RLS de ventas que antes usaba la sesión) ═════════
set local role anon;
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'permission denied for function', 'anon no ejecuta confirmar_venta');
reset role;
set local role authenticated;
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'Sesión requerida', 'sin sesión');
select pg_temp.como('00000000-0000-0000-0000-00000000c704');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'Contrato no encontrado o sin acceso', 'rol venta no ve la venta (RLS)');
select pg_temp.como('00000000-0000-0000-0000-00000000c705');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'Contrato no encontrado o sin acceso', 'control_vuelo no confirma ventas');
select pg_temp.como('00000000-0000-0000-0000-00000000c703');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'Contrato no encontrado o sin acceso', 'operaciones de MINORISTA no confirma una venta mayorista (tenant)');
select pg_temp.como('00000000-0000-0000-0000-00000000c706');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9961')$q$, 'Contrato no encontrado o sin acceso', 'usuario inactivo');
-- Llamar directo al ayudante sobre una venta PENDIENTE no confirma sillas.
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9961')$q$, 'Operación no permitida', 'el ayudante llamado directo no confirma sillas de una venta pendiente');
reset role;
select pg_temp.ok(pg_temp.venta('DTM-9961') = 'pendiente' and pg_temp.sillas('DTM-9961') = 'en_plazo,en_plazo', 'nada cambió tras los intentos sin permiso');

-- ═══ Guardas de estado ═══════════════════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9962')$q$, 'registro de costos/cuentas por pagar incompleto', 'financiero pendiente: no se confirma (candado 172)');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9963')$q$, 'Solo se confirma una venta pendiente (estado actual: cancelado)', 'una venta cancelada no se revive');
select pg_temp.falla($q$select public.confirmar_venta('NO-EXISTE')$q$, 'Contrato no encontrado o sin acceso', 'contrato inexistente');
reset role;
select pg_temp.ok(pg_temp.venta('DTM-9962') = 'pendiente' and pg_temp.sillas('DTM-9962') = 'en_plazo'
  and pg_temp.venta('DTM-9963') = 'cancelado' and pg_temp.sillas('DTM-9963') = 'en_plazo',
  'los rechazos no tocaron ventas ni sillas');

-- ═══ Confirmación correcta e idempotente ═════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
create temp table r1 as select public.confirmar_venta('DTM-9961') as r;
create temp table r2 as select public.confirmar_venta('DTM-9961') as r;
reset role;
select pg_temp.ok((select (r ->> 'ok')::boolean and not (r ->> 'ya_confirmado')::boolean and (r ->> 'sillas_confirmadas')::int = 2 from r1)
  and pg_temp.venta('DTM-9961') = 'confirmado' and pg_temp.sillas('DTM-9961') = 'confirmada,confirmada',
  'operaciones de la misma agencia confirma: venta y sus 2 sillas, juntas');
select pg_temp.ok((select (r ->> 'ya_confirmado')::boolean and (r ->> 'sillas_confirmadas')::int = 0 from r2),
  'repetir sobre una venta ya confirmada: ok sin cambios');

-- ═══ Atomicidad: si las sillas fallan, la venta NO queda confirmada ═══════
create function pg_temp.romper_sillas() returns trigger language plpgsql as $$
begin if new.numero_contrato = 'DTM-9964' and new.estado = 'confirmada' then raise exception 'FALLO_FORZADO_SILLAS'; end if; return new; end $$;
create trigger cv_romper before update on public.sillas for each row execute function pg_temp.romper_sillas();
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c701');
select pg_temp.falla($q$select public.confirmar_venta('DTM-9964')$q$, 'FALLO_FORZADO_SILLAS', 'falla al confirmar las sillas (la venta ya estaba marcada en la misma transacción)');
reset role;
drop trigger cv_romper on public.sillas;
select pg_temp.ok(pg_temp.venta('DTM-9964') = 'pendiente' and pg_temp.sillas('DTM-9964') = 'en_plazo',
  'atomicidad: la venta sigue pendiente y la silla en plazo (no hace falta compensar)');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c701');
create temp table r3 as select public.confirmar_venta('DTM-9964') as r;
reset role;
select pg_temp.ok(pg_temp.venta('DTM-9964') = 'confirmado' and pg_temp.sillas('DTM-9964') = 'confirmada', 'reintento tras el fallo: se confirma completa');

-- ═══ Una venta confirmada con sillas aún en plazo se alinea (por confirmar_venta) ═
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9965';
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9965')$q$, 'Operación no permitida',
  'ni siquiera quien SÍ puede confirmarla alinea sillas llamando directo al ayudante');
create temp table r4 as select public.confirmar_venta('DTM-9965') as r;
reset role;
select pg_temp.ok((select (r ->> 'ya_confirmado')::boolean and (r ->> 'sillas_confirmadas')::int = 1 from r4)
  and pg_temp.sillas('DTM-9965') = 'confirmada',
  'confirmar_venta sobre una venta YA confirmada alinea su silla en plazo');

-- ═══ Llamada DIRECTA al ayudante DEFINER: venta ajena ya confirmada con silla en plazo ═
-- El ayudante es ejecutable por authenticated (lo necesita confirmar_venta,
-- que es INVOKER). Sin el testigo que fija confirmar_venta en la misma
-- transacción no lee ni toca nada, sea quien sea; y aun con un testigo
-- forjado (solo posible con SQL directo, no por la API) exige usuario activo,
-- rol con UPDATE en ventas y la agencia de la venta.
create temp table aud0 as
  select (select count(*) from public.auditoria where registro_id in ('DTM-9966', 'MIN-DTM-9967')) as n,
         (select coalesce(max(id), 0) from public.auditoria) as max_id;
grant select on aud0 to public;
create function pg_temp.forjar(p_numero text, p_uid text) returns void language sql as $$
  select set_config('app.confirmar_venta_token', p_numero || '|' || p_uid, true) $$;
set local role anon;
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'permission denied for function', 'anon no ejecuta el ayudante');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'sin sesión');
-- Sin testigo: todos los roles, incluidos los que SÍ pueden confirmar.
select pg_temp.como('00000000-0000-0000-0000-00000000c701');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'superadmin directo, sin testigo');
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'operaciones de la misma agencia directo, sin testigo');
select pg_temp.como('00000000-0000-0000-0000-00000000c704');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'venta (contrato ajeno) directo');
select pg_temp.como('00000000-0000-0000-0000-00000000c705');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'control_vuelo (sin permiso sobre ventas) directo');
select pg_temp.como('00000000-0000-0000-0000-00000000c703');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'operaciones de MINORISTA directo sobre venta mayorista');
select pg_temp.como('00000000-0000-0000-0000-00000000c706');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'usuario inactivo directo');
-- Mismo mensaje exista o no el contrato: no revela existencia ni estado.
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('NO-EXISTE')$q$, 'Operación no permitida', 'contrato inexistente: mismo mensaje');
-- Testigo forjado (defensa en profundidad; por la API no se puede fijar).
select pg_temp.forjar('DTM-9966', '00000000-0000-0000-0000-00000000c701');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'testigo de OTRO usuario no sirve');
select pg_temp.forjar('DTM-9961', '00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'testigo de OTRO contrato no sirve');
select pg_temp.como('00000000-0000-0000-0000-00000000c706');
select pg_temp.forjar('DTM-9966', '00000000-0000-0000-0000-00000000c706');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'inactivo con testigo forjado');
select pg_temp.como('00000000-0000-0000-0000-00000000c705');
select pg_temp.forjar('DTM-9966', '00000000-0000-0000-0000-00000000c705');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'control_vuelo con testigo forjado (rol sin UPDATE en ventas)');
select pg_temp.como('00000000-0000-0000-0000-00000000c703');
select pg_temp.forjar('DTM-9966', '00000000-0000-0000-0000-00000000c703');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'minorista con testigo forjado sobre venta mayorista (agencia)');
select pg_temp.como('00000000-0000-0000-0000-00000000c702');
select pg_temp.forjar('MIN-DTM-9967', '00000000-0000-0000-0000-00000000c702');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('MIN-DTM-9967')$q$, 'Operación no permitida', 'mayorista con testigo forjado sobre venta minorista (agencia)');
select pg_temp.forjar('', '');
-- El testigo no sobrevive a confirmar_venta: tras una confirmación legítima,
-- otra llamada directa en la MISMA transacción sigue rechazada.
select public.confirmar_venta('DTM-9965');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9965')$q$, 'Operación no permitida', 'tras confirmar_venta el testigo queda limpio (mismo contrato)');
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'tras confirmar_venta el testigo queda limpio (otro contrato)');
reset role;
-- service_role: en Supabase tiene EXECUTE por defecto sobre funciones nuevas; sin sesión de usuario no pasa.
grant execute on function public._confirmar_sillas_de_venta(text) to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select pg_temp.falla($q$select public._confirmar_sillas_de_venta('DTM-9966')$q$, 'Operación no permitida', 'service_role directo (sin sesión de usuario)');
reset role;
select pg_temp.ok(pg_temp.venta('DTM-9966') = 'confirmado' and pg_temp.sillas('DTM-9966') = 'en_plazo'
  and pg_temp.venta('MIN-DTM-9967') = 'confirmado' and pg_temp.sillas('MIN-DTM-9967') = 'en_plazo',
  'llamadas directas: ninguna silla ajena cambió (siguen en plazo)');
select pg_temp.ok((select count(*) from public.auditoria where registro_id in ('DTM-9966', 'MIN-DTM-9967')) = (select n from aud0)
  and not exists (select 1 from public.auditoria where id > (select max_id from aud0)
                    and tabla in ('sillas', 'ventas') and registro_id in ('DTM-9966', 'MIN-DTM-9967')),
  'llamadas directas: ninguna fila nueva de auditoría sobre esas ventas o sus sillas');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
