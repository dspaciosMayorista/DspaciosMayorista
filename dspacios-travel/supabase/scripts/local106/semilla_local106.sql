-- SEMILLA SINTÉTICA de la revisión local del #106 (gestión integral de contratos, solo superadmin).
-- Solo LOCAL: ningún dato de Producción. Mayorista (DTM-106xx / DTM-107xx) y Minorista (MIN-00-09xx / MIN-00-07xx), COP, USD y cobro cruzado.
-- Se aplica sobre una base con el esquema ≤302 + 305 + 306 + 309. Corre como supabase_admin con session_replication_role = replica para sembrar
-- estados que solo producen las RPC financieras (factura contabilizada, acuses) sin disparar guardas ni auditoría; el orden respeta las claves foráneas.
\set ON_ERROR_STOP 1
set session_replication_role = replica;

insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
  (9601, 'Agencia Aliada Demo', '900106001', 'agencia', 0.10, false, 0),
  (9602, 'Freelance Demo',      '900106002', 'freelance', 0.10, false, 0)
on conflict (id) do nothing;

-- Contrato: tenant, estado, precio/moneda de la oferta, fecha de venta, salida, canal/tipo de asesor, aliado, comisión descontada y cobro convertido (opcional).
create function pg_temp.mk(n text, ten text, est text, precio numeric, mon text, fv date, fs date, canal text, tipo text, aliado int, desc_ boolean,
                           mc text default null, trm numeric default null, tc numeric default null, fin text default 'completo') returns void language sql as $$
  insert into public.ventas (numero_contrato, tenant, cliente, destino, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_venta,
                             fecha_salida, fecha_regreso, canal, tipo_asesor, aliado_id, agencia_nombre, freelance_nombre, modo_compra, comision_estado, comision_b2b,
                             moneda_cobro, trm_cobro, total_cobro, pax)
  values (n, ten, 'Cliente ' || n, case when ten = 'minorista' then 'SAN ANDRÉS' else 'CARTAGENA' end, est, 'Local Venta', precio, mon, 'porcion', fin,
          fv + 15, fv, fs, fs + 4, canal, tipo, aliado,
          case when tipo = 'agencia' then 'Agencia Aliada Demo' end, case when tipo = 'freelance' then 'Freelance Demo' end,
          case when desc_ then 'neta' end, case when desc_ then 'descontada' end, case when desc_ then 100000 end, mc, trm, tc, 2)
$$;
create function pg_temp.ab(n text, ten text, valor numeric, mon text default 'COP', dias int default 3) returns void language sql as $$
  insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop)
  values (n, ten, 'Cliente ' || n, date '2026-11-10' - dias, valor, 'transferencia', case when mon = 'USD' then 4200 else 1 end, valor * case when mon = 'USD' then 4200 else 1 end)
$$;
create function pg_temp.vou(n text, tipo text) returns void language sql as $$
  insert into public.vouchers (numero_contrato, tipo, proveedor, contenido) values (n, tipo, 'Hotel Demo', jsonb_build_object('hotel', 'Hotel Demo', 'titular', 'Cliente ' || n))
$$;
create function pg_temp.fac_legacy(n text, num text) returns void language sql as $$
  insert into public.facturacion (numero_contrato, numero_factura, fecha_factura, cliente, estado_dian) values (n, num, date '2026-11-05', 'Cliente ' || n, 'borrador')
$$;
create function pg_temp.fac_contable(n text, ten text, dian boolean) returns void language plpgsql as $$
declare a bigint;
begin
  insert into public.asientos_contables (numero, descripcion, tenant) values ((select coalesce(max(numero), 0) + 1 from public.asientos_contables), 'Factura sintética ' || n, ten) returning id into a;
  insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, asiento_factura_id, dian_emitida, dian_fecha)
  values (n, 0, 100000, a, dian, case when dian then date '2026-11-06' end);
end $$;
create function pg_temp.acuse(n text, ten text, p_tipo text, p_canal text, p_nota text default null) returns void language sql as $$
  insert into public.contrato_seguimiento (numero_contrato, contrato_uid, tenant, tipo, accion, canal, nota, referencia, actor_id, actor_email, actor_nombre, creado_en)
  select n, v.contrato_uid, ten, p_tipo, 'marcar', p_canal, p_nota, public.seguimiento_referencia(n, p_tipo), '00000000-0000-0000-0000-000000000106', 'semilla@local106.test', 'Semilla local', timestamptz '2026-11-12 10:30:00-05'
    from public.ventas v where v.numero_contrato = n
$$;
create function pg_temp.com(n text, ten text, aliado int, tipo text, base numeric, desc_en_precio boolean default false, estado text default 'pendiente') returns bigint language sql as $$
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, precio_venta, base_comision, pct_comision, recobro_total, aplica_retencion, pct_retencion,
                                  estado, descontada_en_precio, aliado_id)
  values (n, ten, case aliado when 9601 then 'Agencia Aliada Demo' else 'Freelance Demo' end, '90010600' || (aliado - 9600), tipo, base, base, 0.10, 0, false, 0, estado, desc_en_precio, aliado)
  returning id
$$;
create function pg_temp.pago_com(id bigint, ten text, valor numeric) returns void language sql as $$
  insert into public.comision_b2b_pagos (aliado_b2b_id, tenant, fecha, valor) values (id, ten, date '2026-11-09', valor)
$$;

-- ═══ MAYORISTA ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- A1 completo: pagado, 2 vouchers entregados (acuse), factura contabilizada + DIAN enviada (acuse). Sin comisión (venta directa).
select pg_temp.mk('DTM-10601', 'mayorista', 'confirmado', 2000000, 'COP', '2026-09-02', '2026-12-10', 'B2C', 'interno', null, false);
select pg_temp.ab('DTM-10601', 'mayorista', 2000000); select pg_temp.vou('DTM-10601', 'hotel'); select pg_temp.vou('DTM-10601', 'traslado');
select pg_temp.fac_contable('DTM-10601', 'mayorista', true);
select pg_temp.acuse('DTM-10601', 'mayorista', 'voucher_entregado', 'whatsapp', 'Enviado al cliente por WhatsApp');
select pg_temp.acuse('DTM-10601', 'mayorista', 'factura_enviada', 'correo');
-- A2 saldo, voucher preparado y NO entregado, factura registrada (flujo de la ficha) y NO enviada, comisión B2B pendiente.
select pg_temp.mk('DTM-10602', 'mayorista', 'confirmado', 3000000, 'COP', '2026-09-15', '2026-12-20', 'B2B', 'agencia', 9601, false);
select pg_temp.ab('DTM-10602', 'mayorista', 1200000); select pg_temp.vou('DTM-10602', 'hotel'); select pg_temp.fac_legacy('DTM-10602', 'FE-1002');
select pg_temp.com('DTM-10602', 'mayorista', 9601, 'agencia', 3000000);
-- A3 pendiente, sin pagos (deuda completa), sin voucher ni factura.
select pg_temp.mk('DTM-10603', 'mayorista', 'pendiente', 1500000, 'COP', '2026-10-05', '2027-01-12', 'B2C', 'interno', null, false);
-- A4 USD cobrado en COP (cobro cruzado): pagado; acuse de voucher DESACTUALIZADO (se generó otro voucher después).
select pg_temp.mk('DTM-10604', 'mayorista', 'confirmado', 1000, 'USD', '2026-09-20', '2027-01-05', 'B2C', 'interno', null, false, 'COP', 4200, 4200000);
select pg_temp.ab('DTM-10604', 'mayorista', 4200000); select pg_temp.vou('DTM-10604', 'hotel');
select pg_temp.acuse('DTM-10604', 'mayorista', 'voucher_entregado', 'correo');
select pg_temp.vou('DTM-10604', 'traslado');
-- A5 cancelado con un pago registrado (el saldo NO es exigible).
select pg_temp.mk('DTM-10605', 'mayorista', 'cancelado', 1000000, 'COP', '2026-08-03', '2026-12-01', 'B2C', 'interno', null, false);
select pg_temp.ab('DTM-10605', 'mayorista', 300000, 'COP', 40);
-- A6 NETO: comisión ya descontada del precio (no es una comisión por pagar). Voucher entregado, factura contabilizada SIN envío.
select pg_temp.mk('DTM-10606', 'mayorista', 'confirmado', 1800000, 'COP', '2026-09-25', '2027-02-02', 'B2B', 'agencia', 9601, true);
select pg_temp.ab('DTM-10606', 'mayorista', 1800000); select pg_temp.vou('DTM-10606', 'hotel'); select pg_temp.com('DTM-10606', 'mayorista', 9601, 'agencia', 1800000, true, 'pagada');
select pg_temp.acuse('DTM-10606', 'mayorista', 'voucher_entregado', 'portal'); select pg_temp.fac_contable('DTM-10606', 'mayorista', false);
-- A7 comisión freelance PAGADA completa.
select pg_temp.mk('DTM-10607', 'mayorista', 'confirmado', 2500000, 'COP', '2026-10-01', '2027-01-20', 'B2B', 'freelance', 9602, false);
select pg_temp.ab('DTM-10607', 'mayorista', 2500000); select pg_temp.pago_com(pg_temp.com('DTM-10607', 'mayorista', 9602, 'freelance', 2500000), 'mayorista', 250000);
-- A8 sobrepago en USD.
select pg_temp.mk('DTM-10608', 'mayorista', 'confirmado', 2500, 'USD', '2026-10-08', '2027-02-14', 'B2C', 'interno', null, false);
select pg_temp.ab('DTM-10608', 'mayorista', 2600, 'USD');
-- A9 histórico sin datos de seguimiento: pagado, voucher preparado, sin acuse, sin factura.
select pg_temp.mk('DTM-10609', 'mayorista', 'confirmado', 1900000, 'COP', '2026-08-12', '2026-12-18', 'B2C', 'interno', null, false);
select pg_temp.ab('DTM-10609', 'mayorista', 1900000, 'COP', 60); select pg_temp.vou('DTM-10609', 'hotel'); select pg_temp.fac_contable('DTM-10609', 'mayorista', true);
-- A10 sin total conocido y registro financiero pendiente (no se muestra un saldo falso).
select pg_temp.mk('DTM-10610', 'mayorista', 'confirmado', 0, 'COP', '2026-10-20', '2027-03-01', 'B2C', 'interno', null, false, null, null, null, 'pendiente');
-- A11 pendiente B2B con plan de comisión sellado y sin fila de comisión todavía.
select pg_temp.mk('DTM-10611', 'mayorista', 'pendiente', 1000000, 'COP', '2026-11-02', '2027-01-30', 'B2B', 'agencia', 9601, false);
insert into public.comision_plan (numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total, recobro_aliado,
                                  base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado)
  select 'DTM-10611', contrato_uid, 1, 'mayorista', 1, 9601, 'agencia', 'COP', 1000000, 0, 0, 0, 1000000, 0.1, 'aliado', 100000, 100000 from public.ventas where numero_contrato = 'DTM-10611';
-- A12 comisión RETENIDA (en revisión contable).
select pg_temp.mk('DTM-10612', 'mayorista', 'confirmado', 2200000, 'COP', '2026-09-28', '2027-01-08', 'B2B', 'agencia', 9601, false);
select pg_temp.ab('DTM-10612', 'mayorista', 1000000);
insert into public.comision_b2b_revision (aliado_b2b_id, tenant, motivo) values (pg_temp.com('DTM-10612', 'mayorista', 9601, 'agencia', 2200000), 'mayorista', 'Sintético: conciliación pendiente');
-- A13 B2B sin definir (sin fila ni plan).
select pg_temp.mk('DTM-10613', 'mayorista', 'confirmado', 2000000, 'COP', '2026-10-12', '2027-02-20', 'B2B', 'agencia', 9601, false);
select pg_temp.ab('DTM-10613', 'mayorista', 2000000);
-- A14 comisión parcial.
select pg_temp.mk('DTM-10614', 'mayorista', 'confirmado', 3200000, 'COP', '2026-10-18', '2027-02-25', 'B2B', 'agencia', 9601, false);
select pg_temp.ab('DTM-10614', 'mayorista', 3200000); select pg_temp.pago_com(pg_temp.com('DTM-10614', 'mayorista', 9601, 'agencia', 3200000), 'mayorista', 100000);
-- A15 NETO con una fila de comisión NO descontada: revisión manual (no es saldo por pagar).
select pg_temp.mk('DTM-10615', 'mayorista', 'confirmado', 1400000, 'COP', '2026-10-22', '2027-03-05', 'B2B', 'agencia', 9601, true);
select pg_temp.ab('DTM-10615', 'mayorista', 1400000); select pg_temp.com('DTM-10615', 'mayorista', 9601, 'agencia', 1400000, false, 'pendiente');
-- A16 COP ofertado y cobrado en USD (cobro cruzado inverso) con saldo en USD.
select pg_temp.mk('DTM-10616', 'mayorista', 'confirmado', 8400000, 'COP', '2026-11-04', '2027-02-10', 'B2C', 'interno', null, false, 'USD', 4200, 2000);
select pg_temp.ab('DTM-10616', 'mayorista', 800, 'USD');
-- A17 estado «activo» (se agrupa con confirmado), pagado, sin voucher.
select pg_temp.mk('DTM-10617', 'mayorista', 'activo', 1100000, 'COP', '2026-11-12', '2027-03-15', 'B2C', 'interno', null, false);
select pg_temp.ab('DTM-10617', 'mayorista', 1100000, 'COP', 1);

-- ═══ MINORISTA ═══════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.mk('MIN-00-0901', 'minorista', 'activo', 1800000, 'COP', '2026-08-20', '2026-12-22', 'B2C', 'interno', null, false);
select pg_temp.ab('MIN-00-0901', 'minorista', 1800000, 'COP', 50);
select pg_temp.mk('MIN-00-0902', 'minorista', 'activo', 2400000, 'COP', '2026-09-10', '2027-01-15', 'B2B', 'freelance', null, false);
select pg_temp.ab('MIN-00-0902', 'minorista', 1000000, 'COP', 30); select pg_temp.com('MIN-00-0902', 'minorista', 9602, 'freelance', 2400000);
select pg_temp.mk('MIN-00-0903', 'minorista', 'cancelado', 900000, 'COP', '2026-08-30', '2026-11-30', 'B2C', 'interno', null, false);
select pg_temp.mk('MIN-00-0904', 'minorista', 'activo', 1200, 'USD', '2026-10-03', '2027-01-25', 'B2C', 'interno', null, false);
select pg_temp.ab('MIN-00-0904', 'minorista', 1200, 'USD'); select pg_temp.vou('MIN-00-0904', 'servicios'); select pg_temp.acuse('MIN-00-0904', 'minorista', 'voucher_entregado', 'presencial');
select pg_temp.mk('MIN-00-0905', 'minorista', 'pendiente', 3000000, 'COP', '2026-11-08', '2027-02-28', 'B2C', 'interno', null, false);

-- ═══ RELLENO para paginar (40 contratos con estados y pagos variados) ═══════════════════════════════════════════
do $$
declare i int; t text; n text; est text; precio numeric; pag numeric;
begin
  for i in 1..40 loop
    t := case when i % 4 = 0 then 'minorista' else 'mayorista' end;
    n := case when t = 'minorista' then 'MIN-00-07' || lpad(i::text, 2, '0') else 'DTM-107' || lpad(i::text, 2, '0') end;
    est := (array['confirmado', 'pendiente', 'confirmado', 'activo', 'cancelado'])[1 + i % 5];
    precio := 900000 + (i * 55000);
    pag := case i % 4 when 0 then precio when 1 then 0 when 2 then round(precio * 0.3) else precio end;
    perform pg_temp.mk(n, t, est, precio, 'COP', date '2026-08-01' + (i * 2), date '2026-12-01' + (i * 3), 'B2C', 'interno', null, false);
    if pag > 0 then perform pg_temp.ab(n, t, pag); end if;
    if i % 6 = 0 and est <> 'pendiente' then perform pg_temp.vou(n, 'hotel'); end if;
  end loop;
end $$;

set session_replication_role = origin;
