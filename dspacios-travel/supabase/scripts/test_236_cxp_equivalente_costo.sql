-- ───────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 236 (#90 Entrega I): equivalente en COP de las CxP en USD del carrito. SOLO bases desechables.
-- Corre en UNA transacción que termina en ROLLBACK, sobre una base con 001-235 y la 236 aplicada.
-- Uso:  psql -X -q -v ON_ERROR_STOP=1 -f test_236_cxp_equivalente_costo.sql      Cierre esperado: "TEST 236 SQL: TODO OK".
--
--   A  esquema: columnas, CHECK, trigger de inmutabilidad, ACL de la RPC
--   B  CHECK de la tabla: lo válido, y cada forma de equivalente inválido (INSERT y UPDATE)
--   C  inmutabilidad: el equivalente nace con la fila y no se agrega, cambia ni quita
--   D  RPC registrar_financiero_contrato: recorrido válido (USD con equivalente + COP) y cada payload inválido ANTES de escribir
--   E  idempotencia y reintento: segunda llamada = no-op (ids intactos); payload persistido reintentado = mismo resultado; reemplazo de CxP automáticas previas
--   F  rutas de siempre: payload sin claves nuevas (COP y USD nominal) queda IDÉNTICO; las claves de #63 (valor_cop/trm) siguen ignoradas por este camino
--   G  pagos y retenciones conviven con la CxP con equivalente (saldo en su moneda nominal)
-- ───────────────────────────────────────────────────────────────────────────
begin;

create schema t236;
create table t236.res (nombre text, ok boolean, detalle text);

create function t236.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t236.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    %', p_nombre;
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

-- Ejecuta una sentencia y devuelve 'OK' o 'ERR <sqlstate> <mensaje>' (la sentencia fallida se deshace sola: subtransacción).
create function t236.intenta(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

create function t236.contrato(p_n text, p_moneda text default 'USD', p_estado text default 'pendiente') returns text
language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado, moneda)
  values (p_n, 'Cliente de prueba', 'mayorista', 1000, 'activo', p_estado, p_moneda);
  return p_n;
end $$;

-- Una CxP del payload. p_cop/p_trm null = sin equivalente.
create function t236.item(p_servicio text, p_valor numeric, p_moneda text, p_cop numeric default null, p_trm numeric default null, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'proveedor', 'Proveedor ' || p_servicio, 'tipo_proveedor', 'hotel', 'servicio', p_servicio, 'valor_total', p_valor, 'moneda', p_moneda,
    'fecha_obligacion', '2026-10-24', 'aplica_retencion', false, 'pct_retencion', 0, 'observaciones', public.marca_cxp_automatica(),
    'valor_cop_costo', p_cop, 'trm_costo', p_trm)) || p_extra
$$;

create function t236.estado(p_n text) returns text language sql as $$
  select coalesce((select financiero_estado from public.ventas where numero_contrato = p_n), 'sin-venta')
         || ' cxp=' || (select count(*) from public.cuentas_por_pagar where numero_contrato = p_n)
         || ' pend=' || (select count(*) from public.contrato_financiero_pendiente where numero_contrato = p_n)
$$;

-- ═══ A · esquema ═══════════════════════════════════════════════════════════
select t236.afirma('A1 columnas valor_cop_costo numeric(15,2) y trm_costo numeric(15,4)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar'
      and ((column_name = 'valor_cop_costo' and numeric_precision = 15 and numeric_scale = 2) or (column_name = 'trm_costo' and numeric_precision = 15 and numeric_scale = 4))) = 2);
select t236.afirma('A2 CHECK validado',
  coalesce((select convalidated from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop_costo_chk'), false));
select t236.afirma('A3 trigger de inmutabilidad: BEFORE UPDATE por fila, habilitado',
  exists (select 1 from pg_trigger t where t.tgrelid = 'public.cuentas_por_pagar'::regclass and t.tgname = 'trg_cxp_costo_inmutable' and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16));
select t236.afirma('A4 la RPC solo la ejecuta service_role',
  (select has_function_privilege('service_role', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE') and not has_function_privilege('anon', f.oid, 'EXECUTE')
     from pg_proc f where f.proname = 'registrar_financiero_contrato' and f.pronamespace = 'public'::regnamespace and f.pronargs = 4));
select t236.afirma('A5 una sola firma de la RPC (sin sobrecargas que esquiven la validación)',
  (select count(*) from pg_proc f where f.proname = 'registrar_financiero_contrato' and f.pronamespace = 'public'::regnamespace) = 1);
select t236.afirma('A6 la RPC deriva #63 antes de validar el payload de siempre',
  (select strpos(pg_get_functiondef(f.oid), 'p63_registrar_financiero(p_numero_contrato') < strpos(pg_get_functiondef(f.oid), 'valor_cop_costo')
     from pg_proc f where f.proname = 'registrar_financiero_contrato' and f.pronamespace = 'public'::regnamespace));
select t236.afirma('A7 las columnas de #63 no cambiaron (valor_cop_63/trm_63 siguen ahí)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_por_pagar' and column_name in ('valor_cop_63', 'trm_63', 'aceptacion_63_id', 'obligacion_63')) = 4);

-- ═══ B · CHECK directo ═════════════════════════════════════════════════════
select t236.contrato('DTM-936001');
create function t236.ins(p_valor numeric, p_moneda text, p_cop numeric, p_trm numeric, p_extra text default '') returns text
language plpgsql as $$
begin
  return t236.intenta(format(
    $f$insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo%s)
       values ('DTM-936001', 'P', 'hotel', 'S', %L, %L, %L, %L%s)$f$,
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '=', 1) end, p_valor, p_moneda, p_cop, p_trm,
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '=', 2) end));
end $$;

select t236.afirma('B1 USD 210 × 3.900 = 819.000 → válido', t236.ins(210, 'USD', 819000, 3900) = 'OK');
select t236.afirma('B2 tolerancia de un centavo: 819.000,01 válido', t236.ins(210, 'USD', 819000.01, 3900) = 'OK');
select t236.afirma('B3 dos centavos de diferencia → rechazado (23514)', t236.ins(210, 'USD', 819000.02, 3900) like 'ERR 23514%');
select t236.afirma('B4 equivalente sin TRM → rechazado', t236.ins(210, 'USD', 819000, null) like 'ERR 23514%');
select t236.afirma('B5 TRM sin equivalente → rechazado', t236.ins(210, 'USD', null, 3900) like 'ERR 23514%');
select t236.afirma('B6 equivalente en una CxP en COP → rechazado', t236.ins(210, 'COP', 819000, 3900) like 'ERR 23514%');
select t236.afirma('B7 TRM cero o negativa → rechazada', t236.ins(210, 'USD', 0, 0) like 'ERR 23514%' and t236.ins(210, 'USD', -819000, -3900) like 'ERR 23514%');
select t236.afirma('B8 equivalente que no corresponde al valor × TRM → rechazado', t236.ins(210, 'USD', 210, 3900) like 'ERR 23514%');
select t236.afirma('B9 junto al equivalente de #63 (valor_cop_63/trm_63) → rechazado', t236.ins(210, 'USD', 819000, 3900, 'valor_cop_63=819000') like 'ERR 23514%');
select t236.afirma('B10 junto a la marca de aceptación #63 → rechazado (FK o CHECK; nunca se acepta)', t236.ins(210, 'USD', 819000, 3900, 'obligacion_63=''hotel''') like 'ERR %');
select t236.afirma('B11 CxP de siempre (sin equivalente), COP o USD, se inserta como antes', t236.ins(100, 'USD', null, null) = 'OK' and t236.ins(100, 'COP', null, null) = 'OK');

-- ═══ C · inmutabilidad y UPDATE ═══════════════════════════════════════════
create temp table t236_c as select t236.contrato('DTM-936002') as n;
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo)
  values ('DTM-936002', 'P', 'hotel', 'Con equivalente', 210, 'USD', 819000, 3900);
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda)
  values ('DTM-936002', 'P', 'hotel', 'Sin equivalente', 100, 'USD');

select t236.afirma('C1 cambiar valor_total de una CxP con equivalente → rechazado (el equivalente dejaría de corresponder)',
  t236.intenta($$update public.cuentas_por_pagar set valor_total = 250 where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR %');
select t236.afirma('C2 cambiar su moneda → rechazado', t236.intenta($$update public.cuentas_por_pagar set moneda = 'COP' where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR %');
select t236.afirma('C3 cambiar a otro par coherente (250 × 3.900 = 975.000) → rechazado por el trigger (Z9610), aunque el CHECK lo permitiría',
  t236.intenta($$update public.cuentas_por_pagar set valor_total = 250, valor_cop_costo = 975000 where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR Z9610%');
select t236.afirma('C4 cambiar solo la TRM (y el equivalente coherente) → rechazado (Z9610)',
  t236.intenta($$update public.cuentas_por_pagar set trm_costo = 4000, valor_cop_costo = 840000 where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR Z9610%');
select t236.afirma('C5 quitar el equivalente (ambas columnas a NULL) → rechazado (Z9610)',
  t236.intenta($$update public.cuentas_por_pagar set valor_cop_costo = null, trm_costo = null where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR Z9610%');
select t236.afirma('C6 agregar el equivalente a una CxP que no lo tenía → rechazado (Z9610): solo nace con la fila',
  t236.intenta($$update public.cuentas_por_pagar set valor_cop_costo = 410000, trm_costo = 4100 where servicio = 'Sin equivalente' and numero_contrato = 'DTM-936002'$$) like 'ERR Z9610%');
select t236.afirma('C7 editar proveedor, servicio, vencimiento e IVA de la CxP con equivalente sigue permitido',
  t236.intenta($$update public.cuentas_por_pagar set proveedor = 'Otro', servicio = 'Con equivalente', fecha_vencimiento = '2026-12-01', iva_proveedor = 5, base_gravable = 205 where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'$$) = 'OK');
select t236.afirma('C8 la fila con equivalente quedó intacta tras los intentos',
  (select (valor_total, moneda, valor_cop_costo, trm_costo) = (210::numeric, 'USD', 819000::numeric, 3900::numeric) from public.cuentas_por_pagar where servicio = 'Con equivalente' and numero_contrato = 'DTM-936002'));

-- ═══ D · RPC ═══════════════════════════════════════════════════════════════
-- Cada paso que ESCRIBE va en su propia sentencia y la comprobación en la siguiente: el planificador puede reordenar los operandos de un AND con
-- funciones volátiles dentro de una misma sentencia, y una prueba no puede depender de ese orden.
create table t236.salida (k text primary key, r text);
create function t236.corre(p_k text, p_n text, p_cxp jsonb, p_costos jsonb default '{"costo_hotel": 210}'::jsonb) returns void
language plpgsql as $$
declare v jsonb;
begin
  begin
    v := public.registrar_financiero_contrato(p_n, 'mayorista', p_costos, p_cxp);
    insert into t236.salida values (p_k, 'OK ' || v::text);
  exception when others then
    insert into t236.salida values (p_k, 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;
end $$;
create function t236.r(p_k text) returns text language sql as $$ select r from t236.salida where k = p_k $$;

-- D1 recorrido válido: una CxP USD con equivalente + una COP sin él (el payload admite ambas; el carrito, en cambio, no mezcla monedas)
select t236.contrato('DTM-936010');
select t236.corre('D1', 'DTM-936010', jsonb_build_array(t236.item('Hotel', 210, 'USD', 819000, 3900), t236.item('Seguro', 50000, 'COP')));
select t236.afirma('D1 payload válido: se escribe (contrato completo, 2 CxP) y el pendiente se limpia',
  t236.r('D1') like 'OK %' and t236.estado('DTM-936010') = 'completo cxp=2 pend=0', t236.r('D1') || ' / ' || t236.estado('DTM-936010'));
select t236.afirma('D2 la CxP USD conserva valor y moneda originales y lleva el par; la COP queda sin él',
  (select (valor_total, moneda, valor_cop_costo, trm_costo) = (210::numeric, 'USD', 819000::numeric, 3900::numeric) from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel')
  and (select valor_cop_costo is null and trm_costo is null and moneda = 'COP' from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Seguro'));
select t236.afirma('D3 ventas.costo_hotel quedó en la moneda de la oferta (210 USD), no en pesos',
  (select costo_hotel = 210 from public.ventas where numero_contrato = 'DTM-936010'));

-- D4.. cada payload inválido se rechaza ANTES de escribir: el contrato sigue pendiente, sin CxP ni costos
create function t236.rechazado(p_k text, p_n text, p_cxp jsonb, p_patron text) returns boolean
language plpgsql as $$
declare r text; e text;
begin
  perform t236.contrato(p_n);
  perform t236.corre(p_k, p_n, p_cxp);
  r := t236.r(p_k);
  e := t236.estado(p_n);
  return r like 'ERR %' and r like p_patron and e = 'pendiente cxp=0 pend=0' and (select costo_hotel from public.ventas where numero_contrato = p_n) = 0;
end $$;

select t236.afirma('D4 equivalente sin TRM', t236.rechazado('D4', 'DTM-936011', jsonb_build_array(t236.item('H', 210, 'USD', 819000, null)), '%sin su TRM de costos%'), t236.r('D4'));
select t236.afirma('D5 TRM sin equivalente', t236.rechazado('D5', 'DTM-936012', jsonb_build_array(t236.item('H', 210, 'USD', null, 3900)), '%sin su TRM de costos%'), t236.r('D5'));
select t236.afirma('D6 equivalente en una CxP en COP', t236.rechazado('D6', 'DTM-936013', jsonb_build_array(t236.item('H', 210, 'COP', 819000, 3900)), '%no está en USD%'), t236.r('D6'));
select t236.afirma('D7 equivalente incoherente con valor × TRM', t236.rechazado('D7', 'DTM-936014', jsonb_build_array(t236.item('H', 210, 'USD', 210, 3900)), '%no corresponde a su valor y a la TRM%'), t236.r('D7'));
select t236.afirma('D8 dos TRM de costos distintas en un contrato',
  t236.rechazado('D8', 'DTM-936015', jsonb_build_array(t236.item('H', 210, 'USD', 819000, 3900), t236.item('T', 100, 'USD', 410000, 4100)), '%una sola TRM de costos%'), t236.r('D8'));
select t236.afirma('D9 CxP USD con importe SIN equivalente junto a otra que lo lleva (devengo mixto)',
  t236.rechazado('D9', 'DTM-936016', jsonb_build_array(t236.item('H', 210, 'USD', 819000, 3900), t236.item('T', 100, 'USD')), '%todas las obligaciones en USD del contrato deben llevarlo%'), t236.r('D9'));
select t236.afirma('D10a TRM cero', t236.rechazado('D10a', 'DTM-936017', jsonb_build_array(t236.item('H', 210, 'USD', 0, 0)), '%inválidos%'), t236.r('D10a'));
select t236.afirma('D10b TRM negativa', t236.rechazado('D10b', 'DTM-936018', jsonb_build_array(t236.item('H', 210, 'USD', -1, -1)), '%inválidos%'), t236.r('D10b'));
select t236.afirma('D10c TRM desbordada (>= 1e11)', t236.rechazado('D10c', 'DTM-936019', jsonb_build_array(t236.item('H', 210, 'USD', 1, 100000000000)), '%inválidos%'), t236.r('D10c'));
select t236.afirma('D10d equivalente/TRM no numéricos',
  t236.rechazado('D10d', 'DTM-936020', jsonb_build_array(t236.item('H', 210, 'USD', null, null, '{"valor_cop_costo": "abc", "trm_costo": "x"}')), '%no numéricos%'), t236.r('D10d'));

select t236.contrato('DTM-936022');
select t236.corre('D11', 'DTM-936022', jsonb_build_array(t236.item('H', 210, 'USD', 819000, 3900), t236.item('Cero', 0, 'USD')));
select t236.afirma('D11 USD en cero sin equivalente + USD con equivalente: válido (una deuda de cero no es un devengo mixto)',
  t236.r('D11') like 'OK %' and t236.estado('DTM-936022') = 'completo cxp=2 pend=0', t236.r('D11'));

select t236.contrato('DTM-936023');
select t236.corre('D12', 'DTM-936023', jsonb_build_array(t236.item('H', 100, 'USD', 405012.34, 4050.123456)));
select t236.afirma('D12 la TRM con más de 4 decimales se guarda a 4 decimales y el equivalente sigue siendo coherente',
  t236.r('D12') like 'OK %' and (select trm_costo = 4050.1235 from public.cuentas_por_pagar where numero_contrato = 'DTM-936023'), t236.r('D12'));

-- ═══ E · idempotencia y reintento ═════════════════════════════════════════
create temp table t236_ids as select string_agg(id::text, ',' order by id) as ids from public.cuentas_por_pagar where numero_contrato = 'DTM-936010';
select t236.corre('E1', 'DTM-936010', jsonb_build_array(t236.item('Hotel', 210, 'USD', 819000, 3900), t236.item('Seguro', 50000, 'COP')));
select t236.afirma('E1 repetir la misma llamada sobre un contrato completo: no-op {ya_completo}, mismas CxP (mismos ids), sin duplicar',
  t236.r('E1') like 'OK %ya_completo": true%'
  and (select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = 'DTM-936010') = (select ids from t236_ids)
  and t236.estado('DTM-936010') = 'completo cxp=2 pend=0', t236.r('E1'));
select t236.corre('E2', 'DTM-936010', jsonb_build_array(t236.item('Hotel', 999, 'USD', 3896100, 3900)));
select t236.afirma('E2 un payload DISTINTO sobre un contrato ya completo tampoco cambia nada (la escritura financiera ocurre una vez)',
  t236.r('E2') like 'OK %ya_completo": true%'
  and (select valor_total from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel') = 210, t236.r('E2'));

-- E3 reintento desde el payload PERSISTIDO (lo que hace la reconciliación): mismo resultado
select t236.contrato('DTM-936030');
insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp)
  values ('DTM-936030', 'mayorista', '{"costo_hotel": 210}', jsonb_build_array(t236.item('Hotel', 210, 'USD', 819000, 3900)));
select t236.corre('E3', 'DTM-936030', (select cxp from public.contrato_financiero_pendiente where numero_contrato = 'DTM-936030'), (select costos from public.contrato_financiero_pendiente where numero_contrato = 'DTM-936030'));
select t236.afirma('E3 reintento con el payload guardado en contrato_financiero_pendiente: mismo equivalente, contrato completo, pendiente borrado',
  t236.r('E3') like 'OK %' and t236.estado('DTM-936030') = 'completo cxp=1 pend=0'
  and (select (valor_cop_costo, trm_costo) = (819000::numeric, 3900::numeric) from public.cuentas_por_pagar where numero_contrato = 'DTM-936030'), t236.r('E3') || ' / ' || t236.estado('DTM-936030'));

-- E4 un intento anterior dejó CxP automáticas (con equivalente) en un contrato todavía pendiente: la RPC las reemplaza (DELETE + INSERT, no choca con la inmutabilidad)
select t236.contrato('DTM-936031');
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, valor_cop_costo, trm_costo, observaciones)
  values ('DTM-936031', 'P', 'hotel', 'Previa', 100, 'USD', 390000, 3900, public.marca_cxp_automatica());
select t236.corre('E4', 'DTM-936031', jsonb_build_array(t236.item('Hotel', 210, 'USD', 840000, 4000)));
select t236.afirma('E4 CxP automática previa con equivalente en un contrato pendiente: se reemplaza por el payload nuevo (otra TRM) sin duplicar',
  t236.r('E4') like 'OK %' and t236.estado('DTM-936031') = 'completo cxp=1 pend=0'
  and (select (valor_cop_costo, trm_costo) = (840000::numeric, 4000::numeric) from public.cuentas_por_pagar where numero_contrato = 'DTM-936031'), t236.r('E4'));

-- ═══ F · rutas de siempre ═════════════════════════════════════════════════
select t236.contrato('DTM-936040', 'COP');
select t236.corre('F1', 'DTM-936040', jsonb_build_array(t236.item('Hotel', 420000, 'COP'), t236.item('Tour', 100000, 'COP')), '{"costo_hotel": 420000, "costo_receptivo": 100000}');
select t236.afirma('F1 contrato COP, payload de siempre (sin claves nuevas): idéntico a antes (CxP COP sin equivalente)',
  t236.r('F1') like 'OK %'
  and (select count(*) from public.cuentas_por_pagar where numero_contrato = 'DTM-936040' and valor_cop_costo is null and trm_costo is null and moneda = 'COP') = 2, t236.r('F1'));
select t236.contrato('DTM-936041');
select t236.corre('F2', 'DTM-936041', jsonb_build_array(t236.item('Programa', 500, 'USD')));
select t236.afirma('F2 payload de siempre con una CxP USD nominal SIN equivalente (ninguna lo lleva): se acepta como antes (rutas no-carrito, p. ej. programas)',
  t236.r('F2') like 'OK %' and (select valor_cop_costo is null and valor_total = 500 from public.cuentas_por_pagar where numero_contrato = 'DTM-936041'), t236.r('F2'));
select t236.contrato('DTM-936042');
select t236.corre('F3', 'DTM-936042', jsonb_build_array(t236.item('Hotel', 210, 'USD', null, null, '{"valor_cop": 819000, "trm": 3900}')));
select t236.afirma('F3 las claves de #63 (valor_cop/trm) siguen IGNORADAS por este camino: la CxP no recibe equivalente de costos ni de #63',
  t236.r('F3') like 'OK %'
  and (select valor_cop_costo is null and trm_costo is null and valor_cop_63 is null and trm_63 is null from public.cuentas_por_pagar where numero_contrato = 'DTM-936042'), t236.r('F3'));
select t236.corre('F4a', 'DTM-936099', '[]'::jsonb);
select t236.corre('F4b', 'DTM-936010', '[]'::jsonb);
select t236.afirma('F4 contrato inexistente / contrato ya completo: mismos errores y no-op de siempre',
  t236.r('F4a') like 'ERR %no existe en la agencia%' and t236.r('F4b') like 'OK %ya_completo": true%', t236.r('F4a') || ' / ' || t236.r('F4b'));
select t236.contrato('DTM-936043');
select t236.corre('F5', 'DTM-936043', '{"a": 1}'::jsonb);
select t236.afirma('F5 p_cxp que no es arreglo se rechaza como antes', t236.r('F5') like 'ERR %debe ser un arreglo%', t236.r('F5'));

-- ═══ G · pagos y retenciones conviven ═════════════════════════════════════
select t236.intenta($$insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm)
                 select id, current_date, 100, 4200 from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel'$$) as g1 \gset
select t236.afirma('G1 un pago parcial en USD (TRM del día de pago, distinta de la de costos) sobre la CxP con equivalente se registra', :'g1' = 'OK', :'g1');
select t236.intenta($$insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm)
                 select id, current_date, 110.11, 4200 from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel'$$) as g2a \gset
select t236.intenta($$insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm)
                 select id, current_date, 110, 4200 from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel'$$) as g2b \gset
select t236.afirma('G2 el saldo se sigue guardando en la moneda NOMINAL: sobrepagar (100 + 110,11 > 210 + 0,10 de tolerancia) se rechaza; 110 completa', :'g2a' like 'ERR %' and :'g2b' = 'OK', :'g2a' || ' / ' || :'g2b');
select t236.afirma('G3 pagar no altera el equivalente de devengo (819.000 a 3.900 sigue congelado)',
  (select (valor_cop_costo, trm_costo) = (819000::numeric, 3900::numeric) from public.cuentas_por_pagar where numero_contrato = 'DTM-936010' and servicio = 'Hotel'));
select t236.intenta($$insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, base_gravable, fecha_practica, mes_declaracion)
                 select id, 0.5, 10, current_date, date_trunc('month', current_date)::date from public.cuentas_por_pagar where numero_contrato = 'DTM-936030' and servicio = 'Hotel'$$) as g4 \gset
select t236.afirma('G4 una retención en USD sobre la CxP con equivalente se registra en su moneda nominal', :'g4' = 'OK', :'g4');

-- ═══ Cierre ═══════════════════════════════════════════════════════════════
do $$
declare v_fallos int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_fallos, v_total from t236.res;
  if v_fallos > 0 then
    raise exception 'TEST 236 SQL: % FALLO(S) de % comprobaciones: %', v_fallos, v_total, (select string_agg(nombre, ' | ') from t236.res where not ok);
  end if;
  raise notice 'TEST 236 SQL: TODO OK (% comprobaciones)', v_total;
end $$;

rollback;
