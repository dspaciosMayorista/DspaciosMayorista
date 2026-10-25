-- ───────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 235 (#90 Entrega F · #63): MONEDA DE COBRO del contrato. SOLO bases desechables.
-- Corre en UNA transacción que termina en ROLLBACK, sobre una base con 001-234 y la 235 aplicada.
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_235_moneda_cobro.sql      Cierre esperado: "TEST 235 SQL: TODO OK".
--
--   A  esquema y fórmula única de conversión (redondeo de venta, ACL, una sola firma de aceptar_oferta_63)
--   B  aceptar con moneda de cobro: COP/USD cruzadas, sin elección, entradas inválidas, reintentos (lo congelado no cambia)
--   C  oferta USD sin TRM: TRM provisional (234) y TRM de cobro (235) son DOS tasas, cada una obligatoria y congelada por separado
--   D  la cabecera lleva exactamente lo congelado; el contrato convertido no se edita; CHECK de coherencia
--   E  recorrido completo: costos y CxP NO se reconvierten; fuentes uniformes y convertidas
--   F  cotizaciones anteriores a un cambio de moneda o de TRM no se aceptan, tampoco con cobro
-- ───────────────────────────────────────────────────────────────────────────
begin;

create schema t235;
create table t235.res (nombre text, ok boolean, detalle text);

create function t235.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t235.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t235.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000234' || case p_k
    when 'super' then '001' when 'gere' then '002' when 'admi' then '003' when 'oper' then '004'
    when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un texto como el usuario `p_k` (NULL = sin sesión) con el rol de Postgres `p_rol`.
create function t235.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t235.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t235.u(p_k)::text, ''), true);
    execute format('set local role %I', p_rol);
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

create function t235.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function t235.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'OK');
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

insert into auth.users (id, email)
select t235.u(k), 'c234-' || k || '@x.test' from unnest(array['super','gere','admi','oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t235.u(v.k), 'c234-' || v.k || '@x.test', 'C234 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('gere','gerencia'), ('admi','administracion'), ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (234010, 'T234 CARTAGENA', 'CTG', 'Colombia', true), (234011, 'T234 SANTA MARTA', 'SMR', 'Colombia', true);
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (234700, 'T234 PROV', false, 0);
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values
  (234600, 234010, 'T234 HOTEL COP', 234700, 'COP'),
  (234601, 234010, 'T234 HOTEL USD', 234700, 'USD');
insert into public.servicios_adicionales (id, nombre, proveedor_id, moneda) values (234650, 'T234 TOUR COP', 234700, 'COP'), (234651, 'T234 TOUR USD', 234700, 'USD');
-- Empaquetados sin record: 234507 en COP (R 1.130.000 / N 1.000.000 / F 80.500) y 234508 en USD (R 290 / N 250 / F 20).
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, proveedor_id, moneda) values
  (234507, null, 'AEROTEST', 'BOG - CTG - BOG', 234010, current_date + 60, current_date + 63, 1000000, 1130000, 80500, true, 234700, 'COP'),
  (234508, null, 'AEROTEST', 'MDE - CTG - MDE', 234010, current_date + 61, current_date + 64, 250, 290, 20, true, 234700, 'USD'),
  (234509, 'ZZZ999', 'AEROTEST', 'CLO - CTG - CLO', 234010, current_date + 62, current_date + 65, 250, 290, 20, true, 234700, 'USD');

-- Paquetes Dinámico en modo 63:
--   234301 COP + TRM 4000 + vinculada USD (USD→COP)        234302 USD + TRM 4000 + vinculada USD (USD→USD)
--   234303 USD + TRM 4000 + vinculada COP (COP→USD)        234304 COP sin TRM, todo COP (como antes)
--   234305 USD SIN TRM (aunque todo sea USD)                234306 legacy
--   234307 USD sin TRM con TODO en COP (hotel, servicio y vuelo)
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta, moneda_publicacion) values
  (234301, 'T234 COP con vinculada USD', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'COP'),
  (234302, 'T234 USD con vinculada USD', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'USD'),
  (234303, 'T234 USD con vinculada COP', 'dinamico', true, 234010, 'cop_trm_63', 4000, 'USD'),
  (234304, 'T234 COP sin TRM', 'dinamico', true, 234010, 'cop_trm_63', null, 'COP'),
  (234305, 'T234 USD sin TRM', 'dinamico', true, 234010, 'cop_trm_63', null, 'USD'),
  (234306, 'T234 legacy', 'dinamico', true, 234010, 'legacy', null, 'COP'),
  (234307, 'T234 USD sin TRM con todo en COP', 'dinamico', true, 234010, 'cop_trm_63', null, 'USD');
select setval(pg_get_serial_sequence('public.armado_paquetes', 'id'), greatest((select max(id) from public.armado_paquetes), 234307));

insert into public.armado_hoteles (paquete_id, hotel_id) values (234301, 234601), (234302, 234601), (234303, 234601), (234304, 234600), (234305, 234601), (234307, 234600);
insert into public.armado_servicios (paquete_id, servicio_id) values (234301, 234651), (234302, 234651), (234303, 234650), (234304, 234650), (234305, 234651), (234307, 234650);
insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta, moneda) values
  (234301, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234302, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234303, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (234304, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP'),
  (234305, 234508, current_date + 61, current_date + 64, 'MDE - CTG - MDE', 'AEROTEST', 290, 20, false, 0, 'USD'),
  (234307, 234507, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0, 'COP');

create function t235.publicar(p_paquete bigint, p_k text, p_trm text default 'null', p_moneda text default 'COP', p_modo text default 'cop_trm_63') returns text
language plpgsql as $$
declare v_gen bigint; v_rev bigint;
begin
  select tarifario_generacion, tarifario_revision_fuente into v_gen, v_rev from public.armado_paquetes where id = p_paquete;
  return t235.q(format('select public.publicar_tarifario_resultado_63(%s, %s, %s, %L, ''[]''::jsonb, %L, %s)::text', p_paquete, v_gen, v_rev, p_moneda, p_modo, p_trm), p_k);
end $$;

create function t235.t0(p_paquete bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('rev_fuente', tarifario_revision_fuente, 'rev_publicada', tarifario_revision_publicada,
                            'gen_publicada', tarifario_generacion_publicada, 'rev_costos', p63_rev_costos)
    from public.armado_paquetes where id = p_paquete
$$;

-- Snapshot del escenario `p_esc`:
--   'usd_usd' paquete 234302, vuelo USD 234508 · 'cop_usd' paquete 234303, vuelo COP 234507 · 'usd_cop' paquete 234301 (COP), vuelo USD 234508
--   'cop_cop' paquete 234304, vuelo COP 234507 (sin TRM)
create function t235.snap(p_esc text, p_trm numeric default null, p_mon text default null, p_cxp jsonb default null) returns jsonb language plpgsql stable as $$
declare
  v_paq bigint; v_emp bigint; v_mon text; v_trm numeric;
  v_precio numeric; v_imp numeric; v_aereo numeric; v_costos jsonb; v_cxp jsonb;
begin
  if p_esc = 'usd_usd' then v_paq := 234302; v_emp := 234508; v_mon := 'USD'; v_trm := 4000; v_precio := 1200; v_imp := 580; v_aereo := 500;
  elsif p_esc = 'cop_usd' then v_paq := 234303; v_emp := 234507; v_mon := 'USD'; v_trm := 4000; v_precio := 1200; v_imp := 565; v_aereo := 500;
  elsif p_esc = 'usd_sintrm' then v_paq := 234305; v_emp := 234508; v_mon := 'USD'; v_trm := null; v_precio := 1200; v_imp := 580; v_aereo := 500;
  elsif p_esc = 'usd_cop' then v_paq := 234301; v_emp := 234508; v_mon := 'COP'; v_trm := 4000; v_precio := 4800000; v_imp := 2320000; v_aereo := 2000000;
  else v_paq := 234304; v_emp := 234507; v_mon := 'COP'; v_trm := null; v_precio := 3360000; v_imp := 2260000; v_aereo := 2000000; end if;
  v_mon := coalesce(p_mon, v_mon);
  v_trm := coalesce(p_trm, v_trm);
  if p_esc in ('cop_cop', 'usd_sintrm') and p_trm is null then v_trm := null; end if;
  v_costos := case v_mon when 'USD' then jsonb_build_object('costo_hotel', 400, 'costo_aereo', v_aereo)
                         else jsonb_build_object('costo_hotel', 1600000, 'costo_aereo', v_aereo) end;
  v_cxp := coalesce(p_cxp, jsonb_build_array(
    -- Aéreo: el costo de ORIGEN del vuelo (USD o COP) con su equivalente COP a la TRM congelada.
    jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST',
      'valor_total', case when v_emp = 234508 then 500 else 2000000 end, 'moneda', case when v_emp = 234508 then 'USD' else 'COP' end,
      'valor_cop', case when v_trm is null and v_mon = 'USD' then null else 2000000 end, 'trm', v_trm, 'aplica_retencion', false, 'pct_retencion', 0,
      'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
    jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T234 PROV', 'servicio', 'Hotel T234',
      'valor_total', case when v_paq = 234304 then 1600000 else 400 end, 'moneda', case when v_paq = 234304 then 'COP' else 'USD' end,
      'valor_cop', case when v_trm is null and v_mon = 'USD' then null else 1600000 end, 'trm', v_trm, 'aplica_retencion', false, 'pct_retencion', 0,
      'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null)));
  return jsonb_build_object(
    'v', 1, 'paquete_id', v_paq, 'salida_id', (select id from public.salidas_dinamicas where paquete_id = v_paq order by id limit 1),
    'empaquetado_id', v_emp, 'trm', v_trm, 'moneda', v_mon,
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', v_mon, 'fecha_salida', (current_date + 60)::text,
        'fecha_regreso', (current_date + 63)::text, 'pax', 2, 'destino', 'T234 CARTAGENA', 'hotel', 'T234 HOTEL',
        'precio_venta', v_precio, 'impuesto', v_imp, 'costo_aereo', v_aereo, 'aerolinea', 'AEROTEST',
        'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', v_paq, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1,
        'tipo_asesor', 'interno', 'canal', 'B2C'),
    'b2b', null, 'vigencias', '[]'::jsonb,
    'financiero', jsonb_build_object('costos', v_costos, 'cxp', v_cxp));
end $$;

create function t235.cotizar(p_esc text, p_h text default 'h1', p_trm numeric default null, p_mon text default null, p_cxp jsonb default null,
                             p_mon_cot text default null, p_t0 jsonb default null) returns text language plpgsql as $$
declare v_cot jsonb; v_snap jsonb; v_paq bigint;
begin
  v_snap := t235.snap(p_esc, p_trm, p_mon, p_cxp);
  v_paq := (v_snap ->> 'paquete_id')::bigint;
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', jsonb_build_object('x', 1), 'detalle', '{}'::jsonb, 'cliente', 'Cliente 234',
    'destino', 'T234 CARTAGENA', 'hotel', 'T234 HOTEL', 'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2,
    'precio_venta', (v_snap -> 'cabecera' ->> 'precio_venta')::numeric,
    'moneda', coalesce(p_mon_cot, v_snap ->> 'moneda'), 'fecha_salida', (current_date + 60)::text, 'fecha_regreso', (current_date + 63)::text,
    'vigencia_hasta', (current_date + 1)::text, 'paquete_armado_id', v_paq, 'asesor', 'Asesor 234', 'creado_por', 'c234@x.test');
  return t235.try(format('select public.crear_cotizacion_oferta_63(%L::uuid, ''mayorista'', %L::jsonb, %L::jsonb, %L, %L, %L::jsonb)::text',
    t235.u('vent'), v_cot::text, v_snap::text, p_h, 'f1', coalesce(p_t0, t235.t0(v_paq))::text));
end $$;

-- Llamada de CINCO argumentos (p_trm_provisional toma su valor por defecto NULL).
create function t235.aceptar5(p_cot text, p_h text default 'h1') returns text language plpgsql as $$
begin
  return t235.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'')::text', p_cot, t235.u('vent'), p_h));
end $$;

-- Acepta como lo hace quien convierte a contrato: si la oferta es USD sin TRM, INGRESA la tasa (4000); en las demás no hace falta y va sin tasa.
create function t235.aceptar(p_cot text, p_h text default 'h1') returns text language plpgsql as $$
declare v_req boolean;
begin
  select (o.trm is null and coalesce(nullif(o.snapshot ->> 'moneda', ''), 'COP') = 'USD') into v_req from public.p63_oferta o where o.cotizacion_id = p_cot::bigint;
  if coalesce(v_req, false) then return t235.aceptar_con(p_cot, p_h, '4000'); end if;
  return t235.aceptar5(p_cot, p_h);
end $$;

-- Igual que aceptar, pasando la TRM provisional INGRESADA al convertir a contrato (p_trm_provisional), como texto SQL ('4321.5', 'null', '0', '''NaN''::numeric'…).
create function t235.aceptar_con(p_cot text, p_h text, p_trm text) returns text language plpgsql as $$
begin
  return t235.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'', %s)::text', p_cot, t235.u('vent'), p_h, p_trm));
end $$;
create function t235.cabecera(p_numero text, p_acep bigint, p_esc text, p_mon_ventas text default null) returns text language plpgsql as $$
declare v_s jsonb := t235.snap(p_esc); v_c jsonb := v_s -> 'cabecera';
begin
  return t235.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id, tipo_asesor, canal)
    values (%L, 'mayorista', 'Cliente 234', 'dinamico', %L, current_date + 60, current_date + 63, 2, 'T234 HOTEL', 'T234 CARTAGENA',
      %s, %s, %s, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', %s, %s, 'interno', 'B2C') returning 'OK'$f$,
    p_numero, coalesce(p_mon_ventas, v_c ->> 'moneda'), v_c ->> 'precio_venta', v_c ->> 'impuesto', v_c ->> 'costo_aereo', v_s ->> 'paquete_id', p_acep));
end $$;

create function t235.hijos(p_numero text) returns void language plpgsql as $$
begin
  insert into public.contrato_vuelos (numero_contrato) select p_numero from generate_series(1, 2);
  insert into public.contrato_items (numero_contrato, descripcion) values (p_numero, 'item');
  insert into public.contrato_hoteles (numero_contrato, nombre) values (p_numero, 'T234 HOTEL');
end $$;

create function t235.pendiente(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t235.try(format($f$insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (%L, 'mayorista', %L::jsonb, %L::jsonb) returning 'OK'$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;

create function t235.finalizar(p_acep bigint, p_numero text) returns text language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  return t235.try(format($f$select public.registrar_financiero_contrato(%L, 'mayorista', %L::jsonb, %L::jsonb)::text$f$,
    p_numero, (v_der->'costos')::text, (v_der->'cxp')::text));
end $$;



-- Cabecera con la moneda de cobro (valores SQL literales: 'null' o el valor) y recorrido con cobro.
create function t235.cab2(p_numero text, p_acep bigint, p_esc text, p_mc text, p_trm text, p_total text, p_precio text default null) returns text language plpgsql as $$
declare v_s jsonb := t235.snap(p_esc); v_c jsonb := v_s -> 'cabecera';
begin
  return t235.try(format($f$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino,
      precio_venta, impuesto, costo_aereo, aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id, tipo_asesor, canal,
      moneda_cobro, trm_cobro, total_cobro)
    values (%L, 'mayorista', 'Cliente 235', 'dinamico', %L, current_date + 60, current_date + 63, 2, 'T234 HOTEL', 'T234 CARTAGENA',
      %s, %s, %s, 'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', %s, %s, 'interno', 'B2C', %s, %s, %s) returning 'OK'$f$,
    p_numero, v_c ->> 'moneda', coalesce(p_precio, v_c ->> 'precio_venta'), v_c ->> 'impuesto', v_c ->> 'costo_aereo', v_s ->> 'paquete_id', p_acep, p_mc, p_trm, p_total));
end $$;

-- Acepta con moneda de cobro (valores SQL literales). trm_prov: la provisional de la 234 ('null' si no aplica).
create function t235.aceptar_cobro(p_cot text, p_h text, p_trm_prov text, p_mc text, p_trm_c text) returns text language plpgsql as $$
begin
  return t235.try(format('select public.aceptar_oferta_63(%s, ''mayorista'', %L::uuid, %L, ''f1'', %s, %s, %s)::text', p_cot, t235.u('vent'), p_h, p_trm_prov, p_mc, p_trm_c));
end $$;

-- Recorre cotizar → aceptar(cobro) → cabecera(cobro de la aceptación) → hijos → pendiente → financiero; devuelve 'numero|aceptacion|resultado'.
create function t235.recorrer_cobro(p_esc text, p_h text, p_trm_prov text, p_mc text, p_trm_c text) returns text language plpgsql as $$
declare v_cot text; v_a jsonb; v_acep bigint; v_num text; v_r text; v_cb jsonb;
begin
  v_cot := t235.cotizar(p_esc, p_h);
  if v_cot !~ '^[0-9]+$' then return '||cotizar ' || v_cot; end if;
  v_a := (t235.aceptar_cobro(v_cot, p_h, p_trm_prov, p_mc, p_trm_c))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato'; v_cb := v_a -> 'cobro';
  v_r := t235.cab2(v_num, v_acep, p_esc,
    case when v_cb ->> 'moneda' is null then 'null' else quote_literal(v_cb ->> 'moneda') end,
    coalesce(v_cb ->> 'trm', 'null'), coalesce(v_cb ->> 'total', 'null'));
  if v_r <> 'OK' then return v_num || '|' || v_acep || '|cabecera ' || v_r; end if;
  perform t235.hijos(v_num);
  v_r := t235.pendiente(v_acep, v_num);
  if v_r <> 'OK' then return v_num || '|' || v_acep || '|pendiente ' || v_r; end if;
  v_r := t235.finalizar(v_acep, v_num);
  return v_num || '|' || v_acep || '|' || v_r;
end $$;

-- ═ A · esquema y fórmula ═══════════════════════════════════════════════════════════
do $$
begin
  perform t235.afirma('A1 ventas y p63_aceptacion tienen moneda_cobro, trm_cobro y total_cobro',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('ventas', 'p63_aceptacion') and column_name in ('moneda_cobro', 'trm_cobro', 'total_cobro')) = 6);
  perform t235.afirma('A2 p63_total_cobro USD→COP = base × TRM con COP al mil hacia arriba (1200 × 4000,5 = 4.800.600 → 4.801.000)', public.p63_total_cobro(1200, 'USD', 'COP', 4000.5) = 4801000);
  perform t235.afirma('A3 p63_total_cobro USD→COP exacto no sube (1200 × 4100 = 4.920.000)', public.p63_total_cobro(1200, 'USD', 'COP', 4100) = 4920000);
  perform t235.afirma('A4 p63_total_cobro COP→USD = base / TRM con USD al dólar hacia arriba (4.801.000 / 4000 = 1200,25 → 1201)', public.p63_total_cobro(4801000, 'COP', 'USD', 4000) = 1201);
  perform t235.afirma('A5 p63_total_cobro COP→USD exacto (4.800.000 / 4000 = 1200)', public.p63_total_cobro(4800000, 'COP', 'USD', 4000) = 1200);
  perform t235.afirma('A6 sin conversión (misma moneda) o sin TRM válida no hay total',
    public.p63_total_cobro(1200, 'USD', 'USD', 4000) is null and public.p63_total_cobro(1200, 'USD', 'COP', null) is null and public.p63_total_cobro(1200, 'USD', 'COP', 0) is null);
  perform t235.afirma('A7 p63_total_cobro no la ejecuta anon ni authenticated',
    not has_function_privilege('anon', 'public.p63_total_cobro(numeric, text, text, numeric)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.p63_total_cobro(numeric, text, text, numeric)', 'EXECUTE'));
  perform t235.afirma('A8 aceptar_oferta_63 tiene UNA sola firma (8 argumentos), solo service_role',
    (select count(*) from pg_proc where proname = 'aceptar_oferta_63' and pronamespace = 'public'::regnamespace) = 1
    and (select pronargs from pg_proc where proname = 'aceptar_oferta_63' and pronamespace = 'public'::regnamespace) = 8
    and not has_function_privilege('authenticated', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric)', 'EXECUTE'));
end $$;

-- ═ B · aceptar con moneda de cobro ═════════════════════════════════════════════════
do $$
declare v_cot text; v_a text; v_j jsonb; v_seq text; v_n int; v_snap_antes text; v_num text; v_r text;
begin
  perform t235.publicar(234302, 'oper', '4000', 'USD');   -- USD con TRM 4000, vuelo USD
  perform t235.publicar(234304, 'oper');                  -- COP sin TRM, todo COP
  perform t235.publicar(234305, 'oper', 'null', 'USD');   -- USD sin TRM, todo USD

  -- B1: oferta USD (1200) cobrada en COP con TRM de cobro 4100 → 4.920.000, congelado en el intento.
  v_cot := t235.cotizar('usd_usd', 'hB1');
  select md5(snapshot::text) into v_snap_antes from public.p63_oferta where cotizacion_id = v_cot::bigint;
  v_a := t235.aceptar_cobro(v_cot, 'hB1', 'null', quote_literal('COP'), '4100');
  v_j := v_a::jsonb;
  perform t235.afirma('B1 oferta USD cobrada en COP: el intento congela COP, TRM 4100 y total 4.920.000', v_a not like 'ERR%'
    and v_j -> 'cobro' ->> 'moneda' = 'COP' and (v_j -> 'cobro' ->> 'trm')::numeric = 4100 and (v_j -> 'cobro' ->> 'total')::numeric = 4920000, v_a);
  perform t235.afirma('B2 la oferta conserva su moneda e importes (snapshot idéntico, moneda USD, precio 1200): nada se reconvierte',
    (select md5(snapshot::text) = v_snap_antes and snapshot ->> 'moneda' = 'USD' and (snapshot -> 'cabecera' ->> 'precio_venta')::numeric = 1200
       from public.p63_aceptacion where numero_contrato = v_j ->> 'numero_contrato'));
  perform t235.afirma('B3 la aceptación guarda lo congelado',
    (select moneda_cobro = 'COP' and trm_cobro = 4100 and total_cobro = 4920000 and trm_provisional is null from public.p63_aceptacion where id = (v_j ->> 'aceptacion_id')::bigint));

  -- B4: oferta COP (3.360.000) cobrada en USD con TRM de cobro 4000 → 840.
  v_cot := t235.cotizar('cop_cop', 'hB4');
  v_a := t235.aceptar_cobro(v_cot, 'hB4', 'null', quote_literal('USD'), '4000');
  v_j := v_a::jsonb;
  perform t235.afirma('B4 oferta COP cobrada en USD: total 840 con TRM 4000', v_a not like 'ERR%' and v_j -> 'cobro' ->> 'moneda' = 'USD' and (v_j -> 'cobro' ->> 'total')::numeric = 840, v_a);

  -- B5: la elección es OBLIGATORIA. Omitirla se rechaza ANTES de reservar número (sin valor por defecto); elegir expresamente la moneda de la oferta
  -- es válido y queda registrado, sin TRM ni total.
  v_cot := t235.cotizar('usd_usd', 'hB5');
  select last_value::text || '/' || is_called::text into v_seq from public.contrato_seq_mayorista;
  select count(*) into v_n from public.p63_aceptacion;
  v_a := t235.aceptar_cobro(v_cot, 'hB5', 'null', 'null', 'null');
  perform t235.afirma('B5 sin moneda de cobro se rechaza (p63_cobro_requerido): no hay valor por defecto', v_a like 'ERR%p63_cobro_requerido%', v_a);
  perform t235.afirma('B5a el rechazo no reservó número, no dejó aceptación y la oferta sigue abierta',
    (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq and (select count(*) from public.p63_aceptacion) = v_n
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');
  v_a := t235.aceptar_cobro(v_cot, 'hB5', 'null', quote_literal('USD'), 'null');
  v_j := v_a::jsonb;
  perform t235.afirma('B5c elegir expresamente la moneda de la oferta (USD) se acepta y queda registrada: moneda USD, sin TRM ni total', v_a not like 'ERR%'
    and v_j -> 'cobro' ->> 'moneda' = 'USD' and v_j -> 'cobro' -> 'trm' = 'null'::jsonb and v_j -> 'cobro' -> 'total' = 'null'::jsonb, v_a);
  v_cot := t235.cotizar('usd_usd', 'hB5b');
  v_a := t235.aceptar(v_cot, 'hB5b');
  perform t235.afirma('B5b la llamada de la 234 (5 argumentos, sin moneda de cobro) ya NO numera: se rechaza (p63_cobro_requerido)', v_a like 'ERR%p63_cobro_requerido%', v_a);
  v_r := t235.msg(format($f$insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot)
      select id, cotizacion_id, tenant, '00-999990', %L::uuid, current_date, snapshot from public.p63_oferta where cotizacion_id = %s$f$, t235.u('vent'), v_cot));
  perform t235.afirma('B5d defensa en profundidad: insertar una aceptación SIN moneda de cobro falla aunque se salte la RPC (trigger)', v_r like '%p63_cobro_requerido%', v_r);

  -- B6: entradas inválidas se rechazan ANTES de reservar número (consecutivo, aceptaciones y oferta intactos).
  v_cot := t235.cotizar('usd_usd', 'hB6');
  select last_value::text || '/' || is_called::text into v_seq from public.contrato_seq_mayorista;
  select count(*) into v_n from public.p63_aceptacion;
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), 'null');
  perform t235.afirma('B6 cobrar en otra moneda sin TRM de cobro se rechaza (p63_cobro_trm_requerida)', v_a like 'ERR%p63_cobro_trm_requerida%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('USD'), '4100');
  perform t235.afirma('B7 una TRM de cobro con la MISMA moneda de la oferta se rechaza (no se convierte dos veces)', v_a like 'ERR%p63_cobro_invalido%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('EUR'), '4100');
  perform t235.afirma('B8 una moneda de cobro fuera de COP/USD se rechaza', v_a like 'ERR%p63_cobro_invalido%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', 'null', '4100');
  perform t235.afirma('B9 una TRM de cobro sin moneda se rechaza', v_a like 'ERR%p63_cobro_invalido%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '0');
  perform t235.afirma('B10 TRM de cobro 0 se rechaza (p63_cobro_trm_invalida)', v_a like 'ERR%p63_cobro_trm_invalida%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '-5');
  perform t235.afirma('B11 TRM de cobro negativa se rechaza', v_a like 'ERR%p63_cobro_trm_invalida%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '''NaN''::numeric');
  perform t235.afirma('B12 TRM de cobro NaN se rechaza', v_a like 'ERR%p63_cobro_trm_invalida%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '100000000000');
  perform t235.afirma('B13 TRM de cobro desbordada se rechaza', v_a like 'ERR%p63_cobro_trm_invalida%', v_a);
  perform t235.afirma('B14 ningún rechazo reservó número ni dejó aceptación, y la oferta sigue abierta',
    (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq and (select count(*) from public.p63_aceptacion) = v_n
    and (select estado from public.p63_oferta where cotizacion_id = v_cot::bigint) = 'abierta');

  -- B15-B18: reintentos. Lo congelado manda; una elección distinta NO lo cambia.
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '4100');
  v_j := v_a::jsonb; v_num := v_j ->> 'numero_contrato';
  perform t235.afirma('B15 la elección válida se acepta (COP, 4100, 4.920.000)', v_a not like 'ERR%' and (v_j -> 'cobro' ->> 'total')::numeric = 4920000, v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '4100');
  perform t235.afirma('B16 el reintento idéntico devuelve el MISMO intento (mismo número y mismo cobro)', v_a not like 'ERR%' and (v_a::jsonb ->> 'numero_contrato') = v_num
    and (v_a::jsonb -> 'cobro' ->> 'total')::numeric = 4920000, v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('COP'), '4300');
  perform t235.afirma('B17 un reintento con OTRA TRM de cobro se rechaza (p63_cobro_cambio) y no cambia lo congelado', v_a like 'ERR%p63_cobro_cambio%'
    and (select trm_cobro = 4100 and total_cobro = 4920000 from public.p63_aceptacion where numero_contrato = v_num), v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', quote_literal('USD'), 'null');
  perform t235.afirma('B18 un reintento que pide volver a la moneda de la oferta se rechaza (p63_cobro_cambio)', v_a like 'ERR%p63_cobro_cambio%'
    and (select moneda_cobro = 'COP' from public.p63_aceptacion where numero_contrato = v_num), v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hB6', 'null', 'null', 'null');
  perform t235.afirma('B19 compatibilidad: el reintento de un intento YA EXISTENTE sin elección devuelve lo congelado (no numera ni re-decide)', v_a not like 'ERR%' and (v_a::jsonb -> 'cobro' ->> 'moneda') = 'COP'
    and (v_a::jsonb ->> 'numero_contrato') = v_num, v_a);
end $$;

-- ═ C · oferta USD sin TRM: DOS tasas distintas, cada una obligatoria y congelada por separado ═══════════════════
do $$
declare v_cot text; v_a text; v_j jsonb; v_seq text; v_n int;
begin
  perform t235.publicar(234305, 'oper', 'null', 'USD');
  update public.parametros_tributarios set valor = 4000 where parametro = 'trm_referencia';
  v_cot := t235.cotizar('usd_sintrm', 'hC1');
  select last_value::text || '/' || is_called::text into v_seq from public.contrato_seq_mayorista;
  select count(*) into v_n from public.p63_aceptacion;
  v_a := t235.aceptar_cobro(v_cot, 'hC1', 'null', quote_literal('COP'), '4100');
  perform t235.afirma('C1 oferta USD sin TRM: la TRM provisional sigue siendo OBLIGATORIA aunque se envíe TRM de cobro (p63_trm_requerida)', v_a like 'ERR%p63_trm_requerida%', v_a);
  v_a := t235.aceptar_cobro(v_cot, 'hC1', '4000', quote_literal('COP'), 'null');
  perform t235.afirma('C2 con la provisional pero sin TRM de cobro no se numera (p63_cobro_trm_requerida)', v_a like 'ERR%p63_cobro_trm_requerida%', v_a);
  perform t235.afirma('C3 ningún rechazo reservó número', (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq and (select count(*) from public.p63_aceptacion) = v_n);
  v_a := t235.aceptar_cobro(v_cot, 'hC1', '4000', quote_literal('COP'), '4100');
  v_j := v_a::jsonb;
  perform t235.afirma('C4 con ambas tasas se acepta: la provisional (4000, para el equivalente COP de las CxP) y la de cobro (4100, para el total) son distintas y se congelan por separado',
    v_a not like 'ERR%' and (select trm_provisional = 4000 and trm_cobro = 4100 and total_cobro = 4920000 and moneda_cobro = 'COP' from public.p63_aceptacion where id = (v_j ->> 'aceptacion_id')::bigint), v_a);
  perform t235.afirma('C5 la TRM de referencia no sustituyó a ninguna de las dos', (select valor from public.parametros_tributarios where parametro = 'trm_referencia') = 4000 and (v_j -> 'cobro' ->> 'trm')::numeric = 4100);
end $$;

-- ═ D · la cabecera lleva exactamente lo congelado; el contrato convertido no se edita ═════════════════════════════
do $$
declare v_cot text; v_a jsonb; v_acep bigint; v_num text; v_r text; v_num2 text; v_acep2 bigint; v_cot2 text;
begin
  perform t235.publicar(234302, 'oper', '4000', 'USD');
  perform t235.publicar(234304, 'oper');

  v_cot := t235.cotizar('usd_usd', 'hD1');
  v_a := (t235.aceptar_cobro(v_cot, 'hD1', 'null', quote_literal('COP'), '4100'))::jsonb;
  v_acep := (v_a ->> 'aceptacion_id')::bigint; v_num := v_a ->> 'numero_contrato';
  v_r := t235.cab2(v_num, v_acep, 'usd_usd', 'null', 'null', 'null');
  perform t235.afirma('D1 la cabecera SIN la moneda de cobro congelada se rechaza (p63_cabecera: moneda_cobro)', v_r like 'ERR%p63_cabecera%moneda_cobro%', v_r);
  v_r := t235.cab2(v_num, v_acep, 'usd_usd', quote_literal('COP'), '4200', '5040000');
  perform t235.afirma('D2 una TRM de cobro distinta de la congelada se rechaza (p63_cabecera: trm_cobro)', v_r like 'ERR%p63_cabecera%trm_cobro%', v_r);
  v_r := t235.cab2(v_num, v_acep, 'usd_usd', quote_literal('COP'), '4100', '4919000');
  perform t235.afirma('D3 un total de cobro distinto del congelado se rechaza (p63_cabecera: total_cobro)', v_r like 'ERR%p63_cabecera%total_cobro%', v_r);
  v_r := t235.cab2(v_num, v_acep, 'usd_usd', quote_literal('USD'), 'null', 'null');
  perform t235.afirma('D4 cobrar en la moneda de la oferta cuando lo congelado es COP se rechaza', v_r like 'ERR%p63_cabecera%moneda_cobro%', v_r);
  perform t235.afirma('D5 los rechazos no crearon la venta ni cambiaron el estado del intento', not exists (select 1 from public.ventas where numero_contrato = v_num)
    and (select estado from public.p63_aceptacion where id = v_acep) = 'preparada');
  v_r := t235.cab2(v_num, v_acep, 'usd_usd', quote_literal('COP'), '4100', '4920000');
  perform t235.afirma('D6 la cabecera con lo congelado se crea: moneda USD (oferta), precio 1200 y cobro COP 4.920.000 a 4100', v_r = 'OK'
    and (select moneda = 'USD' and precio_venta = 1200 and moneda_cobro = 'COP' and trm_cobro = 4100 and total_cobro = 4920000 from public.ventas where numero_contrato = v_num), v_r);

  -- El contrato convertido es inmutable en moneda, precio y cobro.
  v_r := t235.msg(format('update public.ventas set precio_venta = 1300 where numero_contrato = %L', v_num));
  perform t235.afirma('D7 no se edita el precio_venta de un contrato con conversión congelada (p63_cobro_congelado)', v_r like '%p63_cobro_congelado%', v_r);
  v_r := t235.msg(format('update public.ventas set moneda = ''COP'' where numero_contrato = %L', v_num));
  perform t235.afirma('D8 no se edita su moneda (p63_cobro_congelado)', v_r like '%p63_cobro_congelado%', v_r);
  v_r := t235.msg(format('update public.ventas set trm_cobro = 4300 where numero_contrato = %L', v_num));
  perform t235.afirma('D9 no se cambia la TRM de cobro (p63_cobro_congelado)', v_r like '%p63_cobro_congelado%', v_r);
  v_r := t235.msg(format('update public.ventas set total_cobro = 1 where numero_contrato = %L', v_num));
  perform t235.afirma('D10 no se cambia el total de cobro (p63_cobro_congelado)', v_r like '%p63_cobro_congelado%', v_r);
  v_r := t235.msg(format('update public.ventas set moneda_cobro = null, trm_cobro = null, total_cobro = null where numero_contrato = %L', v_num));
  perform t235.afirma('D11 no se borra la elección de cobro', v_r like '%p63_cobro_congelado%', v_r);
  v_r := t235.msg(format('update public.ventas set cliente = ''Otro nombre'' where numero_contrato = %L', v_num));
  perform t235.afirma('D12 el resto de los datos del contrato sí se edita', v_r = 'OK', v_r);

  -- Contrato SIN conversión (cobra en la moneda de la oferta): el precio se edita como siempre.
  v_cot2 := t235.cotizar('cop_cop', 'hD2');
  v_a := (t235.aceptar_cobro(v_cot2, 'hD2', 'null', quote_literal('COP'), 'null'))::jsonb;
  v_acep2 := (v_a ->> 'aceptacion_id')::bigint; v_num2 := v_a ->> 'numero_contrato';
  v_r := t235.cab2(v_num2, v_acep2, 'cop_cop', quote_literal('COP'), 'null', 'null');
  perform t235.afirma('D13 contrato sin conversión: cobro COP = moneda de la oferta, sin TRM ni total', v_r = 'OK'
    and (select moneda_cobro = 'COP' and trm_cobro is null and total_cobro is null from public.ventas where numero_contrato = v_num2), v_r);
  v_r := t235.msg(format('update public.ventas set precio_venta = precio_venta + 1000 where numero_contrato = %L', v_num2));
  perform t235.afirma('D14 su precio_venta se sigue editando (no hay conversión que proteger)', v_r = 'OK', v_r);
  v_r := t235.msg(format('update public.ventas set moneda_cobro = ''USD'' where numero_contrato = %L', v_num2));
  perform t235.afirma('D15 pero su elección de cobro tampoco se cambia después', v_r like '%p63_cobro_congelado%' or v_r like '23514%', v_r);

  -- CHECK de coherencia en la tabla.
  v_r := t235.msg($q$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro)
                     values ('DTM-9901', 'mayorista', 'x', 'dinamico', 'USD', 10, 'USD', 4000, 40000)$q$);
  perform t235.afirma('D16 el CHECK rechaza TRM/total de cobro cuando la moneda de cobro es la de la oferta', v_r like '23514%ventas_cobro_chk%', v_r);
  v_r := t235.msg($q$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro)
                     values ('DTM-9902', 'mayorista', 'x', 'dinamico', 'USD', 10, 'COP', null, null)$q$);
  perform t235.afirma('D17 el CHECK rechaza cobrar en otra moneda sin TRM ni total', v_r like '23514%ventas_cobro_chk%', v_r);
  v_r := t235.msg($q$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro)
                     values ('DTM-9903', 'mayorista', 'x', 'dinamico', 'USD', 10, 'COP', 0, 40000)$q$);
  perform t235.afirma('D18 el CHECK rechaza una TRM de cobro no positiva', v_r like '23514%ventas_cobro_chk%', v_r);
  v_r := t235.msg($q$insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, precio_venta) values ('DTM-9904', 'mayorista', 'x', 'dinamico', 'USD', 10)$q$);
  perform t235.afirma('D19 un contrato sin elección de cobro (anterior a la 235) sigue siendo válido', v_r = 'OK', v_r);

  -- La aceptación (snapshot e identidad) es inmutable también en lo de cobro.
  v_r := t235.msg(format('update public.p63_aceptacion set total_cobro = 1 where id = %s', v_acep));
  perform t235.afirma('D20 la elección de cobro de una aceptación no se modifica (p63_inmutable)', v_r like '%p63_inmutable%', v_r);
end $$;

-- ═ E · recorrido completo con conversión: costos y CxP NO se reconvierten ═════════════════════════════════════════
do $$
declare v_a text; v_b text; v_num_a text; v_num_b text; v_acep_a bigint; v_acep_b bigint;
begin
  perform t235.publicar(234302, 'oper', '4000', 'USD');
  perform t235.publicar(234303, 'oper', '4000', 'USD');
  perform t235.publicar(234304, 'oper');
  -- USD→cobro COP vs el mismo escenario SIN conversión de cobro.
  v_a := t235.recorrer_cobro('usd_usd', 'hE1', 'null', quote_literal('USD'), 'null');
  v_b := t235.recorrer_cobro('usd_usd', 'hE2', 'null', quote_literal('COP'), '4100');
  v_num_a := split_part(v_a, '|', 1); v_acep_a := nullif(split_part(v_a, '|', 2), '')::bigint;
  v_num_b := split_part(v_b, '|', 1); v_acep_b := nullif(split_part(v_b, '|', 2), '')::bigint;
  perform t235.afirma('E1 recorrido sin conversión: contrato completo y CxP escritas', v_a like '%creadas%', v_a);
  perform t235.afirma('E2 recorrido con cobro en COP: contrato completo y CxP escritas', v_b like '%creadas%', v_b);
  perform t235.afirma('E3 las CxP son IDÉNTICAS con o sin conversión de cobro (moneda de origen, valor, TRM y equivalente COP congelados)',
    (select string_agg(moneda || '/' || valor_total || '/' || coalesce(trm_63::text, '-') || '/' || valor_cop_63, ',' order by obligacion_63) from public.cuentas_por_pagar where numero_contrato = v_num_a)
    = (select string_agg(moneda || '/' || valor_total || '/' || coalesce(trm_63::text, '-') || '/' || valor_cop_63, ',' order by obligacion_63) from public.cuentas_por_pagar where numero_contrato = v_num_b));
  perform t235.afirma('E4 los costos y el precio del contrato (en la moneda de la oferta) son idénticos; solo cambia el cobro',
    (select costo_hotel || '/' || costo_aereo || '/' || precio_venta || '/' || moneda from public.ventas where numero_contrato = v_num_a)
    = (select costo_hotel || '/' || costo_aereo || '/' || precio_venta || '/' || moneda from public.ventas where numero_contrato = v_num_b)
    and (select moneda_cobro = 'COP' and total_cobro = 4920000 from public.ventas where numero_contrato = v_num_b)
    and (select moneda_cobro = 'USD' and total_cobro is null from public.ventas where numero_contrato = v_num_a));
  perform t235.afirma('E5 la aceptación queda completa y su cobro intacto', (select estado = 'completa' and total_cobro = 4920000 from public.p63_aceptacion where id = v_acep_b));

  -- COP→cobro USD con aéreo en COP y hotel USD (mezcla de fuentes uniformes y convertidas): cobro en COP de oferta USD ya probado; aquí oferta USD con vuelo COP.
  v_b := t235.recorrer_cobro('cop_usd', 'hE3', 'null', quote_literal('COP'), '4050');
  v_num_b := split_part(v_b, '|', 1);
  perform t235.afirma('E6 oferta USD con fuente convertida (vuelo COP) cobrada en COP: completa, total = 1200 × 4050 = 4.860.000 y las CxP conservan su equivalente a la TRM de la oferta (4000)', v_b like '%creadas%'
    and (select total_cobro = 4860000 from public.ventas where numero_contrato = v_num_b)
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num_b and trm_63 = 4000) = 2, v_b);
  -- oferta COP todo COP cobrada en USD
  v_b := t235.recorrer_cobro('cop_cop', 'hE4', 'null', quote_literal('USD'), '4000');
  v_num_b := split_part(v_b, '|', 1);
  perform t235.afirma('E7 oferta COP cobrada en USD: completa, total 840 y las CxP siguen en COP sin TRM', v_b like '%creadas%'
    and (select moneda = 'COP' and moneda_cobro = 'USD' and total_cobro = 840 and trm_cobro = 4000 from public.ventas where numero_contrato = v_num_b)
    and (select count(*) from public.cuentas_por_pagar where numero_contrato = v_num_b and trm_63 is null and moneda = 'COP') = 2, v_b);
end $$;

-- ═ F · cotizaciones anteriores a un cambio de moneda o de TRM no se aceptan, tampoco con cobro ═════════════════════
do $$
declare v_cot text; v_a text; v_seq text;
begin
  perform t235.publicar(234302, 'oper', '4000', 'USD');
  v_cot := t235.cotizar('usd_usd', 'hF1');
  select last_value::text || '/' || is_called::text into v_seq from public.contrato_seq_mayorista;
  update public.armado_paquetes set trm_oferta = 4500 where id = 234302;
  v_a := t235.aceptar_cobro(v_cot, 'hF1', 'null', quote_literal('COP'), '4100');
  perform t235.afirma('F1 cotizada antes de un cambio de TRM del paquete: no se acepta aunque se pida cobro en COP (p63_oferta_cambio)', v_a like 'ERR%p63_oferta_cambio%', v_a);
  update public.armado_paquetes set trm_oferta = 4000 where id = 234302;
  perform t235.publicar(234302, 'oper', '4000', 'USD');
  v_cot := t235.cotizar('usd_usd', 'hF2');
  update public.armado_paquetes set moneda_publicacion = 'COP' where id = 234302;
  v_a := t235.aceptar_cobro(v_cot, 'hF2', 'null', quote_literal('COP'), '4100');
  perform t235.afirma('F2 cotizada antes de un cambio de la moneda elegida del paquete: no se acepta ni con cobro en COP (p63_oferta_cambio); la moneda elegida no cambia en silencio',
    v_a like 'ERR%p63_oferta_cambio%' and (select moneda_publicacion from public.armado_paquetes where id = 234302) = 'COP', v_a);
  perform t235.afirma('F3 ningún rechazo reservó número', (select last_value::text || '/' || is_called::text from public.contrato_seq_mayorista) = v_seq);
  update public.armado_paquetes set moneda_publicacion = 'USD' where id = 234302;
end $$;

-- ═ G · cartera del dashboard en la moneda de COBRO ═══════════════════════════════
-- Contratos 'minorista' (confirmados, salida a +100 días = al día) para aislar la prueba; se mide el CAMBIO respecto de lo que ya hubiera.
create function t235.venta_g(p_num text, p_mon text, p_precio numeric, p_mc text, p_trm numeric, p_total numeric) returns void language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino, precio_venta,
                             estado, financiero_estado, tipo_asesor, canal, moneda_cobro, trm_cobro, total_cobro)
  values (p_num, 'minorista', 'Cliente G', 'dinamico', p_mon, current_date + 100, current_date + 103, 2, 'T234 HOTEL', 'T234 CARTAGENA', p_precio,
          'confirmado', 'completo', 'interno', 'B2C', p_mc, p_trm, p_total);
end $$;
create function t235.abono_g(p_num text, p_valor numeric) returns void language plpgsql as $$
begin
  insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago)
  values (p_num, 'minorista', p_valor, p_valor, 1, current_date, 'transferencia');
end $$;
create function t235.cartera(p_mon text) returns numeric language sql as $$
  select coalesce((select al_dia + vencida + sin_fecha from public.fn_dashboard_cartera_por_moneda('minorista', current_date) where moneda = p_mon), 0)
$$;

do $$
declare v_cop0 numeric; v_usd0 numeric; v_cop1 numeric; v_usd1 numeric; v_r text;
begin
  v_cop0 := t235.cartera('COP'); v_usd0 := t235.cartera('USD');
  -- G1: oferta COP 3.360.000 cobrada en USD (TRM 4000 → 840) y pagada por completo (840 USD) → saldo CERO, nada en la cartera.
  perform t235.venta_g('MIN-G1', 'COP', 3360000, 'USD', 4000, 840);  perform t235.abono_g('MIN-G1', 840);
  -- G2: oferta USD 1200 cobrada en COP (TRM 4100 → 4.920.000) y pagada por completo → saldo CERO.
  perform t235.venta_g('MIN-G2', 'USD', 1200, 'COP', 4100, 4920000);  perform t235.abono_g('MIN-G2', 4920000);
  v_cop1 := t235.cartera('COP'); v_usd1 := t235.cartera('USD');
  perform t235.afirma('G1 oferta COP cobrada en USD y totalmente pagada: saldo cero (no queda 3.360.000 - 840 en ninguna moneda)', v_cop1 = v_cop0 and v_usd1 = v_usd0, v_cop0 || '/' || v_cop1 || ' ' || v_usd0 || '/' || v_usd1);
  perform t235.afirma('G2 oferta USD cobrada en COP y totalmente pagada: saldo cero (no queda 1200 - 4.920.000)', v_cop1 = v_cop0 and v_usd1 = v_usd0);
  -- G3: oferta USD 1200 → cobro COP 4.920.000, abono parcial de 2.000.000 → saldo 2.920.000 en COP (y nada en USD).
  perform t235.venta_g('MIN-G3', 'USD', 1200, 'COP', 4100, 4920000);  perform t235.abono_g('MIN-G3', 2000000);
  v_cop1 := t235.cartera('COP'); v_usd1 := t235.cartera('USD');
  perform t235.afirma('G3 oferta USD cobrada en COP con abono parcial: saldo 2.920.000 en COP; la cartera USD no cambia', v_cop1 - v_cop0 = 2920000 and v_usd1 = v_usd0, (v_cop1 - v_cop0) || ' / ' || (v_usd1 - v_usd0));
  -- G4: sentido inverso: oferta COP 3.360.000 → cobro USD 840, abono parcial 300 → saldo 540 en USD.
  perform t235.venta_g('MIN-G4', 'COP', 3360000, 'USD', 4000, 840);  perform t235.abono_g('MIN-G4', 300);
  v_cop1 := t235.cartera('COP'); v_usd1 := t235.cartera('USD');
  perform t235.afirma('G4 oferta COP cobrada en USD con abono parcial: saldo 540 en USD; la cartera COP no cambia (sigue en lo de G3)', v_usd1 - v_usd0 = 540 and v_cop1 - v_cop0 = 2920000, (v_usd1 - v_usd0) || ' / ' || (v_cop1 - v_cop0));
  -- G5: contrato HISTÓRICO (moneda_cobro NULL): USD 1000 con abono 400 → saldo 600 en USD, como siempre.
  perform t235.venta_g('MIN-G5', 'USD', 1000, null, null, null);  perform t235.abono_g('MIN-G5', 400);
  v_usd1 := t235.cartera('USD');
  perform t235.afirma('G5 contrato histórico (sin moneda de cobro): saldo 600 en la moneda de su oferta (USD), igual que antes', v_usd1 - v_usd0 = 540 + 600, (v_usd1 - v_usd0)::text);
  -- G6: elección expresa de la MISMA moneda (COP, sin conversión): 1.000.000 con abono 250.000 → 750.000 en COP.
  perform t235.venta_g('MIN-G6', 'COP', 1000000, 'COP', null, null);  perform t235.abono_g('MIN-G6', 250000);
  v_cop1 := t235.cartera('COP');
  perform t235.afirma('G6 cobro expreso en la misma moneda de la oferta: saldo 750.000 en COP (precio de la oferta, sin conversión)', v_cop1 - v_cop0 = 2920000 + 750000, (v_cop1 - v_cop0)::text);
  -- G7: la función conserva la forma y las ACL de la 186 (invoker, stable, ejecutable por authenticated y service_role; no por anon).
  perform t235.afirma('G7 misma firma, SECURITY INVOKER, STABLE; authenticated y service_role la ejecutan, anon no',
    (select prosecdef = false and provolatile = 's' from pg_proc where proname = 'fn_dashboard_cartera_por_moneda' and pronamespace = 'public'::regnamespace)
    and has_function_privilege('authenticated', 'public.fn_dashboard_cartera_por_moneda(text, date)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fn_dashboard_cartera_por_moneda(text, date)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fn_dashboard_cartera_por_moneda(text, date)', 'EXECUTE'));
end $$;

-- ═ H · facturación: sin factura con un importe calculado en otra moneda ═══════════
create function t235.facturar(p_num text, p_pvp numeric) returns text language plpgsql as $$
begin
  return t235.q(format('select public.facturar_factura(%L, %L::uuid, ''mayorista'', %s, 0, 0)::text', p_num, t235.u('admi'), p_pvp), null, 'service_role');
end $$;
create function t235.venta_h(p_num text, p_mon text, p_precio numeric, p_mc text, p_trm numeric, p_total numeric, p_trm_contrato numeric default null) returns void language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino, precio_venta,
                             estado, financiero_estado, tipo_asesor, canal, moneda_cobro, trm_cobro, total_cobro, trm_contrato)
  values (p_num, 'mayorista', 'Cliente H', 'dinamico', p_mon, current_date + 100, current_date + 103, 2, 'T234 HOTEL', 'T234 CARTAGENA', p_precio,
          'confirmado', 'completo', 'interno', 'B2C', p_mc, p_trm, p_total, p_trm_contrato);
end $$;

do $$
declare v_r text; v_asientos_antes bigint;
begin
  select count(*) into v_asientos_antes from public.asientos_contables where origen like 'facturacion%';
  perform t235.venta_h('DTM-880001', 'COP', 3360000, 'USD', 4000, 840);
  perform t235.venta_h('DTM-880002', 'USD', 1200, 'COP', 4100, 4920000, 4000);
  perform t235.venta_h('DTM-880003', 'USD', 1200, null, null, null, 4000);      -- histórico
  perform t235.venta_h('DTM-880004', 'COP', 1000000, 'COP', null, null);        -- elección expresa de la misma moneda

  v_r := t235.facturar('DTM-880001', 3360000);
  perform t235.afirma('H1 facturar_factura de una oferta COP cobrada en USD se rechaza (F4451) con mensaje de negocio', v_r like 'ERR F4451 FIN_COBRO_OTRA_MONEDA%cobra en USD%oferta está en COP%', v_r);
  v_r := t235.facturar('DTM-880002', 4800000);
  perform t235.afirma('H2 facturar_factura de una oferta USD cobrada en COP se rechaza (F4451), aunque el importe enviado sea el "correcto" de la 208', v_r like 'ERR F4451 FIN_COBRO_OTRA_MONEDA%', v_r);
  v_r := t235.facturar('DTM-880002', 0);
  perform t235.afirma('H2b ... y con cualquier importe enviado (el rechazo ocurre antes de comparar importes)', v_r like 'ERR F4451%', v_r);
  perform t235.afirma('H3 los rechazos no dejaron asientos de facturación ni configuración alguna',
    (select count(*) from public.asientos_contables where origen like 'facturacion%') = v_asientos_antes
    and not exists (select 1 from public.contrato_facturacion where numero_contrato in ('DTM-880001', 'DTM-880002')));

  v_r := t235.msg($f$insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, lleva_iva) values ('DTM-880001', 0, 3360000, true)$f$);
  perform t235.afirma('H4 segunda barrera: insertar la configuración de factura de un contrato con cobro en otra moneda falla (F4451) aunque se salte la RPC', v_r like 'F4451 FIN_COBRO_OTRA_MONEDA%', v_r);
  v_r := t235.q($f$insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, lleva_iva) values ('DTM-880002', 0, 4800000, true) returning 'x'$f$, 'admi', 'authenticated');
  perform t235.afirma('H5 ... también como usuario contable autenticado por la API (no llega a insertar)', v_r like 'ERR%', v_r);

  v_r := t235.facturar('DTM-880003', 4800000);
  perform t235.afirma('H6 contrato HISTÓRICO (sin moneda de cobro) USD: la facturación sigue funcionando (emite sin error)', v_r not like 'ERR%', v_r);
  v_r := t235.facturar('DTM-880004', 1000000);
  perform t235.afirma('H7 cobro expreso en la MISMA moneda de la oferta: la facturación sigue funcionando (emite sin error)', v_r not like 'ERR%', v_r);
  perform t235.afirma('H8 ACL intactas: facturar_factura solo service_role; importes_factura solo service_role',
    has_function_privilege('service_role', 'public.facturar_factura(text, uuid, text, numeric, numeric, numeric, text, text, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.facturar_factura(text, uuid, text, numeric, numeric, numeric, text, text, text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'f208_priv.importes_factura(text)', 'EXECUTE')
    and has_function_privilege('service_role', 'f208_priv.importes_factura(text)', 'EXECUTE'));
end $$;

-- ═ Z · conclusión ═══════════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_ok int;
begin
  select count(*), count(*) filter (where ok) into v_total, v_ok from t235.res;
  perform t235.afirma('Z1 la batería ejecutó todas sus secciones (A-H)', v_total >= 75, 'afirmaciones: ' || v_total);
  select count(*), count(*) filter (where ok) into v_total, v_ok from t235.res;
  if v_ok <> v_total then
    raise exception 'TEST 235 SQL: % de % afirmaciones fallaron', v_total - v_ok, v_total;
  end if;
  raise notice 'TEST 235 SQL: TODO OK (% afirmaciones)', v_total;
end $$;

rollback;
