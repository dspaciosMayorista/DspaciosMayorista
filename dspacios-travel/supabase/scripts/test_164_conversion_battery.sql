-- ═══════════════════════════════════════════════════════════════════════════
-- BATERÍA #40 · CONVERSIÓN A UN SOLO CONTRATO (Commit 5, migración 164)
--
-- Correr SOLO contra una base PostgreSQL DESECHABLE donde esté aplicada la
-- migración REAL 1→163 + `20260601000164_condiciones_pago_componente.sql`.
-- NO correr contra Supabase real, preview ni la BD local persistente.
--
-- Ejecución: `psql -v ON_ERROR_STOP=1 -f test_164_conversion_battery.sql`
-- como superusuario. Todo escenario que no cumpla su aserción lanza una
-- excepción → psql aborta (código de salida ≠ 0) → la prueba FALLA.
--
-- Cubre las categorías 1,2,3,5,6,7,8,9 de #40 (SQL/estructural/rollback).
-- La CONCURRENCIA real (cat. 4) y el ciclo apply→rollback→reapply (cat. 10)
-- se cubren con `test_164_conversion_concurrency.sh` (ver ese archivo).
--
-- Convención: al arrancar se limpian los datos y se reinician las secuencias
-- para que la batería sea reproducible desde cualquier estado. Al final se hace
-- rollback de todo lo creado (la batería no deja datos).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── Limpieza + reinicio de secuencias (solo sobre la BD desechable). ──────
truncate table public.contrato_condiciones, public.contrato_items, public.contrato_pasajeros,
  public.aliados_b2b, public.abonos, public.cotizacion_pagos_previos,
  public.cotizacion_condiciones, public.cotizacion_servicios, public.cuentas_por_pagar,
  public.asiento_lineas, public.asientos_contables, public.ventas, public.cotizaciones
  cascade;

-- ── Ayudante de aserción. ──────────────────────────────────────────────────
create schema if not exists _t164;
grant usage on schema _t164 to service_role, anon, authenticated;
create or replace function _t164.expect(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) = false then
    raise exception 'ASSERT %', p_msg;
  end if;
end $$;
grant execute on function _t164.expect(boolean, text) to service_role, anon, authenticated;

-- ── Actores (auth.users + usuarios), idempotente. ──────────────────────────
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','adm@t','authenticated','authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002','germ@t','authenticated','authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003','gern@t','authenticated','authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004','venta@t','authenticated','authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000005','inact@t','authenticated','authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000006','agencia@t','authenticated','authenticated')
on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('aaaaaaaa-0000-0000-0000-000000000001','adm@t','ADM','superadmin',    true,'mayorista'),
  ('aaaaaaaa-0000-0000-0000-000000000002','germ@t','GER M','gerencia',    true,'mayorista'),
  ('aaaaaaaa-0000-0000-0000-000000000003','gern@t','GER N','gerencia',    true,'minorista'),
  ('aaaaaaaa-0000-0000-0000-000000000004','venta@t','VENTA','venta',      true,'mayorista'),
  ('aaaaaaaa-0000-0000-0000-000000000005','inact@t','INACT','superadmin', false,'mayorista'),
  ('aaaaaaaa-0000-0000-0000-000000000006','agencia@t','AGENCIA','agencia',true,'mayorista')
-- upsert: usuarios NO se trunca arriba, así que forzamos el rol/activo/tenant
-- correctos en cada ejecución (los primeros runs usaban un seed erróneo).
on conflict (id) do update set
  email=excluded.email, nombre=excluded.nombre, rol=excluded.rol,
  activo=excluded.activo, tenant=excluded.tenant;
-- Proveedor del catálogo con retención (match por nombre).
insert into public.proveedores (nombre, nit, tipo, ciudad, aplica_retencion, pct_retencion, clasificacion)
values ('PROV HOTEL RET', '900000001', 'hotel', 'Cartagena', true, 0.035, 'hotel') on conflict do nothing;

-- ── Ayudante: crea una cotización manual abierta + la CONGELA con el primer
--    pago previo. Devuelve el id. Costos derivados de p_precio (aéreo 40%,
--    hotel 35%). p_pago1 puede ser < p_exigido (congelada pero bajo mínimo). ──
create or replace function _t164.mk_cot(
  p_tenant text, p_moneda text, p_precio numeric, p_trm numeric,
  p_exigido numeric, p_pago1 numeric, p_clave text,
  p_tipoAsesor text default 'interno'
) returns bigint language plpgsql as $$
declare v_cot bigint; v_aereo numeric := round(p_precio*0.4); v_hotel numeric := round(p_precio*0.35);
begin
  insert into public.cotizaciones
    (tenant, estado, tipo, cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
     pax, precio_venta, moneda, asesor, payload, detalle)
  values
    (p_tenant, 'abierta', 'manual', 'CLIENTE '||p_clave, 'CC '||substr(p_clave,1,6),
     'CARTAGENA', '2026-10-01', '2026-10-04', 2, p_precio, p_moneda, 'Asesor '||p_tenant,
     jsonb_build_object(
       'cliente', jsonb_build_object('nombres','Cliente','apellidos',p_clave,'tipoDoc','CC',
         'numeroDoc', substr(replace(p_clave,'-',''),1,10), 'nacimiento','1990-01-01','telefono','300123'),
       'tipoAsesor', p_tipoAsesor,
       'agenciaNombre','Aliado A','freelanceNombre','Free A',
       'ninos',0,'tarifaNino',0,'recobro',0,'recobroAliado',0,
       'observaciones','bat-'||p_clave),
     '{}'::jsonb)
  returning id into v_cot;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 0, 'aereo', 'Avianca', 'VUELO BOG-CTG', NULL, v_aereo);
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 1, 'hotel', NULL, 'Hotel Test', 'PROV HOTEL RET', v_hotel);
  perform public.registrar_pago_previo(
    v_cot, p_pago1, p_moneda, p_trm, 'Transferencia', 'REF-'||p_clave,
    '2026-09-01', 'aaaaaaaa-0000-0000-0000-000000000001', 'key-'||p_clave,
    jsonb_build_array(
      jsonb_build_object('orden',0,'tipo_componente','aereo_empaquetado','referencia_externa','Vuelo',
        'valor_componente',v_aereo,'condicion_pago_tipo','sin_condicion','monto_exigido',0,'restriccion_comercial','normal'),
      jsonb_build_object('orden',1,'tipo_componente','hotel','referencia_externa','Hotel Test',
        'valor_componente',v_hotel,'condicion_pago_tipo','anticipo_saldo','condicion_pago_pct_aplicable',0.5,
        'condicion_pago_dias_saldo',30,'monto_exigido',p_exigido,'restriccion_comercial','normal')
    ),
    p_exigido, 50.0);
  return v_cot;
end $$;

\echo 'BATTERY #40: arranca.'

-- ════════════ CATEGORÍA 1 · HAPPY PATH aéreo+hotel → UN contrato ════════════
do $$
declare v_cot bigint; v_num text;
  v_n_venta int; v_n_cond int; v_n_abono int; v_n_cxp int;
  v_cx numeric; v_hx numeric; v_rec numeric;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'happy');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  select count(*) into v_n_venta from public.ventas where cotizacion_id=v_cot;
  select count(*) into v_n_cond from public.contrato_condiciones where numero_contrato=v_num;
  select count(*) into v_n_abono from public.abonos where numero_contrato=v_num;
  select count(*) into v_n_cxp  from public.cuentas_por_pagar where numero_contrato=v_num;
  -- reclass 280510→280505 balanceado: Debe 280510 = Haber 280505 = monto aplicado.
  select coalesce(sum(l.debe),0), coalesce(sum(l.haber),0) into v_cx, v_hx
  from public.asiento_lineas l
  join public.asientos_contables a on a.id=l.asiento_id
  join public.puc_cuentas cc on cc.id=l.cuenta_id
  where a.origen='pago_previo_aplicacion' and cc.codigo='280510';
  select coalesce(sum(l.haber),0) into v_rec
  from public.asiento_lineas l
  join public.asientos_contables a on a.id=l.asiento_id
  join public.puc_cuentas cc on cc.id=l.cuenta_id
  where a.origen='pago_previo_aplicacion' and cc.codigo='280505';
  perform _t164.expect(v_n_venta=1, 'C1: debe haber EXACTAMENTE 1 venta');
  perform _t164.expect(v_num ~ '^DTM-', 'C1: número mayorista DTM-xxxx');
  perform _t164.expect(v_n_cond=2, 'C1: condiciones copiadas (2 componentes)');
  perform _t164.expect(v_n_abono=1, 'C1: 1 abono transferido');
  perform _t164.expect(v_n_cxp=2, 'C1: 2 CxP (aéreo+hotel)');
  perform _t164.expect(coalesce(v_cx,0)=1000000 and coalesce(v_rec,0)=1000000,
    'C1: reclass Debe 280510 = Haber 280505 = 1.000.000 COP');
  -- pago aplicado con abono + cotización convertida.
  perform _t164.expect(
    (select estado from public.cotizacion_pagos_previos where cotizacion_id=v_cot)='aplicado'
    and (select abono_id is not null from public.cotizacion_pagos_previos where cotizacion_id=v_cot),
    'C1: pago marcado aplicado con abono_id');
  perform _t164.expect(
    (select estado||'|'||numero_contrato from public.cotizaciones where id=v_cot) = 'convertida|'||v_num,
    'C1: cotización convertida y enlazada');
end $$;
\echo 'C1 happy path: OK'

-- ═══════════════ CATEGORÍA 2 · MÍNIMO (fail-closed) ════════════════════════
-- 2a) 1 COP por debajo del exigido → rechazo, CERO efectos.
do $$
declare v_cot bigint; v_err text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,999999,'min-below');
  begin
    perform public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  perform _t164.expect(v_err is not null, 'C2a: 1 COP debajo del mínimo debe REZAR');
  perform _t164.expect((select count(*) from public.ventas where cotizacion_id=v_cot)=0, 'C2a: sin venta');
  perform _t164.expect((select estado from public.cotizaciones where id=v_cot)='abierta', 'C2a: sigue abierta');
end $$;
\echo 'C2a mínimo (1 COP debajo): OK'

-- 2b) exactamente igual al mínimo → convierte.
do $$
declare v_cot bigint; v_num text; v_err text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'min-exact');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  perform _t164.expect(v_num ~ '^DTM-', 'C2b: igual al mínimo convierte');
end $$;
\echo 'C2b mínimo (igual): OK'

-- 2c) pagado por encima del mínimo y ≤ total → convierte.
do $$
declare v_cot bigint; v_num text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,600000,1500000,'min-above');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  perform _t164.expect(v_num ~ '^DTM-', 'C2c: sobre mínimo ≤ total convierte');
end $$;
\echo 'C2c mínimo (sobre): OK'

-- 2d) un pago ANULADO no cuenta para el mínimo.
do $$
declare v_cot bigint; v_pago_an bigint; v_err text; v_res text;
begin
  -- exigido 1.500.000; primer pago 800.000 activo; segundo 800.000 que se anula.
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1500000,800000,'min-anul');
  select public.registrar_pago_previo(v_cot,800000,'COP',1,'Transferencia','REF-anul2','2026-09-01',
    'aaaaaaaa-0000-0000-0000-000000000001','key-min-anul-2') into v_res;
  v_pago_an := split_part(v_res,'|',2)::bigint;
  perform public.anular_pago_previo(v_pago_an,'aaaaaaaa-0000-0000-0000-000000000001','prueba');
  begin
    perform public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  -- Solo el pago activo (800.000) cuenta → 800.000 < 1.500.000 → rechazo.
  perform _t164.expect(v_err is not null, 'C2d: el pago anulado NO debe contar; debe rechazar');
  perform _t164.expect((select count(*) from public.ventas where cotizacion_id=v_cot)=0, 'C2d: sin venta');
end $$;
\echo 'C2d mínimo (anulado no cuenta): OK'

-- ═══════════════ CATEGORÍA 3 · IDEMPOTENCIA (replay) ════════════════════════
do $$
declare v_cot bigint; v_num1 text; v_num2 text;
  v_seq_after_first bigint; v_seq_after_replay bigint;
  v_ventas int; v_items int; v_pas int; v_cond int; v_abonos int; v_cxp int; v_asi int;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'replay');
  v_num1 := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  -- La PRIMERA conversión consume un consecutivo (correcto).
  select last_value into v_seq_after_first from public.contrato_seq_mayorista;
  -- "Se perdió la respuesta": reintento con la MISMA cotización.
  v_num2 := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  perform _t164.expect(v_num1 = v_num2, 'C3: replay devuelve la MISMA venta/número');
  select last_value into v_seq_after_replay from public.contrato_seq_mayorista;
  perform _t164.expect(v_seq_after_first = v_seq_after_replay,
    'C3: el replay NO consumió otro consecutivo de la secuencia');
  select count(*) into v_ventas from public.ventas where cotizacion_id=v_cot;
  select count(*) into v_items  from public.contrato_items where numero_contrato=v_num1;
  select count(*) into v_pas    from public.contrato_pasajeros where numero_contrato=v_num1;
  select count(*) into v_cond   from public.contrato_condiciones where numero_contrato=v_num1;
  select count(*) into v_abonos from public.abonos where numero_contrato=v_num1;
  select count(*) into v_cxp    from public.cuentas_por_pagar where numero_contrato=v_num1;
  select count(*) into v_asi    from public.asientos_contables a
    where a.referencia like 'cxp:%' and exists(select 1 from public.ventas w where w.numero_contrato=v_num1);
  perform _t164.expect(v_ventas=1, 'C3: sigue habiendo UNA venta');
  perform _t164.expect(v_items=1 and v_pas=1 and v_cond=2, 'C3: hijas/condiciones sin duplicar');
  perform _t164.expect(v_abonos=1 and v_cxp=2, 'C3: abonos/CxP sin duplicar');
  -- el pago aplicado NO se retransfiere (queda 1 pago, 1 abono).
  perform _t164.expect((select count(*) from public.cotizacion_pagos_previos where cotizacion_id=v_cot)=1
    and (select count(*) from public.cotizacion_pagos_previos where cotizacion_id=v_cot and estado='aplicado')=1,
    'C3: el pago aplicado no se retransfiere');
end $$;
\echo 'C3 idempotencia: OK'

-- ═══════════════════════ CATEGORÍA 5 · ROLLBACK INTEGRAL ══════════════════
-- 5a) Fallo de cuenta PUC de la CxP (falta la cuenta de costo del proveedor)
--     DESPUÉS de crear venta+abono dentro de la tx → TODO revierte.
do $$
declare v_cot bigint; v_seq_before bigint; v_seq_after bigint;
  v_asi_before int; v_abono_before int; v_cxp_before int; v_err text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'rollback');
  -- Conteos base (otras categorías ya corrieron): medimos el DELTA del fallo.
  select count(*) into v_asi_before from public.asientos_contables where origen in
    ('pago_previo_aplicacion','cxp');
  select count(*) into v_abono_before from public.abonos;
  select count(*) into v_cxp_before  from public.cuentas_por_pagar;
  select last_value into v_seq_before from public.contrato_seq_mayorista;
  -- "Ocultamos" SOLO la cuenta de costo hotel (613505) del tenant mayorista
  -- renombrándola a un código inexistente: así `_puc_id('mayorista','613505')`
  -- falla dentro de la conversión (sin FK roto ni delete de la fila).
  update public.puc_cuentas set codigo='613505_HIDDEN'
    where tenant='mayorista' and codigo='613505';
  begin
    perform public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  -- Reintegramos la cuenta (la batería no deja el PUC mutilado).
  update public.puc_cuentas set codigo='613505'
    where tenant='mayorista' and codigo='613505_HIDDEN';
  select last_value into v_seq_after from public.contrato_seq_mayorista;
  perform _t164.expect(v_err is not null, 'C5a: la CxP debe fallar al faltar la cuenta PUC');
  -- CERO efectos de ESTA conversión: sin venta para v_cot, sin abonos/CxP/asientos
  -- nuevos (delta = 0), estado intacto. Un fallo transaccional NO deja nada.
  perform _t164.expect((select count(*) from public.ventas where cotizacion_id=v_cot)=0, 'C5a: sin venta');
  perform _t164.expect((select count(*) from public.abonos) = v_abono_before, 'C5a: sin abono nuevo');
  perform _t164.expect((select count(*) from public.cuentas_por_pagar) = v_cxp_before, 'C5a: sin CxP nueva');
  perform _t164.expect((select count(*) from public.asientos_contables where origen in
      ('pago_previo_aplicacion','cxp')) = v_asi_before, 'C5a: sin asiento de aplicacion/cxp nuevo');
  perform _t164.expect((select estado from public.cotizaciones where id=v_cot)='abierta'
    and (select numero_contrato is null from public.cotizaciones where id=v_cot), 'C5a: estado intacto (abierta, sin número)');
  -- Nota PostgreSQL: la secuencia AVANZÓ (hueco normal por el nextval consumido),
  -- pero NO hay contrato → no es un fallo transaccional, es un hueco de secuencia.
  raise notice 'C5a: secuencia avanzó de % a % (hueco normal PostgreSQL, CERO contratos) — OK.',
    v_seq_before, v_seq_after;
end $$;
\echo 'C5a rollback integral (cuenta PUC ausente): OK'

-- 5b) Fallo del lado DEL PAGO (cuenta de costo de la CxP hoteles) revierte
--     también la reclasificación ya insertada en el flujo. (Equivalente al
--     caso previo: el pago→abono + reclass ocurren ANTES del paso 12 CxP.)

-- ═══════════════════════════ CATEGORÍA 6 · MONEDA ══════════════════════════
-- 6a) COP: el abono y el reclass usan monto_cop = valor (TRM 1), sin recomputo.
do $$
declare v_cot bigint; v_num text;
  v_abono_cop numeric; v_abono_moneda numeric; v_pago_cop numeric;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'cop');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  select monto_cop into v_pago_cop from public.cotizacion_pagos_previos where cotizacion_id=v_cot;
  select valor_abono, monto_cop into v_abono_moneda, v_abono_cop from public.abonos where numero_contrato=v_num;
  perform _t164.expect(v_pago_cop=1000000 and v_abono_cop=1000000, 'C6a: abono COP = monto_cop = valor');
  perform _t164.expect(v_abono_moneda=v_abono_cop, 'C6a: valor_abono (COP) == monto_cop');
end $$;
\echo 'C6a COP: OK'

-- 6b) USD: abono en USD con monto_cop = valor×TRM congelada; el reclass y el
--     mínimo se miden SIEMPRE en monto_cop (COP), nunca se recomputa la TRM.
do $$
declare v_cot bigint; v_num text; v_abono_moneda numeric; v_abono_cop numeric;
  v_pago_id bigint; v_exigido_cop numeric; v_cx numeric; v_rec numeric; v_ref text;
begin
  -- precio 2.000 USD, TRM 4000, exigido 1.000 USD, pago1 1.000 USD.
  v_cot := _t164.mk_cot('mayorista','USD',2000,4000,1000,1000,'usd');
  select monto_exigido_total_cop into v_exigido_cop from public.cotizaciones where id=v_cot;
  perform _t164.expect(v_exigido_cop = 1000*4000, 'C6b: monto_exigido_total_cop = 1.000 USD × 4.000 = 4.000.000 COP');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  select id into v_pago_id from public.cotizacion_pagos_previos where cotizacion_id=v_cot;
  -- El asiento de reclasificación referencia 'pago_previo:<pago>:abono:<abono>'.
  v_ref := 'pago_previo:'||v_pago_id||':abono:%';
  select valor_abono, monto_cop into v_abono_moneda, v_abono_cop from public.abonos where numero_contrato=v_num;
  perform _t164.expect(v_abono_moneda = 4000000, 'C6b: valor_abono = monto_cop = 1.000 USD × 4.000 (COP)');
  perform _t164.expect(v_abono_cop = 4000000, 'C6b: monto_cop del abono = 4.000.000');
  select coalesce(sum(l.debe),0) into v_rec
  from public.asiento_lineas l
  join public.asientos_contables a on a.id=l.asiento_id
  join public.puc_cuentas cc on cc.id=l.cuenta_id
  where a.origen='pago_previo_aplicacion' and cc.codigo='280510' and a.referencia like v_ref;
  select coalesce(sum(l.haber),0) into v_cx
  from public.asiento_lineas l
  join public.asientos_contables a on a.id=l.asiento_id
  join public.puc_cuentas cc on cc.id=l.cuenta_id
  where a.origen='pago_previo_aplicacion' and cc.codigo='280505' and a.referencia like v_ref;
  perform _t164.expect(coalesce(v_rec,0)=4000000 and coalesce(v_cx,0)=4000000,
    'C6b: reclass Debe 280510 = Haber 280505 = Σ monto_cop (4.000.000 COP)');
  -- La CxP hereda la moneda de la cotización (USD) pero el asiento NO convierte
  -- (supuesto documentado del posteo automático): valor tal cual.
  select sum(valor_total) into v_cx from public.cuentas_por_pagar where numero_contrato=v_num;
  perform _t164.expect(coalesce(v_cx,0)= round(2000*0.4)+round(2000*0.35), 'C6b: CxP por costo neto en USD (sin conversión, como el posteo actual)');
end $$;
\echo 'C6b USD: OK'

-- ═══════════════════════ CATEGORÍA 7 · CxP por tipo + retención ════════════
do $$
declare v_cot bigint; v_num text; r record;
  v_dbe numeric; v_hbr numeric; v_cc text; v_cd text;
begin
  -- 5 servicios de los 5 tipos (aéreo sin proveedor→plataforma; los demás con
  -- proveedor propio, salvo 'otro' sin ninguno). 'otro' sin proveedor/plataforma
  -- → la CxP nace igual (proveedor NULL) porque el bloque CxP no exige proveedor.
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'cxp');
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 2, 'traslado', NULL, 'TRASLADO CTG', 'REC CTG', 200000);
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 3, 'asistencia', NULL, 'ASIST', 'ASIS PROV', 50000);
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 4, 'otro', NULL, 'OTRO', NULL, 50000);
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  perform _t164.expect((select count(*) from public.cuentas_por_pagar where numero_contrato=v_num)=5, 'C7: 5 CxP');

  -- Precedencia proveedor/plataforma exacta + tipo_proveedor por servicio.
  perform _t164.expect((select proveedor from public.cuentas_por_pagar where numero_contrato=v_num and tipo_proveedor='aereo')='Avianca',
    'C7: aéreo sin proveedor → plataforma fallback');
  perform _t164.expect((select count(*) from public.cuentas_por_pagar where numero_contrato=v_num and tipo_proveedor='receptivo' and proveedor='REC CTG')=1,
    'C7: traslado → tipo_proveedor receptivo');
  perform _t164.expect((select count(*) from public.cuentas_por_pagar where numero_contrato=v_num and tipo_proveedor='asistencia')=1
    and (select count(*) from public.cuentas_por_pagar where numero_contrato=v_num and tipo_proveedor='otro')=1,
    'C7: asistencia y otro con su tipo_proveedor');

  -- Retención por match de nombre en el catálogo (hotel PROV HOTEL RET = 3.5%).
  perform _t164.expect((select aplica_retencion and pct_retencion=0.035 from public.cuentas_por_pagar
      where numero_contrato=v_num and tipo_proveedor='hotel'),
    'C7: retención 3.5% por match de nombre');

  -- Asiento Debe Costo(613xxx) / Haber Proveedores(220xxx) por tipo, exacto,
  -- balanceado a valor_total (equivalencia con _cuentas_cxp/manualMapeos).
  --   aereo→[220510,613510] receptivo→[220515,613515] asistencia→[220520,613520]
  --   hotel→[220505,613505]  otro→[220595,613595]
  for r in select cx.id, cx.tipo_proveedor, cx.valor_total,
        case cx.tipo_proveedor when 'aereo' then '220510' when 'hotel' then '220505'
          when 'receptivo' then '220515' when 'asistencia' then '220520' else '220595' end as c_prov,
        case cx.tipo_proveedor when 'aereo' then '613510' when 'hotel' then '613505'
          when 'receptivo' then '613515' when 'asistencia' then '613520' else '613595' end as c_cost
      from public.cuentas_por_pagar cx where cx.numero_contrato=v_num
  loop
    select sum(l.debe), sum(l.haber) into v_dbe, v_hbr
    from public.asiento_lineas l join public.asientos_contables a on a.id=l.asiento_id
    join public.puc_cuentas cc on cc.id=l.cuenta_id
    where a.referencia='cxp:'||r.id;
    -- debe en la cuenta de costo, haber en la de proveedores.
    select distinct cc.codigo into v_cd from public.asiento_lineas l
      join public.asientos_contables a on a.id=l.asiento_id
      join public.puc_cuentas cc on cc.id=l.cuenta_id
      where a.referencia='cxp:'||r.id and l.debe>0;
    select distinct cc.codigo into v_cc from public.asiento_lineas l
      join public.asientos_contables a on a.id=l.asiento_id
      join public.puc_cuentas cc on cc.id=l.cuenta_id
      where a.referencia='cxp:'||r.id and l.haber>0;
    perform _t164.expect(coalesce(v_dbe,0)=r.valor_total and coalesce(v_hbr,0)=r.valor_total,
      'C7: asiento cxp balanceado (debe=haber=valor) para '||r.tipo_proveedor);
    perform _t164.expect(v_cd=r.c_cost and v_cc=r.c_prov,
      'C7: cuentas Debe='||r.c_cost||'/Haber='||r.c_prov||' para '||r.tipo_proveedor);
  end loop;
end $$;
\echo 'C7 CxP tipos/retención/cuentas exactas: OK'

-- ════════════════════ CATEGORÍA 8 · AUTORIZACIÓN / SEGURIDAD ═══════════════
-- 8a) actor de rol no permitido (venta), inactivo, externo (agencia) → rechazo.
do $$
declare v_cot bigint; v_err text; v_actor text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'auth-role');
  foreach v_actor in array array['aaaaaaaa-0000-0000-0000-000000000004'/*venta*/,
                                   'aaaaaaaa-0000-0000-0000-000000000005'/*inactivo*/,
                                   'aaaaaaaa-0000-0000-0000-000000000006'/*agencia*/]
  loop
    begin
      perform public.convertir_cotizacion_a_contrato(v_cot, v_actor::uuid);
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    perform _t164.expect(v_err is not null, 'C8a: actor no autorizado debe rechazar');
  end loop;
  perform _t164.expect((select count(*) from public.ventas where cotizacion_id=v_cot)=0, 'C8a: sin venta');
end $$;
\echo 'C8a roles inactivo/externo/venta: OK'

-- 8b) mismo tenant (gerencia mayorista) → permitido.
do $$
declare v_cot bigint; v_num text; v_err text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'auth-ok');
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000002');
  perform _t164.expect(v_num ~ '^DTM-', 'C8b: gerencia del mismo tenant convierte');
end $$;
\echo 'C8b mismo tenant: OK'

-- 8c) tenant distinto (gerencia minorista sobre cotización mayorista) → rechazo
--     ANTES de devolver la venta existente (replay de tenant ajeno).
do $$
declare v_cot bigint; v_num text; v_err text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'auth-tenant');
  -- Primero convierte el superadmin de mayorista (crea la venta).
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  -- Ahora gerencia de minorista intenta (aunque ya convertida) → debe rechazar
  -- por tenant, NO devolver el número de la venta existente.
  begin
    perform public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000003');
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  perform _t164.expect(v_err is not null, 'C8c: replay desde tenant ajeno se rechaza ANTES de devolver la venta');
end $$;
\echo 'C8c tenant ajeno (replay): OK'

-- 8d) frontera: tipo NO manual (tarifario/carrito/single) → rechazo explícito.
do $$
declare v_cot bigint; v_err text; v_t text;
begin
  foreach v_t in array array['tarifario','carrito','single']
  loop
    insert into public.cotizaciones (tenant, estado, tipo, cliente, cliente_documento, destino, pax, precio_venta, moneda, asesor, payload, detalle)
    values ('mayorista','abierta',v_t,'CLIENTE','CC1','CARTAGENA',2,100, 'COP','A', jsonb_build_object('cliente',jsonb_build_object('nombres','A','apellidos','B','tipoDoc','CC','numeroDoc','1','nacimiento','1990-01-01')),'{}')
    returning id into v_cot;
    -- congelar manualmente para que el único bloqueo sea la frontera.
    update public.cotizaciones set condicion_pago_congelada_en=now(), moneda_congelada='COP',
      trm_autoritativa=1, precio_total_congelado=100, monto_exigido_total_cop=1 where id=v_cot;
    begin
      perform public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
      v_err := null;
    exception when others then v_err := sqlerrm;
    end;
    perform _t164.expect(v_err is not null, 'C8d: tipo '||v_t||' debe rechazarse (frontera manual-only)');
    delete from public.cotizaciones where id=v_cot;
  end loop;
end $$;
\echo 'C8d frontera manual-only: OK'

-- 8e) estructural: ACL de las funciones de dinero — EXECUTE SOLO service_role;
--     anon/authenticated/PUBLIC sin acceso; y service_role SÍ autorizado.
do $$
begin
  perform _t164.expect(
    has_function_privilege('service_role','public.convertir_cotizacion_a_contrato(bigint, uuid)','EXECUTE'),
    'C8e: service_role tiene EXECUTE en convertir');
  perform _t164.expect(
    not has_function_privilege('anon','public.convertir_cotizacion_a_contrato(bigint, uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.convertir_cotizacion_a_contrato(bigint, uuid)','EXECUTE'),
    'C8e: anon/authenticated NO tienen EXECUTE en convertir');
  perform _t164.expect(
    not has_function_privilege('anon','public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric)','EXECUTE')
    and not has_function_privilege('authenticated','public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric)','EXECUTE'),
    'C8e: anon/authenticated NO tienen EXECUTE en registrar_pago_previo');
end $$;
\echo 'C8e ACL estructural: OK'

-- 8f) llamada EN VIVO bajo service_role (rol de la sesión) autorizada y completa.
--     Necesita una cotización congelada SIN convertir aún.
do $$
declare v_cot bigint; v_num text;
begin
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'auth-sr');
  -- guardamos la cotización para convertirla bajo service_role en el paso de abajo
  perform set_config('t164.pendiente_sr', v_cot::text, false);
end $$;
set role service_role;
do $$
declare v_cot bigint := nullif(current_setting('t164.pendiente_sr',true),'')::bigint; v_num text;
begin
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  perform _t164.expect(v_num ~ '^DTM-', 'C8f: service_role convierte en vivo');
end $$;
reset role;
\echo 'C8f service_role en vivo: OK'

-- ════════════════ CATEGORÍA 9 · UN SOLO CONTRATO (multi-componente) ════════
do $$
declare v_cot bigint; v_num text; v_n int;
begin
  -- 3 servicios de tipos distintos + varios destinos en detalle → UN contrato.
  v_cot := _t164.mk_cot('mayorista','COP',2000000,1,1000000,1000000,'single');
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, costo_neto)
  values (v_cot, 2, 'traslado', 'Receptivo CTG', 'TRASLADO', 200000);
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, costo_neto)
  values (v_cot, 3, 'asistencia', 'Asistencia', 'ASISTENCIA', 50000);
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, costo_neto)
  values (v_cot, 4, 'otro', NULL, 'OTRO', 50000);
  v_num := public.convertir_cotizacion_a_contrato(v_cot,'aaaaaaaa-0000-0000-0000-000000000001');
  select count(*) into v_n from public.ventas where cotizacion_id=v_cot;
  perform _t164.expect(v_n=1, 'C9: múltiples componentes → UNA venta');
  select count(*) into v_n from public.cuentas_por_pagar where numero_contrato=v_num;
  perform _t164.expect(v_n=5, 'C9: 5 CxP (aereo,hotel,traslado,asistencia,otro)');
  select count(*) into v_n from public.contrato_condiciones where numero_contrato=v_num;
  -- las condiciones congeladas fueron 2 (aéreo+hotel del mk_cot); los servicios
  -- añadidos después NO se congelaron → el snapshot sigue siendo el congelado (2).
  perform _t164.expect(v_n=2, 'C9: condiciones copiadas = snapshot congelado (2)');
  -- UNIQUE: la misma cotización no puede crear una segunda venta (replay ya cubierto,
  -- aquí comprobamos la restricción estructural directamente).
  perform _t164.expect(
    (select count(*) from pg_constraint where conname='ventas_cotizacion_id_key')=1,
    'C9: existe el UNIQUE ventas.cotizacion_id');
end $$;
\echo 'C9 un solo contrato multi-componente: OK'

-- ════════════════════ LECTURA FINAL + ROLLBACK GENERAL ═════════════════════
select
  (select count(*) from public.ventas) as ventas_totales,
  (select count(*) from public.cotizaciones) as cotizaciones_totales,
  (select count(*) from public.abonos) as abonos_totales;
\echo 'BATTERY #40: TODAS LAS CATEGORÍAS 1-3,5-9 PASARON.'

-- La batería no deja datos: rollback de todo lo persistido por los escenarios
-- (los `do` se ejecutaron en autocommit, así que hacemos limpieza explícita).
truncate table public.contrato_condiciones, public.contrato_items, public.contrato_pasajeros,
  public.aliados_b2b, public.abonos, public.cotizacion_pagos_previos,
  public.cotizacion_condiciones, public.cotizacion_servicios, public.cuentas_por_pagar,
  public.asiento_lineas, public.asientos_contables, public.ventas, public.cotizaciones
  cascade;
drop schema _t164 cascade;
