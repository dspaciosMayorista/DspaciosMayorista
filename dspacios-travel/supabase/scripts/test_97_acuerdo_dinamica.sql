-- ───────────────────────────────────────────────────────────────
-- PRUEBAS #97 · acuerdo de comisión de la cotización dinámica (migración 286). SOLO base LOCAL desechable con 001–283 + 286.
--   psql -h localhost -U supabase_admin -d <base> -f test_97_acuerdo_dinamica.sql     (una transacción, termina en ROLLBACK)
-- Cualquier fila con resultado distinto de 'OK' es un fallo.
-- ───────────────────────────────────────────────────────────────
begin;
create temp table _r (n serial, caso text, resultado text) on commit drop;
create function pg_temp.chk(p_caso text, p_obtenido text, p_esperado text) returns void language sql as $$
  insert into _r(caso, resultado) values (p_caso, case when p_obtenido ilike p_esperado then 'OK'
    else 'FALLA: obtuve [' || coalesce(p_obtenido, 'NULL') || '], esperaba [' || p_esperado || ']' end);
$$;
create function pg_temp.falla(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'sin error'; exception when others then return sqlerrm; end $$;

-- El corte deja todo lo creado aquí como «nuevo» salvo lo que se baje explícitamente.
-- CICLO de vida ENCENDIDO para las secciones A–G e I. Sus dependencias son la identidad de #75 (284), la guarda de comision_plan y el gancho único de confirmación (288). Si la base no tiene
-- la 288 real, se SIMULAN dentro de esta transacción (confirmar_venta → materializar_obligaciones → materializar_comision_b2b); en una base con la 288 real no se crea ni se cambia nada.
create temp table _stub (creado boolean) on commit drop;
insert into _stub values (to_regprocedure('p75_priv.materializar_obligaciones(text)') is null);
do $stub$ begin
  if (select creado from _stub) then
    create schema if not exists p75_priv;
    create function p75_priv.materializar_obligaciones(p_numero text) returns jsonb language plpgsql as $f$ begin perform public.materializar_comision_b2b(p_numero); return null; end $f$;
    drop function if exists public.confirmar_venta(text);
    create function public.confirmar_venta(p_numero text) returns jsonb language plpgsql as $f$ begin perform p75_priv.materializar_obligaciones(p_numero); return null; end $f$;
  end if;
end $stub$;
update p97_priv.ciclo set activo = true;
-- Estado ACTIVADO (fase 3) para todo lo que sigue, salvo la sección F que prueba la fase 1 y la desactivación.
update p97_priv.corte set exigir = true, cotizacion_id_max = 0;

insert into public.aliados (id, nombre, tipo, pct_comision, nit, aplica_retencion, pct_retencion) values
  (970401, 'T97D Agencia 10 %',  'agencia',   0.10,   '900970401', false, 0),
  (970402, 'T97D Agencia 12 %',  'agencia',   0.12,   '900970402', false, 0),
  (970403, 'T97D Agencia 11 %',  'agencia',   0.11,   '900970403', false, 0),
  (970404, 'T97D Agencia 9,23 %','agencia',   0.0923, '900970404', true, 0.11),
  (970405, 'T97D Freelance sin %','freelance', null,   '900970405', false, 0),
  (970406, 'T97D Agencia 8 %',   'agencia',   0.08,   '900970406', false, 0);

-- ═══ A. Reglas de cálculo (mismos números que pruebas/acuerdoComision97.test.ts) ═══
-- caso | cot | aliado | total | bnc | recobro | participación | base esperada | ordinaria | total aliado
create temp table _g (caso text, cot bigint, ali bigint, total numeric, bnc numeric, rec numeric, part numeric, base numeric, ord numeric, tot numeric) on commit drop;
insert into _g values
  ('cero: el recobro PERMANECE en la base',      970501, 970401, 2000000,  400000, 100000,      0, 1600000, 160000, 160000),
  ('parcial: el recobro COMPLETO sale',          970502, 970401, 2000000,  400000, 100000,  50000, 1500000, 150000, 200000),
  ('total (100 % al aliado)',                    970503, 970401, 2000000,  400000, 100000, 100000, 1500000, 150000, 250000),
  ('sin recobro (12 %)',                         970504, 970402, 2000000,  400000,      0,      0, 1600000, 192000, 192000),
  ('BNC = 0 escrita (11 %)',                     970505, 970403, 1000000,       0,      0,      0, 1000000, 110000, 110000),
  ('BNC = total: base 0',                        970506, 970401, 1000000, 1000000,      0,      0,       0,      0,      0),
  ('recobro mayor que la base restante',         970507, 970401,  500000,  450000, 200000,  10000,       0,      0,  10000),
  ('redondeo de la ordinaria (mitad arriba)',    970508, 970401, 1000005,       0,      0,      0, 1000005, 100001, 100001),
  ('redondeo con participación (9,23 %)',        970509, 970404, 1234567,  234567,  50001,  25001,  949999,  87685, 112686),
  ('% a importe 0 (0,004 % de 100): permanece',  970510, 970401, 1000000,       0,    100,      0, 1000000, 100000, 100000),
  ('% a importe 1 (0,5 % de 100): sale',         970511, 970401, 1000000,       0,    100,      1,  999900,  99990,  99991),
  ('participación 33.333 de 100.000 (1/3)',      970512, 970401, 1000000,       0, 100000,  33333,  900000,  90000, 123333),
  ('freelance sin % propio: parámetro/11 %',     970513, 970405, 1000000,       0,      0,      0, 1000000, 110000, 110000);
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
  select cot, 'T97D-' || cot, 'abierta', 'manual', 'simple', 'mayorista',
         jsonb_build_object('tipoAsesor', case when ali = 970405 then 'freelance' else 'agencia' end, 'recobro', rec, 'recobroAliado', part), total, 'COP', 'C'
    from _g;
select pg_temp.chk('A · ' || g.caso,
  (select (k->>'base')::numeric(15,0) || '/' || (k->>'ordinaria')::numeric(15,0) || '/' || (k->>'total')::numeric(15,0) from (select p97_priv.importes(g.cot, g.ali, g.bnc) k) x),
  g.base::numeric(15,0) || '/' || g.ord::numeric(15,0) || '/' || g.tot::numeric(15,0)) from _g g;

-- ═══ B. Sellado, BNC explícita, versionado, inmutabilidad ═══
select pg_temp.chk('B1 sellar v1 (parcial)', p97_priv.insertar_version(970502, 970401, 400000, null, null, null)::text, '1');
select pg_temp.chk('B2 desglose guardado',
  (select base_comision::numeric(15,0) || '/' || pct_comision || '/' || comision_ordinaria::numeric(15,0) || '/' || recobro_total::numeric(15,0) || '/' || recobro_aliado::numeric(15,0) || '/' || total_aliado::numeric(15,0) || '/' || pct_origen
     from public.comision_plan where cotizacion_id = 970502 and version = 1), '1500000/0.1000/150000/100000/50000/200000/aliado');
select pg_temp.chk('B3 BNC ausente se rechaza', pg_temp.falla($$select p97_priv.importes(970502, 970401, null)$$), 'ACUERDO_97: indica la base no comisionable%');
select pg_temp.chk('B4 BNC mayor que el total se rechaza', pg_temp.falla($$select p97_priv.importes(970502, 970401, 2000001)$$), 'ACUERDO_97: la BNC debe estar entre 0 y el total%');
select pg_temp.chk('B5 BNC 0 explícita vale', (p97_priv.importes(970502, 970401, 0)->>'base')::numeric(15,0)::text, '1900000');
select pg_temp.chk('B6 el acuerdo es de solo inserción', pg_temp.falla($$update public.comision_plan set bnc = 0 where cotizacion_id = 970502$$), 'ACUERDO_97: el acuerdo de comisión es de solo inserción%');
select pg_temp.chk('B7 aliado de otro tipo se rechaza', pg_temp.falla($$select p97_priv.importes(970513, 970401, 0)$$), 'ACUERDO_97: el aliado es de tipo%');
-- Edición de importes → versión nueva que CONSERVA aliado, % y BNC aunque el catálogo cambie.
update public.aliados set pct_comision = 0.20 where id = 970401;
update public.cotizaciones set precio_venta = 2500000, payload = jsonb_set(payload, '{recobro}', '150000') where id = 970502;
select pg_temp.chk('B8 edición → v2 con el % acordado (no el del catálogo de hoy)',
  (select max(version)::text || '/' || (array_agg(pct_comision order by version desc))[1] || '/' || (array_agg(bnc::numeric(15,0) order by version desc))[1] || '/' || (array_agg(pvp_total::numeric(15,0) order by version desc))[1]
     from public.comision_plan where cotizacion_id = 970502), '2/0.1000/400000/2500000');
select pg_temp.chk('B9 v2: recobro 150.000 sale entero de la base (participación 50.000 > 0)',
  (select base_comision::numeric(15,0) || '/' || comision_ordinaria::numeric(15,0) || '/' || total_aliado::numeric(15,0) from public.comision_plan where cotizacion_id = 970502 and version = 2), '1950000/195000/245000');
update public.aliados set pct_comision = 0.10 where id = 970401;
update public.cotizaciones set payload = jsonb_set(payload, '{recobroAliado}', '0') where id = 970502;
select pg_temp.chk('B10 cambia la participación a 0 → v3: el recobro VUELVE a la base',
  (select max(version)::text || '/' || (array_agg(base_comision::numeric(15,0) order by version desc))[1] || '/' || (array_agg(total_aliado::numeric(15,0) order by version desc))[1] from public.comision_plan where cotizacion_id = 970502), '3/2100000/210000');
update public.cotizaciones set cliente = 'Otro nombre' where id = 970502;
select pg_temp.chk('B11 un cambio irrelevante no versiona', (select max(version)::text from public.comision_plan where cotizacion_id = 970502), '3');
select pg_temp.chk('B12 una edición que deja la BNC por encima del nuevo total se rechaza',
  pg_temp.falla($$update public.cotizaciones set precio_venta = 300000 where id = 970502$$), 'ACUERDO_97: la BNC debe estar entre 0 y el total%');

-- ═══ C. Conversión: validar ANTES de numerar y aplicar DESPUÉS (una sola fila, sin duplicados) ═══
select pg_temp.chk('C1 validar con acuerdo vigente: sale sin error', pg_temp.falla($$select p97_priv.validar(970502)$$), 'sin error');
alter table public.cotizaciones disable trigger trg_cot_acuerdo97;
update public.cotizaciones set precio_venta = 2600000 where id = 970502;
alter table public.cotizaciones enable trigger trg_cot_acuerdo97;
select pg_temp.chk('C2 acuerdo que no corresponde a los importes vigentes: la conversión se rechaza',
  pg_temp.falla($$select p97_priv.validar(970502)$$), 'ACUERDO_97: el acuerdo de comisión no corresponde a los importes vigentes%');
update public.cotizaciones set precio_venta = 2500000 where id = 970502;
select pg_temp.chk('C3 B2B nueva sin acuerdo: se rechaza', pg_temp.falla($$select p97_priv.validar(970501)$$), 'ACUERDO_97: esta cotización B2B no tiene acuerdo%');
update p97_priv.corte set cotizacion_id_max = 970501;
select pg_temp.chk('C4 histórica (id ≤ corte) sin acuerdo: conserva el comportamiento de siempre', pg_temp.falla($$select p97_priv.validar(970501)$$), 'sin error');
update p97_priv.corte set cotizacion_id_max = 0;
-- Ámbito: hija de comparativa / paquete 100 % dinámico / con aliado en la cotización no exigen este acuerdo.
update public.cotizaciones set aliado_id = 970401 where id = 970503;
select pg_temp.chk('C5 cotización con aliado_id propio (hija de comparativa): fuera del ámbito', pg_temp.falla($$select p97_priv.validar(970503)$$), 'sin error');
update public.cotizaciones set aliado_id = null where id = 970503;
-- aplicar con la fila de recobro que crea la 198 (pct_recobro del 198 con la precisión nueva) y SIN ella.
select pg_temp.chk('C6 sellar 970512 (participación 33.333 de 100.000)', p97_priv.insertar_version(970512, 970401, 0, null, null, null)::text, '1');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9761','C','mayorista',1000000,'COP','pendiente',970512,'B2B');
insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
  values ('DTM-9761','mayorista','texto libre','agencia',1000000,33333,100000,33333::numeric/100000,'pendiente');
select p97_priv.aplicar(970512, 'DTM-9761') as _x;
select pg_temp.chk('C7p PENDIENTE: aplicar deja el plan y NINGUNA comisión exigible (se retiró la fila del recobro de la conversión)', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9761'), '0');
select pg_temp.chk('C7q materializar con el contrato PENDIENTE no hace nada', coalesce(public.materializar_comision_b2b('DTM-9761')::text, 'null'), 'null');
select pg_temp.chk('C7r el plan quedó ligado al contrato (una sola vez, aunque aplicar se repita)', (select count(*)::text from public.comision_plan where numero_contrato = 'DTM-9761'), '1');
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9761';
select public.materializar_comision_b2b('DTM-9761') as _m;
select pg_temp.chk('C7 una sola fila, enlazada por id, con base/% del acuerdo',
  (select count(*)::text || '|' || min(aliado_id) || '|' || min(base_comision)::numeric(15,0) || '|' || min(pct_comision) from public.aliados_b2b where numero_contrato = 'DTM-9761'), '1|970401|900000|0.1000');
select pg_temp.chk('C8 la fila liquida EXACTAMENTE ordinaria + participación (123.333)',
  (select (round(base_comision * pct_comision) + round(recobro_total * pct_recobro_aliado))::numeric(15,0)::text from public.aliados_b2b where numero_contrato = 'DTM-9761'), '123333');
select p97_priv.aplicar(970512, 'DTM-9761') as _x;
select public.materializar_comision_b2b('DTM-9761') as _m2;
select pg_temp.chk('C9 aplicar y materializar son idempotentes: sigue UNA fila y UN plan ligado', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9761') || '|' || (select count(*)::text from public.comision_plan where numero_contrato = 'DTM-9761'), '1|1');
select pg_temp.chk('C10 la venta quedó enlazada por id (no por nombre)', (select aliado_id::text || '|' || tipo_asesor from public.ventas where numero_contrato = 'DTM-9761'), '970401|agencia');
select pg_temp.chk('C11 ventas.impuesto (default 0) y comision_b2b NO se tocan', (select coalesce(impuesto::text,'null') || '|' || coalesce(comision_b2b::text,'null') from public.ventas where numero_contrato = 'DTM-9761'), '0|null');
-- sin recobro previo (participación 0): no hay fila de la 198 → aplicar la crea una sola vez.
select pg_temp.chk('C12 sellar 970504 (sin recobro)', p97_priv.insertar_version(970504, 970402, 400000, null, null, null)::text, '1');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9762','C','mayorista',2000000,'COP','pendiente',970504,'B2B');
select p97_priv.aplicar(970504, 'DTM-9762') as _x;
select p97_priv.aplicar(970504, 'DTM-9762') as _x;
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9762';
select public.materializar_comision_b2b('DTM-9762') as _m;
select pg_temp.chk('C13 sin fila previa: una sola, ordinaria 192.000, recobro 0',
  (select count(*)::text || '|' || min(round(base_comision * pct_comision))::numeric(15,0) || '|' || min(recobro_total)::numeric(15,0) from public.aliados_b2b where numero_contrato = 'DTM-9762'), '1|192000|0');
-- retención del catálogo se copia (9,23 % con retención 11 %)
select pg_temp.chk('C14 sellar 970509', p97_priv.insertar_version(970509, 970404, 234567, null, null, null)::text, '1');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9763','C','mayorista',1234567,'COP','pendiente',970509,'B2B');
select p97_priv.aplicar(970509, 'DTM-9763') as _x;
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9763';
select public.materializar_comision_b2b('DTM-9763') as _m;
select pg_temp.chk('C15 retención del aliado copiada del catálogo y total del acuerdo = 112.686',
  (select aplica_retencion::text || '|' || pct_retencion || '|' || (round(base_comision * pct_comision) + round(recobro_total * pct_recobro_aliado))::numeric(15,0) from public.aliados_b2b where numero_contrato = 'DTM-9763'), 'true|0.1100|112686');
-- venta que no coincide con el acuerdo (moneda / total)
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9764','C','mayorista',999,'COP','pendiente',null,'B2B');
select pg_temp.chk('C16 contrato con total distinto al del acuerdo: se rechaza', pg_temp.falla($$select p97_priv.aplicar(970504, 'DTM-9764')$$), 'ACUERDO_97: el contrato DTM-9764 no coincide con el plan%');

-- ═══ D. Importes MÁXIMOS, COP y USD, redondeo en el límite, representabilidad ═══
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values
  (970411, 'T97D Agencia 12,35 %', 'agencia', 0.1235, '900970411'),
  (970412, 'T97D Agencia 50 %',    'agencia', 0.5,    '900970412');
-- caso | cot | aliado | moneda | total | bnc | recobro | participación | base | ordinaria | total aliado   (esperados calculados con enteros: sin coma flotante)
create temp table _x (caso text, cot bigint, ali bigint, mon text, total numeric, bnc numeric, rec numeric, part numeric, base numeric, ord numeric, tot numeric) on commit drop;
insert into _x values
  -- 9.999.999.999.999 × 0,1235 = 1.234.999.999.999,8765 → 1.235.000.000.000 (la base 5.999.999.999.999 × 1235 / 10000 = 740.999.999.999,8765 → 741.000.000.000)
  ('COP máximo: participación 1/3 del recobro',       970801, 970411, 'COP', 9999999999999, 1000000000000, 3000000000000, 1000000000000, 5999999999999, 741000000000, 1741000000000),
  ('COP máximo: participación 0, recobro en la base', 970802, 970411, 'COP', 9999999999999, 1000000000000, 3000000000000,             0, 8999999999999, 1111500000000, 1111500000000),
  ('límite .5 en el máximo (50 %: 4.999.999.999.999,5 → sube)', 970803, 970412, 'COP', 9999999999999, 0, 0, 0, 9999999999999, 5000000000000, 5000000000000),
  ('participación de 1 peso sobre el recobro máximo', 970804, 970412, 'COP', 9999999999999, 0, 9999999999998, 1, 1, 1, 2),
  ('USD: 33 de 100 con 12,35 % (11.900 × 12,35 % = 1.469,65 → 1.470)', 970805, 970411, 'USD', 12345, 345, 100, 33, 11900, 1470, 1503),
  ('USD: participación 0, recobro en la base',        970806, 970411, 'USD', 12345, 345, 100, 0, 12000, 1482, 1482);
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
  select cot, 'T97X-' || cot, 'abierta', 'manual', 'simple', 'mayorista', jsonb_build_object('tipoAsesor', 'agencia', 'recobro', rec, 'recobroAliado', part), total, mon, 'C' from _x;
select pg_temp.chk('D · ' || x.caso,
  (select (k->>'base')::numeric(20,0) || '/' || (k->>'ordinaria')::numeric(20,0) || '/' || (k->>'total')::numeric(20,0) from (select p97_priv.importes(x.cot, x.ali, x.bnc) k) q),
  x.base::numeric(20,0) || '/' || x.ord::numeric(20,0) || '/' || x.tot::numeric(20,0)) from _x x;
-- Sellado y aplicación en el MÁXIMO: la fila liquida EXACTAMENTE ordinaria + participación (1/3 del recobro máximo).
select pg_temp.chk('D1 sellar en el máximo', p97_priv.insertar_version(970801, 970411, 1000000000000, null, null, null)::text, '1');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9781','C','mayorista',9999999999999,'COP','pendiente',970801,'B2B');
select p97_priv.aplicar(970801, 'DTM-9781') as _x;
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9781';
select public.materializar_comision_b2b('DTM-9781') as _m;
select pg_temp.chk('D2 liquidador REAL (comision_b2b_total) del máximo = 1.741.000.000.000 al centavo (antes de retención: la fila no la tiene)',
  (select public.comision_b2b_total(b)::numeric(20,2)::text from public.aliados_b2b b where numero_contrato = 'DTM-9781'), '1741000000000.00');
select pg_temp.chk('D3 el % guardado no se redondeó a 4 decimales (1/3 con 20)',
  (select pct_recobro_aliado::text from public.aliados_b2b where numero_contrato = 'DTM-9781'), '0.33333333333333333333');
select pg_temp.chk('D4 USD: sellar y aplicar con la moneda de la cotización', p97_priv.insertar_version(970805, 970411, 345, null, null, null)::text, '1');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9782','C','mayorista',12345,'USD','pendiente',970805,'B2B');
select p97_priv.aplicar(970805, 'DTM-9782') as _x;
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9782';
select public.materializar_comision_b2b('DTM-9782') as _m;
select pg_temp.chk('D5 USD: liquidador REAL (comision_b2b_total) = 1.503,00 al centavo (acuerdo 1.470 + 33), no 1.502,65',
  (select public.comision_b2b_total(b)::numeric(20,2)::text from public.aliados_b2b b where numero_contrato = 'DTM-9782'), '1503.00');
select pg_temp.chk('D5b la fila conserva base, % y participación como evidencia y guarda comision_valor = ordinaria',
  (select base_comision::text || '/' || pct_comision::text || '/' || comision_valor::text || '/' || recobro_total::text from public.aliados_b2b where numero_contrato = 'DTM-9782'), '11900.00/0.1235/1470.00/100.00');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9783','C','mayorista',12345,'COP','pendiente',null,'B2B');
select pg_temp.chk('D6 contrato en COP contra un acuerdo en USD: se rechaza', pg_temp.falla($$select p97_priv.aplicar(970805, 'DTM-9783')$$), 'ACUERDO_97: el contrato DTM-9783 no coincide con el plan%');
-- Representabilidad: un importe que el % NO puede reproducir se RECHAZA (nunca se ajusta en silencio).
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
  values (970807, 'T97X-970807', 'abierta', 'manual', 'simple', 'mayorista', '{"tipoAsesor":"agencia","recobro":1e25,"recobroAliado":1}'::jsonb, 2000000, 'COP', 'C');
select pg_temp.chk('D7 participación que el % no puede representar exactamente: se rechaza',
  pg_temp.falla($$select p97_priv.importes(970807, 970411, 0)$$), 'ACUERDO_97: la participación del aliado en el recobro%no se puede representar exactamente%');
-- Conserva los valores existentes: un % de 4 decimales previo sigue igual tras el ensanchamiento.
select pg_temp.chk('D8 el tipo ensanchado conserva un valor de 4 decimales', (0.2575::numeric(5,4)::numeric(25,20))::text, '0.25750000000000000000');

-- ═══ E. NETO nuevas: la participación MONETARIA final decide; la casilla sola no; lo anterior al corte se conserva ═══
-- Hija con servicios hotel 1.000.000 + aéreo 500.000 y recobro 100.000 (total 1.600.000). p50_priv.calcular devuelve centavos.
create temp table _n (cot bigint) on commit drop;
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente) values
  (970901, 'T97N-1', 'abierta', 'manual', 'simple', 'mayorista', '{"recobro":100000}'::jsonb, 1600000, 'COP', 'C'),
  (970902, 'T97N-2', 'abierta', 'manual', 'simple', 'mayorista', '{"recobro":100000}'::jsonb, 1600000, 'COP', 'C');
insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor)
  select c, o, t, 'S' || o, 'P', cn, 'mk', 20, 0, v from (values (970901, 0, 'hotel', 800000, 1000000), (970901, 1, 'aereo', 400000, 500000),
                                                          (970902, 0, 'hotel', 800000, 1000000), (970902, 1, 'aereo', 400000, 500000)) x(c, o, t, cn, v);
-- 970901 = NUEVA (id > corte = 0). 970902 = ANTERIOR al corte: se sube el corte a 970902 solo dentro de este bloque.
create function pg_temp.neto(p_cot bigint, p_rec boolean, p_ali numeric) returns text language sql as $$
  select ((k->>'base')::numeric / 100)::numeric(20,0) || '/' || ((k->>'ordinaria')::numeric / 100)::numeric(20,0) || '/' || ((k->>'participacion')::numeric / 100)::numeric(20,0) || '/' || ((k->>'descuento')::numeric / 100)::numeric(20,0)
    from (select p50_priv.calcular(p_cot, p_rec, 0.10, p_ali) k) q $$;
select pg_temp.chk('E1 NUEVA, casilla NO marcada: el recobro permanece en la base', pg_temp.neto(970901, false, 50000), '1100000/110000/0/110000');
select pg_temp.chk('E2 NUEVA, casilla marcada pero participación 0: el recobro PERMANECE en la base', pg_temp.neto(970901, true, 0), '1100000/110000/0/110000');
select pg_temp.chk('E3 NUEVA, participación parcial: TODO el recobro sale', pg_temp.neto(970901, true, 50000), '1000000/100000/50000/150000');
select pg_temp.chk('E4 NUEVA, participación total', pg_temp.neto(970901, true, 100000), '1000000/100000/100000/200000');
select pg_temp.chk('E5 NUEVA, participación mayor que el recobro se acota al recobro', pg_temp.neto(970901, true, 999999), '1000000/100000/100000/200000');
update p97_priv.corte set cotizacion_id_max = 970902;
select pg_temp.chk('E6 ANTERIOR al corte, casilla marcada y participación 0: se CONSERVA el cálculo histórico (recobro fuera de la base)', pg_temp.neto(970902, true, 0), '1000000/100000/0/100000');
select pg_temp.chk('E7 ANTERIOR al corte, participación parcial: igual que siempre', pg_temp.neto(970902, true, 50000), '1000000/100000/50000/150000');
select pg_temp.chk('E8 con el corte en 970902, la 970901 (id menor) también es anterior: cálculo histórico', pg_temp.neto(970901, true, 0), '1000000/100000/0/100000');
update p97_priv.corte set cotizacion_id_max = 0;

-- ═══ F. Activación por fases: fase 1 compatible, activar, desactivar (el acuerdo y el corte se conservan) ═══
update p97_priv.corte set exigir = false, cotizacion_id_max = null;
select pg_temp.chk('F1 fase 1 (sin activar): una B2B nueva SIN acuerdo convierte como siempre', pg_temp.falla($$select p97_priv.validar(970501)$$), 'sin error');
select pg_temp.chk('F2 fase 1: la regla NETO nueva NO rige (casilla marcada y participación 0 → recobro fuera de la base, cálculo de siempre)', pg_temp.neto(970901, true, 0), '1000000/100000/0/100000');
select pg_temp.chk('F3 fase 1: public.p97_regla_neto_activa() = false', (select public.p97_regla_neto_activa())::text, 'false');
update p97_priv.corte set exigir = true, cotizacion_id_max = 970501;
select pg_temp.chk('F5 activada con corte 970501: la 970501 (≤ corte) sin acuerdo sigue convertible', pg_temp.falla($$select p97_priv.validar(970501)$$), 'sin error');
select pg_temp.chk('F6 activada: p97_regla_neto_activa() = true', (select public.p97_regla_neto_activa())::text, 'true');
update p97_priv.corte set exigir = false;
select pg_temp.chk('F7 desactivada: el corte NETO se conserva (la 970901 > corte sigue con la regla nueva)', pg_temp.neto(970901, true, 0), '1100000/110000/0/110000');
select pg_temp.chk('F8 desactivada: no queda ningún acuerdo borrado', (select count(*) from public.comision_plan)::text, (select count(*)::text from public.comision_plan));
update p97_priv.corte set exigir = false, cotizacion_id_max = null;

-- ═══ G. Plan de contratos de TODOS los recorridos y materialización única ═══
insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (970421, 'T97G Agencia 10 %', 'agencia', 0.10, '900970421') on conflict (id) do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000097990', 't97g-super@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000097990', 't97g-super@x.test', 'T97G Super', 'superadmin', true, 'mayorista') on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
-- Reservar/manual PVP: el contrato nace PENDIENTE con su comisión informativa (ventas.comision_b2b) y la RPC registra el PLAN, no la fila exigible.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9801','C','mayorista',2000000,'COP','pendiente','B2B','agencia',970421,'comisionable',180000,'pendiente',200000,'pendiente');
create function pg_temp.como(p_rol text, p_sql text) returns text language plpgsql as $f$
declare v_u uuid := case p_rol when 'superadmin' then '00000000-0000-0000-0000-000000097990'::uuid end; r text;
begin
  if v_u is null then return 'sin usuario ' || p_rol; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then r := 'ERROR: ' || sqlerrm; end;
  execute 'reset role';
  return coalesce(r, 'null');
end $f$;
select pg_temp.chk('G1 RPC de reserva (PVP) registra el PLAN y devuelve su id', (select (pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9801', 970421)::text$$) ~ '^[0-9]+$')::text), 'true');
select pg_temp.chk('G2 NO hay fila exigible en pendiente; el plan guarda base, %, BNC y total',
  (select (select count(*) from public.aliados_b2b where numero_contrato = 'DTM-9801')::text || '|' || base_comision::numeric(15,0) || '|' || pct_comision || '|' || bnc::numeric(15,0) || '|' || total_aliado::numeric(15,0) from public.comision_plan where numero_contrato = 'DTM-9801'), '0|1800000|0.1000|200000|180000');
select pg_temp.chk('G3 un segundo registro del mismo contrato se rechaza (sin duplicar el plan)', pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9801', 970421)::text$$), 'ERROR: El contrato DTM-9801 ya tiene comisión B2B.');
select pg_temp.chk('G4 materializar con el contrato PENDIENTE no hace nada', pg_temp.como('superadmin', $$select coalesce(public.materializar_comision_b2b('DTM-9801')::text, 'null')$$), 'null');
-- El plan NO se recalcula con parámetros de hoy: el % del aliado cambia después de sellar y la fila copia el plan.
update public.aliados set pct_comision = 0.20 where id = 970421;
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9801';
select pg_temp.chk('G5 confirmado: UNA fila con el % PACTADO (10 %), no el de hoy (20 %); comision_valor = ordinaria sellada',
  (select (pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9801')::text$$) ~ '^[0-9]+$')::text), 'true');
select pg_temp.chk('G6 la fila liquida el plan al centavo y queda marcada con su plan',
  (select count(*)::text || '|' || min(pct_comision) || '|' || min(comision_valor)::numeric(15,2) || '|' || (min(public.comision_b2b_total(b)))::numeric(15,2) || '|' || (min(plan_id) is not null)::text from public.aliados_b2b b where numero_contrato = 'DTM-9801'),
  '1|0.1000|180000.00|180000.00|true');
update public.aliados set pct_comision = 0.10 where id = 970421;
select pg_temp.chk('G7 reintento y concurrencia: materializar de nuevo devuelve la MISMA fila (sin duplicar)',
  (select (pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9801')::text$$))::bigint = (select id from public.aliados_b2b where numero_contrato = 'DTM-9801')::text::bigint)::text, 'true');
select pg_temp.chk('G7b sigue UNA fila', (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9801'), '1');
-- Históricas: una fila del MISMO aliado ya existe → no se duplica, no se toca.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9802','C','mayorista',1000000,'COP','pendiente','B2B','agencia',970421,'comisionable',100000,'pendiente',0,'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9802', 970421)::text$$);
update public.ventas set financiero_estado = 'completo' where numero_contrato = 'DTM-9802';
insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, tipo_aliado, precio_venta, base_comision, pct_comision, estado)
  values ('DTM-9802','mayorista','Histórica',970421,'agencia',1000000,1000000,0.0850,'pendiente');
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9802';
select pg_temp.chk('G8 fila HISTÓRICA del mismo aliado: no se duplica ni se recalcula (conserva su 8,5 %)',
  (select (pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9802')::text$$) ~ '^[0-9]+$')::text || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9802') || '|' || (select pct_comision::text from public.aliados_b2b where numero_contrato = 'DTM-9802') || '|' || (select (plan_id is null)::text from public.aliados_b2b where numero_contrato = 'DTM-9802')), 'true|1|0.0850|true');
-- NETO: el descuento va en el precio; la RPC deja la fila DESCONTADA (no exigible) y no crea plan; materializar no hace nada.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9803','C','mayorista',900000,'COP','pendiente','B2B','agencia',970421,'neta',100000,'descontada',0,'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9803', 970421)::text$$) as _r9;   -- sentencia aparte: la fila que inserta no se ve dentro de la misma sentencia
select pg_temp.chk('G9 NETO: fila descontada (no por pagar) y NINGÚN plan', (select estado || '/' || descontada_en_precio::text from public.aliados_b2b where numero_contrato = 'DTM-9803') || '|' || (select count(*)::text from public.comision_plan where numero_contrato = 'DTM-9803'), 'pagada/true|0');
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9803';
select pg_temp.chk('G10 NETO confirmado: materializar no crea una segunda comisión', (select coalesce(pg_temp.como('superadmin', $$select coalesce(public.materializar_comision_b2b('DTM-9803')::text, 'null')$$), 'x') || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9803')), 'null|1');
-- Seguridad: anon no ejecuta; un usuario que no ve el contrato no materializa.
-- ═══ I. IDENTIDAD del plan (contrato_uid): nunca por número, fecha ni «frescura» ═══
-- I1 · dos contratos con el MISMO número y distinto UUID, FECHAS IGUALES, y un plan escrito TARDE para el contrato anterior.
insert into public.ventas (numero_contrato, contrato_uid, created_at, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9820', '00000000-0000-0000-0000-0000000a0001', '2026-01-01 10:00:00+00', 'A', 'mayorista', 1000000, 'COP', 'pendiente', 'B2B', 'agencia', 970421, 'comisionable', 100000, 'pendiente', 0, 'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9820', 970421)::text$$) as _i1a;
select pg_temp.chk('I1a el plan del contrato A queda LIGADO a su identidad', (select count(*)::text || '|' || (min(numero_contrato) = 'DTM-9820')::text from public.comision_plan where contrato_uid = '00000000-0000-0000-0000-0000000a0001'), '1|true');
delete from public.ventas where numero_contrato = 'DTM-9820';   -- el contrato A desaparece (reuso del número); su plan queda como evidencia huérfana, no se borra
insert into public.ventas (numero_contrato, contrato_uid, created_at, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9820', '00000000-0000-0000-0000-0000000b0001', '2026-01-01 10:00:00+00', 'B', 'mayorista', 1000000, 'COP', 'confirmado', 'B2B', 'agencia', 970421, 'comisionable', 100000, 'pendiente', 0, 'pendiente');
insert into public.comision_plan (cotizacion_id, numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total, recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_en)
  values (null, 'DTM-9820', '00000000-0000-0000-0000-0000000a0001', 2, 'mayorista', 0, 970421, 'agencia', 'COP', 1000000, 0, 0, 0, 1000000, 0.1000, 'aliado', 100000, 100000, now() + interval '1 hour');
select pg_temp.chk('I1b el plan del contrato ANTERIOR (mismo número, misma fecha, escrito DESPUÉS) NO se elige para el nuevo: no se materializa nada',
  coalesce(pg_temp.como('superadmin', $$select coalesce(public.materializar_comision_b2b('DTM-9820')::text, 'null')$$), 'x') || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9820'), 'null|0');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9820', 970421)::text$$) as _i1c;   -- B nace confirmado: registra SU plan y materializa en el acto
select pg_temp.chk('I1c el contrato nuevo tiene SU plan (identidad b…) y UNA fila materializada desde ese plan (no desde el tardío de A)',
  (select count(*)::text || '|' || (min(plan_id) = (select id from public.comision_plan where contrato_uid = '00000000-0000-0000-0000-0000000b0001'))::text from public.aliados_b2b where numero_contrato = 'DTM-9820'), '1|true');
select pg_temp.chk('I1d materializar de nuevo: la MISMA fila, una sola vez',
  (pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9820')::text$$)) || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9820'),
  (select id::text || '|1' from public.aliados_b2b where numero_contrato = 'DTM-9820'));
select pg_temp.chk('I1e los planes del contrato anterior se CONSERVAN como evidencia (2 versiones, ninguna borrada)', (select count(*)::text from public.comision_plan where contrato_uid = '00000000-0000-0000-0000-0000000a0001'), '2');
-- I2 · RENUMERACIÓN conservando la identidad: el plan sigue a la identidad, no al número.
insert into public.ventas (numero_contrato, contrato_uid, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9830', '00000000-0000-0000-0000-0000000c0001', 'C', 'mayorista', 1000000, 'COP', 'pendiente', 'B2B', 'agencia', 970421, 'comisionable', 100000, 'pendiente', 0, 'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9830', 970421)::text$$) as _i2a;
select pg_temp.como('superadmin', $$select public.fn_renumerar_contrato('DTM-9830', 'DTM-9831')::text$$) as _i2b;
select pg_temp.chk('I2a la renumeración conserva la IDENTIDAD (mismo uid, número nuevo)', (select numero_contrato from public.ventas where contrato_uid = '00000000-0000-0000-0000-0000000c0001'), 'DTM-9831');
update public.ventas set estado = 'confirmado' where contrato_uid = '00000000-0000-0000-0000-0000000c0001';
select pg_temp.chk('I2b el número VIEJO ya no materializa nada', coalesce(pg_temp.como('superadmin', $$select coalesce(public.materializar_comision_b2b('DTM-9830')::text, 'null')$$), 'x'), 'null');
select pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9831')::text$$) as _i2c;   -- sentencia aparte: la fila que inserta no se ve dentro de la misma sentencia
select pg_temp.chk('I2c el número NUEVO materializa el plan (hallado por identidad aunque su etiqueta diga el número viejo): UNA fila, desde ese plan',
  (select count(*)::text || '|' || (min(plan_id) = (select id from public.comision_plan where contrato_uid = '00000000-0000-0000-0000-0000000c0001' order by id desc limit 1))::text from public.aliados_b2b where numero_contrato = 'DTM-9831'), '1|true');
select pg_temp.chk('I2d reintento: la misma fila, sin duplicar', (pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9831')::text$$)) || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9831'), (select id::text || '|1' from public.aliados_b2b where numero_contrato = 'DTM-9831'));
-- I3 · dependencias del ciclo: con el ciclo ENCENDIDO y una dependencia ausente, crear un contrato B2B se rechaza con un diagnóstico claro (sin cambiar la regla en silencio).
delete from public.contrato_guardas_config where tabla = 'comision_plan';
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9840', 'C', 'mayorista', 1000000, 'COP', 'pendiente', 'B2B', 'agencia', 970421, 'comisionable', 100000, 'pendiente', 0, 'pendiente');
select pg_temp.chk('I3 ciclo ENCENDIDO con una dependencia ausente: la RPC se rechaza y nombra lo que falta', pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9840', 970421)::text$$), 'ERROR: CICLO_97%faltan dependencias%guarda de identidad sobre comision_plan%');
select pg_temp.chk('I3b y no dejó nada escrito (ni plan ni fila)', (select count(*)::text from public.comision_plan where numero_contrato = 'DTM-9840') || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9840'), '0|0');
insert into public.contrato_guardas_config (tabla, modo, motivo) values ('comision_plan', 'estricto', 'restablecida por la prueba');
select pg_temp.chk('I3c restablecida la dependencia, la RPC registra el plan', (pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9840', 970421)::text$$) ~ '^[0-9]+$')::text, 'true');
-- Contrato que NACE 'activo' (tratamiento histórico, ya confirmado): la RPC registra el plan y lo materializa en el acto; el ciclo no lo vuelve pendiente.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9806','C','mayorista',1000000,'COP','activo','B2B','agencia',970421,'comisionable',100000,'pendiente',0,'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9806', 970421)::text$$) as _r14;
select pg_temp.chk('G14 contrato que nace ACTIVO (histórico): plan + comisión materializada al crearlo (una fila, con su plan)', (select count(*)::text || '|' || (min(plan_id) is not null)::text from public.aliados_b2b where numero_contrato = 'DTM-9806'), '1|true');
select pg_temp.chk('G11 anon no puede ejecutar materializar_comision_b2b', has_function_privilege('anon', 'public.materializar_comision_b2b(text)', 'execute')::text, 'false');

-- ═══ H. Ciclo APAGADO: un PENDIENTE sigue siendo solo PLAN (invariante); lo histórico (confirmado/activo) conserva la regla de siempre ═══
update p97_priv.ciclo set activo = false;
select pg_temp.chk('H0 el ciclo está apagado', p97_priv.ciclo_activo()::text, 'false');
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, canal, tipo_asesor, aliado_id, modo_compra, comision_b2b, comision_estado, impuesto, financiero_estado)
  values ('DTM-9810','C','mayorista',1000000,'COP','pendiente','B2B','agencia',970421,'comisionable',100000,'pendiente',0,'pendiente');
select pg_temp.como('superadmin', $$select public.registrar_comision_b2b_reserva('DTM-9810', 970421)::text$$) as _h1;
select pg_temp.chk('H1 apagado: un contrato PENDIENTE registra solo el PLAN (0 filas exigibles, 1 plan)',
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9810') || '|' || (select count(*)::text from public.comision_plan where numero_contrato = 'DTM-9810'), '0|1');
select pg_temp.chk('H1b apagado: el gancho público no materializa un pendiente', coalesce(pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9810')::text$$), 'null') || '|' || (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9810'), '%|0');
-- conversión dinámica apagada de un PENDIENTE: la fila de recobro de la 198 se RETIRA y el importe queda en el plan (no hay materialización forzada)
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
  values (970530, 'T97H-1', 'abierta', 'manual', 'simple', 'mayorista', '{"tipoAsesor":"agencia","recobro":50001,"recobroAliado":25001}'::jsonb, 1234567, 'COP', 'C');
select p97_priv.insertar_version(970530, 970404, 234567, null, null, null) as _h2v;
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9811','C','mayorista',1234567,'COP','pendiente',970530,'B2B');
insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
  values ('DTM-9811','mayorista','texto libre','agencia',1234567,1,50001,25001::numeric/50001,'pendiente');
select p97_priv.aplicar(970530, 'DTM-9811') as _h2;
select pg_temp.chk('H2 apagado: aplicar sobre un PENDIENTE retira la fila de la 198 (0 filas) y deja el plan',
  (select count(*)::text from public.aliados_b2b where numero_contrato = 'DTM-9811') || '|' || (select count(*)::text from public.comision_plan c join public.ventas v on v.contrato_uid = c.contrato_uid where v.numero_contrato = 'DTM-9811'), '0|1');
-- al CONFIRMAR (transición de #75) se materializa una vez, con el total del acuerdo, aunque el ciclo siga apagado
update public.ventas set estado = 'confirmado' where numero_contrato = 'DTM-9811';
select pg_temp.como('superadmin', $$select public.materializar_comision_b2b('DTM-9811')::text$$) as _h2c;
select pg_temp.chk('H2b apagado: confirmado → UNA fila con su plan que liquida el total del acuerdo 112.686',
  (select count(*)::text || '|' || (min(plan_id) is not null)::text || '|' || coalesce((min(coalesce(comision_valor, base_comision * pct_comision) + recobro_total * pct_recobro_aliado))::numeric(15,0)::text, '-') from public.aliados_b2b b where numero_contrato = 'DTM-9811'), '1|true|112686');
-- conversión de un contrato que ya está confirmado: aplicar COMPLETA la fila de la 198 (tratamiento histórico), sin forzar
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
  values (970531, 'T97H-2', 'abierta', 'manual', 'simple', 'mayorista', '{"tipoAsesor":"agencia","recobro":50001,"recobroAliado":25001}'::jsonb, 1234567, 'COP', 'C');
select p97_priv.insertar_version(970531, 970404, 234567, null, null, null) as _h3v;
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, moneda, estado, cotizacion_id, canal) values ('DTM-9812','C','mayorista',1234567,'COP','confirmado',970531,'B2B');
insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
  values ('DTM-9812','mayorista','texto libre','agencia',1234567,1,50001,25001::numeric/50001,'pendiente');
select p97_priv.aplicar(970531, 'DTM-9812') as _h3;
select pg_temp.chk('H3 apagado: aplicar sobre un contrato ya CONFIRMADO completa la fila de la 198 (una sola, con plan, total 112.686)',
  (select count(*)::text || '|' || (min(plan_id) is not null)::text || '|' || coalesce((min(coalesce(comision_valor, base_comision * pct_comision) + recobro_total * pct_recobro_aliado))::numeric(15,0)::text, '-') from public.aliados_b2b b where numero_contrato = 'DTM-9812'), '1|true|112686');

select n, caso, resultado from _r order by n;
select 'VEREDICTO', case when exists (select 1 from _r where resultado <> 'OK') then 'HAY FALLAS' else 'TODO OK (' || (select count(*) from _r) || ')' end;
rollback;
