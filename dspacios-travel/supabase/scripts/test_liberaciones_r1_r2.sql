-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS · migración 196 (liberaciones sin residuos R1, R2, vencimiento con
-- fecha de negocio de Bogotá). SOLO base LOCAL o DESECHABLE (192–196
-- aplicadas). Datos propios; termina en ROLLBACK.
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
-- ¿La silla quedó sin NINGÚN dato del grupo D y sin contrato?
create function pg_temp.limpia(p_id bigint) returns boolean language sql stable as $$
  select s.numero_contrato is null and s.contrato_manual is null and not public._silla_con_datos(s) from public.sillas s where s.id = p_id $$;
create function pg_temp.estado(p_id bigint) returns text language sql stable as $$ select estado::text from public.sillas where id = p_id $$;
create temp table fx (k text primary key, id bigint);
grant select on fx to public;
create function pg_temp.fx(p text) returns bigint language sql stable as $$ select id from fx where k = p $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f001', 'lr-super@local.test'), ('00000000-0000-0000-0000-00000000f002', 'lr-cv@local.test');
update public.usuarios set rol = 'superadmin', tenant = 'mayorista', activo = true where id = '00000000-0000-0000-0000-00000000f001';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true where id = '00000000-0000-0000-0000-00000000f002';
insert into public.bloqueos_vuelo (record, cupos_total, fecha_ida) values ('LRY001', 12, date '2026-12-20');
insert into fx select 'b', id from public.bloqueos_vuelo where record = 'LRY001';
insert into public.sillas (bloqueo_id, numero_silla, estado) select pg_temp.fx('b'), g, 'disponible' from generate_series(1, 12) g;
insert into fx select 's' || numero_silla, id from public.sillas where bloqueo_id = pg_temp.fx('b');
-- Una silla "llena": TODAS las columnas del grupo D con datos.
create function pg_temp.llenar(p_id bigint, p_contrato text, p_estado text) returns void language sql as $$
  update public.sillas set estado = p_estado::public.estado_silla, numero_contrato = p_contrato,
    pasajero_nombres = 'ANA', pasajero_apellidos = 'PEREZ', tipo_doc = 'CC', numero_doc = '123', nacimiento = date '1990-01-01',
    inf_nombres = 'BEBE', inf_apellidos = 'PEREZ', inf_tipo_doc = 'RC', inf_numero = '999', inf_nacimiento = date '2025-06-01',
    responsable_menor = 'ANA PEREZ', agencia = 'AG', asesor = 'ASESOR', hotel = 'HOTEL', acomodacion = 'DOBLE', plazo = date '2026-10-01'
  where id = p_id $$;

-- ═══ Vencimiento con fecha de negocio (Bogotá) ════════════════════════════
-- Hoy de negocio fijo: 2026-10-01. A las 7 p. m. de Bogotá la fecha UTC ya es
-- 2026-10-02: con esa fecha (el error anterior) el plazo de HOY se liberaría.
insert into public.ventas (numero_contrato, cliente, tenant, estado, plazo) values
  ('DTM-9941', 'lr', 'mayorista', 'pendiente', date '2026-09-30'),   -- venció ayer → se libera
  ('DTM-9942', 'lr', 'mayorista', 'pendiente', date '2026-10-01'),   -- vence HOY → NO se libera hoy
  ('DTM-9943', 'lr', 'mayorista', 'pendiente', date '2026-10-02'),   -- mañana → no
  ('DTM-9944', 'lr', 'mayorista', 'confirmado', date '2026-09-01');  -- confirmado → nunca
insert into public.contrato_pasajeros (numero_contrato, nombre, tipo_id, identificacion) values ('DTM-9941', 'ANA PEREZ', 'CC', '123');
select pg_temp.llenar(pg_temp.fx('s1'), 'DTM-9941', 'en_plazo');
select pg_temp.llenar(pg_temp.fx('s2'), 'DTM-9942', 'en_plazo');
select pg_temp.llenar(pg_temp.fx('s3'), 'DTM-9943', 'en_plazo');
select pg_temp.llenar(pg_temp.fx('s4'), 'DTM-9944', 'confirmada');

set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000f001');
select pg_temp.falla($q$select public.liberar_vencidas(date '2026-10-01')$q$, 'permission denied for function', 'liberar_vencidas no la ejecuta ni un superadmin con sesión (solo service_role)');
reset role;
set local role anon;
select pg_temp.falla($q$select public.liberar_vencidas(date '2026-10-01')$q$, 'permission denied for function', 'anon no ejecuta liberar_vencidas');
reset role;

-- Rollback: si falla a mitad (ya soltadas las sillas), nada queda a medias.
create function pg_temp.romper_ventas() returns trigger language plpgsql as $$
begin if new.estado = 'cancelado' and new.numero_contrato = 'DTM-9941' then raise exception 'FALLO_FORZADO_VENTAS'; end if; return new; end $$;
create trigger lr_romper before update on public.ventas for each row execute function pg_temp.romper_ventas();
set local role service_role;
select pg_temp.falla($q$select public.liberar_vencidas(date '2026-10-01')$q$, 'FALLO_FORZADO_VENTAS', 'falla al cancelar la venta (después de soltar las sillas)');
reset role;
drop trigger lr_romper on public.ventas;
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s1')) = 'en_plazo' and (select numero_contrato from public.sillas where id = pg_temp.fx('s1')) = 'DTM-9941'
  and (select estado from public.ventas where numero_contrato = 'DTM-9941') = 'pendiente',
  'rollback: la silla sigue en plazo con su contrato y la venta pendiente');

set local role service_role;
create temp table rv as select public.liberar_vencidas(date '2026-10-01') as r;
reset role;
select pg_temp.ok((select (r ->> 'liberadas')::int = 1 and (r ->> 'sillas')::int = 1 and r ->> 'hoy' = '2026-10-01' from rv),
  'liberar_vencidas(hoy = 2026-10-01): libera 1 contrato (plazo de ayer) y 1 silla');
select pg_temp.ok((select estado from public.ventas where numero_contrato = 'DTM-9941') = 'cancelado'
  and (select estado from public.ventas where numero_contrato = 'DTM-9942') = 'pendiente'
  and (select estado from public.ventas where numero_contrato = 'DTM-9943') = 'pendiente'
  and (select estado from public.ventas where numero_contrato = 'DTM-9944') = 'confirmado',
  'un plazo de HOY no se libera hoy; mañana y confirmado tampoco');
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s1')) = 'disponible' and pg_temp.limpia(pg_temp.fx('s1')),
  'R1: la silla liberada queda disponible sin NINGUNO de los 16 datos (adulto, infante, responsable, agencia, asesor, hotel, acomodación, plazo)');
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s2')) = 'en_plazo' and not pg_temp.limpia(pg_temp.fx('s2')),
  'la silla del contrato que vence hoy no se tocó');
select pg_temp.ok((select count(*) from public.contrato_pasajeros where numero_contrato = 'DTM-9941') = 1,
  'historial contractual: los pasajeros del contrato vencido se conservan');
select pg_temp.ok((select count(*) from public.auditoria where tabla = 'sillas' and accion = 'UPDATE' and (antes ->> 'id')::bigint = pg_temp.fx('s1')
                     and (antes ->> 'numero_doc') = '123') >= 1,
  'historial: la auditoría guarda los datos que tenía la silla antes de limpiarla');
set local role service_role;
create temp table rv2 as select public.liberar_vencidas(date '2026-10-02') as r;
reset role;
select pg_temp.ok((select estado from public.ventas where numero_contrato = 'DTM-9942') = 'cancelado' and pg_temp.limpia(pg_temp.fx('s2')),
  'al día siguiente (2026-10-02) sí vence el contrato de plazo 2026-10-01');
set local role service_role;
create temp table rv3 as select public.liberar_vencidas() as r;
reset role;
select pg_temp.ok((select r ->> 'hoy' from rv3) = (now() at time zone 'America/Bogota')::date::text,
  'sin fecha, usa el día de negocio de Bogotá según la base');

-- ═══ R2 · eliminar_contrato: devuelta y no_vendida conservan su estado ════
insert into public.ventas (numero_contrato, cliente, tenant, estado) values ('DTM-9945', 'lr', 'mayorista', 'confirmado');
select pg_temp.llenar(pg_temp.fx('s5'), 'DTM-9945', 'confirmada');
select pg_temp.llenar(pg_temp.fx('s6'), 'DTM-9945', 'devuelta');
select pg_temp.llenar(pg_temp.fx('s7'), 'DTM-9945', 'no_vendida');
select pg_temp.llenar(pg_temp.fx('s8'), 'DTM-9945', 'en_plazo');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000f002');
select pg_temp.falla($q$select public.eliminar_contrato('DTM-9945')$q$, 'Solo un superadmin puede eliminar contratos', 'eliminar_contrato conserva su candado (control_vuelo no puede)');
select pg_temp.como('00000000-0000-0000-0000-00000000f001');
select public.eliminar_contrato('DTM-9945');
reset role;
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s6')) = 'devuelta' and pg_temp.estado(pg_temp.fx('s7')) = 'no_vendida',
  'R2: la silla devuelta sigue devuelta y la no vendida sigue no vendida');
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s5')) = 'disponible' and pg_temp.estado(pg_temp.fx('s8')) = 'disponible',
  'las sillas confirmada y en plazo del contrato vuelven a disponible');
select pg_temp.ok(pg_temp.limpia(pg_temp.fx('s5')) and pg_temp.limpia(pg_temp.fx('s6')) and pg_temp.limpia(pg_temp.fx('s7')) and pg_temp.limpia(pg_temp.fx('s8')),
  'R1: las cuatro sin contrato ni ningún dato residual');
select pg_temp.ok((select count(*) from public.bloqueo_cambios where bloqueo_id = pg_temp.fx('b') and detalle like 'Contrato DTM-9945 eliminado: 2 silla(s) devuelta/no_vendida conservan su estado%') = 1,
  'R2: queda constancia en el historial del bloqueo');
select pg_temp.ok(not exists (select 1 from public.ventas where numero_contrato = 'DTM-9945'), 'el contrato se eliminó');

-- ═══ R2 · revertir_contrato_incompleto: misma regla ══════════════════════
insert into public.ventas (numero_contrato, cliente, tenant, estado) values ('DTM-9946', 'lr', 'mayorista', 'pendiente');
select pg_temp.llenar(pg_temp.fx('s9'), 'DTM-9946', 'en_plazo');
select pg_temp.llenar(pg_temp.fx('s10'), 'DTM-9946', 'devuelta');
set local role service_role;
select public.revertir_contrato_incompleto('DTM-9946', 'mayorista');
reset role;
select pg_temp.ok(pg_temp.estado(pg_temp.fx('s9')) = 'disponible' and pg_temp.estado(pg_temp.fx('s10')) = 'devuelta'
  and pg_temp.limpia(pg_temp.fx('s9')) and pg_temp.limpia(pg_temp.fx('s10')),
  'revertir: en plazo → disponible limpia; devuelta conserva su estado, sin contrato ni datos');

-- ═══ R1 · núcleo de reservas: la silla que se suelta queda limpia ═══════
insert into public.ventas (numero_contrato, cliente, tenant, estado, bloqueo_ref_id) values ('DTM-9947', 'lr', 'mayorista', 'pendiente', pg_temp.fx('b'));
select pg_temp.llenar(pg_temp.fx('s11'), 'DTM-9947', 'en_plazo');
select pg_temp.llenar(pg_temp.fx('s12'), 'DTM-9947', 'en_plazo');
create temp table nuc as select * from public._ajustar_sillas_bloqueo_nucleo('DTM-9947', pg_temp.fx('b'), 1);
select pg_temp.ok((select count(*) from public.sillas where numero_contrato = 'DTM-9947') = 1
  and pg_temp.estado(pg_temp.fx('s12')) = 'disponible' and pg_temp.limpia(pg_temp.fx('s12')),
  'núcleo 2 → 1 pasajeros: la silla soltada (la de número más alto) queda disponible y limpia');

-- ═══ Cobertura: ninguna columna nueva de sillas queda fuera de los grupos ═
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
                    where table_schema = 'public' and table_name = 'sillas')
  = array['acomodacion','agencia','asesor','bloqueo_id','contrato_manual','created_at','estado','hotel','id','inf_apellidos',
          'inf_nacimiento','inf_nombres','inf_numero','inf_tipo_doc','nacimiento','numero_contrato','numero_doc','numero_silla',
          'pasajero_apellidos','pasajero_nombres','plazo','responsable_menor','tipo_doc','updated_at'],
  'sillas tiene exactamente las columnas clasificadas (si se agrega una, revisar _silla_con_datos y _vaciar_sillas)');

rollback;
\echo 'TODAS LAS PRUEBAS PASARON (y se revirtieron)'
