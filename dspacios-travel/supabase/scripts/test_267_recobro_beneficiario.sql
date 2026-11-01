
-- ═════════════════════════════════════════════════════════════════
-- #65 · Migración 267 (recobro con beneficiario explícito) sobre el ESQUEMA COMPLETO 001-266 + 267. SOLO base desechable.
-- Lo corre test_267_recobro_beneficiario.sh con psql -v ON_ERROR_STOP=1, desde el directorio de los scripts (usa \ir) y con
-- /tmp/netoHija50.vectores.json. Una sola transacción que termina en ROLLBACK. Cada afirmación imprime «OK  nombre» o «FALLO nombre»
-- y queda en t216.res; el runner exige el número EXACTO de OK, cero FALLO y que psql termine sin error.
--
-- La conversión es la REAL de la 198 (convertir_cotizacion_a_contrato por su wrapper) y la ruta sellada de la 222 (PVP y NETO).
-- El trigger de la 267 es DIFERIDO (corre al COMMIT): dentro de esta transacción de prueba se evalúa justo al terminar cada conversión
-- (`set constraints all immediate`), dentro de un sub-bloque, de modo que un fallo deshace esa conversión como lo haría un COMMIT fallido.
-- El comportamiento con COMMIT real lo prueba el runner aparte (base B).
-- ═════════════════════════════════════════════════════════════════
\set vect `cat /tmp/netoHija50.vectores.json`
begin;
\ir test_216_fixtures.sql
\ir test_211_fixtures.sql
\ir test_222_fixtures.sql

\ir test_267_helpers.sql


do $$
declare
  n_ok int; sa text; sb text; n int; num text; cot bigint; h1 jsonb; h2 jsonb; hp bigint; ht bigint; b public.aliados_b2b; v public.ventas;
  tr record; nv_antes bigint;
begin
  -- ── E. El objeto existe como se diseñó ───────────────────────────────────
  select t.tgdeferrable, t.tginitdeferred, t.tgconstraint <> 0 as es_constraint into tr
    from pg_trigger t where t.tgname = 'trg_recobro_beneficiario_explicito' and t.tgrelid = 'public.aliados_b2b'::regclass and not t.tgisinternal;
  perform t216.afirma('E1 el trigger de la 267 existe, es de restricción, diferible y diferido',
    tr.es_constraint is true and tr.tgdeferrable and tr.tginitdeferred);
  perform t216.afirma('E2 la función del trigger no la ejecutan anon ni authenticated',
    not has_function_privilege('anon', 'public.fn_recobro_beneficiario_explicito()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fn_recobro_beneficiario_explicito()', 'EXECUTE'));
  perform t216.afirma('E3 la 198 NO fue reemplazada (su md5 sigue siendo el que verifica la 222)',
    md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), '')) = 'edc9975010746e53e4af6a75ad9763dc');

  -- ── M. Conversión REAL de la 198, manual simple, B2B, SIN aliado_id en la cotización ──
  -- M1: el nombre escrito identifica UNA ficha del tipo → la línea de recobro queda acreditada.
  sa := t267.conv(t267.cot('freelance', 'Free 267'));
  perform t216.afirma('M1.1 conversión real con nombre exacto y único: devuelve el contrato', sa ~ '^DTM-\d{4,}$', sa);
  select * into b from public.aliados_b2b where numero_contrato = sa;
  perform t216.afirma('M1.2 UNA línea de recobro, ya con ficha 925701, nombre y tipo de la ficha',
    (select count(*) from public.aliados_b2b where numero_contrato = sa) = 1
    and b.aliado_id = 925701 and b.aliado = 'Free 267' and b.tipo_aliado = 'freelance', to_jsonb(b)::text);
  perform t216.afirma('M1.3 el recobro no cambia de importe: total 200.000, base 100.000, reparto 50 %, comisión = 100.000',
    b.recobro_total = 200000 and b.base_comision = 100000 and b.pct_recobro_aliado = 0.5 and b.estado = 'pendiente' and public.comision_b2b_total(b) = 100000, to_jsonb(b)::text);
  select * into v from public.ventas where numero_contrato = sa;
  perform t216.afirma('M1.4 el propietario de la venta no cambia: ventas.aliado_id sigue vacío y el asesor es el interno',
    v.aliado_id is null and v.asesor = 'Asesor 216', to_jsonb(v)::text);

  -- M1b: misma conversión con el trigger APAGADO (el comportamiento de antes) → dinero, abonos, CxP y propietario IDÉNTICOS.
  alter table public.aliados_b2b disable trigger trg_recobro_beneficiario_explicito;
  sb := t267.conv(t267.cot('freelance', 'Free 267'));
  alter table public.aliados_b2b enable trigger trg_recobro_beneficiario_explicito;
  h1 := t267.huella(sa); h2 := t267.huella(sb);
  perform t216.afirma('M1.5 con y sin la 267 la huella de dinero, abonos, CxP, comisión y propietario es IDÉNTICA', h1 = h2, h1::text || ' <> ' || h2::text);
  perform t216.afirma('M1.6 sin la 267 la línea quedaba SIN ficha (el defecto que corrige)',
    (select aliado_id is null and aliado = 'Free 267' from public.aliados_b2b where numero_contrato = sb));

  -- M2: PVP sin aliado ni nombre → el nombre cae al asesor interno: debe FALLAR y no dejar nada.
  select count(*) into nv_antes from public.ventas;
  cot := t267.cot('freelance', '');
  sa := t267.conv(cot);
  perform t216.afirma('M2.1 PVP sin aliado: la conversión falla con RECOBRO_SIN_BENEFICIARIO', sa ~ 'RECOBRO_SIN_BENEFICIARIO', sa);
  perform t216.afirma('M2.2 el mensaje es claro: contrato, fila, tipo y qué hacer', sa ~ 'Elige el aliado del catálogo' and sa ~ 'tipo «freelance»', sa);
  perform t216.afirma('M2.3 no se guardó nada: la cotización sigue abierta, sin contrato, sin venta ni líneas de comisión',
    (select estado = 'abierta' and numero_contrato is null from public.cotizaciones where id = cot)
    and (select count(*) from public.ventas where cotizacion_id = cot) = 0 and (select count(*) from public.ventas) = nv_antes);

  -- M3: nombre ambiguo (dos fichas del mismo tipo con ese nombre normalizado) → falla.
  sa := t267.conv(t267.cot('freelance', 'Ambigua 267'));
  perform t216.afirma('M3 nombre ambiguo: falla con RECOBRO_SIN_BENEFICIARIO', sa ~ 'RECOBRO_SIN_BENEFICIARIO', sa);

  -- M4: nombre de una ficha de OTRO tipo (venta de agencia, ficha freelance) → no se acepta por nombre.
  sa := t267.conv(t267.cot('agencia', 'Free 267'));
  perform t216.afirma('M4 el nombre de una ficha de otro tipo no acredita: falla', sa ~ 'RECOBRO_SIN_BENEFICIARIO' and sa ~ 'tipo «agencia»', sa);

  -- ── A. cotizaciones.aliado_id: se acredita contra la cotización DE ORIGEN y el tipo de la venta ──
  sa := t267.conv(t267.cot('freelance', '', 925701));
  select * into b from public.aliados_b2b where numero_contrato = sa;
  perform t216.afirma('A1 aliado explícito en la cotización (nombre vacío, la 198 escribió al asesor interno): gana la ficha, con su nombre y NIT; el asesor interno no queda como aliado',
    sa ~ '^DTM-' and b.aliado_id = 925701 and b.aliado = 'Free 267' and b.nit = '925701' and b.tipo_aliado = 'freelance', coalesce(sa, '') || ' ' || coalesce(to_jsonb(b)::text, ''));

  sa := t267.conv(t267.cot('freelance', '', 922201));   -- 922201 es una AGENCIA
  perform t216.afirma('A2 ficha de otro tipo que la venta (agencia en una venta freelance): falla con RECOBRO_ALIADO_DISCREPANTE',
    sa ~ 'RECOBRO_ALIADO_DISCREPANTE' and sa ~ 'es de tipo «agencia»' and sa ~ 'venta .* es de tipo «freelance»', sa);

  sa := t267.conv(t267.cot('freelance', 'Otro nombre', 925701));
  perform t216.afirma('A3 el nombre que escribió la venta contradice a la ficha de la cotización: falla con RECOBRO_ALIADO_DISCREPANTE',
    sa ~ 'RECOBRO_ALIADO_DISCREPANTE' and sa ~ 'escribió', sa);

  -- A4: «la última cotización con ese número» NO decide: una señuelo posterior, con el mismo número y otra ficha, se ignora.
  cot := t267.cot('freelance', '', 925701);
  sa := t267.conv(cot, 925704);
  select * into b from public.aliados_b2b where numero_contrato = sa;
  perform t216.afirma('A4.1 con una cotización señuelo posterior (mismo número, otra ficha) el recobro va a la cotización de origen',
    sa ~ '^DTM-' and b.aliado_id = 925701, coalesce(sa, '') || ' ' || coalesce(to_jsonb(b)::text, ''));
  perform t216.afirma('A4.2 la señuelo existe y es la de mayor id (la prueba es válida)',
    (select count(*) = 2 and max(id) filter (where aliado_id = 925704) > max(id) filter (where aliado_id = 925701) from public.cotizaciones where numero_contrato = sa));

  -- A5: la cotización que la venta referencia no corresponde al contrato → falla (no se «busca» otra).
  sa := t267.conv(t267.cot('freelance', '', 925701), null, true);
  perform t216.afirma('A5 la venta apunta a una cotización que no es la convertida (sin ese contrato): falla con RECOBRO_ALIADO_DISCREPANTE',
    sa ~ 'RECOBRO_ALIADO_DISCREPANTE' and sa ~ 'no coincide con el contrato', sa);

  -- ── C. Rutas selladas de la 222 sobre el esquema completo ──────────────────
  hp := t222.hija_de('V1', 922201, 'agencia', 'pvp', null, 'admin', 'c267-pvp');
  perform t216.pagar(hp, t216.exigido(hp), 'c267-pvp-1');
  num := t267.conv(hp);
  perform t216.afirma('C1.1 comparativa PVP (222): convierte con la línea de recobro ya enlazada por la 222', num ~ '^DTM-\d{4,}$', num);
  perform t216.afirma('C1.2 una sola línea, ficha 922201, pendiente y sin descuento en precio',
    (select count(*) = 1 and bool_and(aliado_id = 922201 and estado = 'pendiente' and not descontada_en_precio and recobro_total > 0) from public.aliados_b2b where numero_contrato = num));

  ht := t222.hija_de('V1', 922201, 'agencia', 'neto', true, 'admin', 'c267-neto');
  perform t222.pagar_neto(ht, 3980000, 'c267-n1');
  perform t216.escalar('service_role', null, t216.pago_sql(ht, 'admin', 4870000, 'c267-n2'));
  num := t267.conv(ht);
  perform t216.afirma('C2.1 comparativa NETO (222): convierte', num ~ '^DTM-\d{4,}$', num);
  select * into b from public.aliados_b2b where numero_contrato = num;
  perform t216.afirma('C2.2 NETO: UNA fila descontada, pagada, con la ficha 922201 y el descuento como valor',
    (select count(*) from public.aliados_b2b where numero_contrato = num) = 1 and b.estado = 'pagada' and b.descontada_en_precio
    and b.aliado_id = 922201 and b.comision_valor = 1150000 and public.comision_b2b_total(b) = 1150000, to_jsonb(b)::text);

  -- ── B. Beneficiarios distintos cargados A PROPÓSITO siguen permitidos ───────
  sa := t267.conv(t267.cot('freelance', 'Free 267'));
  insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision,
                                  recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado)
  values (sa, 'mayorista', 'Ambigua 267', '925702', 'freelance', 925702, 1700000, 1700000, true, 0.05, 0, 0, false, 0, 'pendiente'),
         (sa, 'mayorista', 'Texto libre sin ficha', null, 'freelance', null, 1700000, 1700000, true, 0.02, 0, 0, false, 0, 'pendiente');
  begin
    set constraints all immediate; set constraints all deferred;
    perform t216.afirma('B1 varios beneficiarios a propósito (otra ficha y texto libre) conviven con la línea de recobro: no hay regla «uno por contrato»',
      (select count(*) = 3 and count(distinct aliado_id) filter (where aliado_id is not null) = 2 and count(*) filter (where aliado_id is null) = 1
         from public.aliados_b2b where numero_contrato = sa));
  exception when others then
    perform t216.afirma('B1 varios beneficiarios a propósito conviven', false, sqlerrm);
  end;

  -- B2: una línea de recobro con forma de la 198 pero con OTRA ficha ya puesta no se toca.
  begin
    insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, recobro_total, pct_recobro_aliado, estado)
    values (sa, 'mayorista', 'Ambigua 267', 'freelance', 925702, 1700000, 50000, 100000, 0.5, 'pendiente');
    set constraints all immediate; set constraints all deferred;
    perform t216.afirma('B2 una línea de recobro con ficha explícita distinta se conserva tal cual',
      exists (select 1 from public.aliados_b2b where numero_contrato = sa and aliado_id = 925702 and recobro_total = 100000));
  exception when others then
    perform t216.afirma('B2 línea de recobro con ficha explícita', false, sqlerrm);
  end;

  -- B3: la corrección histórica NO se ejecuta aquí: ninguna fila preexistente fue modificada por la 267.
  perform t216.afirma('B3 el trigger solo actúa en INSERT (no hay UPDATE ni DELETE de filas ajenas)',
    (select count(*) from pg_trigger where tgname = 'trg_recobro_beneficiario_explicito' and tgrelid = 'public.aliados_b2b'::regclass and (tgtype & 16) = 0 and (tgtype & 8) = 0) = 1);

  select count(*) into n_ok from t216.res where ok;
  raise notice 'RESUMEN 267: % afirmaciones OK de % registradas', n_ok, (select count(*) from t216.res);
end $$;

select 'T267_RESUMEN' as marca, count(*) as total, count(*) filter (where ok) as ok, count(*) filter (where not ok) as fallos from t216.res;
rollback;
