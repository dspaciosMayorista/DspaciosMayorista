-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS 208 · facturación transaccional (una sesión). SOLO base local
-- desechable con 001–205 + 206 + 208 aplicadas. Todo corre en UNA transacción
-- que termina en ROLLBACK (incluida la retirada parcial: el rollback_208 se
-- aplica DENTRO de la transacción y se deshace al final).
--
-- Uso (desde dspacios-travel/):
--   psql … -d <base_desechable> -v rollback_208="$(pwd)/supabase/scripts/rollback_208_facturacion_transaccional.sql" \
--        -f supabase/scripts/test_208_facturacion.sql
--   (con docker exec: copia antes el rollback al contenedor y pasa su ruta).
--
-- Salida: una fila por caso → caso | OK/FALLA | esperado | obtenido | foto antes ⇒ después.
-- Al final, el conteo de FALLA (debe ser 0). Las carreras (dos sesiones con
-- commits reales) están en test_208_carrera.sh.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
\pset pager off
begin;
do $$ begin
  if to_regclass('public.factura_revision_fuera_libros') is null then raise exception 'La 208 no está aplicada en esta base.'; end if;
  if current_database() in ('postgres', 'plantilla205') then raise exception 'Usa una base desechable.'; end if;
end $$;

create temp table _r (n serial, fase text, caso text, ok boolean, esperado text, obtenido text, fotos text) on commit drop;
grant all on _r to public;
grant all on sequence _r_n_seq to public;

-- ── Usuarios ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000208201', 'super208@t.test'), ('00000000-0000-0000-0000-000000208202', 'admmay208@t.test'),
  ('00000000-0000-0000-0000-000000208203', 'germin208@t.test'), ('00000000-0000-0000-0000-000000208204', 'ventamay208@t.test'),
  ('00000000-0000-0000-0000-000000208205', 'inact208@t.test'), ('00000000-0000-0000-0000-000000208206', 'opsmay208@t.test'),
  ('00000000-0000-0000-0000-000000208207', 'admmin208@t.test'), ('00000000-0000-0000-0000-000000208208', 'germay208@t.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000208201', 'super208@t.test', 'Super 208', 'superadmin', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000208202', 'admmay208@t.test', 'Adm May 208', 'administracion', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000208203', 'germin208@t.test', 'Ger Min 208', 'gerencia', true, 'minorista'),
  ('00000000-0000-0000-0000-000000208204', 'ventamay208@t.test', 'Venta May 208', 'venta', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000208205', 'inact208@t.test', 'Inactivo 208', 'administracion', false, 'mayorista'),
  ('00000000-0000-0000-0000-000000208206', 'opsmay208@t.test', 'Ops May 208', 'operaciones', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000208207', 'admmin208@t.test', 'Adm Min 208', 'administracion', true, 'minorista'),
  ('00000000-0000-0000-0000-000000208208', 'germay208@t.test', 'Ger May 208', 'gerencia', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

create function pg_temp.uid(q text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000002082' || case q when 'super' then '01' when 'admmay' then '02' when 'germin' then '03'
          when 'ventamay' then '04' when 'inact' then '05' when 'opsmay' then '06' when 'admmin' then '07' when 'germay' then '08' end)::uuid
$$;

-- ── Fotos ─────────────────────────────────────────────────────────────────
create function pg_temp.foto(n text) returns text language sql as $$
  select 'cfg=' || coalesce((select coalesce(irt::numeric(15,0)::text, '-') || '/' || coalesce(ingreso_propio::numeric(15,0)::text, '-')
                                   || '/' || coalesce(ingreso_exento::numeric(15,0)::text, '-') || '/dian=' || dian_emitida
                                   || '/as=' || (asiento_factura_id is not null) || '/rv=' || (revision_id is not null)
                              from public.contrato_facturacion where numero_contrato = n), 'no')
      || ' fact=' || (select count(*) from public.asientos_contables where referencia = 'facturacion:' || n and origen = 'facturacion')
      || ' rev=' || (select count(*) from public.asientos_contables where referencia = 'facturacion:' || n and origen = 'facturacion_reversion')
      || ' vacios=' || (select count(*) from public.asientos_contables a where a.referencia = 'facturacion:' || n
                          and not exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id))
      || ' const=' || (select count(*) from public.factura_revision_fuera_libros where numero_contrato = n)
      || ' abonos=' || (select count(*) from public.abonos where numero_contrato = n)
      || ' as_abono=' || (select count(*) from public.asientos_contables a where a.origen = 'abono'
                            and a.referencia in (select 'abono:' || b.id from public.abonos b where b.numero_contrato = n))
      || ' saldos[' || coalesce((select string_agg(codigo || '=' || s::numeric(15,0), ' ' order by codigo) from (
            select p.codigo, sum(l.debe) - sum(l.haber) s from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id
             where l.tercero = n group by p.codigo having sum(l.debe) - sum(l.haber) <> 0) x), '') || ']'
$$;

-- Paso: ejecuta `p_sql` como `p_rol` (JWT con sub = p_quien). Si falla, la
-- subtransacción deshace todo; devuelve 'OK …' o 'ERR <sqlstate> <mensaje>'.
create function pg_temp.paso(p_rol text, p_quien text, p_sql text, out res text, out f_antes text, out f_desp text, p_n text default null, p_prep text default null)
language plpgsql as $$
declare v_out text; v_state text; v_msg text;
begin
  f_antes := case when p_n is null then null else pg_temp.foto(p_n) end;
  begin
    perform set_config('request.jwt.claims',
      case when p_quien is null then json_build_object('role', p_rol)::text
           else json_build_object('sub', pg_temp.uid(p_quien), 'role', p_rol)::text end, true);
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
  f_desp := case when p_n is null then null else pg_temp.foto(p_n) end;
end $$;

-- Registra un caso: `esperado` es una expresión regular sobre `res`.
-- `integro` = true exige foto idéntica antes ⇒ después (rechazos/fallos).
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

-- Llamadas a las RPC (como service_role, con el actor dado).
create function pg_temp.fact(n text, q text, t text, pvp numeric, irt numeric, exento numeric default 0, hash text default null, nota text default null)
returns text language sql as $$
  select format('select public.facturar_factura(%L, %L::uuid, %L, %s, %s, %s, null, null, %L, %L)::text', n, pg_temp.uid(q), t, pvp, irt, exento, hash, nota)
$$;
create function pg_temp.quitar(n text, q text, t text) returns text language sql as $$
  select format('select public.quitar_factura(%L, %L::uuid, %L)::text', n, pg_temp.uid(q), t)
$$;
create function pg_temp.dian(n text, q text, t text, e boolean) returns text language sql as $$
  select format('select public.marcar_dian_factura(%L, %L::uuid, %L, %L)::text', n, pg_temp.uid(q), t, e)
$$;
create function pg_temp.postear(abono bigint, q text, t text) returns text language sql as $$
  select format('select public.postear_asiento_abono(%s, %L, %L::uuid)::text', abono, t, pg_temp.uid(q))
$$;
create function pg_temp.hash(n text) returns text language sql as $$
  select f208_priv.hash_fotografia(f208_priv.fotografia_fuera_libros(n))
$$;

-- ── Siembra ───────────────────────────────────────────────────────────────
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda, trm_contrato)
select n, 'Cliente ' || n, case when n like 'MIN-%' then 'minorista' else 'mayorista' end,
       case when n = 'DTM-208014' then 1000 else 1800000 end, 'activo', 'completo',
       case when n = 'DTM-208014' then 'USD' else 'COP' end, case when n = 'DTM-208014' then 4000 end
  from unnest(array['DTM-208001','DTM-208002','DTM-208003','DTM-208004','MIN-208005','DTM-208006','DTM-208007','DTM-208008',
                    'DTM-208009','DTM-208010','DTM-208011','DTM-208012','MIN-208013','DTM-208014','DTM-208015','DTM-208016']) n;
-- CxP del hotel marcada IRT (1.500.000; en USD 800).
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant, clasificacion)
select numero_contrato, 'Hotel 208', 'hotel', 'Alojamiento', case when numero_contrato = 'DTM-208014' then 800 else 1500000 end, tenant, 'irt'
  from public.ventas where numero_contrato like '%-2080%' or numero_contrato like '%-2081%';

-- Abonos HISTÓRICOS (anteriores a la 208): se siembran sin disparadores y se
-- corre el corte para que queden antes de él, como los 310 de minorista.
set local session_replication_role = replica;
insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia, contabilizable) values
  ('DTM-208006', 'mayorista', 400000, 400000, 1, '2025-01-10', 'Transferencia', 'H-1', null),   -- sin asiento
  ('DTM-208006', 'mayorista', 300000, 300000, 1, '2025-01-20', 'Efectivo', 'H-2', null),        -- asiento parcial (200.000)
  ('MIN-208013', 'minorista', 250000, 250000, 1, '2025-02-01', 'Transferencia', 'H-3', null),   -- sin asiento (minorista)
  ('DTM-208015', 'mayorista', 100000, null, null, '2025-03-01', 'Transferencia', 'H-4', null);  -- sin valor en pesos
insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia)
select 'mayorista', (select coalesce(max(numero), 0) + 1 from public.asientos_contables where tenant = 'mayorista'), '2025-01-20', 'Abono histórico', 'abono', 'abono:' || id
  from public.abonos where referencia = 'H-2';
insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, debe, haber)
select 'mayorista', a.id, p.id, 'DTM-208006', case when p.codigo = '110505' then 200000 else 0 end, case when p.codigo = '280505' then 200000 else 0 end
  from public.asientos_contables a, public.puc_cuentas p
 where a.referencia = 'abono:' || (select id from public.abonos where referencia = 'H-2') and p.tenant = 'mayorista' and p.codigo in ('110505', '280505');
set local session_replication_role = origin;
update f208_priv.corte set ultimo_abono_id = (select max(id) from public.abonos);

-- ═══ A · 208 activa: emitir, idempotencia, importes, agencia, roles ═══════
select pg_temp.caso('A', 'A1 emitir (administración mayorista, sin abonos)', '^OK .*"estado": "emitida"', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208001');
select pg_temp.verifica('A', 'A1b asiento de la factura', pg_temp.foto('DTM-208001') ~ 'saldos\[130505=1800000 281510=-1500000 413505=-300000\]',
  'Clientes 1.800.000 · IRT -1.500.000 · ingreso propio -300.000', pg_temp.foto('DTM-208001'));
select pg_temp.verifica('A', 'A1c fecha del asiento = día de negocio (Bogotá, fecha_negocio())',
  (select a.fecha = public.fecha_negocio() from public.asientos_contables a join public.contrato_facturacion c on c.asiento_factura_id = a.id where c.numero_contrato = 'DTM-208001'),
  'asientos_contables.fecha = fecha_negocio()', (select a.fecha::text || ' / ' || public.fecha_negocio()::text from public.asientos_contables a join public.contrato_facturacion c on c.asiento_factura_id = a.id where c.numero_contrato = 'DTM-208001'));
select pg_temp.caso('A', 'A2 re-emitir igual (idempotente)', '^OK .*"estado": "sin_cambios"', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208001', true);
select pg_temp.caso('A', 'A3 cambiar exento: reversa + nueva', '^OK .*"estado": "emitida"', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 1800000, 1500000, 100000), 'DTM-208001');
select pg_temp.verifica('A', 'A3b una sola vigente', pg_temp.foto('DTM-208001') ~ 'cfg=1500000/300000/100000/dian=false/as=true/rv=false fact=2 rev=1 vacios=0',
  'fact=2 rev=1, configuración con exento', pg_temp.foto('DTM-208001'));
select pg_temp.caso('A', 'A4 importes manipulados (PVP original)', '^ERR F4410 FIN_IMPORTES_DESACTUALIZADOS', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 2000000, 1500000), 'DTM-208001', true);
select pg_temp.caso('A', 'A4b IRT manipulado', '^ERR F4410', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 1800000, 900000), 'DTM-208001', true);
select pg_temp.caso('A', 'A5 administración mayorista sobre contrato de minorista', '^ERR F4402 FIN_OTRA_AGENCIA', 'service_role', null,
  pg_temp.fact('MIN-208005', 'admmay', 'minorista', 1800000, 1500000), 'MIN-208005', true);
select pg_temp.caso('A', 'A5b superadmin con la otra agencia activa', '^ERR F4402', 'service_role', null,
  pg_temp.fact('MIN-208005', 'super', 'mayorista', 1800000, 1500000), 'MIN-208005', true);
select pg_temp.caso('A', 'A5c gerencia de minorista sobre contrato de mayorista', '^ERR F4402', 'service_role', null,
  pg_temp.fact('DTM-208002', 'germin', 'mayorista', 1800000, 1500000), 'DTM-208002', true);
select pg_temp.caso('A', 'A5d gerencia de mayorista con su agencia', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208002', 'germay', 'mayorista', 1800000, 1500000), 'DTM-208002');
select pg_temp.caso('A', 'A5e superadmin con la agencia del contrato (minorista)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('MIN-208005', 'super', 'minorista', 1800000, 1500000), 'MIN-208005');
select pg_temp.caso('A', 'A6 rol venta', '^ERR F4401 FIN_NO_AUTORIZADO', 'service_role', null,
  pg_temp.fact('DTM-208003', 'ventamay', 'mayorista', 1800000, 1500000), 'DTM-208003', true);
select pg_temp.caso('A', 'A6b rol operaciones', '^ERR F4401', 'service_role', null,
  pg_temp.fact('DTM-208003', 'opsmay', 'mayorista', 1800000, 1500000), 'DTM-208003', true);
select pg_temp.caso('A', 'A6c usuario inactivo', '^ERR F4401', 'service_role', null,
  pg_temp.fact('DTM-208003', 'inact', 'mayorista', 1800000, 1500000), 'DTM-208003', true);
select pg_temp.caso('A', 'A6d authenticated llama la RPC directo', '^ERR 42501', 'authenticated', 'admmay',
  pg_temp.fact('DTM-208003', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208003', true);
select pg_temp.caso('A', 'A6e anon llama la RPC', '^ERR 42501', 'anon', null,
  pg_temp.fact('DTM-208003', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208003', true);
select pg_temp.caso('A', 'A7 USD: convierte con la TRM del contrato (1.000 × 4.000)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208014', 'admmay', 'mayorista', 4000000, 3200000), 'DTM-208014');
select pg_temp.verifica('A', 'A7b asiento USD en pesos', pg_temp.foto('DTM-208014') ~ 'saldos\[130505=4000000 281510=-3200000 413505=-800000\]',
  'Clientes 4.000.000 · IRT -3.200.000 · propio -800.000', pg_temp.foto('DTM-208014'));
select pg_temp.caso('A', 'A7c USD: el PVP original sin convertir se rechaza', '^ERR F4410', 'service_role', null,
  pg_temp.fact('DTM-208014', 'admmay', 'mayorista', 1000, 800), 'DTM-208014', true);

-- Factura vigente en OTRA agencia (como las que dejaba el defecto FACT-2):
-- se siembra sin disparadores (preparación de prueba) y bloquea re-facturar.
set local session_replication_role = replica;
insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia)
values ('minorista', 990206, current_date, 'Simulación FACT-2', 'facturacion', 'facturacion:DTM-208016');
set local session_replication_role = origin;
select pg_temp.caso('A', 'A12 factura vigente en otra agencia (residuo FACT-2)', '^ERR F4412 FIN_FACTURA_EN_OTRA_AGENCIA: .* en la agencia minorista;', 'service_role', null,
  pg_temp.fact('DTM-208016', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208016', true);

-- DIAN
select pg_temp.caso('A', 'A8 marcar DIAN sin configuración', '^ERR F4435 FIN_DIAN_SIN_FACTURA', 'service_role', null,
  pg_temp.dian('DTM-208003', 'admmay', 'mayorista', true), 'DTM-208003', true);
select pg_temp.caso('A', 'A8b marcar DIAN (factura vigente)', '^OK .*marcada', 'service_role', null,
  pg_temp.dian('DTM-208002', 'admmay', 'mayorista', true), 'DTM-208002');
select pg_temp.verifica('A', 'A8b2 dian_fecha = día de negocio (Bogotá)', (select dian_fecha = public.fecha_negocio() from public.contrato_facturacion where numero_contrato = 'DTM-208002'),
  'dian_fecha = fecha_negocio()', (select dian_fecha::text from public.contrato_facturacion where numero_contrato = 'DTM-208002'));
select pg_temp.caso('A', 'A8c volver a marcar (idempotente)', '^OK .*sin_cambios', 'service_role', null,
  pg_temp.dian('DTM-208002', 'admmay', 'mayorista', true), 'DTM-208002', true);
select pg_temp.caso('A', 'A8d desmarcar DIAN', '^ERR F4434 FIN_DIAN_INMUTABLE', 'service_role', null,
  pg_temp.dian('DTM-208002', 'admmay', 'mayorista', false), 'DTM-208002', true);
select pg_temp.caso('A', 'A8e cambiar una factura emitida a la DIAN', '^ERR F4434', 'service_role', null,
  pg_temp.fact('DTM-208002', 'admmay', 'mayorista', 1800000, 1500000, 50000), 'DTM-208002', true);
select pg_temp.caso('A', 'A8f re-guardar la factura DIAN sin cambios', '^OK .*sin_cambios', 'service_role', null,
  pg_temp.fact('DTM-208002', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208002', true);
select pg_temp.caso('A', 'A8g quitar una factura emitida a la DIAN', '^ERR F4434', 'service_role', null,
  pg_temp.quitar('DTM-208002', 'admmay', 'mayorista'), 'DTM-208002', true);
select pg_temp.caso('A', 'A8h marcar DIAN de otra agencia', '^ERR F4402', 'service_role', null,
  pg_temp.dian('MIN-208005', 'admmay', 'minorista', true), 'MIN-208005', true);

-- Quitar (Q3 secuencial)
select pg_temp.caso('A', 'A9 quitar', '^OK .*retirada', 'service_role', null, pg_temp.quitar('DTM-208001', 'admmay', 'mayorista'), 'DTM-208001');
select pg_temp.verifica('A', 'A9b sin factura vigente ni configuración', pg_temp.foto('DTM-208001') ~ '^cfg=no fact=2 rev=2 vacios=0 const=0 abonos=0 as_abono=0 saldos\[\]$',
  'cfg=no fact=2 rev=2, saldos vacíos', pg_temp.foto('DTM-208001'));
select pg_temp.verifica('A', 'A9b2 fecha de la reversa = día de negocio', (select bool_and(fecha = public.fecha_negocio()) from public.asientos_contables
   where referencia = 'facturacion:DTM-208001' and origen = 'facturacion_reversion'), 'reversas con fecha_negocio()', '');
select pg_temp.caso('A', 'A9c quitar otra vez (Q3: una sola reversión)', '^ERR F4438 FIN_SIN_FACTURA_VIGENTE', 'service_role', null,
  pg_temp.quitar('DTM-208001', 'admmay', 'mayorista'), 'DTM-208001', true);
select pg_temp.caso('A', 'A9d volver a emitir tras quitar', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208001', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208001');

-- Fallos intermedios (Q4, COMP-1 en la base, constancia): rollback completo.
select pg_temp.caso('A', 'A10 preparar DTM-208003 (emitida)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208003', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208003');
create or replace function public.t208_falla_delete() returns trigger language plpgsql as $$
begin raise exception 'fallo forzado t208 en DELETE'; end $$;
create trigger t208_falla_delete before delete on public.contrato_facturacion for each row execute function public.t208_falla_delete();
select pg_temp.caso('A', 'A10b Q4 quitar con fallo forzado en el DELETE', '^ERR P0001 fallo forzado t208', 'service_role', null,
  pg_temp.quitar('DTM-208003', 'admmay', 'mayorista'), 'DTM-208003', true);
drop trigger t208_falla_delete on public.contrato_facturacion;

select pg_temp.caso('A', 'A11 preparar DTM-208004 (emitida)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208004', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208004');
update public.puc_cuentas set codigo = '281510-t208' where tenant = 'mayorista' and codigo = '281510';
create function public.t208_sin_borrar() returns trigger language plpgsql as $$
begin raise exception 'borrado bloqueado t208'; end $$;
create trigger t208_sin_borrar before delete on public.asientos_contables for each row execute function public.t208_sin_borrar();
select pg_temp.caso('A', 'A11b COMP-1: falla el asiento nuevo (sin 281510) y no se puede borrar nada', '^ERR F4416 FIN_PUC_INCOMPLETO: Falta la cuenta 281510', 'service_role', null,
  pg_temp.fact('DTM-208004', 'admmay', 'mayorista', 1800000, 1500000, 100000), 'DTM-208004', true);
drop trigger t208_sin_borrar on public.asientos_contables;
update public.puc_cuentas set codigo = '281510' where tenant = 'mayorista' and codigo = '281510-t208';

-- ═══ B · abonos fuera de libros: aviso + constancia atómica ══════════════
select pg_temp.caso('B', 'B1 emitir con abonos históricos sin asiento, sin revisar', '^ERR F4431 FIN_REVISION_REQUERIDA', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208006', true);
select pg_temp.caso('B', 'B2 emitir con un hash distinto', '^ERR F4430 FIN_REVISION_DESACTUALIZADA', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000, 0, repeat('0', 64)), 'DTM-208006', true);
select pg_temp.verifica('B', 'B3 fotografía: H-1 sin asiento (400.000 sin respaldo) · H-2 respaldo parcial (200.000/100.000)',
  (select (f -> 'abonos' -> 0 -> 'respaldo' ->> 'sin_respaldo')::numeric = 400000
      and (f -> 'abonos' -> 1 -> 'respaldo' ->> 'respaldado')::numeric = 200000
      and (f -> 'abonos' -> 1 -> 'respaldo' ->> 'sin_respaldo')::numeric = 100000
      and (f ->> 'total_sin_respaldo_cop')::numeric = 500000
      and f -> 'abonos' -> 0 ->> 'procedencia' = 'historico'
      and not (f -> 'abonos' -> 0 ->> 'pendiente_contabilizar')::boolean
     from (select f208_priv.fotografia_fuera_libros('DTM-208006') f) x),
  'H-1 400.000 sin respaldo; H-2 200.000 respaldado + 100.000 sin respaldo; total 500.000',
  (select f::text from (select f208_priv.fotografia_fuera_libros('DTM-208006') f) x));
select pg_temp.verifica('B', 'B3b fotografía: abono sin valor en pesos → no calculable',
  (select (f -> 'abonos' -> 0 -> 'respaldo' ->> 'calculable')::boolean = false and (f ->> 'no_calculables')::int = 1
     from (select f208_priv.fotografia_fuera_libros('DTM-208015') f) x), 'calculable=false',
  (select (f -> 'abonos' -> 0 -> 'respaldo')::text from (select f208_priv.fotografia_fuera_libros('DTM-208015') f) x));
select pg_temp.caso('B', 'B3c consultar (aviso previo)', '^OK .*"requiere_revision": true', 'service_role', null,
  format('select public.consultar_factura_fuera_libros(%L, %L::uuid, %L)::text', 'DTM-208006', pg_temp.uid('admmay'), 'mayorista'), 'DTM-208006', true);
select pg_temp.caso('B', 'B4 emitir con el hash revisado y nota', '^OK .*"estado": "emitida".*"revision_id": [0-9]', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000, 0, pg_temp.hash('DTM-208006'), 'Revisado con cartera'), 'DTM-208006');
select pg_temp.verifica('B', 'B4b constancia vinculada a ESA emisión',
  (select r.evento = 'revision_emitida' and r.asiento_factura_id = c.asiento_factura_id and r.hash = pg_temp.hash('DTM-208006')
      and r.actor = pg_temp.uid('admmay') and r.actor_rol = 'administracion' and r.nota = 'Revisado con cartera'
      and r.config_factura = jsonb_build_object('irt', 1500000, 'ingreso_propio', 300000, 'ingreso_exento', 0, 'tipo_exento', null, 'observacion', null)
     from public.contrato_facturacion c join public.factura_revision_fuera_libros r on r.id = c.revision_id
    where c.numero_contrato = 'DTM-208006'),
  'evento, asiento, hash, actor, nota y configuración coinciden', pg_temp.foto('DTM-208006'));
select pg_temp.verifica('B', 'B4c el anticipo histórico respaldado (200.000) se aplicó; Cartera no cambia',
  pg_temp.foto('DTM-208006') ~ 'saldos\[110505=200000 130505=1600000 281510=-1500000 413505=-300000\]'
    and (select count(*) from public.abonos where numero_contrato = 'DTM-208006') = 2,
  'Caja 200.000 · Clientes 1.600.000 · abonos intactos', pg_temp.foto('DTM-208006'));
select pg_temp.caso('B', 'B5 re-emitir igual (misma revisión)', '^OK .*sin_cambios', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000, 0, pg_temp.hash('DTM-208006')), 'DTM-208006', true);
create temp table _h as select pg_temp.hash('DTM-208006') as h;
update public.abonos set referencia = 'H-1 corregida' where referencia = 'H-1';
select pg_temp.caso('B', 'B6 un abono cambió desde la revisión (hash viejo)', '^ERR F4430', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000, 50000, (select h from _h)), 'DTM-208006', true);
select pg_temp.caso('B', 'B6b con la revisión nueva', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208006', 'admmay', 'mayorista', 1800000, 1500000, 50000, pg_temp.hash('DTM-208006')), 'DTM-208006');
select pg_temp.verifica('B', 'B6c dos constancias, cada una con su emisión', (select count(distinct asiento_factura_id) = 2 and count(*) = 2
  from public.factura_revision_fuera_libros where numero_contrato = 'DTM-208006' and evento = 'revision_emitida'), '2 emisiones · 2 constancias',
  (select string_agg(id || ':' || asiento_factura_id, ',') from public.factura_revision_fuera_libros where numero_contrato = 'DTM-208006'));
-- Manipulaciones de la constancia y del vínculo.
select pg_temp.caso('B', 'B7 authenticated cambia revision_id', '^ERR F4440', 'authenticated', 'admmay',
  'update public.contrato_facturacion set revision_id = null where numero_contrato = ''DTM-208006'' returning 1', 'DTM-208006', true);
select pg_temp.caso('B', 'B7b service_role con la variable puesta y una constancia ajena (límite declarado G3 → F4436)', '^ERR F4436 FIN_REVISION_NO_VINCULADA', 'service_role', null,
  'update public.contrato_facturacion set revision_id = (select min(id) from public.factura_revision_fuera_libros where numero_contrato = ''DTM-208006'') where numero_contrato = ''DTM-208006'' returning 1',
  'DTM-208006', true, 'select set_config(''app.factura_rpc'', ''DTM-208006'', true)');
select set_config('app.factura_rpc', '', true);
select pg_temp.caso('B', 'B8 service_role inserta una constancia por la API', '^ERR F4437 FIN_CONSTANCIA_SOLO_RPC', 'service_role', null,
  'insert into public.factura_revision_fuera_libros (evento, numero_contrato, tenant, fotografia, hash, actor) values (''revision_emitida'', ''DTM-208006'', ''mayorista'', ''{}'', ''x'', gen_random_uuid()) returning 1', 'DTM-208006', true);
select pg_temp.caso('B', 'B8b service_role borra una constancia', '^ERR 42501', 'service_role', null,
  'delete from public.factura_revision_fuera_libros returning 1', 'DTM-208006', true);
select pg_temp.caso('B', 'B8c el dueño (sin RLS) intenta editar una constancia', '^ERR F4439 FIN_CONSTANCIA_INMUTABLE', 'supabase_admin', null,
  'update public.factura_revision_fuera_libros set nota = ''x'' returning 1', 'DTM-208006', true);
select pg_temp.caso('B', 'B8d authenticated lee constancias directo (RLS sin policies)', '^ERR 42501', 'authenticated', 'admmay',
  'select count(*)::text from public.factura_revision_fuera_libros', null);
select pg_temp.caso('B', 'B9 quitar la factura con revisión', '^OK .*retirada', 'service_role', null,
  pg_temp.quitar('DTM-208006', 'admmay', 'mayorista'), 'DTM-208006');
select pg_temp.verifica('B', 'B9b evento factura_retirada enlazado a su revisión', (select count(*) = 1 from public.factura_revision_fuera_libros r
   where r.numero_contrato = 'DTM-208006' and r.evento = 'factura_retirada' and r.revision_id is not null and r.asiento_reversion_id is not null),
  '1 evento de retiro con revision_id y reversa', pg_temp.foto('DTM-208006'));

-- F4420 (abono nuevo de la app sin asiento) e importador (no contabilizable).
select pg_temp.caso('B', 'B10 la app registra un abono (sesión)', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (''DTM-208007'', ''mayorista'', 500000, 500000, 1, current_date, ''Transferencia'') returning id::text', 'DTM-208007');
select pg_temp.caso('B', 'B10b facturar con ese abono aún sin asiento', '^ERR F4420 FIN_ABONO_PENDIENTE_CONTABILIZAR', 'service_role', null,
  pg_temp.fact('DTM-208007', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208007', true);
select pg_temp.caso('B', 'B10c contabilizar el pendiente', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select max(id) from public.abonos where numero_contrato = 'DTM-208007'), 'admmay', 'mayorista'), 'DTM-208007');
select pg_temp.caso('B', 'B10d facturar: aplica el anticipo, sin aviso', '^OK .*emitida.*"revision_id": null', 'service_role', null,
  pg_temp.fact('DTM-208007', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208007');
select pg_temp.verifica('B', 'B10e saldos', pg_temp.foto('DTM-208007') ~ 'saldos\[111005=500000 130505=1300000 281510=-1500000 413505=-300000\]',
  'Bancos 500.000 · Clientes 1.300.000', pg_temp.foto('DTM-208007'));
select pg_temp.caso('B', 'B11 el importador (service_role) inserta un abono', '^OK false', 'service_role', null,
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono) values (''DTM-208009'', ''mayorista'', 90000, 90000, 1, current_date) returning contabilizable::text', 'DTM-208009');
select pg_temp.caso('B', 'B11b facturar: queda fuera de libros (aviso), no F4420', '^ERR F4431', 'service_role', null,
  pg_temp.fact('DTM-208009', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208009', true);
select pg_temp.caso('B', 'B11c contabilizar un abono del servidor', '^ERR F4426 FIN_ABONO_NO_CONTABILIZABLE', 'service_role', null,
  pg_temp.postear((select max(id) from public.abonos where numero_contrato = 'DTM-208009'), 'admmay', 'mayorista'), 'DTM-208009', true);
select pg_temp.caso('B', 'B11d nadie cambia la procedencia de un abono', '^ERR F4426', 'authenticated', 'admmay',
  'update public.abonos set contabilizable = true where numero_contrato = ''DTM-208009'' returning 1', 'DTM-208009', true);

-- Discrepancias (consulta contable con filtro explícito).
select pg_temp.caso('B', 'B12 emitir MIN-208013 (superadmin, agencia minorista)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('MIN-208013', 'super', 'minorista', 1800000, 1500000, 0, pg_temp.hash('MIN-208013')), 'MIN-208013');
select pg_temp.caso('B', 'B12b discrepancias: administración mayorista', '^OK DTM-208006,DTM-208006,DTM-208006$', 'authenticated', 'admmay',
  'select string_agg(numero_contrato, '','' order by numero_contrato, tipo) from public.f208_discrepancias_fuera_libros()', null);
select pg_temp.caso('B', 'B12c discrepancias: gerencia minorista (solo su agencia)', '^OK MIN-208013$', 'authenticated', 'germin',
  'select string_agg(numero_contrato, '','' order by numero_contrato) from public.f208_discrepancias_fuera_libros()', null);
select pg_temp.caso('B', 'B12d discrepancias: superadmin (todas)', '^OK DTM-208006,DTM-208006,DTM-208006,MIN-208013$', 'authenticated', 'super',
  'select string_agg(numero_contrato, '','' order by numero_contrato, tipo) from public.f208_discrepancias_fuera_libros()', null);
select pg_temp.caso('B', 'B12e discrepancias: venta (nada)', '^OK $', 'authenticated', 'ventamay',
  'select coalesce(string_agg(numero_contrato, '',''), '''') from public.f208_discrepancias_fuera_libros()', null);
select pg_temp.caso('B', 'B12f discrepancias: anon', '^ERR 42501', 'anon', null,
  'select count(*)::text from public.f208_discrepancias_fuera_libros()', null);

-- Factura HEREDADA (anterior a la 208) con abonos fuera de libros y sin
-- revisión: aparece en la consulta de discrepancias.
set local session_replication_role = replica;
insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio) values ('DTM-208015', 1500000, 300000);
set local session_replication_role = origin;
select pg_temp.caso('B', 'B13 discrepancias: factura heredada con abonos fuera de libros sin revisión', '^OK DTM-208015[|]factura_sin_revision$', 'authenticated', 'super',
  'select string_agg(numero_contrato || ''|'' || tipo, '','') from public.f208_discrepancias_fuera_libros() where tipo = ''factura_sin_revision''', null);

-- ═══ C · M1: asiento de abono solo por la RPC, con abono y venta vivos ════
select pg_temp.caso('C', 'C1 abono de la app', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (''DTM-208008'', ''mayorista'', 300000, 300000, 1, current_date, ''Efectivo'') returning id::text', 'DTM-208008');
create temp table _ab as select max(id) as id from public.abonos where numero_contrato = 'DTM-208008';
select pg_temp.caso('C', 'C2 la app vieja escribe el asiento directo (service_role)', '^ERR F4421 FIN_ASIENTO_ABONO_SOLO_RPC', 'service_role', null,
  format('insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990001, current_date, ''x'', ''abono'', ''abono:%s'') returning 1', (select id from _ab)), 'DTM-208008', true);
select pg_temp.caso('C', 'C2b authenticated escribe el asiento directo', '^ERR F4421', 'authenticated', 'admmay',
  format('insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990001, current_date, ''x'', ''abono'', ''abono:%s'') returning 1', (select id from _ab)), 'DTM-208008', true);
select pg_temp.caso('C', 'C3 posteo por la RPC (anticipo 280505)', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select id from _ab), 'opsmay', 'mayorista'), 'DTM-208008');
select pg_temp.verifica('C', 'C3b Caja / Anticipos', pg_temp.foto('DTM-208008') ~ 'as_abono=1 saldos\[110505=300000 280505=-300000\]', 'Caja 300.000 · Anticipos -300.000', pg_temp.foto('DTM-208008'));
select pg_temp.caso('C', 'C4 re-postear igual (idempotente)', '^OK .*sin_cambios', 'service_role', null,
  pg_temp.postear((select id from _ab), 'opsmay', 'mayorista'), 'DTM-208008', true);
select pg_temp.caso('C', 'C5 otra agencia (administración minorista)', '^ERR F4402', 'service_role', null,
  pg_temp.postear((select id from _ab), 'admmin', 'mayorista'), 'DTM-208008', true);
select pg_temp.caso('C', 'C5b rol venta', '^ERR F4401', 'service_role', null,
  pg_temp.postear((select id from _ab), 'ventamay', 'mayorista'), 'DTM-208008', true);
select pg_temp.caso('C', 'C6 facturar (aplica el anticipo)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208008', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208008');
update public.abonos set monto_cop = 350000, valor_abono = 350000 where id = (select id from _ab);
select pg_temp.caso('C', 'C7 cambiar el valor de un anticipo ya aplicado por la factura', '^ERR F4418 FIN_ANTICIPO_APLICADO', 'service_role', null,
  pg_temp.postear((select id from _ab), 'admmay', 'mayorista'), 'DTM-208008', true);
update public.abonos set monto_cop = 300000, valor_abono = 300000, forma_pago = 'Transferencia' where id = (select id from _ab);
select pg_temp.caso('C', 'C7b cambiar solo la forma de pago: conserva Anticipos', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select id from _ab), 'admmay', 'mayorista'), 'DTM-208008');
select pg_temp.verifica('C', 'C7c Bancos en vez de Caja; Clientes con el anticipo aplicado', pg_temp.foto('DTM-208008') ~ 'saldos\[111005=300000 130505=1500000 281510=-1500000 413505=-300000\]',
  'Bancos 300.000 · Clientes 1.500.000', pg_temp.foto('DTM-208008'));
select pg_temp.caso('C', 'C8 abono después de facturar → Clientes', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (''DTM-208008'', ''mayorista'', 100000, 100000, 1, ''2026-09-30'', ''Efectivo'') returning id::text', 'DTM-208008');
select pg_temp.caso('C', 'C8b posteo', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select max(id) from public.abonos where numero_contrato = 'DTM-208008'), 'admmay', 'mayorista'), 'DTM-208008');
select pg_temp.verifica('C', 'C8b2 el asiento del abono lleva la fecha del abono (2026-09-30), no la del servidor',
  (select a.fecha = date '2026-09-30' from public.asientos_contables a where a.referencia = 'abono:' || (select max(id) from public.abonos where numero_contrato = 'DTM-208008')),
  'fecha = fecha_abono', (select a.fecha::text from public.asientos_contables a where a.referencia = 'abono:' || (select max(id) from public.abonos where numero_contrato = 'DTM-208008')));
select pg_temp.verifica('C', 'C8c Clientes baja a 1.400.000', pg_temp.foto('DTM-208008') ~ '130505=1400000', 'Clientes 1.400.000', pg_temp.foto('DTM-208008'));
-- Posteo tardío: el abono ya no existe.
select pg_temp.caso('C', 'C9 abono borrado antes del posteo', '^ERR F4405 FIN_ABONO_INEXISTENTE', 'service_role', null,
  pg_temp.postear(999999999, 'admmay', 'mayorista'), null);
-- Líneas manipuladas.
select pg_temp.caso('C', 'C10 authenticated añade una línea al asiento de un abono', '^ERR F4421', 'authenticated', 'admmay',
  format('insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, debe, haber) select ''mayorista'', a.id, p.id, ''DTM-208008'', 1, 0 from public.asientos_contables a, public.puc_cuentas p where a.referencia = ''abono:%s'' and p.tenant = ''mayorista'' and p.codigo = ''110505'' returning 1', (select id from _ab)), 'DTM-208008', true);
select pg_temp.caso('C', 'C10b authenticated añade una línea al asiento de la factura', '^ERR F4440', 'authenticated', 'admmay',
  'insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, debe, haber) select ''mayorista'', c.asiento_factura_id, p.id, ''DTM-208008'', 1, 0 from public.contrato_facturacion c, public.puc_cuentas p where c.numero_contrato = ''DTM-208008'' and p.tenant = ''mayorista'' and p.codigo = ''130505'' returning 1', 'DTM-208008', true);
select pg_temp.caso('C', 'C10c service_role edita una línea de la factura', '^ERR F4440', 'service_role', null,
  'update public.asiento_lineas set debe = debe + 1 where asiento_id = (select asiento_factura_id from public.contrato_facturacion where numero_contrato = ''DTM-208008'') and debe > 0 returning 1', 'DTM-208008', true);
select pg_temp.caso('C', 'C10d service_role borra el asiento de la factura', '^ERR F4440', 'service_role', null,
  'delete from public.asientos_contables where id = (select asiento_factura_id from public.contrato_facturacion where numero_contrato = ''DTM-208008'') returning 1', 'DTM-208008', true);
select pg_temp.caso('C', 'C10e eliminarAbono borra el asiento del abono (sigue permitido)', '^OK 1', 'service_role', null,
  format('delete from public.asientos_contables where origen = ''abono'' and referencia = ''abono:%s'' returning 1', (select max(id) from public.abonos where numero_contrato = 'DTM-208008')), 'DTM-208008');

-- ═══ D · protector de la historia de ventas (P-a) ═══════════════════════
select pg_temp.caso('D', 'D1 borrar una venta con historia de facturación', '^ERR F4450 FIN_HISTORIA_CONTABLE', 'service_role', null,
  'delete from public.ventas where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('D', 'D1b eliminar_contrato (superadmin)', '^ERR F4450', 'authenticated', 'super',
  'select public.eliminar_contrato(''DTM-208001'')::text', 'DTM-208001', true);
select pg_temp.caso('D', 'D2 renumerar una venta con historia', '^ERR F4450', 'service_role', null,
  'update public.ventas set numero_contrato = ''DTM-208999'' where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('D', 'D3 cambiar de agencia una venta con historia', '^ERR F4450', 'service_role', null,
  'update public.ventas set tenant = ''minorista'' where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('D', 'D4 editar otros campos de la venta (sí)', '^OK 1', 'service_role', null,
  'update public.ventas set observaciones = ''ok'' where numero_contrato = ''DTM-208001'' returning 1', null);

-- ═══ E · escrituras directas por rol y agencia (208 activa) ════════════
select pg_temp.caso('E', 'E1 Guardar (vieja) upsert de importes, administración', '^ERR F4440', 'authenticated', 'admmay',
  'insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, ingreso_exento) values (''DTM-208001'', 1500000, 300000, 9) on conflict (numero_contrato) do update set ingreso_exento = excluded.ingreso_exento returning 1', 'DTM-208001', true);
select pg_temp.caso('E', 'E1b Guardar (vieja) en contrato sin configuración', '^ERR F4440', 'authenticated', 'admmay',
  'insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio) values (''DTM-208010'', 1500000, 300000) returning 1', 'DTM-208010', true);
select pg_temp.caso('E', 'E2 Quitar (vieja) DELETE, administración', '^ERR F4440', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('E', 'E2b service_role DELETE directo', '^ERR F4440', 'service_role', null,
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('E', 'E3 marcar DIAN directo (factura vigente; operación permitida)', '^OK 1', 'authenticated', 'admmay',
  'update public.contrato_facturacion set dian_emitida = true, dian_fecha = current_date where numero_contrato = ''DTM-208004'' returning 1', 'DTM-208004');
select pg_temp.verifica('E', 'E3b solo cambió la marca DIAN', pg_temp.foto('DTM-208004') ~ 'dian=true' and pg_temp.foto('DTM-208004') ~ 'fact=1 rev=0', 'dian=true, sin asientos nuevos', pg_temp.foto('DTM-208004'));
select pg_temp.caso('E', 'E3c desmarcar DIAN directo', '^ERR F4434', 'authenticated', 'admmay',
  'update public.contrato_facturacion set dian_emitida = false, dian_fecha = null where numero_contrato = ''DTM-208004'' returning 1', 'DTM-208004', true);
select pg_temp.caso('E', 'E4 administración de minorista marca DIAN de mayorista (RLS: 0 filas)', '^OK $', 'authenticated', 'admmin',
  'update public.contrato_facturacion set dian_emitida = true where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true);
select pg_temp.caso('E', 'E5 rol venta inserta configuración', '^ERR F4403 FIN_SIN_ACCESO', 'authenticated', 'ventamay',
  'insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio) values (''DTM-208010'', 1, 1) returning 1', 'DTM-208010', true);
select pg_temp.caso('E', 'E6 TRUNCATE como authenticated', '^ERR 42501', 'authenticated', 'admmay', 'select ''x''', null, false, 'truncate public.contrato_facturacion');
select pg_temp.caso('E', 'E6b TRUNCATE como service_role', '^ERR 42501', 'service_role', null, 'select ''x''', null, false, 'truncate public.asiento_lineas');
select pg_temp.caso('E', 'E6c TRUNCATE como dueño', '^ERR F4440', 'supabase_admin', null, 'select ''x''', null, false, 'truncate public.contrato_facturacion cascade');
-- Helpers privilegiados: ACL y agencia.
select pg_temp.caso('E', 'E7 helper bloquear_venta: administración de la otra agencia', '^ERR F4403', 'authenticated', 'admmin',
  'select f208_priv.bloquear_venta(''DTM-208001'')', null);
select pg_temp.caso('E', 'E7b helper factura_vigente_id: rol venta', '^ERR F4403', 'authenticated', 'ventamay',
  'select f208_priv.factura_vigente_id(''DTM-208001'')::text', null);
select pg_temp.caso('E', 'E7c helper: administración de su agencia', '^OK [0-9]+', 'authenticated', 'admmay',
  'select f208_priv.factura_vigente_id(''DTM-208001'')::text', null);
select pg_temp.caso('E', 'E7d helper fotografía: authenticated sin EXECUTE', '^ERR 42501', 'authenticated', 'admmay',
  'select f208_priv.fotografia_fuera_libros(''DTM-208006'')::text', null);
select pg_temp.caso('E', 'E7e anon sin USAGE en f208_priv', '^ERR 42501', 'anon', null,
  'select f208_priv.factura_vigente_id(''DTM-208001'')::text', null);
select pg_temp.caso('E', 'E7f la variable de la RPC no la puede poner authenticated (y no le sirve)', '^ERR F4440', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true, 'select set_config(''app.factura_rpc'', ''DTM-208001'', true)');
select set_config('app.factura_rpc', '', true);
select pg_temp.caso('E', 'E7g service_role con la variable de OTRO contrato', '^ERR F4440', 'service_role', null,
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208001'' returning 1', 'DTM-208001', true, 'select set_config(''app.factura_rpc'', ''DTM-208003'', true)');
select set_config('app.factura_rpc', '', true);

-- ═══ G · F4415: un abono CON asiento no se borra (eliminarAbono) ═════════
select pg_temp.caso('G', 'G1 la app registra un abono (sesión)', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (''DTM-208012'', ''mayorista'', 120000, 120000, 1, current_date, ''Transferencia'') returning id::text', 'DTM-208012');
create temp table _g as select max(id) as id from public.abonos where numero_contrato = 'DTM-208012';
grant all on _g to public;
select pg_temp.caso('G', 'G2 posteo por la RPC', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select id from _g), 'admmay', 'mayorista'), 'DTM-208012');
select pg_temp.caso('G', 'G3 DELETE directo (administración): F4415, abono y asiento íntegros', '^ERR F4415 FIN_ABONO_CON_ASIENTO', 'authenticated', 'admmay',
  format('delete from public.abonos where id = %s returning 1', (select id from _g)), 'DTM-208012', true);
select pg_temp.caso('G', 'G4 DELETE directo (service_role): F4415, íntegro', '^ERR F4415', 'service_role', null,
  format('delete from public.abonos where id = %s returning 1', (select id from _g)), 'DTM-208012', true);
select pg_temp.caso('G', 'G5 DELETE de operaciones (puede borrar abonos pero no leer asientos): F4415, íntegro', '^ERR F4415', 'authenticated', 'opsmay',
  format('delete from public.abonos where id = %s returning 1', (select id from _g)), 'DTM-208012', true);
select pg_temp.caso('G', 'G6 eliminar_contrato (superadmin) con un abono con asiento: F4415, íntegro (consecuencia declarada)', '^ERR F4415', 'authenticated', 'super',
  'select public.eliminar_contrato(''DTM-208012'')::text', 'DTM-208012', true);
select pg_temp.caso('G', 'G7 abono SIN asiento: se borra como siempre', '^OK 1', 'authenticated', 'admmay',
  'delete from public.abonos where numero_contrato = ''DTM-208009'' and referencia is null returning 1', 'DTM-208009');
select pg_temp.caso('G', 'G7b abono histórico SIN asiento (H-1): se borra como siempre', '^OK 1', 'authenticated', 'admmay',
  'delete from public.abonos where referencia = ''H-1 corregida'' returning 1', 'DTM-208006');
select pg_temp.caso('G', 'G7c abono histórico CON asiento (H-2): F4415, íntegro', '^ERR F4415', 'authenticated', 'admmay',
  'delete from public.abonos where referencia = ''H-2'' returning 1', 'DTM-208006', true);
set local session_replication_role = replica;
insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, referencia, contabilizable) values ('DTM-208012', 'mayorista', 55000, 55000, 1, current_date, 'PP-1', false);
insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia)
  select 'mayorista', 990010, current_date, 'Aplicación pago previo', 'pago_previo_aplicacion', 'pago_previo:1:abono:' || id from public.abonos where referencia = 'PP-1';
set local session_replication_role = origin;
select pg_temp.caso('G', 'G8 abono con asiento de aplicación de pago previo: F4415, íntegro', '^ERR F4415', 'authenticated', 'admmay',
  'delete from public.abonos where referencia = ''PP-1'' returning 1', 'DTM-208012', true);
select pg_temp.caso('G', 'G9 el asiento se puede borrar (eliminarAbono ya no lo hace primero); luego el abono queda sin asiento y se borra', '^OK 1', 'service_role', null,
  format('delete from public.asientos_contables where origen = ''abono'' and referencia = ''abono:%s'' returning 1', (select id from _g)), 'DTM-208012');
select pg_temp.caso('G', 'G9b ya sin asiento, el DELETE del abono procede', '^OK 1', 'authenticated', 'admmay',
  format('delete from public.abonos where id = %s returning 1', (select id from _g)), 'DTM-208012');
-- Abono nuevo con asiento, que seguirá vivo durante la retirada parcial.
select pg_temp.caso('G', 'G10 abono con asiento para la fase de retirada', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values (''DTM-208012'', ''mayorista'', 77000, 77000, 1, current_date, ''Transferencia'') returning id::text', 'DTM-208012');
create temp table _g2 as select max(id) as id from public.abonos where numero_contrato = 'DTM-208012' and monto_cop = 77000;
grant all on _g2 to public;
select pg_temp.caso('G', 'G10b posteo', '^OK .*contabilizado', 'service_role', null,
  pg_temp.postear((select id from _g2), 'admmay', 'mayorista'), 'DTM-208012');

select pg_temp.caso('G', 'G10c abono SIN asiento, que se borrará durante la retirada parcial', '^OK [0-9]+', 'authenticated', 'admmay',
  'insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia) values (''DTM-208012'', ''mayorista'', 11000, 11000, 1, current_date, ''Transferencia'', ''SA-1'') returning id::text', 'DTM-208012');

-- ═══ F · RETIRADA PARCIAL (D-RET): se aplica el rollback de la 208 ═══════
select pg_temp.caso('F', 'F0 preparar DTM-208010 (emitida)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208010', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208010');
select pg_temp.caso('F', 'F0b preparar DTM-208011 (emitida)', '^OK .*emitida', 'service_role', null,
  pg_temp.fact('DTM-208011', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208011');
\i :rollback_208
select pg_temp.verifica('F', 'F1 tras la retirada: sin RPC de emitir/quitar; guardas, constancias y marcar DIAN siguen',
  to_regprocedure('public.facturar_factura(text,uuid,text,numeric,numeric,numeric,text,text,text,text)') is null
  and to_regprocedure('public.quitar_factura(text,uuid,text)') is null
  and to_regprocedure('public.marcar_dian_factura(text,uuid,text,boolean)') is not null
  and to_regclass('public.factura_revision_fuera_libros') is not null
  and (select count(*) from pg_trigger where tgname like 'trg_f208_%' and not tgisinternal) >= 12
  and (select count(*) from public.factura_revision_fuera_libros) > 0,
  'RPC retiradas; guardas, tabla y constancias conservadas', '');
select pg_temp.caso('F', 'Q5 Guardar (vieja): upsert de importes', '^ERR F4440', 'authenticated', 'admmay',
  'insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, ingreso_exento, updated_at) values (''DTM-208010'', 1500000, 300000, 77, now()) on conflict (numero_contrato) do update set irt = excluded.irt, ingreso_propio = excluded.ingreso_propio, ingreso_exento = excluded.ingreso_exento, updated_at = excluded.updated_at returning 1', 'DTM-208010', true);
select pg_temp.caso('F', 'Q5b Guardar (vieja): su asiento (service_role)', '^ERR F4440', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990002, current_date, ''Factura'', ''facturacion'', ''facturacion:DTM-208010'') returning 1', 'DTM-208010', true);
select pg_temp.caso('F', 'Q6 Marcar DIAN (vieja, upsert) sobre factura vigente', '^OK 1', 'authenticated', 'admmay',
  'insert into public.contrato_facturacion (numero_contrato, dian_emitida, dian_fecha, updated_at) values (''DTM-208011'', true, current_date, now()) on conflict (numero_contrato) do update set dian_emitida = excluded.dian_emitida, dian_fecha = excluded.dian_fecha, updated_at = excluded.updated_at returning 1', 'DTM-208011');
select pg_temp.verifica('F', 'Q6b solo cambió dian_emitida', pg_temp.foto('DTM-208011') ~ '^cfg=1500000/300000/0/dian=true/as=true/rv=false fact=1 rev=0', 'importes y asientos iguales', pg_temp.foto('DTM-208011'));
select pg_temp.caso('F', 'Q6c Quitar (vieja) una factura ya DIAN', '^ERR F4434', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208011'' returning 1', 'DTM-208011', true);
select pg_temp.caso('F', 'Q6d Marcar DIAN por la RPC (sigue disponible)', '^OK .*marcada', 'service_role', null,
  pg_temp.dian('DTM-208001', 'admmay', 'mayorista', true), 'DTM-208001');
select pg_temp.caso('F', 'Q7 Quitar (vieja) #1', '^ERR F4440', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208010'' returning 1', 'DTM-208010', true);
select pg_temp.caso('F', 'Q7b Quitar (vieja) #2', '^ERR F4440', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208010'' returning 1', 'DTM-208010', true);
select pg_temp.caso('F', 'Q8 Quitar de B: la reversa (service_role) primero', '^ERR F4440', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990003, current_date, ''Reversión'', ''facturacion_reversion'', ''facturacion:DTM-208010'') returning 1', 'DTM-208010', true);
create or replace function public.t208_falla_delete() returns trigger language plpgsql as $$
begin raise exception 'fallo forzado t208 en DELETE'; end $$;
create trigger t208_falla_delete before delete on public.contrato_facturacion for each row execute function public.t208_falla_delete();
select pg_temp.caso('F', 'Q8b Quitar de B con fallo forzado en el DELETE: la reversa ya se rechazó; ninguna huérfana', '^ERR F4440', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990004, current_date, ''Reversión'', ''facturacion_reversion'', ''facturacion:DTM-208010'') returning 1', 'DTM-208010', true);
drop trigger t208_falla_delete on public.contrato_facturacion;
select pg_temp.caso('F', 'Q9 Quitar de main: DELETE primero', '^ERR F4440', 'authenticated', 'admmay',
  'delete from public.contrato_facturacion where numero_contrato = ''DTM-208010'' returning 1', 'DTM-208010', true);
select pg_temp.caso('F', 'Q10 Marcar DIAN (vieja) sin configuración', '^ERR F4435', 'authenticated', 'admmay',
  'insert into public.contrato_facturacion (numero_contrato, dian_emitida, dian_fecha, updated_at) values (''DTM-208012'', true, current_date, now()) on conflict (numero_contrato) do update set dian_emitida = excluded.dian_emitida returning 1', 'DTM-208012', true);
select pg_temp.caso('F', 'Q10b Marcar DIAN por la RPC sin configuración', '^ERR F4435', 'service_role', null,
  pg_temp.dian('DTM-208012', 'admmay', 'mayorista', true), 'DTM-208012', true);
select pg_temp.caso('F', 'F1b tras la retirada, un abono con asiento sigue sin poder borrarse (no se reabre la orfandad)', '^ERR F4415', 'authenticated', 'admmay',
  format('delete from public.abonos where id = %s returning 1', (select id from _g2)), 'DTM-208012', true);
select pg_temp.caso('F', 'F1c tras la retirada, un abono sin asiento se borra igual', '^OK 1', 'authenticated', 'admmay',
  'delete from public.abonos where referencia = ''SA-1'' returning 1', 'DTM-208012');
select pg_temp.caso('F', 'F2 la app nueva llama facturar_factura (retirada)', '^ERR 42883', 'service_role', null,
  pg_temp.fact('DTM-208012', 'admmay', 'mayorista', 1800000, 1500000), 'DTM-208012', true);
select pg_temp.caso('F', 'F3 posteo de abonos sigue disponible (M1)', '^OK .*', 'service_role', null,
  pg_temp.postear((select id from _ab), 'admmay', 'mayorista'), 'DTM-208008');
select pg_temp.caso('F', 'F4 la app vieja escribe el asiento de abono directo', '^ERR F4421', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 990005, current_date, ''x'', ''abono'', ''abono:1'') returning 1', null);

-- ── Resultado ─────────────────────────────────────────────────────────────
\echo '=== RESULTADOS 208 (una sesión) ==='
\pset format unaligned
\pset fieldsep ' | '
select n, fase, caso, case when ok then 'OK' else 'FALLA' end as r, esperado, left(obtenido, 240) as obtenido, fotos from _r order by n;
select count(*) filter (where ok) as pasan, count(*) filter (where not ok) as fallan, count(*) as total from _r;
rollback;
