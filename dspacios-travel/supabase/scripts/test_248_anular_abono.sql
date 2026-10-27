-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS 248 · anulación atómica de un abono contabilizado (una sesión). SOLO base local
-- desechable con 001–247 + 248 aplicadas. Todo corre en UNA transacción que termina en ROLLBACK.
--
-- Uso (desde dspacios-travel/):
--   psql … -d <base_desechable> -f supabase/scripts/test_248_anular_abono.sql
--
-- Salida: una fila por caso → caso | OK/FALLA | esperado | obtenido | foto antes ⇒ después.
-- Al final, el conteo de FALLA (debe ser 0). La carrera de doble pulsación (dos sesiones con
-- commit real) está en test_248_carrera.sh.
--
-- Casos: A reproducción del contrato minorista (abono con asiento) · B anulación exitosa y
-- idempotencia · C fallo a mitad con rollback completo · D dependencias que bloquean ·
-- E aislamiento por agencia y roles · F lectores (saldos) y huella inmutable · G registro atómico e idempotente · H la clave de idempotencia identifica el abono completo.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
\pset pager off
begin;
do $$ begin
  if to_regclass('public.abonos_anulados') is null then raise exception 'La 248 no está aplicada en esta base.'; end if;
  if current_database() in ('postgres', 'plantilla247', 'plantilla245') then raise exception 'Usa una base desechable.'; end if;
end $$;

create temp table _r (n serial, fase text, caso text, ok boolean, esperado text, obtenido text, fotos text) on commit drop;
grant all on _r to public;
grant all on sequence _r_n_seq to public;

-- ── Usuarios ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000246201', 'super248@t.test'), ('00000000-0000-0000-0000-000000246202', 'admmay248@t.test'),
  ('00000000-0000-0000-0000-000000246203', 'germin248@t.test'), ('00000000-0000-0000-0000-000000246204', 'ventamay248@t.test'),
  ('00000000-0000-0000-0000-000000246205', 'inact248@t.test'), ('00000000-0000-0000-0000-000000246206', 'opsmay248@t.test'),
  ('00000000-0000-0000-0000-000000246207', 'admmin248@t.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000246201', 'super248@t.test', 'Super 248', 'superadmin', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000246202', 'admmay248@t.test', 'Adm May 248', 'administracion', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000246203', 'germin248@t.test', 'Ger Min 248', 'gerencia', true, 'minorista'),
  ('00000000-0000-0000-0000-000000246204', 'ventamay248@t.test', 'Venta May 248', 'venta', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000246205', 'inact248@t.test', 'Inactivo 248', 'administracion', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000246206', 'opsmay248@t.test', 'Ops May 248', 'operaciones', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000246207', 'admmin248@t.test', 'Adm Min 248', 'administracion', true, 'minorista')
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

create function pg_temp.uid(q text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000002462' || case q when 'super' then '01' when 'admmay' then '02' when 'germin' then '03'
          when 'ventamay' then '04' when 'inact' then '05' when 'opsmay' then '06' when 'admmin' then '07' end)::uuid
$$;

-- ── Foto: todo lo que la anulación podría romper, de un contrato ──────────
create function pg_temp.foto(n text) returns text language sql as $$
  select 'abonos=' || (select count(*) from public.abonos where numero_contrato = n)
      || ' suma=' || (select coalesce(sum(valor_abono), 0)::numeric(15,0) from public.abonos where numero_contrato = n)
      || ' as_abono=' || (select count(*) from public.asientos_contables a where a.origen = 'abono'
                            and a.referencia in (select 'abono:' || b.id from public.abonos b where b.numero_contrato = n))
      || ' huellas=' || (select count(*) from public.abonos_anulados where numero_contrato = n)
      || ' descuadre=' || (select count(*) from (select asiento_id from public.asiento_lineas group by asiento_id having sum(debe) <> sum(haber)) x)
      || ' saldos[' || coalesce((select string_agg(codigo || '=' || s::numeric(15,0), ' ' order by codigo) from (
            select p.codigo, sum(l.debe) - sum(l.haber) s from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
             where l.tercero = n group by p.codigo having sum(l.debe) - sum(l.haber) <> 0) x), '') || ']'
$$;

create function pg_temp.paso(p_rol text, p_quien text, p_sql text, out res text, out f_antes text, out f_desp text, p_n text default null, p_prep text default null)
language plpgsql as $$
declare v_out text; v_state text; v_msg text;
begin
  f_antes := case when p_n is null then null else pg_temp.foto(p_n) end;
  begin
    perform set_config('request.jwt.claims',
      case when p_quien is null then json_build_object('role', p_rol)::text
           else json_build_object('sub', pg_temp.uid(p_quien), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(case when p_quien is null then null else pg_temp.uid(p_quien)::text end, ''), true);  -- auth.uid() de esta imagen lee la GUC vieja
    execute format('set local role %I', p_rol);
    if p_prep is not null then execute p_prep; end if;
    execute p_sql into v_out;
    execute 'reset role';
    res := 'OK ' || coalesce(v_out, '');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    execute 'reset role';
    res := 'ERR ' || v_state || ' ' || left(v_msg, 200);
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  f_desp := case when p_n is null then null else pg_temp.foto(p_n) end;
end $$;

create function pg_temp.caso(p_fase text, p_caso text, p_esperado text, p_rol text, p_quien text, p_sql text,
                             p_n text default null, p_integro boolean default false, p_prep text default null) returns text language plpgsql as $$
declare r record; v_ok boolean;
begin
  select * into r from pg_temp.paso(p_rol, p_quien, p_sql, p_n, p_prep);
  v_ok := r.res ~ p_esperado and (not p_integro or r.f_antes = r.f_desp);
  insert into _r (fase, caso, ok, esperado, obtenido, fotos)
  values (p_fase, p_caso, v_ok, p_esperado || case when p_integro then ' + foto íntegra' else '' end, r.res,
          case when p_n is null then null else r.f_antes || '  ⇒  ' || r.f_desp
               || case when p_integro then case when r.f_antes = r.f_desp then '  · ÍNTEGRO' else '  · ¡CAMBIÓ!' end else '' end end);
  return r.res;
end $$;
create function pg_temp.verifica(p_fase text, p_caso text, p_ok boolean, p_esperado text, p_obtenido text) returns void language sql as $$
  insert into _r (fase, caso, ok, esperado, obtenido) values (p_fase, p_caso, p_ok, p_esperado, p_obtenido)
$$;

create function pg_temp.fact(n text, q text, t text, pvp numeric, irt numeric) returns text language sql as $$
  select format('select public.facturar_factura(%L, %L::uuid, %L, %s, %s, 0, null, null, null, null)::text', n, pg_temp.uid(q), t, pvp, irt)
$$;
create function pg_temp.postear(abono bigint, q text, t text) returns text language sql as $$
  select format('select public.postear_asiento_abono(%s, %L, %L::uuid)::text', abono, t, pg_temp.uid(q))
$$;
create function pg_temp.anular(abono bigint, n text, t text, q text, motivo text default 'Error de digitación') returns text language sql as $$
  select format('select public.anular_abono(%s, %L, %L, %L::uuid, %L)::text', abono, n, t, pg_temp.uid(q), motivo)
$$;
-- id del abono por referencia (los abonos se siembran con referencia única).
create function pg_temp.ab(ref text) returns bigint language sql as $$ select id from public.abonos where referencia = ref $$;

-- ── Siembra ───────────────────────────────────────────────────────────────
-- MIN-248001 reproduce el contrato minorista 534: abono contabilizado (Bancos / Anticipos).
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
select n, 'Cliente ' || n, case when n like 'MIN-%' then 'minorista' else 'mayorista' end, 1800000, 'activo', 'completo', 'COP'
  from unnest(array['MIN-248001','DTM-248002','DTM-248003','DTM-248004','DTM-248005','DTM-248006','DTM-248007','DTM-248008','DTM-248009']) n;
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant, clasificacion)
select numero_contrato, 'Hotel 248', 'hotel', 'Alojamiento', 1500000, tenant, 'irt' from public.ventas where numero_contrato like '%-2480%';

insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia) values
  ('MIN-248001', 'minorista', 500000, 500000, 1, current_date, 'Transferencia', 'R-534'),
  ('MIN-248001', 'minorista', 200000, 200000, 1, current_date, 'Efectivo', 'R-534b'),
  ('DTM-248002', 'mayorista', 600000, 600000, 1, current_date, 'Transferencia', 'R-F1'),
  ('DTM-248003', 'mayorista', 300000, 300000, 1, current_date, 'Transferencia', 'R-PP'),
  ('DTM-248004', 'mayorista', 250000, 250000, 1, current_date, 'Transferencia', 'R-CO'),
  ('DTM-248005', 'mayorista', 100000, 100000, 1, current_date, 'Transferencia', 'R-ANT'),   -- se factura DESPUÉS de este
  ('DTM-248006', 'mayorista', 150000, 150000, 1, current_date, 'Transferencia', 'R-SA'),    -- sin asiento (importado)
  ('DTM-248007', 'mayorista', 400000, 400000, 1, current_date, 'Transferencia', 'R-ROLL'),
  ('DTM-248008', 'mayorista', 350000, 350000, 1, current_date, 'Transferencia', 'R-AGE');

-- Posteo de los asientos de los abonos (como los deja la app: RPC de la 208).
select pg_temp.caso('S', 'S1 posteo ' || r, '^OK .*"estado": "contabilizado"', 'service_role', null,
  pg_temp.postear(pg_temp.ab(r), case when r in ('R-534', 'R-534b') then 'admmin' else 'admmay' end, case when r in ('R-534', 'R-534b') then 'minorista' else 'mayorista' end))
  from unnest(array['R-534','R-534b','R-F1','R-PP','R-CO','R-ANT','R-ROLL','R-AGE']) r;

-- Pago previo aplicado (R-PP) y conciliación (R-CO): se siembran sin FKs externas.
set local session_replication_role = replica;
insert into public.cotizacion_pagos_previos (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago, referencia, registrado_por_id, estado, abono_id)
values (999001, 'mayorista', 300000, 300000, 'COP', 1, 'Transferencia', 'PP-1', pg_temp.uid('admmay'), 'aplicado', pg_temp.ab('R-PP'));
insert into public.conciliacion (id, nota, total) values (990246, 'cruce de prueba 248', 250000);
insert into public.conciliacion_sistema (conciliacion_id, ref, descripcion, fecha, valor)
values (990246, 'abono:' || pg_temp.ab('R-CO'), 'Abono R-CO', current_date, 250000);
set local session_replication_role = origin;

-- ═══ A · Reproducción: el abono con asiento no se podía quitar ═════════════
select pg_temp.caso('A', 'A1 borrar el abono directo (lo que hacía eliminarAbono): la guarda F4415 lo impide', '^ERR F4415', 'service_role', null,
  format('delete from public.abonos where id = %s returning 1', pg_temp.ab('R-534')), 'MIN-248001', true);
select pg_temp.verifica('A', 'A1b el abono tiene asiento y el libro está cuadrado antes de anular',
  pg_temp.foto('MIN-248001') ~ 'abonos=2 suma=700000 as_abono=2 huellas=0 descuadre=0 saldos\[110505=200000 111005=500000 280505=-700000\]'
    or pg_temp.foto('MIN-248001') ~ 'abonos=2 suma=700000 as_abono=2 huellas=0 descuadre=0',
  'abonos=2 suma=700000 as_abono=2 descuadre=0', pg_temp.foto('MIN-248001'));

-- ═══ B · Anulación exitosa, huella, saldos e idempotencia ══════════════════
select pg_temp.caso('B', 'B1 anular R-534 (admin minorista, su agencia)', '^OK .*"estado": "anulado".*"asientos_retirados": 1', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-534'), 'MIN-248001', 'minorista', 'admmin', 'Abono duplicado, contrato 534'), 'MIN-248001');
select pg_temp.verifica('B', 'B1b abono y asiento desaparecen; el otro abono sigue; libro cuadrado',
  pg_temp.foto('MIN-248001') ~ '^abonos=1 suma=200000 as_abono=1 huellas=1 descuadre=0',
  'abonos=1 suma=200000 as_abono=1 huellas=1 descuadre=0', pg_temp.foto('MIN-248001'));
select pg_temp.verifica('B', 'B1c los saldos contables del contrato solo conservan el otro abono (200.000)',
  (select coalesce(sum(l.debe) - sum(l.haber), 0) from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
    where l.tercero = 'MIN-248001' and p.codigo in ('110505', '111005', '111010')) = 200000
  and (select coalesce(sum(l.haber) - sum(l.debe), 0) from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
    where l.tercero = 'MIN-248001' and p.codigo = '280505') = 200000,
  'caja/bancos 200.000 · anticipos 200.000', pg_temp.foto('MIN-248001'));
select pg_temp.verifica('B', 'B1d la huella conserva abono, asiento con líneas, actor y motivo',
  (select z.motivo = 'Abono duplicado, contrato 534' and z.actor_email = 'admmin248@t.test' and z.tenant = 'minorista'
          and (z.abono ->> 'valor_abono')::numeric = 500000 and z.abono ->> 'referencia' = 'R-534'
          and jsonb_array_length(z.asientos) = 1 and jsonb_array_length(z.asientos -> 0 -> 'lineas') = 2
     from public.abonos_anulados z where z.numero_contrato = 'MIN-248001'),
  'motivo, actor, abono y asiento (2 líneas) guardados', (select left(z.abono::text, 120) from public.abonos_anulados z where z.numero_contrato = 'MIN-248001'));
select pg_temp.caso('B', 'B2 doble pulsación / reintento: ya_anulado, no escribe nada', '^OK .*"estado": "ya_anulado"', 'service_role', null,
  format('select public.anular_abono(%s, ''MIN-248001'', ''minorista'', %L::uuid, ''otra vez'')::text', (select abono_id from public.abonos_anulados where numero_contrato = 'MIN-248001'), pg_temp.uid('admmin')),
  'MIN-248001', true);
select pg_temp.caso('B', 'B3 anular el otro abono (efectivo → Caja) deja el contrato en cero', '^OK .*"estado": "anulado"', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-534b'), 'MIN-248001', 'minorista', 'admmin'), 'MIN-248001');
select pg_temp.verifica('B', 'B3b contrato sin abonos, sin asientos de abono y sin saldos contables',
  pg_temp.foto('MIN-248001') = 'abonos=0 suma=0 as_abono=0 huellas=2 descuadre=0 saldos[]', 'abonos=0 suma=0 as_abono=0 huellas=2 saldos[]', pg_temp.foto('MIN-248001'));
select pg_temp.caso('B', 'B4 abono sin asiento (importado): se anula igual, 0 asientos retirados', '^OK .*"estado": "anulado".*"asientos_retirados": 0', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-SA'), 'DTM-248006', 'mayorista', 'admmay'), 'DTM-248006');
select pg_temp.verifica('B', 'B4b la guarda F4415 sigue activa para abonos con asiento',
  exists (select 1 from pg_trigger where tgrelid = 'public.abonos'::regclass and tgname = 'trg_f208_abonos_borrar' and tgenabled = 'O'),
  'trigger activo', 'ok');

-- ═══ C · Fallo a mitad: rollback completo ══════════════════════════════════
-- El trigger falla DESPUÉS de que la RPC retiró el asiento y guardó la huella: todo debe revertirse.
create function public.t248_falla() returns trigger language plpgsql as $$ begin raise exception 'T248 falla simulada al borrar el abono'; end $$;
create trigger t248_falla before delete on public.abonos for each row when (old.referencia = 'R-ROLL') execute function public.t248_falla();
select pg_temp.caso('C', 'C1 falla al borrar el abono (después de retirar el asiento): nada cambia', '^ERR P0001 T248', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-ROLL'), 'DTM-248007', 'mayorista', 'admmay'), 'DTM-248007', true);
select pg_temp.verifica('C', 'C1b sin huella, con su asiento y el libro cuadrado',
  pg_temp.foto('DTM-248007') ~ '^abonos=1 suma=400000 as_abono=1 huellas=0 descuadre=0', 'abonos=1 as_abono=1 huellas=0', pg_temp.foto('DTM-248007'));
drop trigger t248_falla on public.abonos;
drop function public.t248_falla();
select pg_temp.caso('C', 'C2 sin el fallo, la misma anulación sí procede', '^OK .*"estado": "anulado"', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-ROLL'), 'DTM-248007', 'mayorista', 'admmay'), 'DTM-248007');
select pg_temp.caso('C', 'C3 motivo vacío', '^ERR F4462', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'admmay', '  '), 'DTM-248008', true);

-- ═══ D · Dependencias que bloquean ═════════════════════════════════════════
select pg_temp.caso('D', 'D1 pago previo aplicado', '^ERR F4460 FIN_ABONO_PAGO_PREVIO', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-PP'), 'DTM-248003', 'mayorista', 'admmay'), 'DTM-248003', true);
select pg_temp.caso('D', 'D2 conciliado con el extracto', '^ERR F4461 FIN_ABONO_CONCILIADO', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-CO'), 'DTM-248004', 'mayorista', 'admmay'), 'DTM-248004', true);
-- Factura vigente que ya aplicó el anticipo (R-F1 se postea como Anticipos y luego se factura).
select pg_temp.caso('D', 'D3a emitir factura de DTM-248002', '^OK .*"estado": "emitida"', 'service_role', null,
  pg_temp.fact('DTM-248002', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-248002');
select pg_temp.caso('D', 'D3 factura vigente con el anticipo aplicado', '^ERR F4418 FIN_ANTICIPO_APLICADO', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-F1'), 'DTM-248002', 'mayorista', 'admmay'), 'DTM-248002', true);
-- Abono posterior a la factura (acredita Clientes 130505): no depende del anticipo → se puede anular.
select pg_temp.caso('D', 'D4a emitir factura de DTM-248005 (el abono R-ANT se aplica como anticipo)', '^OK .*"estado": "emitida"', 'service_role', null,
  pg_temp.fact('DTM-248005', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-248005');
insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia)
values ('DTM-248005', 'mayorista', 80000, 80000, 1, current_date, 'Transferencia', 'R-POST');
select pg_temp.caso('D', 'D4b abono posterior a la factura (130505)', '^OK .*"estado": "contabilizado"', 'service_role', null,
  pg_temp.postear(pg_temp.ab('R-POST'), 'admmay', 'mayorista'), 'DTM-248005');
select pg_temp.caso('D', 'D4 anular el abono posterior con factura vigente: procede y el anticipo aplicado no se toca', '^OK .*"estado": "anulado"', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-POST'), 'DTM-248005', 'mayorista', 'admmay'), 'DTM-248005');
select pg_temp.verifica('D', 'D4b la factura y el anticipo aplicado siguen: R-ANT intacto y libro cuadrado',
  pg_temp.foto('DTM-248005') ~ '^abonos=1 suma=100000 as_abono=1 huellas=1 descuadre=0', 'abonos=1 as_abono=1 huellas=1 descuadre=0', pg_temp.foto('DTM-248005'));
select pg_temp.caso('D', 'D5 el abono anticipado de ese contrato (ya aplicado a la factura) sigue bloqueado', '^ERR F4418', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-ANT'), 'DTM-248005', 'mayorista', 'admmay'), 'DTM-248005', true);

-- ═══ E · Agencia, contrato y roles ═════════════════════════════════════════
select pg_temp.caso('E', 'E1 administración minorista sobre un contrato mayorista (tenant de la sesión = el suyo)', '^ERR F4402', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'minorista', 'admmin'), 'DTM-248008', true);
select pg_temp.caso('E', 'E2 administración minorista declarando la agencia del contrato (no es la suya)', '^ERR F4402', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'admmin'), 'DTM-248008', true);
select pg_temp.caso('E', 'E3 abono de otro contrato', '^ERR F4405', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248001', 'mayorista', 'admmay'), 'DTM-248008', true);
select pg_temp.caso('E', 'E4 rol venta', '^ERR F4401', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'ventamay'), 'DTM-248008', true);
select pg_temp.caso('E', 'E5 usuario inactivo', '^ERR F4401', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'inact'), 'DTM-248008', true);
select pg_temp.caso('E', 'E6 un usuario autenticado no puede llamar la RPC directo', '^ERR 42501', 'authenticated', 'admmay',
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'admmay'), 'DTM-248008', true);
select pg_temp.caso('E', 'E7 anon tampoco', '^ERR 42501', 'anon', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'admmay'), 'DTM-248008', true);
select pg_temp.caso('E', 'E8 abono inexistente', '^ERR F4405', 'service_role', null,
  pg_temp.anular(99999999, 'DTM-248008', 'mayorista', 'admmay'), 'DTM-248008', true);
select pg_temp.caso('E', 'E9 operaciones de su agencia puede anular', '^OK .*"estado": "anulado"', 'service_role', null,
  pg_temp.anular(pg_temp.ab('R-AGE'), 'DTM-248008', 'mayorista', 'opsmay'), 'DTM-248008');

-- ═══ F · Lectores y huella ═════════════════════════════════════════════════
-- Cartera, ficha, estado de cuenta, recibo y conciliaciones leen `abonos`; con la fila borrada dejan de contarla.
select pg_temp.verifica('F', 'F1 todo lector basado en abonos deja de contar lo anulado (MIN-248001, DTM-248005/6/7/8)',
  (select count(*) from public.abonos where numero_contrato in ('MIN-248001', 'DTM-248006', 'DTM-248007', 'DTM-248008')) = 0
  and (select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = 'DTM-248005') = 100000,
  'MIN-248001/6/7/8 en 0; DTM-248005 en 100.000', (select string_agg(numero_contrato || '=' || n, ' ') from (select numero_contrato, count(*) n from public.abonos where numero_contrato like '%-2480%' group by 1 order by 1) x));
select pg_temp.caso('F', 'F2 vista agregada de abonos (abonos_resumen) para un asesor refleja la anulación', '^OK 100000', 'authenticated', 'admmay',
  'select coalesce(total_pagado, 0)::numeric(15,0)::text from public.abonos_resumen where numero_contrato = ''DTM-248005''');
select pg_temp.caso('F', 'F3 la huella no se edita (service_role: sin privilegio)', '^ERR 42501', 'service_role', null, 'update public.abonos_anulados set motivo = ''x'' returning 1');
select pg_temp.caso('F', 'F4 la huella no se borra (service_role: sin privilegio)', '^ERR 42501', 'service_role', null, 'delete from public.abonos_anulados returning 1');
select pg_temp.caso('F', 'F5 la huella no se trunca (service_role: sin privilegio)', '^ERR 42501', 'service_role', null, 'truncate public.abonos_anulados');
select pg_temp.caso('F', 'F5b el trigger de inmutabilidad (aun con privilegios): editar', '^ERR F4463', 'supabase_admin', null, 'update public.abonos_anulados set motivo = ''x'' returning 1');
select pg_temp.caso('F', 'F5c …borrar', '^ERR F4463', 'supabase_admin', null, 'delete from public.abonos_anulados returning 1');
select pg_temp.caso('F', 'F5d …truncar', '^ERR F4463', 'supabase_admin', null, 'truncate public.abonos_anulados');
select pg_temp.caso('F', 'F6 la huella de la agencia minorista la ve su administración', '^OK [1-9]', 'authenticated', 'admmin',
  'select count(*)::text from public.abonos_anulados where numero_contrato = ''MIN-248001''');
select pg_temp.caso('F', 'F7 …y no la ve la administración de la otra agencia', '^OK 0', 'authenticated', 'admmay',
  'select count(*)::text from public.abonos_anulados where numero_contrato = ''MIN-248001''');
select pg_temp.caso('F', 'F8 venta no ve huellas', '^OK 0', 'authenticated', 'ventamay', 'select count(*)::text from public.abonos_anulados');
select pg_temp.verifica('F', 'F9 ningún asiento de abono huérfano (sin abono vivo ni huella)',
  (select count(*) from public.asientos_contables a where a.origen = 'abono' and a.referencia ~ '^abono:[0-9]+$'
     and not exists (select 1 from public.abonos b where 'abono:' || b.id = a.referencia)
     and not exists (select 1 from public.abonos_anulados z where 'abono:' || z.abono_id = a.referencia)) = 0, '0 huérfanos', 'ok');

-- ═══ G · Registro atómico e idempotente (registrar_abono) ══════════════════
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
values ('DTM-248010', 'Cliente G10', 'mayorista', 1000000, 'activo', 'completo', 'COP'),
       ('DTM-248011', 'Cliente G11', 'mayorista', 1000, 'activo', 'completo', 'USD'),
       ('DTM-248012', 'Cliente G12', 'mayorista', 1000000, 'activo', 'pendiente', 'COP'),
       ('DTM-248013', 'Cliente G13', 'mayorista', 1000000, 'activo', 'completo', 'COP');
create function pg_temp.reg(n text, t text, q text, monto numeric, confirmar boolean default false, op text default null, trm numeric default null) returns text language sql as $$
  select format('select public.registrar_abono(%L, %L, %L::uuid, %s, %s, %L, %L, null, %L, %L)::text',
                n, t, pg_temp.uid(q), monto, coalesce(trm::text, 'null'), 'Transferencia', 'R-G', confirmar, op)
$$;
select pg_temp.caso('G', 'G1 registrar 400.000 (operación A)', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 400000, false, '00000000-0000-4000-8000-0000000a0001'), 'DTM-248010');
select pg_temp.verifica('G', 'G1b el abono nace contabilizable, con su asiento (Bancos / Anticipos) y libro cuadrado',
  (select contabilizable from public.abonos where numero_contrato = 'DTM-248010') is true
  and pg_temp.foto('DTM-248010') ~ '^abonos=1 suma=400000 as_abono=1 huellas=0 descuadre=0 saldos\[111005=400000 280505=-400000\]',
  'contabilizable=true · as_abono=1 · saldos 400.000', pg_temp.foto('DTM-248010'));
select pg_temp.caso('G', 'G2 la MISMA operación otra vez (doble pulsación): ya_registrado, nada cambia', '^OK .*"estado": "ya_registrado"', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 400000, false, '00000000-0000-4000-8000-0000000a0001'), 'DTM-248010', true);
select pg_temp.caso('G', 'G3 la misma operación con OTRO valor', '^ERR F4466', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 999, false, '00000000-0000-4000-8000-0000000a0001'), 'DTM-248010', true);
select pg_temp.caso('G', 'G4 completar el pago (600.000, operación B): se registra sin confirmación', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 600000, false, '00000000-0000-4000-8000-0000000a0002'), 'DTM-248010');
select pg_temp.caso('G', 'G5 un abono más con el contrato pagado, SIN confirmar: pide confirmación y no escribe', '^OK (?=.*"estado": "requiere_confirmacion")(?=.*"total": 1000000)(?=.*"pagado": 1000000)(?=.*"nuevo": 100000)', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 100000, false, '00000000-0000-4000-8000-0000000a0003'), 'DTM-248010', true);
select pg_temp.verifica('G', 'G5b pedir confirmación no consume la operación C', not exists (select 1 from public.abono_operaciones where operacion_id = '00000000-0000-4000-8000-0000000a0003'),
  'sin fila en abono_operaciones', 'ok');
select pg_temp.caso('G', 'G6 el mismo abono CONFIRMADO: el excedente intencional se registra', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 100000, true, '00000000-0000-4000-8000-0000000a0003'), 'DTM-248010');
select pg_temp.caso('G', 'G7 repetir la confirmación (doble pulsación en «Confirmar»): ya_registrado', '^OK .*"estado": "ya_registrado"', 'service_role', null,
  pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 100000, true, '00000000-0000-4000-8000-0000000a0003'), 'DTM-248010', true);
select pg_temp.verifica('G', 'G7b quedan 3 abonos (400.000 + 600.000 + 100.000 de excedente) y el libro cuadra',
  pg_temp.foto('DTM-248010') ~ '^abonos=3 suma=1100000 as_abono=3 huellas=0 descuadre=0', 'abonos=3 suma=1100000 as_abono=3', pg_temp.foto('DTM-248010'));
select pg_temp.caso('G', 'G8 otra agencia', '^ERR F4402', 'service_role', null,
  pg_temp.reg('DTM-248010', 'minorista', 'admmin', 1000, true), 'DTM-248010', true);
select pg_temp.caso('G', 'G9 rol venta', '^ERR F4401', 'service_role', null, pg_temp.reg('DTM-248010', 'mayorista', 'ventamay', 1000, true), 'DTM-248010', true);
select pg_temp.caso('G', 'G10 valor 0', '^ERR F4464', 'service_role', null, pg_temp.reg('DTM-248010', 'mayorista', 'admmay', 0, true), 'DTM-248010', true);
select pg_temp.caso('G', 'G11 contrato con registro financiero pendiente', '^ERR F4465', 'service_role', null, pg_temp.reg('DTM-248012', 'mayorista', 'admmay', 1000), 'DTM-248012', true);
select pg_temp.caso('G', 'G12 contrato USD sin TRM', '^ERR F4467', 'service_role', null, pg_temp.reg('DTM-248011', 'mayorista', 'admmay', 4000000), 'DTM-248011', true);
select pg_temp.caso('G', 'G13 contrato USD con TRM: 4.000.000 COP / 4000 = USD 1000 y queda cubierto', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg('DTM-248011', 'mayorista', 'admmay', 4000000, false, null, 4000), 'DTM-248011');
select pg_temp.caso('G', 'G14 USD cubierto: pide confirmación en dólares', '^OK (?=.*"requiere_confirmacion")(?=.*"nuevo": 25)(?=.*"moneda": "USD")', 'service_role', null,
  pg_temp.reg('DTM-248011', 'mayorista', 'admmay', 100000, false, null, 4000), 'DTM-248011', true);
select pg_temp.caso('G', 'G15 un insert directo de service_role sigue siendo NO contabilizable (importaciones/pago previo, regla de la 208)', '^OK f', 'service_role', null,
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, referencia) values (''DTM-248013'', ''mayorista'', 5000, 5000, 1, current_date, ''IMPORT'') returning contabilizable::text');
select pg_temp.caso('G', 'G16 la RPC no es invocable por authenticated', '^ERR 42501', 'authenticated', 'admmay', pg_temp.reg('DTM-248013', 'mayorista', 'admmay', 1000));
-- El asiento no tumba el abono: se rompe a propósito la cuenta 280505 del PUC.
update public.puc_cuentas set codigo = 'x280505' where tenant = 'mayorista' and codigo = '280505';
select pg_temp.caso('G', 'G17 si el asiento falla, el abono queda y se informa asiento_error', '^OK .*"estado": "registrado".*"asiento_error"', 'service_role', null,
  pg_temp.reg('DTM-248013', 'mayorista', 'admmay', 2000, false, '00000000-0000-4000-8000-0000000a0017'));
update public.puc_cuentas set codigo = '280505' where tenant = 'mayorista' and codigo = 'x280505';
select pg_temp.verifica('G', 'G17b el abono de G17 existe sin asiento y sin dejar líneas huérfanas',
  (select count(*) from public.abonos where numero_contrato = 'DTM-248013' and valor_abono = 2000) = 1
  and not exists (select 1 from public.asientos_contables a where a.origen = 'abono' and not exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id)),
  '1 abono, 0 asientos vacíos', 'ok');

-- ── H · La clave de idempotencia identifica el abono COMPLETO ──────────────
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
values ('DTM-248014', 'Cliente H14', 'mayorista', 1000000, 'activo', 'completo', 'COP'),
       ('DTM-248015', 'Cliente H15', 'mayorista', 1000, 'activo', 'completo', 'USD');
create function pg_temp.reg2(n text, q text, monto numeric, forma text, ref text, fecha date, trm numeric, op text, confirmar boolean default false) returns text language sql as $$
  select format('select public.registrar_abono(%L, ''mayorista'', %L::uuid, %s, %s, %L, %L, %L::date, %L, %L)::text',
                n, pg_temp.uid(q), monto, coalesce(trm::text, 'null'), forma, ref, fecha, confirmar, op)
$$;
select pg_temp.caso('H', 'H1 registrar con todos los datos explícitos (operación 1)', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014');
select pg_temp.caso('H', 'H2 la misma clave con TODOS los datos iguales: ya_registrado', '^OK .*"estado": "ya_registrado"', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3a …con otra forma de pago', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Efectivo', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3b …con otra referencia', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-B', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3c …con otra fecha', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-29', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3d …con otro valor', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100001, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3e …registrado por otro usuario', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'opsmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H3f …sobre otro contrato', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248010', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248010', true);
select pg_temp.caso('H', 'H4 USD: operación con TRM 4000', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg2('DTM-248015', 'admmay', 400000, 'Transferencia', 'REF-U', '2026-09-30', 4000, '00000000-0000-4000-8000-0000000b0002'), 'DTM-248015');
select pg_temp.caso('H', 'H4b …la misma clave con otra TRM (mismos pesos, distinto valor en USD)', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248015', 'admmay', 400000, 'Transferencia', 'REF-U', '2026-09-30', 4100, '00000000-0000-4000-8000-0000000b0002'), 'DTM-248015', true);
select pg_temp.caso('H', 'H5 anular el abono de la operación 1', '^OK .*"estado": "anulado"', 'service_role', null,
  pg_temp.anular(pg_temp.ab('REF-A'), 'DTM-248014', 'mayorista', 'admmay'), 'DTM-248014');
select pg_temp.caso('H', 'H5b reutilizar esa clave con los mismos datos tras anular: NO hay éxito fantasma (F4468) y no se crea nada', '^ERR F4468 FIN_OPERACION_ANULADA', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0001'), 'DTM-248014', true);
select pg_temp.caso('H', 'H5c el mismo pago como operación NUEVA sí se registra', '^OK .*"estado": "registrado"', 'service_role', null,
  pg_temp.reg2('DTM-248014', 'admmay', 100000, 'Transferencia', 'REF-A', '2026-09-30', null, '00000000-0000-4000-8000-0000000b0003'), 'DTM-248014');
select pg_temp.verifica('H', 'H5d quedan: 1 abono vivo, 1 huella, 2 operaciones; ninguna operación apunta a un abono inexistente salvo la anulada (con huella)',
  (select count(*) from public.abonos where numero_contrato = 'DTM-248014') = 1
  and (select count(*) from public.abonos_anulados where numero_contrato = 'DTM-248014') = 1
  and (select count(*) from public.abono_operaciones where numero_contrato = 'DTM-248014') = 2
  and not exists (select 1 from public.abono_operaciones o where o.numero_contrato = 'DTM-248014' and not exists (select 1 from public.abonos b where b.id = o.abono_id)
                    and not exists (select 1 from public.abonos_anulados z where z.abono_id = o.abono_id)),
  'abonos=1 huellas=1 operaciones=2', pg_temp.foto('DTM-248014'));

-- ═══ I · El asiento falla al registrar: el reintento con la MISMA operación informa el estado contable real ═══
-- Un trigger (apagable) hace fallar el INSERT del asiento de este contrato; el abono y su operación sí quedan.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
values ('DTM-248016', 'Cliente I16', 'mayorista', 1000000, 'activo', 'completo', 'COP');
create function public.t248_sin_asiento() returns trigger language plpgsql as $$
begin
  if current_setting('t248.falla', true) = 'on' and new.origen = 'abono' and new.descripcion like 'Abono DTM-248016%' then
    raise exception 'T248 el asiento no se puede escribir';
  end if;
  return new;
end $$;
create trigger t248_sin_asiento before insert on public.asientos_contables for each row execute function public.t248_sin_asiento();
select set_config('t248.falla', 'on', false);
select pg_temp.caso('I', 'I1 registrar con el asiento fallando: el abono queda y se informa asiento_error', '^OK (?=.*"estado": "registrado")(?=.*"asiento_error": "T248)',
  'service_role', null,
  pg_temp.reg2('DTM-248016', 'admmay', 300000, 'Transferencia', 'REF-I', '2026-09-30', null, '00000000-0000-4000-8000-0000000c0001'), 'DTM-248016');
select pg_temp.verifica('I', 'I1b 1 abono, 1 operación, SIN asiento',
  pg_temp.foto('DTM-248016') ~ '^abonos=1 suma=300000 as_abono=0 huellas=0 descuadre=0 saldos\[\]'
  and (select count(*) from public.abono_operaciones where numero_contrato = 'DTM-248016') = 1,
  'abonos=1 as_abono=0 operaciones=1', pg_temp.foto('DTM-248016'));
select pg_temp.caso('I', 'I2 reintento idéntico mientras sigue fallando: NO es éxito limpio (ya_registrado + asiento_error), sin duplicar',
  '^OK (?=.*"estado": "ya_registrado")(?=.*"asiento_error": "T248)', 'service_role', null,
  pg_temp.reg2('DTM-248016', 'admmay', 300000, 'Transferencia', 'REF-I', '2026-09-30', null, '00000000-0000-4000-8000-0000000c0001'), 'DTM-248016', true);
select set_config('t248.falla', 'off', false);
select pg_temp.caso('I', 'I3 reintento idéntico ya sin fallo: ya_registrado SIN asiento_error y el asiento queda escrito', '^OK (?!.*asiento_error).*"estado": "ya_registrado"',
  'service_role', null,
  pg_temp.reg2('DTM-248016', 'admmay', 300000, 'Transferencia', 'REF-I', '2026-09-30', null, '00000000-0000-4000-8000-0000000c0001'), 'DTM-248016');
select pg_temp.verifica('I', 'I3b 1 abono, 1 asiento (Bancos / Anticipos), libro cuadrado, 1 operación',
  pg_temp.foto('DTM-248016') = 'abonos=1 suma=300000 as_abono=1 huellas=0 descuadre=0 saldos[111005=300000 280505=-300000]'
  and (select count(*) from public.abono_operaciones where numero_contrato = 'DTM-248016') = 1,
  'abonos=1 as_abono=1 saldos[111005=300000 280505=-300000]', pg_temp.foto('DTM-248016'));
select pg_temp.caso('I', 'I4 otro reintento idéntico: idempotente (sin asiento duplicado ni cambios)', '^OK (?!.*asiento_error).*"estado": "ya_registrado"',
  'service_role', null,
  pg_temp.reg2('DTM-248016', 'admmay', 300000, 'Transferencia', 'REF-I', '2026-09-30', null, '00000000-0000-4000-8000-0000000c0001'), 'DTM-248016', true);
select pg_temp.caso('I', 'I5 reintento con otros datos tras el fallo: sigue siendo F4466 (no se cuela otro abono)', '^ERR F4466', 'service_role', null,
  pg_temp.reg2('DTM-248016', 'admmay', 300001, 'Transferencia', 'REF-I', '2026-09-30', null, '00000000-0000-4000-8000-0000000c0001'), 'DTM-248016', true);
drop trigger t248_sin_asiento on public.asientos_contables;
drop function public.t248_sin_asiento();

-- ── Resultado ─────────────────────────────────────────────────────────────
\echo '=== RESULTADOS 248 (una sesión) ==='
\pset format unaligned
\pset fieldsep ' | '
select n, fase, caso, case when ok then 'OK' else 'FALLA' end as r, esperado, left(obtenido, 240) as obtenido, fotos from _r order by n;
select count(*) filter (where ok) as pasan, count(*) filter (where not ok) as fallan, count(*) as total from _r;
rollback;
