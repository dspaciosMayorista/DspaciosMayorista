-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #48 (migración 317). Cotización dinámica B2B NORMAL con precio NETO, por la RPC REAL, con sesión de rol y
-- recorrido persistido: crear → rechazos → editar (congelada) → pagar → convertir → leer la venta. SOLO base desechable.
-- Una transacción; termina en ROLLBACK. Uso (desde supabase/scripts):  psql -v ON_ERROR_STOP=1 -f test_317_neto_manual.sql <base>
-- Valores ESPERADOS calculados a mano (no con la función bajo prueba):
--   COP  aéreo 1.000.000 (costo 800.000) + hotel 4.000.000 (costo 3.200.000) = PVP 5.000.000; agencia 12 % → base 4.000.000 (sin tiquete)
--        → comisión 480.000 → NETO 4.520.000; costos 4.000.000 → margen 11,5 %. Primer pago exigido = 1.000.000 + 30 % × 3.520.000 = 2.056.000.
--   Con recobro 300.000 y participación 100.000 reconocida: total 5.300.000; base = 5.300.000 − 1.000.000 − 300.000 = 4.000.000 → 480.000 + 100.000 = 580.000 → NETO 4.720.000.
--   USD  aéreo 500 + hotel 2.000 = PVP 2.500 → comisión 12 % × 2.000 = 240 → NETO 2.260; exigido 500 + 30 % × 1.760 = 1.028.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set vect '[]'
begin;
\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql

create schema t317;
-- Servicios con costos elegibles (aéreo + hotel).
create function t317.serv(p_aereo numeric, p_costo_aereo numeric, p_hotel numeric, p_costo_hotel numeric) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('orden', 0, 'tipo_servicio', 'aereo', 'plataforma', 'Despegar', 'nombre_servicio', 'Aéreo BOG-CTG', 'proveedor', 'Avianca',
       'costo_neto', p_costo_aereo, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', p_aereo),
    jsonb_build_object('orden', 1, 'tipo_servicio', 'hotel', 'plataforma', 'Booking', 'nombre_servicio', 'Hotel A', 'proveedor', 'Hoteles A',
       'costo_neto', p_costo_hotel, 'modo', 'mk', 'pct_markup', 0.2, 'ta', 0, 'valor', p_hotel))
$$;
-- Cabecera B2B (agencia o freelance) con total, recobro y participación; la suma de servicios la pone quien llama.
create function t317.cab(p_tipo text, p_suma numeric, p_recobro numeric default 0, p_rec_ali numeric default 0, p_moneda text default 'COP') returns jsonb
language sql stable as $$
  select jsonb_set(t216.cab(p_tipo, p_recobro, 0, 0, p_moneda, p_suma), '{payload,recobroAliado}', to_jsonb(p_rec_ali))
$$;
-- Crea por la RPC NUEVA como lo hace el servidor (service_role). Devuelve el id o 'ERR …'.
create function t317.crear(p_k text, p_cab jsonb, p_serv jsonb, p_aliado bigint, p_rec boolean, p_aut boolean default false) returns text
language plpgsql as $$
begin
  return t216.escalar('service_role', null, format('select public.crear_cotizacion_manual_neto(%L, ''mayorista'', %L::jsonb, %L::jsonb, %s, %L, %L)::text',
    t216.u(p_k), p_cab, p_serv, coalesce(p_aliado::text, 'null'), p_rec, p_aut));
end $$;
create function t317.n_cot() returns bigint language sql stable as $$ select count(*) from public.cotizaciones $$;

do $$
begin
  if to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') is null then
    raise exception 'test_317 exige la 317 aplicada.';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- A. Creación sellada NETO (agencia, COP): valores a mano'
do $$
declare r text; c bigint; n public.cotizacion_neto; q public.cotizaciones; nc int; npl int;
begin
  r := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 800000, 4000000, 3200000), 922201, false);
  perform t216.afirma('A1 admin crea la cotización B2B NETO y devuelve su id', r ~ '^\d+$', r);
  c := r::bigint;
  select * into n from public.cotizacion_neto where cotizacion_id = c;
  perform t216.afirma('A2 sello NETO: PVP 5.000.000, comisión 480.000, NETO 4.520.000, costos 4.000.000, base 4.000.000, 12 %, aliado 922201',
    n.modalidad = 'neto' and n.pvp_total = 5000000 and n.comision_ordinaria = 480000 and n.participacion_recobro = 0 and n.descuento_total = 480000
    and n.neto_total = 4520000 and n.costo_total = 4000000 and n.base_comision = 4000000 and n.pct_comision = 0.12 and n.aliado_id = 922201
    and n.tipo_asesor = 'agencia' and n.reconoce_recobro = false and n.autorizado_por is null and n.solo_tiquetes = false, to_jsonb(n)::text);
  select * into q from public.cotizaciones where id = c;
  perform t216.afirma('A3 la cotización queda a PVP (5.000.000), con aliado por id y el recobro del aliado en 0', q.precio_venta = 5000000 and q.aliado_id = 922201
    and (q.payload->>'recobroAliado')::numeric = 0 and q.estado = 'abierta' and q.modo = 'simple' and q.cotizacion_origen_id is null, to_jsonb(q)::text);
  select count(*) into nc from public.cotizacion_neto_componentes where cotizacion_id = c;
  perform t216.afirma('A4 reparto por fila: aéreo 0 de descuento, hotel 480.000 (neto 3.520.000)',
    (select descuento from public.cotizacion_neto_componentes where cotizacion_id = c and tipo_servicio = 'aereo') = 0
    and (select descuento from public.cotizacion_neto_componentes where cotizacion_id = c and tipo_servicio = 'hotel') = 480000
    and (select neto from public.cotizacion_neto_componentes where cotizacion_id = c and tipo_servicio = 'hotel') = 3520000 and nc = 2, nc::text);
  select count(*) into npl from public.comision_plan where cotizacion_id = c;
  perform t216.afirma('A5 NETO no genera acuerdo/plan de comisión #97 (no hay segunda comisión)', npl = 0, npl::text);
  -- Recobro con participación reconocida: 4.720.000.
  r := t317.crear('admin', t317.cab('agencia', 5000000, 300000, 100000), t317.serv(1000000, 800000, 4000000, 3200000), 922201, true);
  c := r::bigint;
  select * into n from public.cotizacion_neto where cotizacion_id = c;
  perform t216.afirma('A6 recobro 300.000 con participación 100.000: base 4.000.000, comisión 480.000 + participación 100.000, NETO 4.720.000',
    n.base_comision = 4000000 and n.comision_ordinaria = 480000 and n.participacion_recobro = 100000 and n.descuento_total = 580000 and n.neto_total = 4720000
    and n.recobro_aliado_original = 100000 and n.reconoce_recobro = true, to_jsonb(n)::text);
  -- Freelance con su % (parámetro 11 %): base 4.000.000 → 440.000 → NETO 4.560.000.
  r := t317.crear('gerencia', t317.cab('freelance', 5000000), t317.serv(1000000, 800000, 4000000, 3200000), 922202, false);
  select * into n from public.cotizacion_neto where cotizacion_id = r::bigint;
  perform t216.afirma('A7 freelance (gerencia): 11 % por defecto → comisión 440.000, NETO 4.560.000', n.pct_comision = 0.11 and n.neto_total = 4560000 and n.tipo_asesor = 'freelance', to_jsonb(n)::text);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- B. Rechazos: nada se persiste (ni cotización, ni sello, ni consecutivo)'
do $$
declare n0 bigint; s0 bigint; r text; d0 bigint;
  base_serv jsonb := t317.serv(1000000, 800000, 4000000, 3200000);
begin
  n0 := t317.n_cot(); s0 := (select count(*) from public.cotizacion_neto); d0 := t216.ultimo_dtm();
  r := t317.crear('ventaA', t317.cab('agencia', 5000000), base_serv, 922201, false);
  perform t216.rechaza('B1 el rol venta no fija NETO', r, 'tu rol no puede fijar el precio NETO');
  r := t317.crear('admin', t317.cab('interno', 5000000), base_serv, 922201, false);
  perform t216.rechaza('B2 una venta B2C (interno) no puede ser NETO', r, 'solo aplica a ventas de una agencia o freelance');
  r := t317.crear('admin', t317.cab('agencia', 5000000), base_serv, null, false);
  perform t216.rechaza('B3 sin aliado del catálogo no hay NETO', r, 'necesita la agencia o freelance del catálogo');
  r := t317.crear('admin', t317.cab('agencia', 5000000), base_serv, 99999999, false);
  perform t216.rechaza('B4 un aliado inexistente se rechaza', r, 'necesita la agencia o freelance del catálogo');
  r := t317.crear('admin', t317.cab('agencia', 5000000), base_serv, 922202, false);
  perform t216.rechaza('B5 aliado de otro tipo (freelance en venta de agencia) se rechaza', r, 'de otro tipo');
  r := t317.crear('admin', t317.cab('agencia', 5000000), base_serv, 922204, false);
  perform t216.rechaza('B6 comisión 0 % → descuento 0 → no hay NETO (se vende a PVP)', r, 'con descuento 0 no hay precio NETO');
  r := t317.crear('admin', t317.cab('agencia', 5000000), base_serv, 922201, null);
  perform t216.rechaza('B7 indicar si se reconoce la participación es obligatorio', r, 'indica si se reconoce la participación');
  -- Bajo costo: costos 4.800.000 > NETO 4.520.000 → ningún rol.
  r := t317.crear('super', t317.cab('agencia', 5000000), t317.serv(1000000, 900000, 4000000, 3900000), 922201, false, true);
  perform t216.rechaza('B8 NETO por debajo del costo: ni superadmin con autorización', r, 'por debajo del costo total');
  -- Costo cero.
  r := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 0, 4000000, 0), 922201, false);
  perform t216.rechaza('B9 costo total 0 no se puede fijar', r, 'el costo total de la cotización es 0');
  -- Margen 4,87 % (costos 4.300.000 < NETO 4.520.000 pero <6 %): sin autorización, rechazo; gerencia no autoriza; administración sí.
  r := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 900000, 4000000, 3400000), 922201, false, false);
  perform t216.rechaza('B10 margen 4,87 % sin autorización se rechaza', r, 'no cubre el margen mínimo');
  r := t317.crear('gerencia', t317.cab('agencia', 5000000), t317.serv(1000000, 900000, 4000000, 3400000), 922201, false, true);
  perform t216.rechaza('B11 gerencia no autoriza un margen bajo el 6 %', r, 'tu rol no puede autorizar un margen');
  perform t216.afirma('B12 ningún rechazo dejó cotización, sello ni consumió consecutivo', t317.n_cot() = n0 and (select count(*) from public.cotizacion_neto) = s0 and t216.ultimo_dtm() = d0,
    t317.n_cot() || '/' || n0);
  r := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 900000, 4000000, 3400000), 922201, false, true);
  perform t216.afirma('B13 administración sí autoriza el 4,87 % y queda constancia (rol y usuario)', r ~ '^\d+$'
    and (select autorizado_rol = 'administracion' and autorizado_por = t216.u('admin') and margen < 0.06 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  -- Acceso directo: ni la API autenticada ni anon pueden llamar la RPC.
  perform t216.rechaza('B14 un usuario autenticado no llama la RPC directo', t216.escalar('authenticated', t216.u('admin'),
    format('select public.crear_cotizacion_manual_neto(%L, ''mayorista'', %L::jsonb, %L::jsonb, 922201, false, false)::text', t216.u('admin'),
      t317.cab('agencia', 5000000), base_serv)), 'permission denied');
  perform t216.rechaza('B15 anon tampoco', t216.escalar('anon', null, format('select public.crear_cotizacion_manual_neto(%L, ''mayorista'', %L::jsonb, %L::jsonb, 922201, false, false)::text',
    t216.u('admin'), t317.cab('agencia', 5000000), base_serv)), 'permission denied');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- C. Congelada: una cotización con NETO no se edita; la normal sigue editable'
do $$
declare c bigint; r text; cn bigint; serv2 jsonb;
begin
  c := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 800000, 4000000, 3200000), 922201, false)::bigint;
  serv2 := t317.serv(1000000, 800000, 4500000, 3600000);
  r := t216.escalar('service_role', null, t216.editar_sql(c, 'admin', serv2));
  perform t216.rechaza('C1 editar servicios de una cotización con NETO se rechaza', r, 'precio NETO fijado');
  r := t216.escalar('service_role', null, t216.recobro_sql(c, 'admin', 0, 0, 100000));
  perform t216.rechaza('C2 editar niños/recobro también', r, 'precio NETO fijado');
  perform t216.afirma('C3 el sello y el total siguen intactos tras los intentos', (select neto_total from public.cotizacion_neto where cotizacion_id = c) = 4520000
    and (select precio_venta from public.cotizaciones where id = c) = 5000000);
  -- Una dinámica B2C normal (sin NETO) sigue editable exactamente como antes.
  cn := t216.crear('admin');
  r := t216.escalar('service_role', null, t216.editar_sql(cn, 'admin', t216.serv(600000)));
  perform t216.afirma('C4 la cotización normal sin NETO sigue editable (regresión #39)', r ~ '^\d+$', r);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- D. Pagar y convertir (COP): el contrato nace en NETO, sin segunda comisión'
do $$
declare c bigint; num text; v public.ventas; b public.aliados_b2b; r text; nb int; sumi numeric; d0 bigint; npl int; pg bigint;
begin
  c := t317.crear('admin', t317.cab('agencia', 5000000), t317.serv(1000000, 800000, 4000000, 3200000), 922201, false)::bigint;
  perform t216.afirma('D1 el exigido NETO del primer pago es 2.056.000 (1.000.000 aéreo + 30 % de 3.520.000)', t222.exigido_snap(t222.snap_neto(c)) = 2056000, t222.exigido_snap(t222.snap_neto(c))::text);
  pg := t222.pagar_neto(c, 2056000, 'd-p1');
  perform t216.afirma('D2 el primer pago congela el NETO: total congelado 4.520.000', (select precio_total_congelado from public.cotizaciones where id = c) = 4520000);
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 2464001, 'd-p2'));
  perform t216.rechaza('D3 el pago se topa contra el NETO (un peso más se rechaza)', r, 'Sobrepago rechazado');
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 2464000, 'd-p3'));
  perform t216.afirma('D4 el resto exacto hasta el NETO se acepta', r ~ '^OK\|\d+$', r);
  d0 := t216.ultimo_dtm();
  num := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('D5 convertir devuelve el contrato y consume UN consecutivo', num ~ '^DTM-\d{4,}$' and t216.ultimo_dtm() = d0 + 1, num);
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('D6 venta en forma NETO: precio 4.520.000, comisión_b2b 480.000, descontada, modo neta, canal B2B, COP',
    v.precio_venta = 4520000 and v.comision_b2b = 480000 and v.comision_estado = 'descontada' and v.modo_compra = 'neta' and v.canal = 'B2B' and v.moneda = 'COP', to_jsonb(v)::text);
  perform t216.afirma('D7 identidad por id: aliado 922201, tipo agencia, nombre del catálogo', v.aliado_id = 922201 and v.tipo_asesor = 'agencia' and v.agencia_nombre = 'C222 Agencia', to_jsonb(v)::text);
  select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) into sumi from public.contrato_items where numero_contrato = num;
  perform t216.afirma('D8 los items del documento siguen a PVP (5.000.000)', sumi = 5000000, sumi::text);
  select count(*) into nb from public.aliados_b2b where numero_contrato = num;
  select * into b from public.aliados_b2b where numero_contrato = num;
  perform t216.afirma('D9 UNA sola fila de aliados_b2b, la descontada: pagada, sin retención, valor 480.000, sin recobro aparte',
    nb = 1 and b.estado = 'pagada' and coalesce(b.descontada_en_precio, false) and b.comision_valor = 480000 and b.aplica_retencion is not true and b.recobro_total = 0, to_jsonb(b)::text);
  perform t216.afirma('D10 la comisión que leen los módulos es EXACTAMENTE el descuento', public.comision_b2b_total(b) = 480000, public.comision_b2b_total(b)::text);
  select count(*) into npl from public.comision_plan where cotizacion_id = c or numero_contrato = num;
  perform t216.afirma('D11 no hay plan de comisión #97 para este contrato (ni se materializa otra comisión)', npl = 0, npl::text);
  perform t216.afirma('D12 repetir la conversión devuelve el mismo contrato sin duplicar', t216.escalar('service_role', null, t216.convertir_sql(c)) = num
    and (select count(*) from public.aliados_b2b where numero_contrato = num) = 1);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- E. USD: sello con decimales, pago y conversión'
do $$
declare c bigint; n public.cotizacion_neto; num text; v public.ventas; r text;
begin
  c := t317.crear('admin', t317.cab('agencia', 2500, 0, 0, 'USD'), t317.serv(500, 400, 2000, 1600), 922201, false)::bigint;
  select * into n from public.cotizacion_neto where cotizacion_id = c;
  perform t216.afirma('E1 USD: PVP 2.500, comisión 240, NETO 2.260, costos 2.000, moneda USD', n.moneda = 'USD' and n.pvp_total = 2500 and n.descuento_total = 240 and n.neto_total = 2260 and n.costo_total = 2000, to_jsonb(n)::text);
  perform t216.afirma('E2 USD: exigido 500 + 30 % × 1.760 = 1.028', t222.exigido_snap(t222.snap_neto(c)) = 1028, t222.exigido_snap(t222.snap_neto(c))::text);
  perform t222.pagar_neto(c, 1028, 'e-p1', 'USD', 4000);
  r := t216.escalar('service_role', null, t216.pago_sql(c, 'admin', 1232, 'e-p2', null, null, 'USD', 4000));
  perform t216.afirma('E3 USD: el resto 1.232 completa el NETO 2.260', r ~ '^OK\|\d+$', r);
  num := t216.escalar('service_role', null, t216.convertir_sql(c));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('E4 USD: venta a NETO 2.260 en USD, comisión descontada 240', v.precio_venta = 2260 and v.moneda = 'USD' and v.comision_b2b = 240 and v.comision_estado = 'descontada', to_jsonb(v)::text);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- F. Regresión: el camino PVP con acuerdo #97 y el B2C no cambian'
do $$
declare c bigint; r text; cn bigint; npl int; ns int;
begin
  -- B2B PVP con acuerdo (aliado por id + BNC explícita) por la RPC de siempre: plan, sin sello, editable.
  r := t216.escalar('service_role', null, format('select public.crear_cotizacion_manual_con_acuerdo(%L, ''mayorista'', %L::jsonb, %L::jsonb, 922201, 0)::text',
        t216.u('admin'), t317.cab('agencia', 5000000), t317.serv(1000000, 800000, 4000000, 3200000)));
  perform t216.afirma('F1 la dinámica B2B PVP con acuerdo se crea como siempre', r ~ '^\d+$', r);
  c := r::bigint;
  select count(*) into npl from public.comision_plan where cotizacion_id = c;
  select count(*) into ns from public.cotizacion_neto where cotizacion_id = c;
  perform t216.afirma('F2 tiene plan #97 (1 versión) y NO tiene sello NETO; su aliado_id sigue nulo', npl = 1 and ns = 0 and (select aliado_id from public.cotizaciones where id = c) is null, npl || '/' || ns);
  r := t216.escalar('service_role', null, t216.editar_sql(c, 'admin', t317.serv(1000000, 800000, 4500000, 3600000), 'cambio de prueba', null,
        jsonb_build_object('precio_venta', 5500000, 'hotel', 'Hotel A', 'aerolinea', 'Aéreo BOG-CTG', 'items', t216.items(5500000), 'payload_servicios', '[]'::jsonb)));
  perform t216.afirma('F3 sigue siendo editable y el plan versiona (2 versiones)', r ~ '^\d+$' and (select count(*) from public.comision_plan where cotizacion_id = c) = 2, r);
  -- B2C normal: crear, pagar y convertir como siempre.
  cn := t216.crear('admin');
  perform t216.afirma('F4 B2C normal: sin sello ni aliado', not exists (select 1 from public.cotizacion_neto where cotizacion_id = cn) and (select aliado_id from public.cotizaciones where id = cn) is null);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G. ACL y copias de funciones'
do $$
declare s text;
begin
  perform t216.afirma('G1 crear_cotizacion_manual_neto: solo service_role',
    has_function_privilege('service_role', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)', 'EXECUTE'));
  perform t216.afirma('G2 sellar_hija y bloquear_para_editar siguen sin acceso desde la API',
    not has_function_privilege('authenticated', 'p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'p39_priv.bloquear_para_editar(bigint,uuid,integer,text)', 'EXECUTE'));
  select prosrc into s from pg_proc where oid = to_regprocedure('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)');
  perform t216.afirma('G3 sellar_hija: la guarda nueva está y la de «solo hijas» ya no', position('h.paquete_din_id is not null' in s) > 0 and position('h.cotizacion_origen_id is null or h.tipo' in s) = 0);
  perform t216.afirma('G4 la frontera de #39 sigue activa', p39_priv.frontera_activa());
end $$;

-- ── Resumen ────────────────────────────────────────────────────────────────
select count(*) filter (where ok) as aciertos, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, detalle from t216.res where not ok;
do $$ begin
  if exists (select 1 from t216.res where not ok) then raise exception 'test_317: hay % fallos', (select count(*) from t216.res where not ok); end if;
end $$;
rollback;
