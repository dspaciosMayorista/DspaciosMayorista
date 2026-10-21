-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #50 (migración 222 aplicada; la 223 NO). Hija manual de una comparativa con precio NETO.
-- SOLO base desechable (CI o local). Corre en UNA transacción y termina en ROLLBACK.
--
--   psql -v ON_ERROR_STOP=1 -f test_222_neto_hija.sql <base>        (desde supabase/scripts: usa \ir)
--   Exige /tmp/netoHija50.vectores.json (los MISMOS vectores del test TS pruebas/netoHijaPuro.test.ts).
--
-- Grupos (sección 6 de la bitácora de #50):
--   M  margen sobre el TOTAL y cálculo (paridad con TS)   R  reparto del snapshot y sello
--   S  nacimiento de la hija (elegir / resolver / firmas)  P  pago NETO (snapshot, tope, USD)
--   C  conversión NETO (forma de ventas, abonos, CxP)      I  identidad B2B en PVP y NETO
--   D  consecutivo DTM (rechazos, directo, fallo inyectado) F  frontera de #39 intacta
--   A  permisos (ACL, RLS, solo inserción)                 G  hijas legadas / B2C idénticas
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set vect `cat /tmp/netoHija50.vectores.json`
begin;

\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql

do $$
begin
  if not p39_priv.frontera_activa() then
    raise exception 'test_222 exige la 216 y la 217 aplicadas (frontera activa).';
  end if;
  if to_regclass('public.cotizacion_neto') is null then
    raise exception 'test_222 exige la 222 aplicada.';
  end if;
  if p50_priv.exigir_modalidad() then
    raise exception 'test_222 corre SIN la 223 (la modalidad aun no es obligatoria).';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- M. Margen sobre el total y cálculo'
do $$
declare
  r record; e jsonb; x jsonb; k jsonb; ev jsonb; cot bigint; filas bigint[]; esp bigint[]; vid text;
begin
  for r in select v from t222.vectores order by t222.vectores.id loop
    e := r.v->'entrada'; x := r.v->'esperado'; vid := r.v->>'id';
    cot := t222.cot_directa(e, coalesce(e->>'moneda', 'COP'));
    k := p50_priv.calcular(cot, (e->>'reconoceRecobro')::boolean, (e->>'pct')::numeric, (e->>'recobroAliado')::numeric);
    ev := p50_priv.evaluar_margen((k->>'neto')::bigint, (k->>'costos')::bigint, (k->>'solo_tiquetes')::boolean);
    select array_agg((f->>'descuento')::bigint order by (f->>'orden')::int) into filas from jsonb_array_elements(k->'filas') f;
    select array_agg(t222.c(d::numeric) order by n) into esp from jsonb_array_elements_text(x->'descuentosFila') with ordinality t(d, n);
    perform t216.afirma('M2 ' || vid || ' neto, descuento, costos y reparto por fila = TS',
      (k->>'neto')::bigint = t222.c((x->>'neto')::numeric) and (k->>'descuento')::bigint = t222.c((x->>'descuento')::numeric)
      and (k->>'costos')::bigint = t222.c((x->>'costos')::numeric) and filas = esp, k::text || ' / esperado ' || coalesce(esp::text, 'null'));
    perform t216.afirma('M1 ' || vid || ' cumple, bajo costo, costo cero y solo tiquetes = TS',
      (ev->>'cumple')::boolean = (x->>'cumple')::boolean and (ev->>'bajo_costo')::boolean = (x->>'bajoCosto')::boolean
      and (ev->>'costo_cero')::boolean = (x->>'costoCero')::boolean and (k->>'solo_tiquetes')::boolean = (x->>'soloTiquetes')::boolean,
      ev::text);
  end loop;
end $$;

do $$
declare ev jsonb;
begin
  -- 6 % con tolerancia de medio peso: el mínimo de NETO para costos 8.250.000 es 8.776.595,25.
  perform t216.afirma('M1.b1 6 %: 8.776.595,25 cumple y 8.776.595,24 no (medio peso)',
    (p50_priv.evaluar_margen(877659525, 825000000, false)->>'cumple')::boolean
    and not (p50_priv.evaluar_margen(877659524, 825000000, false)->>'cumple')::boolean);
  -- 2 % de solo tiquetes EXACTO: NETO 2.050.000 / costos 2.009.000 cumple; un centavo más, no.
  perform t216.afirma('M1.b2 2 % exacto: costos 2.009.000,00 cumple y 2.009.000,01 no',
    (p50_priv.evaluar_margen(205000000, 200900000, true)->>'cumple')::boolean
    and not (p50_priv.evaluar_margen(205000000, 200900001, true)->>'cumple')::boolean);
  ev := p50_priv.evaluar_margen(100, 0, false);
  perform t216.afirma('M1.b3 costo total 0 se marca (sin excepción posible)', (ev->>'costo_cero')::boolean and not (ev->>'cumple')::boolean);
  ev := p50_priv.evaluar_margen(100, 101, false);
  perform t216.afirma('M1.b4 NETO bajo el costo se marca', (ev->>'bajo_costo')::boolean);
  perform t216.afirma('M1.b5 roles: 6 % superadmin y administración; 2 % solo superadmin; NETO lo fijan los cuatro (no venta)',
    p50_priv.rol_autoriza_margen('superadmin', false) and p50_priv.rol_autoriza_margen('administracion', false)
    and not p50_priv.rol_autoriza_margen('gerencia', false) and not p50_priv.rol_autoriza_margen('operaciones', false)
    and p50_priv.rol_autoriza_margen('superadmin', true) and not p50_priv.rol_autoriza_margen('administracion', true)
    and p50_priv.rol_fija_neto('superadmin') and p50_priv.rol_fija_neto('gerencia') and p50_priv.rol_fija_neto('administracion')
    and p50_priv.rol_fija_neto('operaciones') and not p50_priv.rol_fija_neto('venta') and not p50_priv.rol_fija_neto(null));
end $$;

do $$
begin
  perform t216.afirma('R1.a reparto exacto: 100 centavos entre tres iguales = 34/33/33 (el sobrante a la primera)',
    p50_priv.repartir(100, array[1000, 1000, 1000]::bigint[]) = array[34, 33, 33]::bigint[]);
  perform t216.afirma('R1.b pesos cero no reciben', p50_priv.repartir(100, array[1000, 0, 1000]::bigint[]) = array[50, 0, 50]::bigint[]);
  perform t216.afirma('R1.c total 0 o pesos 0 reparten 0', p50_priv.repartir(0, array[5, 5]::bigint[]) = array[0, 0]::bigint[]
    and p50_priv.repartir(7, array[0, 0]::bigint[]) = array[0, 0]::bigint[] and p50_priv.repartir(7, '{}'::bigint[]) = '{}'::bigint[]);
  perform t216.afirma('R1.d mayor resto: el centavo cae en la última fila (V10)',
    p50_priv.repartir(1000000, array[3333333, 3333333, 3333334]::bigint[]) = array[333333, 333333, 333334]::bigint[]);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- S. Nacimiento de la hija: elegir, resolver y firmas'
do $$
declare
  m bigint; h bigint; r text; n public.cotizacion_neto; h2 text; hij int; c public.cotizaciones; k int; ev int;
begin
  -- S1 · NETO asistido: el interno escoge NETO y reconoce la participación.
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'admin', 'neto', true, false, 's1-clave-0001');
  perform t216.afirma('S1.1 elegir con modalidad NETO crea la hija', r ~ '^\d+$', r);
  h := r::bigint;
  select * into n from public.cotizacion_neto where cotizacion_id = h;
  perform t216.afirma('S1.2 sello NETO: base, ordinaria, participación, descuento, NETO, costos, margen y piso',
    n.modalidad = 'neto' and n.reconoce_recobro and n.aliado_id = 922201 and n.tipo_asesor = 'agencia' and n.moneda = 'COP'
    and n.pvp_total = 10000000 and n.tiquetes = 2000000 and n.recobro = 500000 and n.ninos_total = 0 and n.recobro_aliado_original = 250000
    and n.base_comision = 7500000 and n.pct_comision = 0.12 and n.comision_ordinaria = 900000 and n.participacion_recobro = 250000
    and n.descuento_total = 1150000 and n.neto_total = 8850000 and n.costo_total = 8250000 and n.margen = 0.067797 and n.piso = 0.06
    and n.solo_tiquetes = false and n.autorizado_por is null and n.autorizado_rol is null and n.creado_por_id = t216.u('admin'),
    to_jsonb(n)::text);
  select * into c from public.cotizaciones where id = h;
  perform t216.afirma('S1.3 la hija conserva el PVP; el payload se sella con recobroAliado = 0 y el recobro intacto',
    c.precio_venta = 10000000 and (c.payload->>'recobroAliado')::numeric = 0 and (c.payload->>'recobro')::numeric = 500000
    and c.aliado_id = 922201 and c.creado_por_id = t216.u('admin'), c.payload::text);
  perform t216.afirma('S1.4 la madre sigue íntegra (sello económico)', (select sello_economico = f211_priv.sello_madre(id) from public.cotizaciones where id = m));
  perform t216.afirma('S1.5 queda el evento «elegida» y UNA sola hija',
    (select count(*) from public.cotizacion_comparativa_eventos where cotizacion_id = m and tipo = 'elegida' and clave = 's1-clave-0001') = 1
    and (select count(*) from public.cotizaciones where cotizacion_origen_id = m) = 1);
  -- Reintento con la MISMA clave y la misma modalidad: la misma hija, sin hija nueva.
  h2 := t222.elegir(m, 'admin', 'neto', true, false, 's1-clave-0001');
  perform t216.afirma('S1.6 reintento idéntico devuelve la misma hija', h2 = h::text, h2);
  -- La misma clave con OTRA modalidad o con otra respuesta de recobro: falla cerrado.
  perform t216.rechaza('S1.7 la misma clave con PVP se rechaza', t222.elegir(m, 'admin', 'pvp', null, false, 's1-clave-0001'), 'la clave ya se usó');
  perform t216.rechaza('S1.8 la misma clave con otra respuesta de recobro se rechaza', t222.elegir(m, 'admin', 'neto', false, false, 's1-clave-0001'), 'la clave ya se usó');
  perform t216.rechaza('S1.9 la misma clave por la firma ANTERIOR (sin modalidad) tampoco devuelve la hija NETO',
    t222.elegir(m, 'admin', null, null, false, 's1-clave-0001', true), 'la clave ya se usó');
  select count(*) into hij from public.cotizaciones where cotizacion_origen_id = m;
  perform t216.afirma('S1.10 ningún reintento creó otra hija', hij = 1);

  -- S2 · PVP sellado de una venta B2B: deja constancia y NO toca el payload.
  h := t222.hija_de('V1', 922201, 'agencia', 'pvp', null, 'admin', 's2-clave-0001');
  select * into n from public.cotizacion_neto where cotizacion_id = h;
  select * into c from public.cotizaciones where id = h;
  perform t216.afirma('S2.1 PVP sellado: aliado y tipo guardados, sin importes NETO',
    n.modalidad = 'pvp' and n.aliado_id = 922201 and n.tipo_asesor = 'agencia' and n.neto_total is null and n.descuento_total is null
    and n.reconoce_recobro is null and n.pvp_total = 10000000, to_jsonb(n)::text);
  perform t216.afirma('S2.2 en PVP el payload no cambia (recobroAliado sigue en 250.000)', (c.payload->>'recobroAliado')::numeric = 250000 and c.precio_venta = 10000000);
  perform t216.afirma('S2.3 no hay reparto por fila en PVP', not exists (select 1 from public.cotizacion_neto_componentes where cotizacion_id = h));

  -- S3 · firma ANTERIOR (sin modalidad): la hija nace como siempre, sin sello.
  h := t222.hija_de('V1', 922201, 'agencia', null, null, 'admin', 's3-clave-0001', false, true);
  perform t216.afirma('S3.1 firma anterior: sin sello y payload intacto',
    not exists (select 1 from public.cotizacion_neto where cotizacion_id = h)
    and (select (payload->>'recobroAliado')::numeric from public.cotizaciones where id = h) = 250000);
  -- La firma NUEVA sin modalidad es lo mismo (la modalidad aún no es obligatoria con solo la 222).
  h := t222.hija_de('V1', 922201, 'agencia', null, null, 'admin', 's3-clave-0002');
  perform t216.afirma('S3.2 firma nueva con modalidad nula: sin sello', not exists (select 1 from public.cotizacion_neto where cotizacion_id = h));

  -- S4 · rechazos al sellar (la hija no nace y el recibo no se consume).
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'ventaA', 'neto', true, false, 's4-clave-0001');
  perform t216.rechaza('S4.1 venta no fija NETO', r, 'tu rol no puede fijar el precio NETO');
  perform t216.afirma('S4.1b sin hija tras el rechazo', not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m));
  r := t222.elegir(m, 'ventaA', 'pvp', null, false, 's4-clave-0002');
  perform t216.afirma('S4.2 venta sí elige PVP', r ~ '^\d+$', r);

  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  perform t216.rechaza('S4.3 NETO exige decidir el recobro', t222.elegir(m, 'admin', 'neto', null, false, 's4-clave-0003'), 'indica si se reconoce');
  perform t216.rechaza('S4.4 la modalidad solo la fija el personal interno (canal b2b)', t222.elegir(m, 'agencia', 'neto', true, false, 's4-clave-0004', false, 'A', 'b2b'), 'solo la fija el personal interno');
  perform t216.rechaza('S4.5 modalidad inválida', t216.escalar('service_role', null, format(
    'select public.registrar_validacion_comparativa_n50(%s, ''A'', ''unica'', 1, ''interno'', %L, %s, ''COP'', true, null, ''bruto'', null, false)::text',
    m, t216.u('admin'), t222.total(m))), 'debe ser PVP o NETO');

  m := t222.madre(t216.u('admin'), null, 'interno', t222.vec('V1')->'entrada');
  perform t216.rechaza('S4.6 una venta B2C no tiene NETO', t222.elegir(m, 'admin', 'neto', true, false, 's4-clave-0005'), 'solo aplica a ventas de una agencia o freelance');
  r := t222.elegir(m, 'admin', 'pvp', null, false, 's4-clave-0006');
  perform t216.afirma('S4.7 una venta B2C sí deja constancia de PVP (sin aliado)', r ~ '^\d+$'
    and (select modalidad = 'pvp' and aliado_id is null and tipo_asesor = 'interno' from public.cotizacion_neto where cotizacion_id = r::bigint), r);

  m := t222.madre(t216.u('admin'), null, 'agencia', t222.vec('V1')->'entrada');
  perform t216.rechaza('S4.8 una venta B2B sin aliado del catálogo no se sella (NETO)', t222.elegir(m, 'admin', 'neto', true, false, 's4-clave-0007'), 'necesita la agencia o freelance');
  -- Q-5: PVP sin aliado del catálogo se sigue permitiendo (comportamiento de hoy): la hija nace legada, SIN sello.
  r := t222.elegir(m, 'admin', 'pvp', null, false, 's4-clave-0008');
  perform t216.afirma('S4.9 una venta B2B sin aliado del catálogo SÍ puede ir en PVP, sin sello', r ~ '^\d+$'
    and not exists (select 1 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  perform t216.afirma('S4.9b el reintento con la misma clave devuelve la misma hija (PVP sin sello)',
    t222.elegir(m, 'admin', 'pvp', null, false, 's4-clave-0008') = r, r);
  perform t216.rechaza('S4.9c con la clave ya usada, cambiar a NETO es otro dato', t222.elegir(m, 'admin', 'neto', true, false, 's4-clave-0008'), 'COMPARATIVA_CLAVE');

  m := t211.madre_carrito(t216.u('admin'), null);
  perform t216.rechaza('S4.10 la comparativa de carrito no admite modalidad',
    t222.elegir(m, 'admin', 'pvp', null, false, 's4-clave-0009', false, 'A', 'interno', 'doble'), 'comparativa manual');

  -- S5 · solicitud confirmada por el equipo (resolver con modalidad) y por la firma anterior.
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t216.escalar('service_role', null, format(
    'select (public.registrar_solicitud_comparativa(%s, ''A'', ''unica'', 1, ''Ana Prueba'', ''3101112233'', ''ana@x.test'', null, ''sol-clave-0001'', null))->>''id''', m));
  perform t216.afirma('S5.1 solicitud registrada', r ~ '^\d+$', r);
  k := r::int;
  perform t216.rechaza('S5.2 venta no confirma en NETO', t216.escalar('authenticated', t216.u('ventaA'), format(
    'select public.resolver_solicitud_comparativa_n50(%s, ''confirmar'', null, ''res-clave-0001'', ''neto'', true, false)::text', k)), 'tu rol no puede fijar el precio NETO');
  perform t216.afirma('S5.2b la solicitud sigue pendiente', (select estado from public.cotizacion_comparativa_solicitudes where id = k) = 'pendiente');
  r := t216.escalar('authenticated', t216.u('admin'), format(
    'select public.resolver_solicitud_comparativa_n50(%s, ''confirmar'', null, ''res-clave-0001'', ''neto'', true, false)::text', k));
  perform t216.afirma('S5.3 confirmar con NETO crea la hija sellada', r ~ '^\d+$'
    and (select modalidad = 'neto' and neto_total = 8850000 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  h2 := r;
  r := t216.escalar('authenticated', t216.u('admin'), format(
    'select public.resolver_solicitud_comparativa_n50(%s, ''confirmar'', null, ''res-clave-0001'', ''neto'', true, false)::text', k));
  perform t216.afirma('S5.4 reintento idéntico: la misma hija', r = h2, r);
  perform t216.rechaza('S5.5 reintento con otra modalidad: falla cerrado', t216.escalar('authenticated', t216.u('admin'), format(
    'select public.resolver_solicitud_comparativa_n50(%s, ''confirmar'', null, ''res-clave-0001'', ''pvp'', null, false)::text', k)), 'la clave ya se usó');
  perform t216.afirma('S5.6 una sola hija para la madre', (select count(*) from public.cotizaciones where cotizacion_origen_id = m) = 1);

  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t216.escalar('service_role', null, format(
    'select (public.registrar_solicitud_comparativa(%s, ''A'', ''unica'', 1, ''Beto Prueba'', ''3102223344'', ''beto@x.test'', null, ''sol-clave-0002'', null))->>''id''', m));
  r := t216.escalar('authenticated', t216.u('admin'), format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-clave-0002'')::text', r));
  perform t216.afirma('S5.7 la firma anterior del resolver sigue creando la hija sin sello', r ~ '^\d+$'
    and not exists (select 1 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  perform t216.rechaza('S5.8 anon no resuelve', t216.intenta('anon', null, 'select public.resolver_solicitud_comparativa_n50(1, ''confirmar'', null, ''x'', null, null, false)'), 'permission denied');
  perform t216.rechaza('S5.9 service_role tampoco (identidad = sesión)', t216.intenta('service_role', null, 'select public.resolver_solicitud_comparativa_n50(1, ''confirmar'', null, ''x'', null, null, false)'), 'permission denied');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- M3/M4. Rechazos y autorizaciones del margen al sellar'
do $$
declare
  r text; h bigint; n public.cotizacion_neto; m bigint; ev int;
begin
  -- M3 · descuento 0, costo cero y NETO bajo el costo: rechazo sin excepción.
  r := t222.elegir(t222.madre(t216.u('admin'), 922204, 'agencia', t222.vec('V5b')->'entrada'), 'super', 'neto', false, true, 'm3-clave-0001');
  perform t216.rechaza('M3.1 descuento 0 por porcentaje 0: no hay NETO (ni con superadmin)', r, 'con descuento 0 no hay precio NETO');
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V5a')->'entrada'), 'super', 'neto', true, true, 'm3-clave-0002');
  perform t216.rechaza('M3.2 descuento 0 de solo tiquetes sin recobro: no hay NETO', r, 'con descuento 0 no hay precio NETO');
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V8')->'entrada'), 'super', 'neto', true, true, 'm3-clave-0003');
  perform t216.rechaza('M3.3 costo total 0: rechazo sin excepción (superadmin con autorización)', r, 'el costo total de la cotización es 0');
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V3b')->'entrada'), 'super', 'neto', true, true, 'm3-clave-0004');
  perform t216.rechaza('M3.4 NETO bajo el costo: rechazo sin excepción (superadmin con autorización)', r, 'por debajo del costo total');
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V3b')->'entrada'), 'admin', 'neto', true, true, 'm3-clave-0005');
  perform t216.rechaza('M3.5 NETO bajo el costo: tampoco administración', r, 'por debajo del costo total');
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V8')->'entrada');
  r := t222.elegir(m, 'super', 'neto', true, true, 'm3-clave-0006');
  perform t216.afirma('M3.6 tras un rechazo no hay hija ni sello', not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m)
    and not exists (select 1 from public.cotizacion_neto where cotizacion_id in (select id from public.cotizaciones where cotizacion_origen_id = m)));

  -- M4 · margen bajo el 6 %: V2 (5,65 %).
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V2')->'entrada');
  perform t216.rechaza('M4.1 sin autorización se rechaza (administración)', t222.elegir(m, 'admin', 'neto', true, false, 'm4-clave-0001'), 'no cubre el margen mínimo');
  perform t216.rechaza('M4.2 gerencia no autoriza', t222.elegir(m, 'gerencia', 'neto', true, true, 'm4-clave-0002'), 'tu rol no puede autorizar');
  perform t216.rechaza('M4.3 operaciones no autoriza', t222.elegir(m, 'oper', 'neto', true, true, 'm4-clave-0003'), 'tu rol no puede autorizar');
  r := t222.elegir(m, 'admin', 'neto', true, true, 'm4-clave-0004');
  perform t216.afirma('M4.4 administración con autorización: se crea', r ~ '^\d+$', r);
  select * into n from public.cotizacion_neto where cotizacion_id = r::bigint;
  perform t216.afirma('M4.5 la excepción queda registrada: quién, rol, cuándo, margen y piso',
    n.autorizado_por = t216.u('admin') and n.autorizado_rol = 'administracion' and n.autorizado_en is not null
    and n.margen = 0.056497 and n.piso = 0.06 and n.costo_total = 8350000 and n.neto_total = 8850000, to_jsonb(n)::text);
  -- Una autorización que no hacía falta NO se registra.
  h := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'm4-clave-0005', true);
  perform t216.afirma('M4.6 autorizar sin necesitarlo no deja excepción registrada',
    (select autorizado_por is null and autorizado_rol is null from public.cotizacion_neto where cotizacion_id = h));
  -- Igual al costo: pasa solo con autorización.
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V3')->'entrada'), 'admin', 'neto', true, false, 'm4-clave-0006');
  perform t216.rechaza('M4.7 NETO igual al costo sin autorización se rechaza', r, 'no cubre el margen mínimo');
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V3')->'entrada'), 'super', 'neto', true, true, 'm4-clave-0007');
  perform t216.afirma('M4.8 NETO igual al costo con superadmin autorizando: pasa con margen 0', r ~ '^\d+$'
    and (select margen = 0 and autorizado_rol = 'superadmin' from public.cotizacion_neto where cotizacion_id = r::bigint), r);

  -- M5 · solo tiquetes: 2 % EXACTO, solo superadmin autoriza.
  r := t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V4')->'entrada'), 'oper', 'neto', true, false, 'm5-clave-0001');
  perform t216.afirma('M5.1 en el límite exacto del 2 % pasa sin autorización', r ~ '^\d+$'
    and (select solo_tiquetes and piso = 0.02 and neto_total = 2050000 and descuento_total = 50000 and base_comision = 0 and comision_ordinaria = 0
           from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V4b')->'entrada');
  perform t216.rechaza('M5.2 un centavo bajo el 2 % se rechaza sin autorización', t222.elegir(m, 'oper', 'neto', true, false, 'm5-clave-0002'), 'no cubre el margen mínimo');
  perform t216.rechaza('M5.3 administración NO autoriza el 2 %', t222.elegir(m, 'admin', 'neto', true, true, 'm5-clave-0003'), 'tu rol no puede autorizar');
  r := t222.elegir(m, 'super', 'neto', true, true, 'm5-clave-0004');
  perform t216.afirma('M5.4 superadmin autoriza el 2 %', r ~ '^\d+$'
    and (select autorizado_rol = 'superadmin' and piso = 0.02 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  perform t216.rechaza('M5.5 un peso bajo el 2 % también exige superadmin', t222.elegir(t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V4c')->'entrada'), 'admin', 'neto', true, true, 'm5-clave-0005'), 'tu rol no puede autorizar');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- R. Reparto del snapshot y sello'
do $$
declare h bigint; filas numeric[]; n public.cotizacion_neto; hl bigint;
begin
  h := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'r-clave-0001');
  select array_agg(neto order by orden) into filas from public.cotizacion_neto_componentes where cotizacion_id = h;
  perform t216.afirma('R2.1 NETO por fila: aéreo 2.000.000, hotel 5.280.000, traslado 880.000, asistencia 440.000', filas = array[2000000, 5280000, 880000, 440000]::numeric[], filas::text);
  select array_agg(descuento order by orden) into filas from public.cotizacion_neto_componentes where cotizacion_id = h;
  perform t216.afirma('R2.2 descuento por fila: el tiquete no se toca', filas = array[0, 720000, 120000, 60000]::numeric[], filas::text);
  perform t216.afirma('R2.3 el PVP por fila sigue igual al de los servicios',
    (select count(*) from p39_priv.componentes_manual(h) m join public.cotizacion_neto_componentes c on c.cotizacion_id = h and c.orden = m.orden where c.pvp = m.valor_componente) = 4);
  perform t216.afirma('R2.4 el exigido del snapshot NETO es 3.980.000 (a PVP serían 4.250.000)',
    t222.exigido_snap(t222.snap_neto(h)) = 3980000 and (select sum(round(m.valor_componente * 0.3, 2)) from p39_priv.componentes_manual(h) m) <> 3980000);
  -- Sin reconocer la participación: el recobro entra a la base.
  h := t222.hija_de('V1', 922201, 'agencia', 'neto', false, 'admin', 'r-clave-0002');
  select * into n from public.cotizacion_neto where cotizacion_id = h;
  perform t216.afirma('R3.1 sin reconocer: base 8.000.000, ordinaria 960.000, participación 0, NETO 9.040.000',
    n.base_comision = 8000000 and n.comision_ordinaria = 960000 and n.participacion_recobro = 0 and n.descuento_total = 960000 and n.neto_total = 9040000
    and not n.reconoce_recobro, to_jsonb(n)::text);
  perform t216.afirma('R3.2 sin reconocer el payload también se sella en 0 (nada de comisión pendiente de recobro)',
    (select (payload->>'recobroAliado')::numeric from public.cotizaciones where id = h) = 0);
  -- Niños: entran a la base y reparten el descuento con el hotel.
  h := t222.hija_de('V9', 922203, 'agencia', 'neto', true, 'admin', 'r-clave-0003');
  select * into n from public.cotizacion_neto where cotizacion_id = h;
  perform t216.afirma('R4.1 V9 niños: base 4.600.000, ordinaria 460.000, NETO 4.140.000, hotel con 400.000 de descuento',
    n.base_comision = 4600000 and n.comision_ordinaria = 460000 and n.neto_total = 4140000 and n.ninos_total = 600000
    and (select descuento from public.cotizacion_neto_componentes where cotizacion_id = h and orden = 0) = 400000, to_jsonb(n)::text);
  -- Mayor resto (V10): el centavo cae en la última fila.
  h := t222.hija_de('V10', 922203, 'agencia', 'neto', true, 'admin', 'r-clave-0004');
  select array_agg(descuento order by orden) into filas from public.cotizacion_neto_componentes where cotizacion_id = h;
  perform t216.afirma('R5.1 V10 mayor resto: 3.333,33 / 3.333,33 / 3.333,34', filas = array[3333.33, 3333.33, 3333.34]::numeric[], filas::text);
  -- Porcentaje: el del aliado; sin él, el parámetro de su tipo o el 11 % de freelance.
  hl := t222.hija_de('V1', 922202, 'freelance', 'neto', true, 'admin', 'r-clave-0005');
  perform t216.afirma('R6.1 freelance sin % propio: parámetro COMISION_FREELANCE o 11 %',
    (select pct_comision from public.cotizacion_neto where cotizacion_id = hl)
      = round(coalesce((select valor from public.parametros_tributarios where parametro = 'COMISION_FREELANCE'), 0.11), 4));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- P. Pago NETO'
do $$
declare
  hp bigint; hq bigint; r text; h0 jsonb; h1 jsonb; c public.cotizaciones; pid bigint; pid2 text; nc int; hh bigint;
  snap jsonb;
begin
  hp := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'p-clave-0001');
  snap := t222.snap_neto(hp);
  h0 := t216.huella_dinero(hp);
  r := t216.escalar('service_role', null, t216.pago_sql(hp, 'admin', 1000000, 'p1-a'));
  perform t216.rechaza('P1.1 un snapshot a PVP no sirve en una hija NETO', r, 'NETO: las condiciones enviadas');
  r := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 1000000, 'p1-b', snap, 'COP', 1, 8850001));
  perform t216.rechaza('P1.2 un exigido mayor que el NETO se rechaza', r, 'no es coherente con el precio NETO');
  r := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 1000000, 'p1-c', snap, 'COP', 1, 3980001));
  perform t216.rechaza('P1.3 un exigido que no suma el snapshot se rechaza', r, 'no es coherente con el precio NETO');
  r := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 8850001, 'p1-d', snap));
  perform t216.rechaza('P1.4 el primer pago no puede exceder el total NETO', r, 'excede el total NETO');
  r := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 1000000, 'p1-e', snap, 'COP', 1, null, t216.rev(hp) - 1));
  perform t216.rechaza('P1.5 una revisión vieja se rechaza como siempre', r, 'PAGO_39_REVISION');
  r := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 1000000, 'p1-f',
        (select jsonb_agg(case when (e->>'orden')::int = 1 then jsonb_set(e, '{valor_componente}', '6000000') else e end) from jsonb_array_elements(snap) e)));
  perform t216.rechaza('P1.6 un valor de componente que no es el NETO sellado se rechaza', r, 'NETO: las condiciones enviadas');
  h1 := t216.huella_dinero(hp);
  perform t216.afirma('P1.7 ningún rechazo escribió nada (huella de dinero idéntica)', h0 = h1, t216.dif_huella(h0, h1));

  pid := t222.pagar_neto(hp, 3980000, 'p1-ok');
  select * into c from public.cotizaciones where id = hp;
  perform t216.afirma('P2.1 el primer pago congela el NETO: total congelado 8.850.000 y exigido 3.980.000; el PVP no cambia',
    c.precio_total_congelado = 8850000 and c.monto_exigido_total = 3980000 and c.monto_exigido_total_cop = 3980000
    and c.moneda_congelada = 'COP' and c.condicion_pago_congelada_en is not null and c.precio_venta = 10000000,
    format('%s / %s / %s / %s', c.precio_total_congelado, c.monto_exigido_total, c.monto_exigido_total_cop, c.precio_venta));
  select count(*) into nc from public.cotizacion_condiciones where cotizacion_id = hp
     and valor_componente = (select neto from public.cotizacion_neto_componentes x where x.cotizacion_id = hp and x.orden = cotizacion_condiciones.orden);
  perform t216.afirma('P2.2 las 4 condiciones congeladas llevan el valor NETO de su fila', nc = 4, nc::text);
  h0 := t216.huella_dinero(hp);
  pid2 := t216.escalar('service_role', null, t222.pago_sql(hp, 'admin', 3980000, 'p1-ok', snap));
  perform t216.afirma('P2.3 el reintento con la misma clave devuelve el mismo pago', pid2 = 'OK|' || pid, pid2);
  h1 := t216.huella_dinero(hp);
  perform t216.afirma('P2.4 y no escribe nada', h0 = h1, t216.dif_huella(h0, h1));
  r := t216.escalar('service_role', null, t216.pago_sql(hp, 'admin', 4870001, 'p2-sobre'));
  perform t216.rechaza('P3.1 el segundo pago se topa contra el NETO (no contra el PVP)', r, 'Sobrepago rechazado');
  r := t216.escalar('service_role', null, t216.pago_sql(hp, 'admin', 4870000, 'p2-ok'));
  perform t216.afirma('P3.2 el resto hasta el NETO sí se acepta', r ~ '^OK\|\d+$', r);
  perform t216.afirma('P3.3 el total pagado es exactamente el NETO', (select sum(monto_cop) from public.cotizacion_pagos_previos where cotizacion_id = hp and estado = 'activo') = 8850000);
  r := t216.escalar('service_role', null, t216.pago_sql(hp, 'admin', 1, 'p2-uno-mas'));
  perform t216.rechaza('P3.4 ni un peso más', r, 'Sobrepago rechazado');

  -- USD con decimales (V11): NETO 1.956,50 USD; TRM 4.000.
  hh := t222.hija_de('V11', 922201, 'agencia', 'neto', true, 'admin', 'p-clave-usd1', false, false, 'USD');
  perform t216.afirma('P4.1 USD: sello con decimales (D 244,00; NETO 1.956,50; moneda USD)',
    (select neto_total = 1956.50 and descuento_total = 244.00 and moneda = 'USD' and costo_total = 1730.25 from public.cotizacion_neto where cotizacion_id = hh));
  r := t216.escalar('service_role', null, t222.pago_sql(hh, 'admin', 1956.51, 'usd-sobre', t222.snap_neto(hh), 'USD', 4000));
  perform t216.rechaza('P4.2 USD: un centavo más que el NETO se rechaza', r, 'excede el total NETO');
  pid := t222.pagar_neto(hh, 848.96, 'usd-1', 'USD', 4000);
  select * into c from public.cotizaciones where id = hh;
  perform t216.afirma('P4.3 USD: congelado 1.956,50 USD; exigido 848,96 USD = 3.395.840 COP',
    c.precio_total_congelado = 1956.50 and c.monto_exigido_total = 848.96 and c.monto_exigido_total_cop = 3395840 and c.moneda_congelada = 'USD' and c.trm_autoritativa = 4000,
    format('%s / %s / %s', c.precio_total_congelado, c.monto_exigido_total, c.monto_exigido_total_cop));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- C. Conversión NETO y su gemelo PVP'
do $$
declare
  hp bigint; ht bigint; num text; v public.ventas; b public.aliados_b2b; d0 bigint; nb int; sumi numeric; pvp_h bigint; numt text;
  cxp_n int; cxp_p int; asi_n int; asi_p int; suma_n numeric; suma_p numeric;
begin
  hp := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'c-clave-0001');
  perform t222.pagar_neto(hp, 3980000, 'c-p1');
  perform t216.escalar('service_role', null, t216.pago_sql(hp, 'admin', 4870000, 'c-p2'));
  d0 := t216.ultimo_dtm();
  num := t216.escalar('service_role', null, t216.convertir_sql(hp));
  perform t216.afirma('C1.1 convertir por el wrapper devuelve el contrato y consume UN consecutivo', num ~ '^DTM-\d{4,}$' and t216.ultimo_dtm() = d0 + 1, num);
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('C1.2 forma NETO de la venta: precio = total exigible; descuento; estado descontada; modo neta',
    v.precio_venta = 8850000 and v.comision_b2b = 1150000 and v.comision_estado = 'descontada' and v.modo_compra = 'neta'
    and v.cotizacion_id = hp and v.moneda = 'COP' and v.canal = 'B2B', to_jsonb(v)::text);
  perform t216.afirma('C1.3 identidad B2B en la venta: aliado, tipo y nombre del catálogo',
    v.aliado_id = 922201 and v.tipo_asesor = 'agencia' and v.agencia_nombre = 'C222 Agencia', to_jsonb(v)::text);
  perform t216.afirma('C1.4 el recobro es todo de la empresa: la participación va dentro del descuento (ni fila ni comisión pendiente)',
    v.recobro_total = 500000 and v.recobro_aliado = 0 and v.recobro_empresa = 500000, to_jsonb(v)::text);
  select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) into sumi from public.contrato_items where numero_contrato = num;
  perform t216.afirma('C1.5 los items siguen a PVP (suman 10.000.000; el documento oculta los valores por item)', sumi = 10000000, sumi::text);
  select count(*) into nb from public.aliados_b2b where numero_contrato = num;
  perform t216.afirma('C1.6 UNA sola fila de aliados_b2b', nb = 1, nb::text);
  select * into b from public.aliados_b2b where numero_contrato = num;
  perform t216.afirma('C1.7 la fila es la descontada: pagada, descontada_en_precio, sin retención, valor = descuento, sin recobro aparte',
    b.estado = 'pagada' and b.descontada_en_precio and b.aplica_retencion = false and b.pct_retencion = 0 and b.comision_valor = 1150000
    and b.recobro_total = 0 and b.aliado_id = 922201 and b.tipo_aliado = 'agencia' and b.precio_venta = 10000000
    and b.base_comision = 7500000 and b.base_explicita and b.pct_comision = 0.12, to_jsonb(b)::text);
  perform t216.afirma('C1.8 el total de la comisión que leen los módulos es EXACTAMENTE el descuento', public.comision_b2b_total(b) = 1150000, public.comision_b2b_total(b)::text);
  perform t216.afirma('C1.9 y está reconocida como descontada (sin saldo por pagar)', public.comision_b2b_descontada(b));
  perform t216.afirma('C1.10 abonos: 2 pagos trasladados que suman el NETO; saldo 0',
    (select count(*) from public.abonos where numero_contrato = num) = 2 and (select sum(valor_abono) from public.abonos where numero_contrato = num) = 8850000
    and v.precio_venta - (select sum(valor_abono) from public.abonos where numero_contrato = num) = 0);
  perform t216.afirma('C1.11 la cotización queda convertida con el NETO congelado',
    (select estado = 'convertida' and numero_contrato = num and precio_total_congelado = 8850000 and precio_venta = 10000000 from public.cotizaciones where id = hp));
  perform t216.afirma('C1.12 las condiciones del contrato son las NETO (valor y exigido)',
    (select count(*) = 4 and sum(monto_exigido) = 3980000 and sum(valor_componente) = 8600000 from public.contrato_condiciones where numero_contrato = num));
  select count(*), coalesce(sum(valor_total), 0) into cxp_n, suma_n from public.cuentas_por_pagar where numero_contrato = num;
  select count(*) into asi_n from public.asientos_contables a where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = num);
  perform t216.afirma('C1.13 CxP de proveedores: 4 cuentas por 8.250.000 (el descuento no es costo), cada una con su asiento', cxp_n = 4 and suma_n = 8250000 and asi_n = 4, format('%s/%s/%s', cxp_n, suma_n, asi_n));
  perform t216.afirma('C1.14 no hay ningún pago, retención ni abono de comisión por el descuento',
    not exists (select 1 from public.comision_b2b_pagos p join public.aliados_b2b x on x.id = p.aliado_b2b_id where x.numero_contrato = num));

  -- Gemelo PVP (mismo vector, sellado PVP): mismos costos y asientos; sin forma NETO.
  pvp_h := t222.hija_de('V1', 922201, 'agencia', 'pvp', null, 'admin', 'c-clave-0002');
  perform t216.pagar(pvp_h, t216.exigido(pvp_h), 'c-pvp-1');
  numt := t216.escalar('service_role', null, t216.convertir_sql(pvp_h));
  perform t216.afirma('C2.1 el gemelo PVP convierte', numt ~ '^DTM-\d{4,}$', numt);
  select * into v from public.ventas where numero_contrato = numt;
  perform t216.afirma('C2.2 PVP: precio = PVP, sin modalidad NETO, recobro del aliado como siempre',
    v.precio_venta = 10000000 and v.modo_compra is null and v.comision_estado = 'pendiente' and v.comision_b2b = 250000
    and v.recobro_aliado = 250000 and v.recobro_empresa = 250000, to_jsonb(v)::text);
  perform t216.afirma('C2.3 PVP: identidad B2B completa también (venta y fila de recobro)',
    v.aliado_id = 922201 and v.tipo_asesor = 'agencia' and v.agencia_nombre = 'C222 Agencia'
    and (select count(*) = 1 and bool_and(aliado_id = 922201 and estado = 'pendiente' and not descontada_en_precio) from public.aliados_b2b where numero_contrato = numt));
  select count(*), coalesce(sum(valor_total), 0) into cxp_p, suma_p from public.cuentas_por_pagar where numero_contrato = numt;
  select count(*) into asi_p from public.asientos_contables a where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = numt);
  perform t216.afirma('C2.4 NETO y PVP generan las mismas CxP y asientos de costo', cxp_n = cxp_p and suma_n = suma_p and asi_n = asi_p);

  -- USD (V11): se convierte con el NETO en dólares.
  ht := t222.hija_de('V11', 922201, 'agencia', 'neto', true, 'admin', 'c-clave-usd', false, false, 'USD');
  perform t222.pagar_neto(ht, 848.96, 'c-usd-1', 'USD', 4000);
  num := t216.escalar('service_role', null, t216.convertir_sql(ht));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('C3.1 USD: venta NETO en dólares (1.956,50; descuento 244,00; moneda USD)',
    num ~ '^DTM-' and v.precio_venta = 1956.50 and v.comision_b2b = 244.00 and v.moneda = 'USD' and v.comision_estado = 'descontada', coalesce(num, ''));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- I. Identidad B2B (PVP, NETO y legadas)'
do $$
declare
  hl bigint; hn bigint; num text; v public.ventas; r text; hc bigint;
begin
  -- Legada abierta de una venta B2B con aliado (firma anterior, sin sello): D-5, el aliado se propaga al convertir.
  hl := t222.hija_de('V1', 922201, 'agencia', null, null, 'admin', 'i-clave-0001', false, true);
  perform t216.pagar(hl, t216.exigido(hl), 'i-pvp-1');
  num := t216.escalar('service_role', null, t216.convertir_sql(hl));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('I1.1 legada con aliado: se propagan aliado, tipo y nombre; precio y recobro como siempre',
    v.aliado_id = 922201 and v.tipo_asesor = 'agencia' and v.agencia_nombre = 'C222 Agencia' and v.precio_venta = 10000000 and v.modo_compra is null
    and v.comision_b2b = 250000 and v.comision_estado = 'pendiente', to_jsonb(v)::text);
  perform t216.afirma('I1.2 la fila de recobro de la legada queda enlazada al aliado',
    (select count(*) = 1 and bool_and(aliado_id = 922201) from public.aliados_b2b where numero_contrato = num));
  -- Legada B2B SIN aliado en el catálogo: se mantiene el comportamiento actual (Q-4).
  hl := t222.hija_de('V1', null, 'agencia', null, null, 'admin', 'i-clave-0002', false, true);
  perform t216.pagar(hl, t216.exigido(hl), 'i-pvp-2');
  num := t216.escalar('service_role', null, t216.convertir_sql(hl));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('I2.1 legada sin aliado: convierte como siempre (sin aliado_id, sin error)',
    num ~ '^DTM-' and v.aliado_id is null and v.tipo_asesor is null and v.precio_venta = 10000000, coalesce(num, ''));
  -- B2C legada y B2C sellada: nada que propagar.
  hl := t222.hija_de('V1', null, 'interno', null, null, 'admin', 'i-clave-0003', false, true);
  perform t216.pagar(hl, t216.exigido(hl), 'i-pvp-3');
  num := t216.escalar('service_role', null, t216.convertir_sql(hl));
  perform t216.afirma('I3.1 B2C legada convierte como siempre', num ~ '^DTM-' and (select aliado_id is null and canal = 'B2C' from public.ventas where numero_contrato = num), coalesce(num, ''));
  hc := t222.hija_de('V1', null, 'interno', 'pvp', null, 'admin', 'i-clave-0004');
  perform t216.pagar(hc, t216.exigido(hc), 'i-pvp-4');
  num := t216.escalar('service_role', null, t216.convertir_sql(hc));
  perform t216.afirma('I3.2 B2C sellada en PVP convierte como siempre', num ~ '^DTM-' and (select aliado_id is null and precio_venta = 10000000 from public.ventas where numero_contrato = num), coalesce(num, ''));

  -- Freelance sellado en NETO: tipo y nombre del catálogo.
  hn := t222.hija_de('V1', 922202, 'freelance', 'neto', true, 'admin', 'i-clave-0005');
  perform t222.pagar_neto(hn, (select t222.exigido_snap(t222.snap_neto(hn))), 'i-neto-1');
  perform t216.escalar('service_role', null, t216.pago_sql(hn, 'admin', (select neto_total from public.cotizacion_neto where cotizacion_id = hn) - t222.exigido_snap(t222.snap_neto(hn)), 'i-neto-2'));
  num := t216.escalar('service_role', null, t216.convertir_sql(hn));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('I4.1 freelance NETO: tipo_asesor, nombre y aliado del catálogo; estado descontada',
    v.aliado_id = 922202 and v.tipo_asesor = 'freelance' and v.freelance_nombre = 'C222 Freelance' and v.comision_estado = 'descontada'
    and (select tipo_aliado = 'freelance' and aliado = 'C222 Freelance' and nit = '922202' from public.aliados_b2b where numero_contrato = num), to_jsonb(v)::text);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- D. Consecutivo DTM y atomicidad'
do $$
declare
  ht bigint; h0 jsonb; h1 jsonb; d0 bigint; r text; hz bigint; hu bigint;
begin
  -- D1 · aliado alterado después de sellar: rechazo ANTES de numerar.
  ht := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'd-clave-0001');
  perform t222.pagar_neto(ht, 3980000, 'd-p1');
  update public.cotizaciones set aliado_id = 922203 where id = ht;
  h0 := t216.huella_dinero(ht); d0 := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, t216.convertir_sql(ht));
  perform t216.rechaza('D1.1 aliado distinto del sellado: rechazo', r, 'el aliado de la cotización no coincide');
  h1 := t216.huella_dinero(ht);
  perform t216.afirma('D1.2 sin escrituras ni consecutivo consumido (rechazo nuevo antes de la 198)', h0 = h1 and t216.ultimo_dtm() = d0, t216.dif_huella(h0, h1));
  update public.cotizaciones set aliado_id = 922201 where id = ht;

  -- D2 · servicios alterados (costos) después de sellar: el sello ya no coincide.
  update public.cotizacion_servicios set costo_neto = costo_neto + 1 where cotizacion_id = ht and tipo_servicio = 'hotel';
  h0 := t216.huella_dinero(ht); d0 := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, t216.convertir_sql(ht));
  perform t216.rechaza('D2.1 costos alterados: «no coincide con el precio NETO fijado»', r, 'no coincide con el precio NETO fijado');
  h1 := t216.huella_dinero(ht);
  perform t216.afirma('D2.2 sin escrituras ni consecutivo', h0 = h1 and t216.ultimo_dtm() = d0, t216.dif_huella(h0, h1));
  update public.cotizacion_servicios set costo_neto = costo_neto - 1 where cotizacion_id = ht and tipo_servicio = 'hotel';

  -- D3 · total congelado que no es el NETO.
  update public.cotizaciones set precio_total_congelado = 10000000 where id = ht;
  h0 := t216.huella_dinero(ht); d0 := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, t216.convertir_sql(ht));
  perform t216.rechaza('D3.1 congelado distinto del NETO: rechazo', r, 'el total congelado de la cotización no es el precio NETO');
  perform t216.afirma('D3.2 sin consecutivo consumido', t216.ultimo_dtm() = d0);
  update public.cotizaciones set precio_total_congelado = 8850000 where id = ht;

  -- D4 · la 198 DIRECTO sobre la NETO congelada y pagada: la frontera de #39 la rechaza (G1: hueco DTM documentado).
  perform t216.escalar('service_role', null, t216.pago_sql(ht, 'admin', 4870000, 'd-p2'));
  h0 := t216.huella_dinero(ht); d0 := t216.ultimo_dtm();
  r := t216.intenta('service_role', null, format('select public.convertir_cotizacion_a_contrato(%s, %L)', ht, t216.u('admin')));
  perform t216.rechaza('D4.1 la 198 directo sobre una hija NETO se rechaza', r, 'FRONTERA_39');
  h1 := t216.huella_dinero(ht);
  perform t216.afirma('D4.2 no deja venta, abonos ni cambios', h0 = h1, t216.dif_huella(h0, h1));
  perform t216.afirma('D4.3 consume UN consecutivo (hueco documentado, nunca un contrato mal interpretado)', t216.ultimo_dtm() = d0 + 1, (t216.ultimo_dtm() - d0)::text);

  -- D5 · la 198 directo sobre una NETO SIN congelar falla antes de numerar: sin hueco.
  hz := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'd-clave-0002');
  d0 := t216.ultimo_dtm();
  r := t216.intenta('service_role', null, format('select public.convertir_cotizacion_a_contrato(%s, %L)', hz, t216.u('admin')));
  perform t216.rechaza('D5.1 sin congelar: «no está congelada»', r, 'no está congelada');
  perform t216.afirma('D5.2 y no consume consecutivo', t216.ultimo_dtm() = d0);
  r := t216.escalar('service_role', null, t216.convertir_sql(hz));
  perform t216.rechaza('D5.3 por el wrapper, sin congelar, también se rechaza antes de numerar', r, 'el total congelado');
  perform t216.afirma('D5.4 sin consecutivo', t216.ultimo_dtm() = d0);

  -- D6 · fallo imprevisto DESPUÉS de la 198: todo se revierte (queda el consecutivo gastado: hueco documentado).
  create trigger t222_falla_b2b before insert on public.aliados_b2b
    for each row execute function t222.falla();
  h0 := t216.huella_dinero(ht); d0 := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, t216.convertir_sql(ht));
  perform t216.rechaza('D6.1 fallo inyectado tras la 198: se rechaza', r, 'falla inyectada');
  h1 := t216.huella_dinero(ht);
  perform t216.afirma('D6.2 rollback total: sin venta, abonos, CxP ni asientos; la cotización sigue abierta', h0 = h1
    and (select estado from public.cotizaciones where id = ht) = 'abierta', t216.dif_huella(h0, h1));
  perform t216.afirma('D6.3 el consecutivo sí se gasta (documentado)', t216.ultimo_dtm() = d0 + 1, (t216.ultimo_dtm() - d0)::text);
  drop trigger t222_falla_b2b on public.aliados_b2b;
  r := t216.escalar('service_role', null, t216.convertir_sql(ht));
  perform t216.afirma('D6.4 sin el fallo, la misma conversión sale bien', r ~ '^DTM-\d{4,}$', r);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- F. Frontera de #39 intacta'
do $$
declare hp bigint; hv bigint; r text; n int;
begin
  perform t216.afirma('F1.1 la frontera sigue activa', p39_priv.frontera_activa());
  select count(*) into n from pg_catalog.pg_trigger t
   where not t.tgisinternal and t.tgenabled in ('O', 'A') and t.tgname in
     ('trg_cot_frontera_39', 'trg_cot_economico_rev_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39',
      'trg_cot_servicios_rev_39_ins', 'trg_cot_servicios_rev_39_upd', 'trg_cot_servicios_rev_39_del');
  perform t216.afirma('F1.2 los 7 disparadores de frontera, habilitados', n = 7, n::text);
  perform t216.afirma('F1.3 los permisos que mira la frontera no cambiaron',
    not has_table_privilege('service_role', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.cotizacion_condiciones', 'TRUNCATE'));
  perform t216.afirma('F1.4 la 198 conserva su cuerpo (md5 de main)',
    md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), '')) = 'edc9975010746e53e4af6a75ad9763dc');
  hp := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'f-clave-0001');
  r := t216.intenta('service_role', null, t216.editar_sql(hp, 'admin', t216.serv()));
  perform t216.rechaza('F2.1 una hija sellada NO es editable por #39', r, 'EDICION_39_NO_ELEGIBLE');
  hv := t222.hija_de('V1', 922201, 'agencia', 'pvp', null, 'admin', 'f-clave-0002');
  r := t216.intenta('service_role', null, format('update public.cotizaciones set payload = jsonb_set(payload, ''{recobroAliado}'', ''0''::jsonb) where id = %s', hv));
  perform t216.rechaza('F3.1 la API NO puede reescribir el payload de una hija (la frontera 217 lo impide)', r, 'FRONTERA_39');
  perform t216.afirma('F3.2 en cambio la operación de sellado SÍ lo hizo (frontera y tg_cotizaciones_guarda lo admiten en la RPC)',
    (select (payload->>'recobroAliado')::numeric from public.cotizaciones where id = hp) = 0
    and (select (payload->>'recobroAliado')::numeric from public.cotizaciones where id = hv) = 250000);
  r := t216.intenta('service_role', null, format('update public.cotizaciones set precio_total_congelado = 1 where id = %s', hp));
  perform t216.rechaza('F3.3 la API tampoco puede mover el total congelado fuera de un pago autorizado', r, 'FRONTERA_39');
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- A. Permisos y solo inserción'
do $$
declare h bigint; r text; ok boolean; f record;
begin
  h := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'a-clave-0001');
  perform t216.afirma('A1.1 las dos tablas: RLS activo y sin policies',
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('cotizacion_neto', 'cotizacion_neto_componentes') and c.relrowsecurity) = 2
    and not exists (select 1 from pg_policies where tablename in ('cotizacion_neto', 'cotizacion_neto_componentes')));
  perform t216.rechaza('A1.2 anon no lee el sello', t216.intenta('anon', null, 'select * from public.cotizacion_neto'), 'permission denied');
  perform t216.rechaza('A1.3 authenticated (administración) no lee el sello por la API', t216.intenta('authenticated', t216.u('admin'), 'select * from public.cotizacion_neto'), 'permission denied');
  perform t216.rechaza('A1.4 authenticated no lee el reparto', t216.intenta('authenticated', t216.u('admin'), 'select * from public.cotizacion_neto_componentes'), 'permission denied');
  perform t216.acepta('A1.5 service_role sí lee (el servidor arma el panel)', t216.intenta('service_role', null, 'select count(*) from public.cotizacion_neto'));
  perform t216.rechaza('A1.6 service_role no inserta', t216.intenta('service_role', null, format('insert into public.cotizacion_neto select * from public.cotizacion_neto where cotizacion_id = %s', h)), 'permission denied');
  perform t216.rechaza('A1.7 service_role no actualiza', t216.intenta('service_role', null, 'update public.cotizacion_neto set tenant = tenant'), 'permission denied');
  perform t216.rechaza('A1.8 service_role no borra', t216.intenta('service_role', null, 'delete from public.cotizacion_neto'), 'permission denied');
  ok := false;
  begin update public.cotizacion_neto set tenant = tenant where cotizacion_id = h; exception when others then ok := sqlerrm like '%no se modifica ni se borra%'; end;
  perform t216.afirma('A2.1 ni el dueño actualiza el sello (solo inserción)', ok);
  ok := false;
  begin delete from public.cotizacion_neto_componentes where cotizacion_id = h; exception when others then ok := sqlerrm like '%no se modifica ni se borra%'; end;
  perform t216.afirma('A2.2 ni el dueño borra el reparto', ok);
  ok := false;
  begin truncate public.cotizacion_neto_componentes; exception when others then ok := sqlerrm like '%no se modifica ni se borra%'; end;
  perform t216.afirma('A2.3 ni el dueño trunca el reparto', ok);

  perform t216.afirma('A3.1 p50_priv: USAGE solo para service_role', not has_schema_privilege('anon', 'p50_priv', 'USAGE')
    and not has_schema_privilege('authenticated', 'p50_priv', 'USAGE') and has_schema_privilege('service_role', 'p50_priv', 'USAGE'));
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p where p.pronamespace = 'p50_priv'::regnamespace and p.prokind = 'f' loop
    if f.proname in ('composicion_neto_coincide', 'validar_conversion', 'completar_conversion') then
      perform t216.afirma('A3.2 ' || f.firma::text || ' solo para service_role',
        has_function_privilege('service_role', f.firma, 'EXECUTE') and not has_function_privilege('authenticated', f.firma, 'EXECUTE') and not has_function_privilege('anon', f.firma, 'EXECUTE'));
    else
      perform t216.afirma('A3.3 ' || f.firma::text || ' sin acceso para la API',
        not has_function_privilege('service_role', f.firma, 'EXECUTE') and not has_function_privilege('authenticated', f.firma, 'EXECUTE') and not has_function_privilege('anon', f.firma, 'EXECUTE'));
    end if;
  end loop;
  perform t216.afirma('A4.1 registrar_validacion_comparativa_n50: solo service_role',
    has_function_privilege('service_role', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE'));
  perform t216.afirma('A4.2 resolver_solicitud_comparativa_n50: solo authenticated (identidad = sesión)',
    has_function_privilege('authenticated', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE'));
  perform t216.afirma('A4.3 las funciones reemplazadas conservan su ACL (elegir y resolver: authenticated; wrappers: service_role)',
    has_function_privilege('authenticated', 'public.elegir_opcion_comparativa_sesion(uuid,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.elegir_opcion_comparativa_sesion(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.resolver_solicitud_comparativa(bigint,text,text,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.resolver_solicitud_comparativa(bigint,text,text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE'));
  perform t216.afirma('A5.1 los wrappers siguen INVOKER y las funciones nuevas con dueño llevan search_path fijo con pg_temp al final',
    (select not prosecdef from pg_proc where oid = to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)'))
    and (select not prosecdef from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)'))
    and not exists (select 1 from pg_proc p where p.prosecdef and (p.pronamespace = 'p50_priv'::regnamespace
          or p.proname in ('registrar_validacion_comparativa_n50', 'resolver_solicitud_comparativa_n50'))
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%pg_temp')));
  perform t216.afirma('A5.2 ninguna función nueva lee current_setting ni es IMMUTABLE si consulta catálogos',
    not exists (select 1 from pg_proc p where p.pronamespace = 'p50_priv'::regnamespace and p.prosrc ilike '%current_setting%')
    and (select provolatile = 's' from pg_proc where oid = to_regprocedure('p50_priv.calcular(bigint,boolean,numeric,numeric)'))
    and (select provolatile = 'i' from pg_proc where oid = to_regprocedure('p50_priv.repartir(bigint,bigint[])')));
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '--- G. Hijas legadas y B2C: idénticas a antes'
do $$
declare hl bigint; hc bigint; num text; v public.ventas;
begin
  hl := t222.hija_de('V1', 922201, 'agencia', null, null, 'admin', 'g-clave-0001', false, true);
  perform t216.afirma('G1.1 la legada no gana sello ni cambia su payload', not exists (select 1 from public.cotizacion_neto where cotizacion_id = hl)
    and (select (payload->>'recobroAliado')::numeric = 250000 and precio_venta = 10000000 from public.cotizaciones where id = hl));
  perform t216.pagar(hl, t216.exigido(hl), 'g-pvp-1');
  perform t216.afirma('G1.2 el primer pago PVP usa el snapshot PVP de siempre (composición #39)',
    (select precio_total_congelado = 10000000 and monto_exigido_total = t216.exigido(hl) from public.cotizaciones where id = hl));
  num := t216.escalar('service_role', null, t216.convertir_sql(hl));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('G1.3 la conversión PVP de la legada sigue en PVP con su abono',
    v.precio_venta = 10000000 and v.modo_compra is null and (select sum(valor_abono) from public.abonos where numero_contrato = num) = t216.exigido(hl));
  hc := t222.hija_de('V9', null, 'interno', null, null, 'admin', 'g-clave-0002', false, true);
  perform t216.afirma('G2.1 una B2C legada: sin sello', not exists (select 1 from public.cotizacion_neto where cotizacion_id = hc));
end $$;

-- ── Resumen ────────────────────────────────────────────────────────────────
\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, left(detalle, 600) from t216.res where not ok order by nombre;
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from t216.res;
  if f > 0 then raise exception 'test_222_neto_hija: % de % prueba(s) fallaron', f, t; end if;
  raise notice 'TEST 222 SQL: TODO OK (% verificaciones)', t;
end $$;
rollback;
