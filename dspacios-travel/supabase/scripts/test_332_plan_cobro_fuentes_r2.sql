-- R2-1 (migración 332) — pruebas de BASE DE DATOS de reemplazar_plan_cobro: el total, la moneda y el mínimo los deriva la base; ninguna fuente vieja/forjada guarda un plan.
-- Se corre en una copia desechable que ya tenga 307 + 331 + 332 (psql -v ON_ERROR_STOP=1 -f -). Todo termina en ROLLBACK; el resultado es una tabla única (control, observado, esperado, estado).
-- Actor: superadmin de la plantilla (aaaaaaaa-1111-…), con la sesión simulada por JWT claims (auth.uid() de la plantilla lee request.jwt.claim.sub). Los cambios de fuentes se hacen como dueño (reset role) para simular otra sesión concurrente.
begin;
create schema r2t;
grant usage, create on schema r2t to authenticated, anon;
create table r2t.r2_res (n serial, control text, observado text, esperado text, estado text);
grant all on all tables in schema r2t to authenticated;
grant all on all sequences in schema r2t to authenticated;
create function r2t.reg(p_control text, p_obs text, p_esp text) returns void language sql as $$
  insert into r2t.r2_res (control, observado, esperado, estado) values (p_control, p_obs, p_esp, case when p_obs is not distinct from p_esp then 'OK' else 'FALLO' end) $$;
-- Intenta reemplazar y devuelve 'ok:<n>' o el prefijo del error (sin abortar la transacción).
create function r2t.intento(p text, f jsonb, filas jsonb) returns text language plpgsql as $$
begin return 'ok:' || (public.reemplazar_plan_cobro(p, f, filas)->>'n');
exception when others then return 'err:' || split_part(sqlerrm, ':', 1); end $$;
create function r2t.huella(p text) returns text language sql as $$
  select coalesce(string_agg(id || '/' || orden || '/' || tipo || '/' || monto::numeric(15,2), ',' order by id), '-') from public.cuotas where numero_contrato = p $$;
-- Fuentes tal como las armaría la aplicación a partir de lo que lee AHORA (con sobrescrituras para simular un cálculo viejo o forjado).
create function r2t.fu(p text, pct numeric default null, total numeric default null) returns jsonb language plpgsql as $$
declare v jsonb := public.plan_cobro_fuentes(p); begin
  return jsonb_build_object('total', coalesce(total, (v->>'total')::numeric), 'pagado', v->'pagado', 'precio_venta', v->'precio_venta', 'total_cobro', v->'total_cobro', 'fecha_salida', v->'fecha_salida',
    'moneda', v->'moneda', 'moneda_cobro', v->'moneda_cobro', 'trm_cobro', v->'trm_cobro', 'moneda_efectiva', v->'moneda_efectiva', 'pct_abono', coalesce(pct, (v->>'pct_abono')::numeric), 'acuerdo_id', v->'acuerdo_id');
end $$;
create function r2t.como_super() returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-1111-1111-111111111111', true), set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true) $$;

-- Contrato sintético propio (no toca los de la plantilla): 1.000.000 COP, condición congelada 300.000.
insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_salida, fecha_regreso)
values ('DTM-8201', 'mayorista', 'Cliente R2', 'pendiente', 'Prueba', 1000000, 'COP', 'porcion', 'completo', current_date + 30, current_date + 120, current_date + 124);
insert into public.contrato_condiciones (numero_contrato, tipo_componente, orden, valor_componente, condicion_pago_tipo, monto_exigido, restriccion_comercial, moneda, trm)
values ('DTM-8201', 'hotel', 0, 1, 'normal', 300000, 'normal', 'COP', 1);
set local role authenticated;
select r2t.como_super();

-- S0: la base deriva total, moneda y porcentaje.
select r2t.reg('S0 la base deriva total=1.000.000, moneda COP, pct=0,3 (condición 300.000)',
  (public.plan_cobro_fuentes('DTM-8201')->>'total') || '|' || (public.plan_cobro_fuentes('DTM-8201')->>'moneda_efectiva') || '|' || round((public.plan_cobro_fuentes('DTM-8201')->>'pct_abono')::numeric, 4), '1000000.00|COP|0.3000');

-- S1: un plan válido se guarda.
select r2t.reg('S1 un plan válido (300.000 + 700.000) se guarda',
  r2t.intento('DTM-8201', r2t.fu('DTM-8201'), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'ok:2');
create table r2t.r2_base as select r2t.huella('DTM-8201') h;
grant all on all tables in schema r2t to authenticated;

-- S2: total FORJADO en p_fuentes (500.000, y las filas suman 500.000) con el contrato en 1.000.000 → rechazado: la base ya no confía en p_fuentes.total.
select r2t.reg('S2 total forjado en p_fuentes (filas suman 500.000) → rechazado',
  r2t.intento('DTM-8201', r2t.fu('DTM-8201', null, 500000), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":150000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":350000}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S2b plan idéntico tras el rechazo', (r2t.huella('DTM-8201') = (select h from r2t.r2_base))::text, 'true');

-- S3: fuentes correctas pero las filas NO suman el total de la base.
select r2t.reg('S3 filas que suman 900.000 con fuentes correctas → rechazado',
  r2t.intento('DTM-8201', r2t.fu('DTM-8201'), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":600000}]'), 'err:reemplazar_plan_cobro');
select r2t.reg('S3b plan idéntico', (r2t.huella('DTM-8201') = (select h from r2t.r2_base))::text, 'true');

-- S4: se agrega otra condición congelada (200.000, suma 500.000) después de que la aplicación calculó con 0,3 (las condiciones son inmutables: solo se pueden añadir).
reset role;
insert into public.contrato_condiciones (numero_contrato, tipo_componente, orden, valor_componente, condicion_pago_tipo, monto_exigido, restriccion_comercial, moneda, trm)
values ('DTM-8201', 'servicio', 1, 1, 'normal', 200000, 'normal', 'COP', 1);
set local role authenticated;
select r2t.como_super();
select r2t.reg('S4 condición congelada cambió (30 %→50 %), la aplicación usó 0,3 → rechazado',
  r2t.intento('DTM-8201', r2t.fu('DTM-8201', 0.3), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S4b plan idéntico', (r2t.huella('DTM-8201') = (select h from r2t.r2_base))::text, 'true');
select r2t.reg('S4c con el pct vigente (0,5) sí se guarda',
  r2t.intento('DTM-8201', r2t.fu('DTM-8201'), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":500000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":500000}]'), 'ok:2');
reset role;
update r2t.r2_base set h = r2t.huella('DTM-8201');
-- S5: contrato SIN condiciones (histórico): manda config_cobros; el % cambia entre calcular y guardar.
update public.config_cobros set pct_abono = 0.3 where tipo_paquete = 'porcion_terrestre';
insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_salida, fecha_regreso)
values ('DTM-8202', 'mayorista', 'Cliente R2b', 'pendiente', 'Prueba', 1000000, 'COP', 'porcion_terrestre', 'completo', current_date + 30, current_date + 120, current_date + 124);
set local role authenticated;
select r2t.como_super();
select r2t.reg('S5a plan inicial del contrato sin condiciones se guarda', r2t.intento('DTM-8202', r2t.fu('DTM-8202'), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'ok:2');
create table r2t.r2_base2 as select r2t.huella('DTM-8202') h;
create table r2t.r2_f5 as select r2t.fu('DTM-8202') f;
grant all on all tables in schema r2t to authenticated;
select r2t.reg('S5 sin condiciones el pct sale de config_cobros (0,3)', (select f->>'pct_abono' from r2t.r2_f5), '0.3000');
reset role;
update public.config_cobros set pct_abono = 0.6 where tipo_paquete = 'porcion_terrestre';
set local role authenticated;
select r2t.como_super();
select r2t.reg('S5b config_cobros cambió a 0,6 con fuentes viejas (0,3) → rechazado',
  r2t.intento('DTM-8202', (select f from r2t.r2_f5), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S5c plan idéntico', (r2t.huella('DTM-8202') = (select h from r2t.r2_base2))::text, 'true');

-- S6: contrato cuya oferta es COP pero se cobra en USD (TRM 4.000 congelada, total 250 USD; la moneda de cobro no se puede cambiar después de crear el contrato). Una aplicación que calculó con la moneda/total de la OFERTA se rechaza.
reset role;
insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, moneda_cobro, trm_cobro, total_cobro, tipo_paquete, financiero_estado, plazo, fecha_salida, fecha_regreso)
values ('DTM-8203', 'mayorista', 'Cliente R2c', 'pendiente', 'Prueba', 1000000, 'COP', 'USD', 4000, 250, 'porcion_terrestre', 'completo', current_date + 30, current_date + 120, current_date + 124);
set local role authenticated;
select r2t.como_super();
select r2t.reg('S6a la base deriva total=250 USD y moneda efectiva USD', (public.plan_cobro_fuentes('DTM-8203')->>'total') || '|' || (public.plan_cobro_fuentes('DTM-8203')->>'moneda_efectiva'), '250.00|USD');
select r2t.reg('S6b la aplicación usó la moneda/total de la OFERTA (COP 1.000.000) → rechazado',
  r2t.intento('DTM-8203', r2t.fu('DTM-8203') || '{"moneda_efectiva":"COP","total":1000000}'::jsonb, '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S6c la aplicación omitió la TRM de cobro → rechazado',
  r2t.intento('DTM-8203', r2t.fu('DTM-8203') || '{"trm_cobro":null}'::jsonb, '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":75},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":175}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S6d sin plan guardado tras los rechazos', r2t.huella('DTM-8203'), '-');
select r2t.reg('S6e fuentes correctas (USD 250 = 75 + 175) se guardan', r2t.intento('DTM-8203', r2t.fu('DTM-8203'), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":75},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":175}]'), 'ok:2');

-- S7: un abono nuevo llega entre calcular y guardar.
reset role;
update public.ventas set moneda_cobro = null, trm_cobro = null, total_cobro = null where numero_contrato = 'DTM-8202';
update public.config_cobros set pct_abono = 0.3 where tipo_paquete = 'porcion_terrestre';
set local role authenticated;
select r2t.como_super();
create table r2t.r2_f7 as select r2t.fu('DTM-8202') f;
grant all on all tables in schema r2t to authenticated;
reset role;
insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values ('DTM-8202', 'Cliente R2', current_date, 100000, 'efectivo', 'mayorista');
set local role authenticated;
select r2t.como_super();
select r2t.reg('S7 abono nuevo tras calcular → rechazado',
  r2t.intento('DTM-8202', (select f from r2t.r2_f7), '[{"tipo":"abono","fecha_limite":"2099-01-01","monto":300000},{"tipo":"cuota","fecha_limite":"2099-02-01","monto":700000}]'), 'err:PLAN_COBRO_FUENTES_CAMBIARON');
select r2t.reg('S7b plan idéntico', (r2t.huella('DTM-8202') = (select h from r2t.r2_base2))::text, 'true');

-- S8: anon no ejecuta.
reset role;
select r2t.reg('S8 anon no ejecuta plan_cobro_fuentes', (case when has_function_privilege('anon', 'public.plan_cobro_fuentes(text)', 'execute') then 'puede' else 'no puede' end), 'no puede');
select r2t.reg('S8b anon no ejecuta reemplazar_plan_cobro', (case when has_function_privilege('anon', 'public.reemplazar_plan_cobro(text,jsonb,jsonb)', 'execute') then 'puede' else 'no puede' end), 'no puede');

select n, control, observado, esperado, estado from r2t.r2_res order by n;
select case when count(*) filter (where estado <> 'OK') = 0 then 'VEREDICTO: TODO OK (' || count(*) || ' comprobaciones)' else 'VEREDICTO: HAY FALLOS (' || count(*) filter (where estado <> 'OK') || ')' end as veredicto from r2t.r2_res;
rollback;
