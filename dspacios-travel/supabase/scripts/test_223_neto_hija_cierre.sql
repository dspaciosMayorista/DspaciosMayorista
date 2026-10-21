-- ═════════════════════════════════════════════════════════════════════════
-- PRUEBAS SQL · #50 (migración 223, cierre, aplicada tras la 222): la modalidad es OBLIGATORIA.
-- SOLO base desechable (CI o local). Corre en UNA transacción y termina en ROLLBACK.
--
--   psql -v ON_ERROR_STOP=1 -f test_223_neto_hija_cierre.sql <base>   (desde supabase/scripts: usa \ir)
--   Exige /tmp/netoHija50.vectores.json.
-- ═════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set vect `cat /tmp/netoHija50.vectores.json`
begin;

\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql

do $$
begin
  if not p50_priv.exigir_modalidad() then
    raise exception 'test_223 exige la 223 aplicada (modalidad obligatoria).';
  end if;
end $$;

\echo '--- O. Modalidad obligatoria en la venta B2B de una comparativa manual'
do $$
declare
  m bigint; r text; k int; hl bigint; num text; v public.ventas; mc bigint;
begin
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  perform t216.rechaza('O1.1 firma anterior (sin modalidad) en una venta B2B: se rechaza',
    t222.elegir(m, 'admin', null, null, false, 'o-clave-0001', true), 'elige la modalidad de la venta B2B');
  perform t216.afirma('O1.1b y no nace ninguna hija', not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m));
  perform t216.rechaza('O1.2 firma nueva con modalidad nula: también se rechaza',
    t222.elegir(m, 'admin', null, null, false, 'o-clave-0002'), 'elige la modalidad de la venta B2B');
  perform t216.afirma('O1.2b sin hija y el recibo no se consumió', not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m)
    and exists (select 1 from public.cotizacion_comparativa_validaciones where cotizacion_id = m and consumida_en is null));
  r := t222.elegir(m, 'ventaA', 'pvp', null, false, 'o-clave-0003');
  perform t216.afirma('O1.3 con PVP explícito (venta incluida) se crea', r ~ '^\d+$', r);
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'admin', 'neto', true, false, 'o-clave-0004');
  perform t216.afirma('O1.4 con NETO explícito se crea', r ~ '^\d+$', r);

  -- Q-5: una venta B2B SIN aliado del catálogo no se queda sin salida con la 223: la modalidad no se exige
  -- (la hija sigue legada, comportamiento de hoy) y PVP se permite; solo NETO necesita el aliado.
  m := t222.madre(t216.u('admin'), null, 'agencia', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'admin', null, null, false, 'o-clave-0005', true);
  perform t216.afirma('O2.1 B2B sin aliado, firma anterior: se crea (legada, sin sello)', r ~ '^\d+$'
    and not exists (select 1 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  m := t222.madre(t216.u('admin'), null, 'agencia', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'admin', 'pvp', null, false, 'o-clave-0006');
  perform t216.afirma('O2.2 B2B sin aliado, PVP: se crea sin sello', r ~ '^\d+$'
    and not exists (select 1 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  m := t222.madre(t216.u('admin'), null, 'agencia', t222.vec('V1')->'entrada');
  perform t216.rechaza('O2.3 B2B sin aliado, NETO: se rechaza (necesita el aliado)', t222.elegir(m, 'admin', 'neto', true, false, 'o-clave-0010'), 'necesita la agencia o freelance');

  -- B2C y carrito siguen como siempre, con la firma anterior.
  m := t222.madre(t216.u('admin'), null, 'interno', t222.vec('V1')->'entrada');
  r := t222.elegir(m, 'admin', null, null, false, 'o-clave-0007', true);
  perform t216.afirma('O3.1 B2C con la firma anterior: sin cambios', r ~ '^\d+$' and not exists (select 1 from public.cotizacion_neto where cotizacion_id = r::bigint), r);
  mc := t211.madre_carrito(t216.u('admin'), null);
  r := t222.elegir(mc, 'admin', null, null, false, 'o-clave-0008', true, 'A', 'interno', 'doble');
  perform t216.afirma('O3.2 comparativa de carrito con la firma anterior: sin cambios', r ~ '^\d+$', r);

  -- Solicitudes: la firma anterior del resolver ya no sirve en B2B; la nueva sí.
  m := t222.madre(t216.u('admin'), 922201, 'agencia', t222.vec('V1')->'entrada');
  r := t216.escalar('service_role', null, format(
    'select (public.registrar_solicitud_comparativa(%s, ''A'', ''unica'', 1, ''Ana Prueba'', ''3101112233'', ''ana@x.test'', null, ''sol-o-0001'', null))->>''id''', m));
  k := r::int;
  perform t216.rechaza('O4.1 resolver con la firma anterior en B2B: se rechaza',
    t216.escalar('authenticated', t216.u('admin'), format('select public.resolver_solicitud_comparativa(%s, ''confirmar'', null, ''res-o-0001'')::text', k)), 'elige la modalidad de la venta B2B');
  perform t216.afirma('O4.1b la solicitud sigue pendiente y no hay hija', (select estado from public.cotizacion_comparativa_solicitudes where id = k) = 'pendiente'
    and not exists (select 1 from public.cotizaciones where cotizacion_origen_id = m));
  r := t216.escalar('authenticated', t216.u('admin'), format('select public.resolver_solicitud_comparativa_n50(%s, ''confirmar'', null, ''res-o-0002'', ''neto'', true, false)::text', k));
  perform t216.afirma('O4.2 resolver con modalidad: se crea la hija NETO', r ~ '^\d+$'
    and (select modalidad = 'neto' from public.cotizacion_neto where cotizacion_id = r::bigint), r);

  -- Una legada abierta (creada ANTES del cierre) sigue siendo convertible, con el aliado propagado.
  update p50_priv.config set exigir_modalidad = false;
  hl := t222.hija_de('V1', 922201, 'agencia', null, null, 'admin', 'o-clave-0009', false, true);
  update p50_priv.config set exigir_modalidad = true;
  perform t216.afirma('O5.1 la legada no tiene sello', not exists (select 1 from public.cotizacion_neto where cotizacion_id = hl));
  perform t216.pagar(hl, t216.exigido(hl), 'o-pvp-1');
  num := t216.escalar('service_role', null, t216.convertir_sql(hl));
  select * into v from public.ventas where numero_contrato = num;
  perform t216.afirma('O5.2 y se convierte en PVP con su aliado propagado (D-5, sin backfill)',
    num ~ '^DTM-\d{4,}$' and v.aliado_id = 922201 and v.tipo_asesor = 'agencia' and v.precio_venta = 10000000 and v.modo_compra is null, to_jsonb(v)::text);
end $$;

\echo '=== RESUMEN ==='
select count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos, count(*) as total from t216.res;
select nombre, left(detalle, 600) from t216.res where not ok order by nombre;
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from t216.res;
  if f > 0 then raise exception 'test_223_neto_hija_cierre: % de % prueba(s) fallaron', f, t; end if;
  raise notice 'TEST 223 SQL: TODO OK (% verificaciones)', t;
end $$;
rollback;
