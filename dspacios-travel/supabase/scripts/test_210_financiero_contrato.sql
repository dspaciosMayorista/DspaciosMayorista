-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBAS 210 · cierre de K15 (una sesión). SOLO base local desechable con
-- 001–205 + 207 + 210. Todo corre en UNA transacción que termina en ROLLBACK
-- (incluido el rollback_210, que se aplica DENTRO y se deshace al final).
--
-- Uso (desde dspacios-travel/):
--   psql … -d <base_desechable> -v rollback_210=<ruta a rollback_210_*.sql> \
--        -f supabase/scripts/test_210_financiero_contrato.sql
--
-- EQUIVALENCIAS con test_171_financiero_atomico.sql (que NO se edita: la 171/172 no cambian).
-- La 210 cambia a propósito lo que ese script asume sobre un contrato YA completo, porque su fixture
-- crea ventas con financiero_estado='completo' (por defecto) y vuelve a llamar la RPC sobre ellas:
--   171 · fixture sin estado + A1/A2 (primera escritura)   → 210 · A1, A1b, A6 con el contrato 'pendiente' (el único
--                                                              estado desde el que la RPC escribe)
--   171 · A3 payload inválido aborta todo (sobre un contrato → 210 · A8 (inválido sobre un pendiente: error y sigue
--         ya completado por A1)                                pendiente) y A9/A9b/A9c (fallo a mitad: nada parcial; el
--                                                              reintento completa sin duplicar). Sobre un contrato ya
--                                                              completo la RPC ya no valida ni escribe: A3, A4.
--   171 · A4 reintento reemplaza las CxP y devuelve         → 210 · A2/A2b/A3/A4/A5 (reentrada = no-op: mismos ids, sin
--         `eliminadas`                                         eliminadas); el reemplazo sigue existiendo SOLO para un
--                                                              pendiente con CxP automáticas residuales: A10, A10b.
--   171 · A4-bis la CxP manual nunca se reemplaza           → 210 · A11 (pendiente con una CxP manual: se conserva).
--   171 · A5 revertir un contrato incompleto                 → 210 · B2 (pendiente) y B3 (completo por defecto, sin marca:
--                                                              se revierte como siempre).
--   171 · A5-bis con dinero real no revierte                → 210 · B6 (abonos) y B7 (pagos a proveedor).
-- Lo que A3/A4 no podían ver y la 210 añade: la compensación no borra lo que la RPC completó (B1, R2a, T3).
--
-- Salida: caso | OK/FALLA | esperado | obtenido | foto antes ⇒ después.
-- Las carreras con dos sesiones y commit real están en test_210_carrera.sh.
-- ───────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP 1
\pset pager off
begin;
do $$ begin
  if to_regprocedure('public.revertir_contrato_incompleto(text,text)') is null
     or not exists (select 1 from information_schema.columns where table_name = 'ventas' and column_name = 'financiero_registrado_en') then
    raise exception 'La 210 no está aplicada en esta base.'; end if;
  if current_database() in ('postgres', 'plantilla205') then raise exception 'Usa una base desechable.'; end if;
end $$;

create temp table _r (n serial, caso text, ok boolean, esperado text, obtenido text, fotos text) on commit drop;
grant all on _r to public;
grant all on sequence _r_n_seq to public;

-- ── Usuarios (para los roles de la API) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000210001', 'adm210@t.test'), ('00000000-0000-0000-0000-000000210002', 'ven210@t.test');
update public.usuarios set nombre = 'Adm 210', rol = 'administracion', tenant = 'mayorista', activo = true where id = '00000000-0000-0000-0000-000000210001';
update public.usuarios set nombre = 'Ven 210', rol = 'venta', tenant = 'mayorista', activo = true where id = '00000000-0000-0000-0000-000000210002';

-- ── Utilidades ────────────────────────────────────────────────────────────
create function pg_temp.foto(n text) returns text language sql as $$
  select coalesce((select 'est=' || financiero_estado || ' reg=' || (financiero_registrado_en is not null) || ' hotel=' || coalesce(costo_hotel::numeric(15,0)::text, '-')
                     || ' otros=' || coalesce(otros_costos::numeric(15,0)::text, '-') from public.ventas where numero_contrato = n), 'venta=no')
      || ' cxp=[' || coalesce((select string_agg(id || ':' || valor_total::numeric(15,0), ',' order by id) from public.cuentas_por_pagar where numero_contrato = n), '') || ']'
      || ' pend=' || (select count(*) from public.contrato_financiero_pendiente where numero_contrato = n)
      || ' as_cxp=' || (select count(*) from public.asientos_contables a where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = n))
$$;

create function pg_temp.paso(p_rol text, p_quien text, p_sql text, out res text, out f_antes text, out f_desp text, p_n text default null)
language plpgsql as $$
declare v_out text; v_state text; v_msg text;
begin
  f_antes := case when p_n is null then null else pg_temp.foto(p_n) end;
  begin
    perform set_config('request.jwt.claims', case when p_quien is null then json_build_object('role', p_rol)::text
      else json_build_object('sub', p_quien, 'role', p_rol)::text end, true);
    execute format('set local role %I', p_rol);
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

create function pg_temp.caso(p_caso text, p_esperado text, p_rol text, p_quien text, p_sql text, p_n text default null, p_integro boolean default false) returns text
language plpgsql as $$
declare r record; v_ok boolean;
begin
  select * into r from pg_temp.paso(p_rol, p_quien, p_sql, p_n);
  v_ok := r.res ~ p_esperado and (not p_integro or r.f_antes = r.f_desp);
  insert into _r (caso, ok, esperado, obtenido, fotos) values (p_caso, v_ok, p_esperado || case when p_integro then ' + foto íntegra' else '' end, r.res,
    case when p_n is null then null else r.f_antes || '  ⇒  ' || r.f_desp
      || case when p_integro then case when r.f_antes = r.f_desp then '  · ÍNTEGRO' else '  · ¡CAMBIÓ!' end else '' end end);
  return r.res;
end $$;
create function pg_temp.verifica(p_caso text, p_ok boolean, p_esperado text, p_obtenido text) returns void language sql as $$
  insert into _r (caso, ok, esperado, obtenido) values (p_caso, p_ok, p_esperado, p_obtenido)
$$;

-- Payload de 2 CxP (hotel 1.000.000 + aéreo 500.000) y costos.
create function pg_temp.cxp(hotel numeric default 1000000, aereo numeric default 500000) returns text language sql as $$
  select format($j$'[{"proveedor":"Hotel T","tipo_proveedor":"hotel","servicio":"Alojamiento","valor_total":%s,"fecha_obligacion":"2026-10-01"},
                     {"proveedor":"Aerolinea T","tipo_proveedor":"aereo","servicio":"Tiquete","valor_total":%s,"fecha_obligacion":"2026-10-01"}]'::jsonb$j$, hotel, aereo)
$$;
create function pg_temp.reg(n text, tenant text default 'mayorista', hotel numeric default 1000000, aereo numeric default 500000) returns text language sql as $$
  select format('select public.registrar_financiero_contrato(%L, %L, %L::jsonb, %s)::text', n, tenant,
                format('{"costo_hotel":%s,"otros_costos":%s}', hotel, aereo), pg_temp.cxp(hotel, aereo))
$$;
create function pg_temp.rev(n text, tenant text default 'mayorista') returns text language sql as $$
  select format('select public.revertir_contrato_incompleto(%L, %L)::text', n, tenant)
$$;

-- ── Siembra ───────────────────────────────────────────────────────────────
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado)
select n, 'C ' || n, case when n like 'MIN-%' then 'minorista' else 'mayorista' end, 3000000, 'activo',
       case when n in ('DTM-210020') then 'completo' else 'pendiente' end
  from unnest(array['DTM-210001','DTM-210002','DTM-210003','DTM-210004','DTM-210005','DTM-210006','DTM-210007','DTM-210008','DTM-210009',
                    'DTM-210010','DTM-210011','DTM-210012','DTM-210013','MIN-210014','DTM-210015','DTM-210016','DTM-210020']) n;

-- ═══ A · reentrada: la RPC actúa una sola vez ═════════════════════════════
select pg_temp.caso('A1 RPC sobre un contrato pendiente: completa y deja la marca', '^OK .*"creadas": \[\{', 'service_role', null, pg_temp.reg('DTM-210001'), 'DTM-210001');
select pg_temp.verifica('A1b estado final', pg_temp.foto('DTM-210001') ~ '^est=completo reg=true hotel=1000000 otros=500000 cxp=\[[0-9]+:1000000,[0-9]+:500000\] pend=0 as_cxp=0$', 'completo, marca, 2 CxP, sin pendiente', pg_temp.foto('DTM-210001'));
create temp table _a1 as select string_agg(id::text, ',' order by id) as ids from public.cuentas_por_pagar where numero_contrato = 'DTM-210001';
select pg_temp.caso('A2 misma llamada otra vez (reentrada): no-op, CxP intactas', '^OK (?=.*"ya_completo": true)(?=.*"creadas": \[\])', 'service_role', null, pg_temp.reg('DTM-210001'), 'DTM-210001', true);
select pg_temp.verifica('A2b los ids de CxP no cambiaron (nada se borró ni se recreó)', (select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = 'DTM-210001') = (select ids from _a1), 'mismos ids', (select ids from _a1));
select pg_temp.caso('A3 reentrada con OTRO payload y otros costos: no-op, nada cambia', '^OK .*"ya_completo": true', 'service_role', null, pg_temp.reg('DTM-210001', 'mayorista', 9999999, 8888888), 'DTM-210001', true);
-- Con pagos a proveedor ya registrados, la 172 DUPLICABA la CxP (la protegida quedaba y se creaba otra).
insert into public.cxp_pagos (cuenta_por_pagar_id, valor, fecha) select min(id), 1000, current_date from public.cuentas_por_pagar where numero_contrato = 'DTM-210001';
select pg_temp.caso('A4 reentrada con un pago a proveedor ya registrado: no-op (la 172 duplicaba la CxP)', '^OK .*"ya_completo": true', 'service_role', null, pg_temp.reg('DTM-210001'), 'DTM-210001', true);
select pg_temp.caso('A5 contrato que nunca fue pendiente (completo por defecto): no-op', '^OK (?=.*"ya_completo": true)(?=.*"estado": "completo")', 'service_role', null, pg_temp.reg('DTM-210020'), 'DTM-210020', true);
select pg_temp.caso('A6 contrato pendiente SIN costos ni CxP: completa con marca (caso de reservas sin costo)', '^OK .*"creadas": \[\]', 'service_role', null,
  'select public.registrar_financiero_contrato(''DTM-210002'', ''mayorista'', ''{}''::jsonb, ''[]''::jsonb)::text', 'DTM-210002');
select pg_temp.verifica('A6b queda completo y marcado', pg_temp.foto('DTM-210002') ~ '^est=completo reg=true .*pend=0', 'completo + marca', pg_temp.foto('DTM-210002'));
select pg_temp.caso('A7 contrato inexistente / tenant ajeno: error, sin efectos', '^ERR P0001 registrar_financiero_contrato: el contrato DTM-210003 no existe en la agencia minorista', 'service_role', null, pg_temp.reg('DTM-210003', 'minorista'), 'DTM-210003', true);
select pg_temp.caso('A8 payload inválido (valor negativo): error y el contrato sigue pendiente', '^ERR P0001 registrar_financiero_contrato: valor_total inválido', 'service_role', null, pg_temp.reg('DTM-210003', 'mayorista', -1, 5), 'DTM-210003', true);

-- Fallo intermedio: la 2.ª CxP falla al insertar → todo se deshace; el reintento funciona sin duplicar.
create function public.t210_falla() returns trigger language plpgsql as $$
begin if new.servicio = 'Tiquete' and current_setting('t210.falla', true) = 'si' then raise exception 'fallo inyectado t210 en la 2a CxP'; end if; return new; end $$;
create trigger t210_falla before insert on public.cuentas_por_pagar for each row execute function public.t210_falla();
select set_config('t210.falla', 'si', true);
select pg_temp.caso('A9 fallo en la 2.ª CxP: nada queda (ni la 1.ª, ni costos, ni marca); sigue pendiente', '^ERR P0001 fallo inyectado t210', 'service_role', null, pg_temp.reg('DTM-210004'), 'DTM-210004', true);
select set_config('t210.falla', 'no', true);
select pg_temp.caso('A9b reintento tras el fallo: completa, sin duplicar', '^OK .*"creadas": \[\{', 'service_role', null, pg_temp.reg('DTM-210004'), 'DTM-210004');
select pg_temp.verifica('A9c exactamente 2 CxP', (select count(*) from public.cuentas_por_pagar where numero_contrato = 'DTM-210004') = 2, '2 CxP', pg_temp.foto('DTM-210004'));
drop trigger t210_falla on public.cuentas_por_pagar;

-- Reintento legítimo sobre un pendiente con CxP automáticas residuales sin pagos (comportamiento 172 conservado).
insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, observaciones)
  values ('DTM-210005', 'mayorista', 'Hotel T', 'hotel', 'Alojamiento', 1, public.marca_cxp_automatica());
select pg_temp.caso('A10 pendiente con una CxP automática residual: se reemplaza (una sola vez) y devuelve su id', '^OK .*"eliminadas": \[[0-9]+\]', 'service_role', null, pg_temp.reg('DTM-210005'), 'DTM-210005');
select pg_temp.verifica('A10b 2 CxP, ninguna duplicada', (select count(*) from public.cuentas_por_pagar where numero_contrato = 'DTM-210005') = 2, '2 CxP', pg_temp.foto('DTM-210005'));

-- (equivalente a 171·A4-bis) Un pendiente con una CxP MANUAL y una automática residual: solo la automática se reemplaza.
insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total, observaciones)
  values ('DTM-210016', 'mayorista', 'H', 'hotel', 'Alojamiento', 1, public.marca_cxp_automatica()),
         ('DTM-210016', 'mayorista', 'Contabilidad', 'otro', 'Cargado a mano', 50000, 'Registrado por contabilidad');
select pg_temp.caso('A11 pendiente con una CxP manual y una automática residual: la manual se conserva, la automática se reemplaza', '^OK .*"eliminadas": \[[0-9]+\]', 'service_role', null, pg_temp.reg('DTM-210016'), 'DTM-210016');
select pg_temp.verifica('A11b CxP manual intacta y 3 en total (manual + 2 nuevas)',
  (select count(*) filter (where observaciones = 'Registrado por contabilidad') = 1 and count(*) = 3 from public.cuentas_por_pagar where numero_contrato = 'DTM-210016'),
  'manual conservada; 3 CxP', pg_temp.foto('DTM-210016'));

-- ═══ B · compensación: nunca borra lo que la RPC ya completó ═════════════
select pg_temp.caso('B1 revertir un contrato COMPLETADO por la RPC (otra sesión): ya_completo, íntegro', '^OK \{"estado": "ya_completo"\}', 'service_role', null, pg_temp.rev('DTM-210001'), 'DTM-210001', true);
select pg_temp.caso('B2 revertir un contrato pendiente: se revierte', '^OK \{"estado": "revertido"\}', 'service_role', null, pg_temp.rev('DTM-210006'), 'DTM-210006');
select pg_temp.verifica('B2b ya no existe', not exists (select 1 from public.ventas where numero_contrato = 'DTM-210006'), 'sin venta', pg_temp.foto('DTM-210006'));
select pg_temp.caso('B3 revertir un contrato completo por DEFECTO (flujo manual de main, sin marca): se revierte como siempre', '^OK \{"estado": "revertido"\}', 'service_role', null, pg_temp.rev('DTM-210020'));
select pg_temp.caso('B4 revertir un contrato inexistente: no_existe', '^OK \{"estado": "no_existe"\}', 'service_role', null, pg_temp.rev('DTM-299999'));
select pg_temp.caso('B5 revertir con tenant ajeno: no_existe y el contrato sigue ahí (aislamiento)', '^OK \{"estado": "no_existe"\}', 'service_role', null, pg_temp.rev('DTM-210007', 'minorista'), 'DTM-210007', true);
-- (La 172 impide abonos sobre un pendiente; el fixture del abono previo se siembra sin disparadores.)
set local session_replication_role = replica;
insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono) values ('DTM-210008', 'mayorista', 1000, 1000, 1, current_date);
set local session_replication_role = origin;
select pg_temp.caso('B6 revertir un pendiente con abonos: se niega (excepción conservada)', '^ERR P0001 revertir_contrato_incompleto: el contrato DTM-210008 ya tiene abonos', 'service_role', null, pg_temp.rev('DTM-210008'), 'DTM-210008', true);
insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total) values ('DTM-210009', 'mayorista', 'P', 'hotel', 'S', 10);
insert into public.cxp_pagos (cuenta_por_pagar_id, valor, fecha) select id, 1, current_date from public.cuentas_por_pagar where numero_contrato = 'DTM-210009';
select pg_temp.caso('B7 revertir un pendiente con pagos a proveedor: se niega', '^ERR P0001 revertir_contrato_incompleto: el contrato DTM-210009 ya tiene pagos', 'service_role', null, pg_temp.rev('DTM-210009'), 'DTM-210009', true);

-- ═══ C · contrato_financiero_pendiente sin residuos ═══════════════════════
select pg_temp.caso('C1 el payload de un contrato pendiente se guarda', '^OK 1', 'service_role', null,
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210010'', ''mayorista'', ''{}'', ''[]'') returning 1', 'DTM-210010');
select pg_temp.caso('C2 el payload de un contrato YA completo se descarta en silencio (0 filas)', '^OK $', 'service_role', null,
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210001'', ''mayorista'', ''{}'', ''[]'') returning 1', 'DTM-210001', true);
select pg_temp.caso('C3 upsert (como guardarPendiente) sobre un contrato completo: sin residuo, sin error', '^OK $', 'service_role', null,
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210001'', ''mayorista'', ''{}'', ''[]'') on conflict (numero_contrato) do update set costos = excluded.costos returning 1', 'DTM-210001', true);
select pg_temp.caso('C4 upsert sobre un pendiente con fila: actualiza (reintento de la reconciliación)', '^OK 1', 'service_role', null,
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210010'', ''mayorista'', ''{"costo_hotel": 5}'', ''[]'') on conflict (numero_contrato) do update set costos = excluded.costos returning 1', 'DTM-210010');
select pg_temp.caso('C5 contrato inexistente: la FK sigue dando su error', '^ERR 23503', 'service_role', null,
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-299998'', ''mayorista'', ''{}'', ''[]'') returning 1');
-- Residuo HISTÓRICO (fila de un contrato completo, sembrada sin disparadores): la RPC lo limpia al ser llamada; no hay backfill.
set local session_replication_role = replica;
insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values ('DTM-210001', 'mayorista', '{}', '[]');
set local session_replication_role = origin;
select pg_temp.caso('C6 RPC no-op sobre un contrato con un residuo previo: lo limpia', '^OK .*"ya_completo": true', 'service_role', null, pg_temp.reg('DTM-210001'), 'DTM-210001');
select pg_temp.verifica('C6b sin residuo', pg_temp.foto('DTM-210001') ~ 'pend=0', 'pend=0', pg_temp.foto('DTM-210001'));
select pg_temp.caso('C7 respuesta perdida + compensación: RPC ok, revertir → ya_completo, sin residuo (todo en orden)', '^OK \{"estado": "ya_completo"\}', 'service_role', null, pg_temp.rev('DTM-210001'), 'DTM-210001', true);

-- ═══ D · llamada directa a la RPC y permisos efectivos ═══════════════════
select pg_temp.verifica('D1 ACL: solo service_role ejecuta las dos RPC', (
  select bool_and(has_function_privilege('service_role', p, 'execute') and not has_function_privilege('authenticated', p, 'execute')
                  and not has_function_privilege('anon', p, 'execute') and not has_function_privilege('public', p, 'execute'))
    from unnest(array['public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure, 'public.revertir_contrato_incompleto(text,text)'::regprocedure]) p),
  'service_role sí; authenticated/anon/public no', '');
select pg_temp.caso('D2 authenticated (administración) llama la RPC registrar', '^ERR 42501', 'authenticated', '00000000-0000-0000-0000-000000210001', pg_temp.reg('DTM-210011'), 'DTM-210011', true);
select pg_temp.caso('D3 authenticated (venta) llama la RPC registrar', '^ERR 42501', 'authenticated', '00000000-0000-0000-0000-000000210002', pg_temp.reg('DTM-210011'), 'DTM-210011', true);
select pg_temp.caso('D4 anon llama la RPC registrar', '^ERR 42501', 'anon', null, pg_temp.reg('DTM-210011'), 'DTM-210011', true);
select pg_temp.caso('D5 authenticated (administración) llama revertir', '^ERR 42501', 'authenticated', '00000000-0000-0000-0000-000000210001', pg_temp.rev('DTM-210011'), 'DTM-210011', true);
select pg_temp.caso('D6 anon llama revertir', '^ERR 42501', 'anon', null, pg_temp.rev('DTM-210011'), 'DTM-210011', true);
select pg_temp.caso('D7 authenticated no escribe el payload pendiente (RLS sin policies)', '^ERR 42501', 'authenticated', '00000000-0000-0000-0000-000000210001',
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210011'', ''mayorista'', ''{}'', ''[]'') returning 1', 'DTM-210011', true);
select pg_temp.caso('D7b ...y con un contrato COMPLETO responde IGUAL (42501): no se filtra el estado del contrato', '^ERR 42501', 'authenticated', '00000000-0000-0000-0000-000000210001',
  'insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (''DTM-210001'', ''mayorista'', ''{}'', ''[]'') returning 1', 'DTM-210001', true);
select pg_temp.caso('D7c authenticated no lee filas del pendiente (RLS: 0 filas visibles)', '^OK 0$', 'authenticated', '00000000-0000-0000-0000-000000210001',
  'select count(*)::text from public.contrato_financiero_pendiente');
select pg_temp.caso('D8 service_role directo sobre un contrato de OTRA agencia: no_existe / error, íntegro', '^ERR P0001 registrar_financiero_contrato: el contrato MIN-210014 no existe en la agencia mayorista', 'service_role', null, pg_temp.reg('MIN-210014', 'mayorista'), 'MIN-210014', true);
select pg_temp.caso('D9 la RPC de la agencia correcta sobre el contrato minorista funciona (aislamiento por tenant, no por rol)', '^OK .*"creadas": \[\{', 'service_role', null, pg_temp.reg('MIN-210014', 'minorista'), 'MIN-210014');
select pg_temp.verifica('D9b las CxP quedaron con el tenant del contrato', (select bool_and(tenant = 'minorista') and count(*) = 2 from public.cuentas_por_pagar where numero_contrato = 'MIN-210014'), '2 CxP minorista', pg_temp.foto('MIN-210014'));

-- ═══ E · asiento: un solo devengo por CxP ═════════════════════════════════
insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values ('mayorista', 910001, current_date, 'cxp A', 'cxp', 'cxp:910001');
select pg_temp.caso('E1 segundo asiento de la MISMA CxP: unique_violation (no se duplica)', '^ERR 23505', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 910002, current_date, ''cxp A bis'', ''cxp'', ''cxp:910001'') returning 1');
select pg_temp.caso('E2 el reemplazo en DOS pasos (borrar y luego volver a postear, como lo hace la app) sigue funcionando', '^OK 1', 'service_role', null,
  'delete from public.asientos_contables where origen = ''cxp'' and referencia = ''cxp:910001'' returning 1');
select pg_temp.caso('E2b ...y el nuevo asiento entra', '^OK 1', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 910003, current_date, ''cxp A reemplazo'', ''cxp'', ''cxp:910001'') returning 1');
select pg_temp.caso('E3 otros orígenes con la misma referencia no se ven afectados', '^OK 1', 'service_role', null,
  'insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia) values (''mayorista'', 910004, current_date, ''x'', ''pago_proveedor'', ''cxp:910001'') returning 1');

-- ═══ F · RETIRADA (rollback_210): restaura las 172, sin reparar datos ════
select pg_temp.caso('F0 preparar: contrato completo por la 210', '^OK .*"creadas": \[\{', 'service_role', null, pg_temp.reg('DTM-210012'), 'DTM-210012');
create temp table _f0 as select string_agg(id::text, ',' order by id) as ids from public.cuentas_por_pagar where numero_contrato = 'DTM-210012';
\i :rollback_210
select pg_temp.verifica('F1b revertir devuelve void otra vez', (select format_type(prorettype, null) = 'void' from pg_proc where oid = 'public.revertir_contrato_incompleto(text,text)'::regprocedure), 'void', '');
select pg_temp.verifica('F1c sin trigger de guarda', not exists (select 1 from pg_trigger where tgname = 'trg_contrato_financiero_pendiente_guarda'), 'sin trigger', '');
select pg_temp.verifica('F1d columna, índice y datos conservados', exists (select 1 from information_schema.columns where table_name = 'ventas' and column_name = 'financiero_registrado_en')
  and to_regclass('public.asientos_contables_cxp_referencia_uk') is not null
  and (select financiero_registrado_en is not null from public.ventas where numero_contrato = 'DTM-210012'), 'columna + índice + marca', '');
select pg_temp.verifica('F1e ACL reafirmado tras la retirada', (
  select bool_and(has_function_privilege('service_role', p, 'execute') and not has_function_privilege('authenticated', p, 'execute') and not has_function_privilege('anon', p, 'execute'))
    from unnest(array['public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure, 'public.revertir_contrato_incompleto(text,text)'::regprocedure]) p), 'solo service_role', '');
select pg_temp.caso('F2 tras la retirada, la reentrada vuelve a REEMPLAZAR las CxP (K15 reabierto: eso es lo que cuesta retirar la 210)', '^OK .*"eliminadas": \[[0-9]+, [0-9]+\]', 'service_role', null, pg_temp.reg('DTM-210012'), 'DTM-210012');
select pg_temp.verifica('F2b los ids cambiaron (se borraron y recrearon)', (select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = 'DTM-210012') is distinct from (select ids from _f0), 'ids distintos', '');

-- ── Resultado ─────────────────────────────────────────────────────────────
\echo '=== RESULTADOS 210 (una sesión) ==='
\pset format unaligned
\pset fieldsep ' | '
select n, caso, case when ok then 'OK' else 'FALLA' end as r, esperado, left(obtenido, 220) as obtenido, fotos from _r order by n;
select count(*) filter (where ok) as pasan, count(*) filter (where not ok) as fallan, count(*) as total from _r;
rollback;
