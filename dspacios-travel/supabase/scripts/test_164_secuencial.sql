-- Pruebas SECUENCIALES de la corrección A1/A2/A3 (migración 164).
-- Precondición: correr test_164_schema.sql en el MISMO esquema.
-- Concurrencia (dos conexiones): test_164_concurrencia.sh
\set ON_ERROR_STOP off
\pset footer off

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function public._snap() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('orden',0,'tipo_componente','hotel','referencia_externa','HOTEL X',
      'valor_componente',2000000,'condicion_pago_tipo','anticipo_saldo','condicion_pago_pct_aplicable',null,
      'condicion_pago_dias_saldo',15,'condicion_pago_fecha_limite',null,'monto_exigido',1066000,
      'restriccion_comercial','normal','hotel_temporada_id',null,'paquete_id',null,'programa_id',null),
    jsonb_build_object('orden',1,'tipo_componente','servicio','referencia_externa','TOUR',
      'valor_componente',1000000,'condicion_pago_tipo','normal','condicion_pago_pct_aplicable',null,
      'condicion_pago_dias_saldo',null,'condicion_pago_fecha_limite',null,'monto_exigido',0,
      'restriccion_comercial','normal','hotel_temporada_id',null,'paquete_id',null,'programa_id',null)
  );
$$;

create or replace function public._reset_cot(p_id bigint, p_moneda text, p_precio numeric)
returns void language plpgsql as $$
begin
  -- Primero se DESCONGELA la cotización (el trigger de congelado bloquea el
  -- DELETE de cotizacion_condiciones mientras siga congelada).
  insert into public.cotizaciones (id, tenant, moneda, precio_venta, estado, tipo)
    values (p_id,'mayorista',p_moneda,p_precio,'abierta','manual')
    on conflict (id) do update set estado='abierta', moneda=p_moneda, precio_venta=p_precio,
      condicion_pago_congelada_en=null, moneda_congelada=null, trm_autoritativa=1,
      precio_total_congelado=null, monto_exigido_total=null, monto_exigido_total_cop=null,
      pct_efectivo_informativo=null, tipo='manual';
  delete from public.cotizacion_condiciones where cotizacion_id = p_id;
  delete from public.cotizacion_pagos_previos where cotizacion_id = p_id;
  delete from public.asiento_lineas
    where asiento_id in (select id from public.asientos_contables
                         where origen in ('pago_previo','pago_previo_reversion'));
  delete from public.asientos_contables where origen in ('pago_previo','pago_previo_reversion');
end $$;

-- Runner: reporta PASS/FAIL sin abortar el script.
create or replace function public._t(tag text, fn text) returns void language plpgsql as $$
begin
  begin
    execute 'select public.' || fn || '()';
    raise notice 'PASS  %', tag;
  exception when others then
    raise notice 'FAIL  % : %', tag, sqlerrm;
  end;
end $$;

-- ── T1: repetir MISMA clave → UN pago/asiento + devuelve el resultado original.
create or replace function public.t1_repeticion_clave() returns void language plpgsql as $$
declare r1 text; r2 text; n_pay int; n_asi int; n_snap int;
begin
  perform public._reset_cot(101,'COP',3000000);
  r1 := public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-1', public._snap(), 1066000, 35.53);
  r2 := public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-1');
  select count(*) into n_pay from cotizacion_pagos_previos where cotizacion_id=101;
  select count(*) into n_asi from asientos_contables where origen='pago_previo';
  select count(*) into n_snap from cotizacion_condiciones where cotizacion_id=101;
  if r1 = r2 and r1 like 'OK|%' and n_pay=1 and n_asi=1 and n_snap=2 then return; end if;
  raise exception 'r1=% r2=% n_pay=% n_asi=% n_snap=%', r1, r2, n_pay, n_asi, n_snap;
end $$;

-- ── T2: MISMA clave + identidad distinta → rechazo cerrado.
create or replace function public.t2_clave_identidad_distinta() returns void language plpgsql as $$
declare msg text; ok boolean := false;
begin
  perform public._reset_cot(101,'COP',3000000);
  perform public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-2', public._snap(), 1066000, 35.53);
  begin
    perform public.registrar_pago_previo(101, 999999, 'COP', 1, 'Transferencia', 'REF-X', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-2');
  exception when others then msg := sqlerrm; ok := (msg like '%no se reutiliza%'); end;
  if ok then return; end if;
  raise exception 'Se esperaba rechazo por identidad distinta (msg=%)', msg;
end $$;

-- ── T5: fallo en cualquier punto del RPC → CERO snapshot/pago/asiento.
create or replace function public.t5_fallo_atomico() returns void language plpgsql as $$
declare n_pay int; n_asi int; n_snap int; congelada timestamptz; ok boolean:=false; msg text;
begin
  perform public._reset_cot(101,'COP',3000000);
  begin
    perform public.registrar_pago_previo(101, 5000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-5', public._snap(), 1066000, 35.53);
  exception when others then msg := sqlerrm; ok := (msg like '%Sobrepago rechazado%'); end;
  select count(*) into n_pay from cotizacion_pagos_previos where cotizacion_id=101;
  select count(*) into n_asi from asientos_contables where origen='pago_previo';
  select count(*) into n_snap from cotizacion_condiciones where cotizacion_id=101;
  select condicion_pago_congelada_en into congelada from cotizaciones where id=101;
  if ok and n_pay=0 and n_asi=0 and n_snap=0 and congelada is null then return; end if;
  raise exception 'ok=% n_pay=% n_asi=% n_snap=% congelada=%', ok, n_pay, n_asi, n_snap, congelada;
end $$;

-- ── T6: pago posterior REUTILIZA el snapshot/TRM/precio congelados.
create or replace function public.t6_reutiliza_congelado() returns void language plpgsql as $$
declare trm_f numeric; exig_cop numeric; monto2 numeric; msg text;
begin
  perform public._reset_cot(102,'USD',2000);
  perform public.registrar_pago_previo(102, 500, 'USD', 4000, 'Transferencia', 'R1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-6a', public._snap(), 700, 35.0);
  -- 2º pago: TRM 4500 ≠ congelada 4000 → debe usar la 4000 congelada
  perform public.registrar_pago_previo(102, 300, 'USD', 4500, 'Transferencia', 'R2', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-6b');
  select trm_autoritativa, monto_exigido_total_cop into trm_f, exig_cop from cotizaciones where id=102;
  select monto_cop into monto2 from cotizacion_pagos_previos where cotizacion_id=102 and referencia='R2';
  if (select count(*) from cotizacion_condiciones where cotizacion_id=102)=2
     and trm_f=4000 and exig_cop=2800000 and monto2=1200000 then return; end if;
  raise exception 'reutilización congelada mal: trm=% exig_cop=% monto2=%', trm_f, exig_cop, monto2;
end $$;

-- ── T7a: cotización con pago ACTIVO no se descarta (UPDATE directo). ──────
create or replace function public.t7a_no_descarta_con_activo() returns void language plpgsql as $$
declare ok boolean := false; msg text; v_estado text;
begin
  perform public._reset_cot(101,'COP',3000000);
  perform public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-7a', public._snap(), 1066000, 35.53);
  begin
    update public.cotizaciones set estado='descartada' where id=101;
  exception when others then msg := sqlerrm; ok := (msg like '%No se puede descartar%'); end;
  select estado into v_estado from cotizaciones where id=101;
  if ok and v_estado='abierta' then return; end if;
  raise exception 'descarte con activo debió bloquearse: ok=% estado=% msg=%', ok, v_estado, msg;
end $$;

-- ── T7b: tras ANULAR el pago (reversa formal) YA se puede descartar. ──────
create or replace function public.t7b_descarta_tras_anular() returns void language plpgsql as $$
declare pid bigint; v_estado text; n_rev int;
begin
  perform public._reset_cot(101,'COP',3000000);
  pid := (select split_part(public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-7b', public._snap(), 1066000, 35.53),'|',2)::bigint);
  perform public.anular_pago_previo(pid, '00000000-0000-0000-0000-000000000001', 'prueba reversa');
  -- reversa contable formal presente
  select count(*) into n_rev from asientos_contables where origen='pago_previo_reversion';
  update public.cotizaciones set estado='descartada' where id=101;
  select estado into v_estado from cotizaciones where id=101;
  if v_estado='descartada' and n_rev>=1 then return; end if;
  raise exception 'tras anular debió poder descartarse: estado=% n_rev=%', v_estado, n_rev;
end $$;

-- ── T8: sin pagos previos conserva el comportamiento permitido. ────────────
create or replace function public.t8_descarta_sin_pagos() returns void language plpgsql as $$
declare v_estado text;
begin
  perform public._reset_cot(103,'COP',1000000);
  update public.cotizaciones set estado='descartada' where id=103;
  select estado into v_estado from cotizaciones where id=103;
  if v_estado='descartada' then return; end if;
  raise exception 'cotización sin pagos debió descartarse';
end $$;

-- ── T9a: rol NO autorizado (venta) no ejecuta el RPC. ─────────────────────
create or replace function public.t9a_rol_no_autorizado() returns void language plpgsql as $$
declare ok boolean:=false; msg text;
begin
  perform public._reset_cot(101,'COP',3000000);
  begin
    perform public.registrar_pago_previo(101, 1000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000002', 'K-9a', public._snap(), 1066000, 35.53);
  exception when others then msg:=sqlerrm; ok:=(msg like '%no autorizado%'); end;
  if ok and (select count(*) from cotizacion_pagos_previos where cotizacion_id=101)=0 then return; end if;
  raise exception 'rol venta debió ser rechazado (msg=%)', msg;
end $$;

-- ── T10: mensajes limpios (sin detalles internos). ────────────────────────
create or replace function public.t10_mensaje_limpio() returns void language plpgsql as $$
declare msg text; ok boolean:=false;
begin
  perform public._reset_cot(101,'COP',3000000);
  begin
    -- sobrepago: el mensaje es la frase de negocio, no un detalle de BD
    perform public.registrar_pago_previo(101, 5000000, 'COP', 1, 'Transferencia', 'REF-1', current_date,
        '00000000-0000-0000-0000-000000000001', 'K-10', public._snap(), 1066000, 35.53);
  exception when others then msg:=sqlerrm; end;
  if msg like 'Sobrepago rechazado:%' then ok:=true; end if;
  if ok then return; end if;
  raise exception 'el mensaje no es el esperado: %', msg;
end $$;

-- ── Ejecutar ───────────────────────────────────────────────────────────────
select public._t('T1  idempotencia (misma clave, un pago/asiento)', 't1_repeticion_clave');
select public._t('T2  idempotencia (misma clave, identidad distinta → rechazo)', 't2_clave_identidad_distinta');
select public._t('T5  atomicidad (fallo revierte snapshot+pago+asiento)', 't5_fallo_atomico');
select public._t('T6  pago posterior reutiliza snapshot/TRM congelado', 't6_reutiliza_congelado');
select public._t('T7a descarte bloqueado con pago activo (UPDATE directo)', 't7a_no_descarta_con_activo');
select public._t('T7b descarte permitido tras reversa (anular)', 't7b_descarta_tras_anular');
select public._t('T8  descarte permitido sin pagos', 't8_descarta_sin_pagos');
select public._t('T9a rol venta no autorizado para el RPC', 't9a_rol_no_autorizado');
select public._t('T10 mensaje limpio (sobrepago)', 't10_mensaje_limpio');
