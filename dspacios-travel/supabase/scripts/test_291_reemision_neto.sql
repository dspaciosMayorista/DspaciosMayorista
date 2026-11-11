-- ───────────────────────────────────────────────────────────────
-- PRUEBAS de la migración 291 (#75): reemisión de tarifas de un NETO pendiente sin pagos. SOLO base LOCAL desechable con la 291.
-- Una transacción que termina en ROLLBACK. Cualquier fila distinta de 'OK' es un fallo. La carrera (dos sesiones) está en test_291_carrera.sh.
-- ───────────────────────────────────────────────────────────────
begin;
create temp table _r (n serial, caso text, resultado text) on commit drop;
create function pg_temp.como(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_n bigint; v_res text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  if p_uid is not null then execute 'set local role authenticated'; end if;
  begin execute p_sql; get diagnostics v_n = row_count; v_res := 'filas=' || v_n;
  exception when others then v_res := 'error: ' || sqlerrm; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK' else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000291001', 't291-super@x.test'), ('00000000-0000-0000-0000-000000291002', 't291-admin@x.test'), ('00000000-0000-0000-0000-000000291003', 't291-supmin@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('00000000-0000-0000-0000-000000291001', 't291-super@x.test', 'T291 Super', 'superadmin', true, 'mayorista'),
  ('00000000-0000-0000-0000-000000291002', 't291-admin@x.test', 'T291 Admin', 'administracion', true, 'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (291001, 'T291 Agencia', 'agencia', 0.25, '900291001');  -- % ACTUAL del catálogo distinto al pactado (10 %)

-- Fábrica de un NETO pendiente con acuerdo pactado, en las TRES formas reales de fila descontada:
--   '206' → comision_valor NULL, sin recobro en la fila (aplicar_neto_contrato_manual);
--   '222' → comision_valor = descuento completo (ordinaria + participación), recobro 0 en la fila (p50_priv, hija NETO);
--   'rec' → participación como recobro_total × pct_recobro_aliado en la fila, comision_valor NULL.
-- p_excl = recobro excluido de la base (importe) y p_part = participación del aliado: por la regla #97 van juntos (ambos > 0 o ambos 0).
create function pg_temp.neto(p_n text, p_pvp numeric, p_bnc numeric, p_pct numeric, p_excl numeric default 0, p_part numeric default 0, p_forma text default '206',
                             p_moneda text default 'COP', p_moneda_cobro text default null, p_trm numeric default null) returns void language plpgsql as $$
declare v_base numeric := greatest(p_pvp - p_bnc - p_excl, 0); v_ord numeric := round(greatest(p_pvp - p_bnc - p_excl, 0) * p_pct); v_desc numeric;
begin
  v_desc := v_ord + p_part;
  insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal, modo_compra,
                             comision_b2b, comision_estado, moneda, moneda_cobro, trm_cobro, total_cobro)
    values (p_n, 'C', 'mayorista', 'T291 Asesor', p_pvp - v_desc, p_bnc, 'pendiente', 'completo', 'agencia', 291001, 'B2B', 'neta', v_desc, 'descontada', p_moneda,
            p_moneda_cobro, p_trm, case when p_moneda_cobro is not null and p_trm is not null then public.p63_total_cobro(p_pvp - v_desc, p_moneda, p_moneda_cobro, p_trm) end);
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, comision_valor,
                                  recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
    values (p_n, 'mayorista', 'T291 Agencia', '900291001', 'agencia', 291001, p_pvp, v_base, true, p_pct,
            case p_forma when '222' then v_desc end,
            case p_forma when 'rec' then p_excl else 0 end, case when p_forma = 'rec' and p_excl > 0 then p_part / p_excl else 0 end,
            false, 0, 'pagada', true);
  insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden) values (p_n, 'Paquete', 1, 0, p_pvp, 0, 0);
end $$;
create function pg_temp.reemitir(p_uid uuid, p_n text, p_tarifa numeric) returns text language sql as $$
  select pg_temp.como(p_uid, format($q$select public.reemitir_neto_pendiente(%L, '[{"descripcion":"Paquete","adultos":1,"ninos":0,"tarifaAdulto":%s,"tarifaNino":0}]'::jsonb)$q$, p_n, p_tarifa)) $$;
-- Vista legible (formateada a 2 decimales SOLO para leer). La exactitud la prueba pg_temp.conc, por igualdad numérica sin casts.
create function pg_temp.foto(p_n text) returns text language sql as $$
  select v.precio_venta::numeric(15,2) || '|' || v.comision_b2b::numeric(15,2) || '|' || coalesce(v.total_cobro::numeric(15,2)::text, '-') || '|' ||
         (select b.precio_venta::numeric(15,2) || '|' || b.base_comision::numeric(15,2) || '|' || b.pct_comision from public.aliados_b2b b where b.numero_contrato = v.numero_contrato) || '|' ||
         (select string_agg(it.tarifa_adulto::numeric(15,2)::text, ',' order by it.orden) from public.contrato_items it where it.numero_contrato = v.numero_contrato)
    from public.ventas v where v.numero_contrato = p_n $$;
-- Conciliación EXACTA (igualdad numérica, sin redondear ni castear): el liquidador SQL de la 205 (comision_b2b_total) y la fórmula sin retención
-- de la fila (la que verifica p97_priv.materializar) contra el descuento de la venta, y PVP = NETO + descuento.
create function pg_temp.conc(p_n text) returns text language sql as $$
  select 'total205=' || public.comision_b2b_total(b) || ' fila=' || (coalesce(b.comision_valor, b.base_comision * b.pct_comision) + coalesce(b.recobro_total, 0) * coalesce(b.pct_recobro_aliado, 0.5))
         || ' desc=' || v.comision_b2b || ' ok=' || (public.comision_b2b_total(b) = v.comision_b2b
                                                   and coalesce(b.comision_valor, b.base_comision * b.pct_comision) + coalesce(b.recobro_total, 0) * coalesce(b.pct_recobro_aliado, 0.5) = v.comision_b2b
                                                   and v.precio_venta + v.comision_b2b = b.precio_venta)
    from public.ventas v join public.aliados_b2b b on b.numero_contrato = v.numero_contrato and b.descontada_en_precio where v.numero_contrato = p_n $$;
\set SU '''00000000-0000-0000-0000-000000291001'''

-- 1) CASO OBLIGATORIO: PVP 2.000.000, BNC 400.000, 10 % → base 1.600.000, comisión 160.000, NETO 1.840.000; editar a 2.200.000.
select pg_temp.neto('DTM-29101', 2000000, 400000, 0.10);
select pg_temp.chk('1a estado inicial (NETO|comisión|cobro|PVP|base|%|ítem)', pg_temp.foto('DTM-29101'), '1840000.00|160000.00|-|2000000.00|1600000.00|0.1000|2000000.00');
select pg_temp.chk('1b reemisión a 2.200.000', pg_temp.reemitir(:SU, 'DTM-29101', 2200000), 'filas=1');
select pg_temp.chk('1c base 1.800.000, comisión 180.000, NETO 2.020.000; % pactado 10 % (no el 25 % del catálogo); BNC intacta',
  pg_temp.foto('DTM-29101') || '|' || (select impuesto::numeric(15,2) from public.ventas where numero_contrato = 'DTM-29101'), '2020000.00|180000.00|-|2200000.00|1800000.00|0.1000|2200000.00|400000.00');
select pg_temp.chk('1d el mínimo NETO de confirmación es el nuevo total', ((p75_priv.estado_minimo('DTM-29101')->>'minimo')::numeric = 2020000)::text, 'true');
select pg_temp.chk('1e fila descontada y pagada, importe PERSISTIDO 180.000 y conciliada', (select descontada_en_precio || '|' || estado || '|' || (comision_valor = 180000)
  from public.aliados_b2b b where numero_contrato = 'DTM-29101') || '|' || pg_temp.conc('DTM-29101'), 'true|pagada|true|%ok=true');
select pg_temp.chk('1f la marca de reemisión no queda viva fuera de la RPC', coalesce(current_setting('app.p291_reemision', true), ''), '');
select pg_temp.chk('1g repetir el guardado al mismo PVP es estable y sigue conciliado', pg_temp.reemitir(:SU, 'DTM-29101', 2200000) || '|' || pg_temp.foto('DTM-29101') || '|' || pg_temp.conc('DTM-29101'),
  'filas=1|2020000.00|180000.00|-|2200000.00|1800000.00|0.1000|2200000.00|%ok=true');

-- 2) MONEDA y REDONDEO: la ordinaria redondeada se persiste (criterio #97), así la fila liquida exactamente el descuento.
-- 2a-2d · CASO OBLIGATORIO USD: 2.345 → 2.355, BNC 0, 10 %: comisión 236 (235,5 → 236), NETO 2.119; antes la fila (206, comision_valor NULL) liquidaba 235,5.
select pg_temp.neto('DTM-29102', 2345, 0, 0.10, 0, 0, '206', 'USD');
select pg_temp.chk('2a USD inicial (206): descuento 235 pero la fila 206 liquida 234,5 (diferencia previa, de la 206)', pg_temp.conc('DTM-29102'), '%total205=234.5% desc=235% ok=false');
select pg_temp.chk('2b USD a 2.355: NETO 2.119, descuento 236', pg_temp.reemitir(:SU, 'DTM-29102', 2355) || '|' || pg_temp.foto('DTM-29102'), 'filas=1|2119.00|236.00|-|2355.00|2355.00|0.1000|2355.00');
select pg_temp.chk('2c la fila representa EXACTAMENTE 236 (comision_valor persistido) y el % pactado sigue en 10 %',
  (select (comision_valor = 236)::text || '|' || (pct_comision = 0.10)::text from public.aliados_b2b where numero_contrato = 'DTM-29102') || '|' || pg_temp.conc('DTM-29102'), 'true|true|%ok=true');
select pg_temp.chk('2d mínimo NETO = 2.119 USD', ((p75_priv.estado_minimo('DTM-29102')->>'minimo')::numeric = 2119)::text, 'true');
select pg_temp.chk('2e repetir el guardado USD: igual y conciliado', pg_temp.reemitir(:SU, 'DTM-29102', 2355) || '|' || pg_temp.foto('DTM-29102') || '|' || pg_temp.conc('DTM-29102'),
  'filas=1|2119.00|236.00|-|2355.00|2355.00|0.1000|2355.00|%ok=true');
-- 2f · COP con medio peso: 2.000.005 → 2.000.015 al 10 %: 200.000,5 → 200.001 y 200.001,5 → 200.002.
select pg_temp.neto('DTM-29114', 2000005, 0, 0.10);
select pg_temp.chk('2f COP con medio peso: descuento 200.002, NETO 1.800.013, fila exacta',
  pg_temp.reemitir(:SU, 'DTM-29114', 2000015) || '|' || pg_temp.foto('DTM-29114') || '|' || pg_temp.conc('DTM-29114'),
  'filas=1|1800013.00|200002.00|-|2000015.00|2000015.00|0.1000|2000015.00|%ok=true');
select pg_temp.neto('DTM-29113', 2345, 0, 0.10, 0, 0, '206', 'USD', 'COP', 4000);
select pg_temp.chk('2g USD cobrado en COP (TRM congelada): rechazado sin cambios',
  pg_temp.reemitir(:SU, 'DTM-29113', 2355) || '|' || pg_temp.foto('DTM-29113'),
  'error: NETO_291: el contrato DTM-29113 se cobra en COP con una conversión congelada%|2110.00|235.00|8440000.00|2345.00|2345.00|0.1000|2345.00');

-- 3) RECOBRO (regla #97): excluido de la base ⇔ participación en el descuento. Se conservan el importe excluido y la participación; la fila concilia.
-- 3a-3c · forma 222 (descuento completo en comision_valor), COP: recobro 100.000 excluido, participación 50.000.
select pg_temp.neto('DTM-29103', 2000000, 400000, 0.10, 100000, 50000, '222');   -- base 1.500.000, ordinaria 150.000 + 50.000 = 200.000, NETO 1.800.000
select pg_temp.chk('3a 222 inicial conciliada', pg_temp.foto('DTM-29103') || '|' || pg_temp.conc('DTM-29103'), '1800000.00|200000.00|-|2000000.00|1500000.00|0.1000|2000000.00|%ok=true');
select pg_temp.chk('3b 222 a 2.200.000: base 1.700.000, 170.000 + 50.000 = 220.000, NETO 1.980.000; comision_valor 220.000; recobro de la fila intacto (0)',
  pg_temp.reemitir(:SU, 'DTM-29103', 2200000) || '|' || pg_temp.foto('DTM-29103') || '|' || pg_temp.conc('DTM-29103'),
  'filas=1|1980000.00|220000.00|-|2200000.00|1700000.00|0.1000|2200000.00|%ok=true');
-- (sentencia aparte: una subconsulta en línea vería la foto ANTERIOR a la RPC de la misma sentencia)
select pg_temp.chk('3b2 222: comision_valor 220.000 persistido; recobro de la fila intacto (0)',
  (select (comision_valor = 220000)::text || '|' || (recobro_total = 0)::text from public.aliados_b2b where numero_contrato = 'DTM-29103'), 'true|true');
select pg_temp.chk('3c 222 repetir el guardado: igual y conciliado', pg_temp.reemitir(:SU, 'DTM-29103', 2200000) || '|' || pg_temp.foto('DTM-29103') || '|' || pg_temp.conc('DTM-29103'),
  'filas=1|1980000.00|220000.00|-|2200000.00|1700000.00|0.1000|2200000.00|%ok=true');
-- 3d-3e · forma 'rec' (participación como recobro_total × %), USD: recobro 150 excluido, participación 75.
select pg_temp.neto('DTM-29104', 2345, 0, 0.10, 150, 75, 'rec', 'USD');   -- base 2.195, ordinaria 220 (219,5 → 220) + 75 = 295, NETO 2.050
select pg_temp.chk('3d rec USD inicial: la fila 206-like liquida 219,5 + 75 (diferencia previa del redondeo)', pg_temp.conc('DTM-29104'), '%total205=294.5% desc=295% ok=false');
select pg_temp.chk('3e rec USD a 2.355: base 2.205, ordinaria 221 (220,5 → 221) + 75 = 296, NETO 2.059; comision_valor 221; recobro 150 × 0,5 intacto',
  pg_temp.reemitir(:SU, 'DTM-29104', 2355) || '|' || pg_temp.foto('DTM-29104') || '|' || pg_temp.conc('DTM-29104'),
  'filas=1|2059.00|296.00|-|2355.00|2205.00|0.1000|2355.00|%ok=true');
select pg_temp.chk('3e2 rec: comision_valor 221 persistido; recobro 150 × 0,5 intacto',
  (select (comision_valor = 221)::text || '|' || (recobro_total = 150 and pct_recobro_aliado = 0.5)::text from public.aliados_b2b where numero_contrato = 'DTM-29104'), 'true|true');
select pg_temp.chk('3f rec USD repetir el guardado: igual y conciliado', pg_temp.reemitir(:SU, 'DTM-29104', 2355) || '|' || pg_temp.foto('DTM-29104') || '|' || pg_temp.conc('DTM-29104'),
  'filas=1|2059.00|296.00|-|2355.00|2205.00|0.1000|2355.00|%ok=true');
-- 3g-3h · acuerdos que contradicen #97: no se adivina, se rechaza sin cambios.
select pg_temp.neto('DTM-29115', 2000000, 400000, 0.10, 0, 50000, '222');   -- participación sin recobro excluido
create temp table _f15 on commit drop as select pg_temp.foto('DTM-29115') as f;
select pg_temp.chk('3g participación con el recobro DENTRO de la base: rechazado sin cambios',
  pg_temp.reemitir(:SU, 'DTM-29115', 2200000) || '|' || (pg_temp.foto('DTM-29115') = (select f from _f15))::text, 'error: NETO_291: no se puede recuperar el acuerdo pactado%|true');
select pg_temp.neto('DTM-29116', 2000000, 400000, 0.10, 100000, 0, '222');  -- recobro excluido sin participación
select pg_temp.chk('3h recobro excluido SIN participación: rechazado', pg_temp.reemitir(:SU, 'DTM-29116', 2200000), 'error: NETO_291: no se puede recuperar el acuerdo pactado%');

-- 4) RECHAZOS SIN CAMBIOS.
select pg_temp.neto('DTM-29105', 2000000, 400000, 0.10);
create temp table _f5 on commit drop as select pg_temp.foto('DTM-29105') as f;
select pg_temp.chk('4a BNC (400.000) mayor que el nuevo PVP (300.000)', pg_temp.reemitir(:SU, 'DTM-29105', 300000), 'error: NETO_291: la BNC%supera el nuevo PVP%');
select pg_temp.chk('4b no superadmin (administración)', pg_temp.reemitir('00000000-0000-0000-0000-000000291002', 'DTM-29105', 2200000), 'error: NETO_291: no autorizado%');
select pg_temp.chk('4c sin sesión', pg_temp.reemitir(null, 'DTM-29105', 2200000), 'error: NETO_291: no autorizado%');
select pg_temp.chk('4d sin cambios tras los rechazos', pg_temp.foto('DTM-29105'), (select f from _f5));
-- Dato histórico inconsistente: la 205 impide crearlo por la vía normal, así que se siembra sin triggers (solo esta fixture).
set local session_replication_role = replica;
update public.aliados_b2b set base_comision = 1234567 where numero_contrato = 'DTM-29105';  -- acuerdo que no corresponde a su PVP/BNC
set local session_replication_role = origin;
select pg_temp.chk('4e acuerdo no recuperable', pg_temp.reemitir(:SU, 'DTM-29105', 2200000), 'error: NETO_291: no se puede recuperar el acuerdo pactado%');
set local session_replication_role = replica;
update public.aliados_b2b set base_comision = 1600000, pct_comision = null where numero_contrato = 'DTM-29105';
set local session_replication_role = origin;
select pg_temp.chk('4f acuerdo sin % pactado', pg_temp.reemitir(:SU, 'DTM-29105', 2200000), 'error: NETO_291: no se puede recuperar el acuerdo pactado%');
set local session_replication_role = replica;
update public.aliados_b2b set pct_comision = 0.10 where numero_contrato = 'DTM-29105';
set local session_replication_role = origin;
select pg_temp.chk('4g y los ítems no se tocaron', (select (count(*) = 1 and bool_and(tarifa_adulto = 2000000))::text from public.contrato_items where numero_contrato = 'DTM-29105'), 'true');
-- confirmado / con abono / con soporte / con cuotas / con facturación / no NETO / #63
select pg_temp.neto('DTM-29106', 2000000, 400000, 0.10); update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-29106';
select pg_temp.chk('4h confirmado: bloqueado', pg_temp.reemitir(:SU, 'DTM-29106', 2200000), 'error: NETO_291: el contrato DTM-29106 no está pendiente%');
select pg_temp.neto('DTM-29107', 2000000, 400000, 0.10);
insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia) values ('DTM-29107', 'mayorista', 10000, 10000, 1, current_date, 'Efectivo', 't291');
select pg_temp.chk('4i con un abono: bloqueado', pg_temp.reemitir(:SU, 'DTM-29107', 2200000), 'error: NETO_291: el contrato DTM-29107 ya tiene pagos%');
select pg_temp.neto('DTM-29108', 2000000, 400000, 0.10); insert into public.cuotas (numero_contrato, monto, orden, tipo, fecha_limite) values ('DTM-29108', 920000, 1, 'cuota', current_date + 30);
select pg_temp.chk('4j con plan de cuotas: bloqueado', pg_temp.reemitir(:SU, 'DTM-29108', 2200000), 'error: NETO_291: el contrato DTM-29108 tiene un plan de cuotas%');
select pg_temp.neto('DTM-29109', 2000000, 400000, 0.10);
-- la facturación solo nace por su operación atómica (208); aquí basta con que exista la fila, se siembra sin triggers.
set local session_replication_role = replica;
insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio) values ('DTM-29109', 0, 0);
set local session_replication_role = origin;
select pg_temp.chk('4k con facturación: bloqueado', pg_temp.reemitir(:SU, 'DTM-29109', 2200000), 'error: NETO_291: el contrato DTM-29109 ya tiene facturación%');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado) values ('DTM-29110', 'C', 'mayorista', 2000000, 'pendiente', 'completo');
select pg_temp.chk('4l contrato PVP (no NETO): no se reemite por aquí', pg_temp.reemitir(:SU, 'DTM-29110', 2200000), 'error: NETO_291: el contrato DTM-29110 no es NETO%');
select pg_temp.chk('4m sin cambios en los bloqueados', pg_temp.foto('DTM-29106') || '#' || pg_temp.foto('DTM-29107') || '#' || pg_temp.foto('DTM-29108'),
  '1840000.00|160000.00|-|2000000.00|1600000.00|0.1000|2000000.00#1840000.00|160000.00|-|2000000.00|1600000.00|0.1000|2000000.00#1840000.00|160000.00|-|2000000.00|1600000.00|0.1000|2000000.00');

-- 5) FALLO ATÓMICO: si cualquier escritura falla, no queda nada a medias (ni ítems, ni fila descontada, ni ventas).
select pg_temp.neto('DTM-29111', 2000000, 400000, 0.10);
create temp table _f11 on commit drop as select pg_temp.foto('DTM-29111') as f;
create function pg_temp.t291_falla() returns trigger language plpgsql as $$ begin if new.numero_contrato = 'DTM-29111' then raise exception 'fallo simulado t291'; end if; return new; end $$;
create trigger t291_falla before update on public.ventas for each row execute function pg_temp.t291_falla();
select pg_temp.chk('5a la escritura final falla', pg_temp.reemitir(:SU, 'DTM-29111', 2200000), 'error: fallo simulado t291%');
drop trigger t291_falla on public.ventas;
select pg_temp.chk('5b todo quedó como antes (ítems, fila descontada, ventas)', pg_temp.foto('DTM-29111'), (select f from _f11));

-- 6) La excepción de la 205 solo la abre la RPC, para ESE contrato y sin pagos: una marca puesta a mano o de otro contrato no sirve.
select pg_temp.neto('DTM-29112', 2000000, 400000, 0.10);
select pg_temp.chk('6a sin marca: cambiar el total de la fila descontada sigue rechazado (205)',
  pg_temp.como(null, $q$update public.aliados_b2b set base_comision = 1800000 where numero_contrato = 'DTM-29112'$q$), 'error: %alteraría su total%');
select pg_temp.chk('6b marca de OTRO contrato: rechazado',
  pg_temp.como(null, $q$select set_config('app.p291_reemision', 'DTM-29101|' || (select contrato_uid from public.ventas where numero_contrato = 'DTM-29101'), true);
                        update public.aliados_b2b set base_comision = 1800000 where numero_contrato = 'DTM-29112'$q$), 'error: %alteraría su total%');
select pg_temp.chk('6c marca correcta pero contrato con abono: rechazado',
  pg_temp.como(null, $q$select set_config('app.p291_reemision', 'DTM-29107|' || (select contrato_uid from public.ventas where numero_contrato = 'DTM-29107'), true);
                        update public.aliados_b2b set base_comision = 1800000 where numero_contrato = 'DTM-29107'$q$), 'error: %alteraría su total%');
select set_config('app.p291_reemision', '', true);

-- 7) MARGEN: la MISMA regla con la que se creó el contrato, sobre el NETO nuevo y los costos registrados (ventas.costo_*), en su moneda.
create function pg_temp.reemitir_f(p_uid uuid, p_n text, p_tarifa numeric, p_forzar boolean) returns text language sql as $$
  select pg_temp.como(p_uid, format($q$select public.reemitir_neto_pendiente(%L, '[{"descripcion":"Paquete","adultos":1,"ninos":0,"tarifaAdulto":%s,"tarifaNino":0}]'::jsonb, %L)$q$, p_n, p_tarifa, p_forzar)) $$;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000291003', 't291-supmin@x.test', 'T291 Gerencia', 'gerencia', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = 'mayorista';
-- 7a-7f · contrato MANUAL (206) en COP: costo 1.500.000 → NETO mínimo 1.500.000 ÷ 0,94 = 1.595.744,68 (con medio peso de tolerancia: 1.595.745 cumple).
select pg_temp.neto('DTM-29120', 2000000, 0, 0.10);
update public.ventas set costo_hotel = 1500000, tipo_paquete = 'dinamico' where numero_contrato = 'DTM-29120';
create temp table _f20 on commit drop as select pg_temp.foto('DTM-29120') as f;
select pg_temp.chk('7a COP por debajo (PVP 1.773.040 → NETO 1.595.736): rechazado', pg_temp.reemitir(:SU, 'DTM-29120', 1773040),
  'error: NETO_291_MARGEN: el total NETO (1595736%) no cubre el margen mínimo del 6 % con costos de 1500000%');
select pg_temp.chk('7b ... sin cambiar ítems, comisión ni venta', (pg_temp.foto('DTM-29120') = (select f from _f20))::text || '|' || pg_temp.conc('DTM-29120'), 'true|%ok=true');
select pg_temp.chk('7c COP en el límite (PVP 1.773.050 → NETO 1.595.745): pasa', pg_temp.reemitir(:SU, 'DTM-29120', 1773050) || '|' || pg_temp.foto('DTM-29120') || '|' || pg_temp.conc('DTM-29120'),
  'filas=1|1595745.00|177305.00|-|1773050.00|1773050.00|0.1000|1773050.00|%ok=true');
select pg_temp.chk('7d COP por debajo CON aprobación explícita de superadmin (rol de la excepción de creación): pasa',
  pg_temp.reemitir_f(:SU, 'DTM-29120', 1700000, true) || '|' || pg_temp.foto('DTM-29120'), 'filas=1|1530000.00|170000.00|-|1700000.00|1700000.00|0.1000|1700000.00');
select pg_temp.chk('7e la aprobación NO es automática por ser superadmin: sin el indicador, por debajo se rechaza', pg_temp.reemitir_f(:SU, 'DTM-29120', 1690000, false), 'error: NETO_291_MARGEN:%');
select pg_temp.neto('DTM-29121', 2000000, 0, 0.10);
update public.ventas set costo_hotel = 1500000, tipo_paquete = 'bloqueo' where numero_contrato = 'DTM-29121';
select pg_temp.chk('7f negociado (bloqueo): al crear no se mide margen, al reemitir tampoco', pg_temp.reemitir(:SU, 'DTM-29121', 1700000), 'filas=1');
-- 7g-7i · contrato MANUAL en USD (costos en USD, como U1): costo 1.983 → mínimo 2.109,57.
select pg_temp.neto('DTM-29122', 2345, 0, 0.10, 0, 0, '206', 'USD');
update public.ventas set costo_hotel = 1983, tipo_paquete = 'dinamico' where numero_contrato = 'DTM-29122';
select pg_temp.chk('7g USD en el límite (2.344 → NETO 2.110): pasa', pg_temp.reemitir(:SU, 'DTM-29122', 2344) || '|' || pg_temp.foto('DTM-29122'), 'filas=1|2110.00|234.00|-|2344.00|2344.00|0.1000|2344.00');
create temp table _f22 on commit drop as select pg_temp.foto('DTM-29122') as f;
select pg_temp.chk('7h USD por debajo (2.343 → NETO 2.109): rechazado', pg_temp.reemitir(:SU, 'DTM-29122', 2343), 'error: NETO_291_MARGEN: el total NETO (2109%');
select pg_temp.chk('7i ... sin cambios', (pg_temp.foto('DTM-29122') = (select f from _f22))::text, 'true');

-- 7j-7o · HIJA NETO (222): la regla de p50_priv (6 %, o 2 % exacto solo tiquetes; costo 0 o NETO < costo sin excepción; autoriza el rol de la 222).
-- La cabecera sellada (cotizacion_neto) se siembra sin triggers ni FK: aquí solo importa que exista y su indicador solo_tiquetes.
set local session_replication_role = replica;
insert into public.cotizacion_neto (cotizacion_id, tenant, modalidad, reconoce_recobro, aliado_id, tipo_asesor, moneda, pvp_total, base_comision, pct_comision,
                                    comision_ordinaria, participacion_recobro, descuento_total, neto_total, costo_total, piso, solo_tiquetes)
  values (2912301, 'mayorista', 'neto', false, 291001, 'agencia', 'COP', 2000000, 2000000, 0.10, 200000, 0, 200000, 1800000, 1500000, 0.06, false),
         (2912401, 'mayorista', 'neto', false, 291001, 'agencia', 'COP', 2000000, 2000000, 0.10, 200000, 0, 200000, 1800000, 1500000, 0.02, true);
set local session_replication_role = origin;
select pg_temp.neto('DTM-29123', 2000000, 0, 0.10, 0, 0, '222');
select pg_temp.neto('DTM-29124', 2000000, 0, 0.10, 0, 0, '222');
set local session_replication_role = replica;
update public.ventas set cotizacion_id = 2912301, costo_hotel = 1500000, tipo_paquete = 'dinamico' where numero_contrato = 'DTM-29123';
update public.ventas set cotizacion_id = 2912401, costo_aereo = 1500000, tipo_paquete = 'dinamico' where numero_contrato = 'DTM-29124';
set local session_replication_role = origin;
select pg_temp.chk('7j hija 6 %: por debajo sin aprobación → rechazado', pg_temp.reemitir(:SU, 'DTM-29123', 1700000), 'error: NETO_291_MARGEN: %mínimo del 6 %%Requiere aprobación de superadmin o administración.');
select pg_temp.chk('7k hija 6 %: con aprobación de superadmin → pasa', pg_temp.reemitir_f(:SU, 'DTM-29123', 1700000, true) || '|' || pg_temp.foto('DTM-29123'), 'filas=1|1530000.00|170000.00|%');
select pg_temp.chk('7l hija: NETO por debajo del COSTO → rechazado aun con aprobación', pg_temp.reemitir_f(:SU, 'DTM-29123', 1600000, true), 'error: NETO_291_MARGEN_COSTO:%');
-- solo tiquetes, 2 % EXACTO: costo 1.500.000 → NETO ≥ 1.530.612,24 (sin tolerancia): 1.700.680 → 1.530.612 no cumple; 1.700.690 → 1.530.621 cumple.
select pg_temp.chk('7m hija solo tiquetes 2 %: en el límite (NETO 1.530.621) pasa', pg_temp.reemitir(:SU, 'DTM-29124', 1700690), 'filas=1');
select pg_temp.chk('7n hija solo tiquetes 2 %: por debajo (NETO 1.530.612) rechazado', pg_temp.reemitir(:SU, 'DTM-29124', 1700680), 'error: NETO_291_MARGEN: %mínimo del 2 %%Requiere aprobación de superadmin.');
select pg_temp.chk('7o hija solo tiquetes: superadmin con aprobación explícita pasa', pg_temp.reemitir_f(:SU, 'DTM-29124', 1700680, true), 'filas=1');
-- 7p · el indicador viene del navegador: solo vale con el rol de la excepción (gerencia NO; aquí ni siquiera llega: la RPC es solo superadmin).
select pg_temp.chk('7p gerencia con el indicador: no autorizado', pg_temp.reemitir_f('00000000-0000-0000-0000-000000291003', 'DTM-29120', 1600000, true), 'error: NETO_291: no autorizado%');

select n, caso, resultado from _r order by n;
select 'FALLAS: ' || count(*) filter (where resultado <> 'OK') || ' de ' || count(*) from _r;
rollback;
