-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — impuestos distintos por acomodación
-- (migración 163, `programas.regla_comisionable_impuesto_por_acomodacion` +
-- `programa_salidas.impuesto_{sencilla,doble,triple,multiple}` +
-- `guardar_programa_salidas`)
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK):
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_programa_impuesto_por_acomodacion.sql <conn>
--
-- Mismo criterio que test_programa_modalidad_mk.sql (migración 161): cada
-- caso es una ASERCIÓN real (RAISE EXCEPTION si falla, nunca RAISE NOTICE);
-- los casos que DEBEN fallar comprueban SQLSTATE/constraint/mensaje exactos.
-- Termina con un solo resumen y ROLLBACK — no deja fixtures.
--
-- Cobertura:
--   1. Columna nueva nace en `false` para un programa creado SIN tocarla.
--   2. CHECK de BD rechaza activar la opción con modo <> 'impuesto' en un
--      UPDATE directo a la tabla (sin pasar por el RPC).
--   2b. El CHECK está atado específicamente a `public.programas`.
--   3. CHECK de BD rechaza un impuesto_* negativo en un UPDATE directo.
--   3b. El CHECK está atado específicamente a `public.programa_salidas`.
--   4. RPC: impuesto GLOBAL histórico (opción apagada, modo 'impuesto') —
--      usa `v_valor` sin importar qué impuestos por acomodación se manden.
--   5. RPC: opción activa con modo <> 'impuesto' → rechazada (fail-closed,
--      "no confundir con la futura condición de pago por componentes").
--   6. RPC: cuatro impuestos DISTINTOS persisten cada uno en su columna —
--      cada tarifa usa el SUYO, nunca el de otra acomodación.
--   7. RPC: tarifa > 0 sin su impuesto correspondiente (opción activa) →
--      rechazada, fail-closed (nunca se convierte en 0 en silencio).
--   7b. Asimetría correcta: tarifa = 0 (o ausente) SIN su impuesto NO se
--      rechaza — no es una acomodación ofrecida por el proveedor, mismo
--      criterio que el editor (`tarifa > 0`) y la Server Action (tras el fix
--      de este PR).
--   8. RPC: impuesto_* negativo se rechaza (además del CHECK de BD, ya
--      cubierto en el caso 3 — acá se prueba el camino del RPC).
--   9. RPC + modalidad 'base_neta_impuestos_al_final': la base neta se
--      calcula con el impuesto DE LA ACOMODACIÓN, no con el impuesto global
--      — un impuesto general que rechazaría la tarifa NO bloquea si el
--      impuesto de esa acomodación puntual sí deja una base neta válida, y
--      viceversa (un impuesto por acomodación inválido SÍ bloquea aunque el
--      global sea inocuo).
--   10. RPC: payload SIN la clave `impuestoPorAcomodacion` (cliente
--      desplegado antes de esta migración) → CONSERVA el valor ya guardado
--      (no lo apaga en silencio).
--   11. RPC: `impuestoPorAcomodacion` presente pero no-booleano se rechaza.
--   12. ACL: `anon` y `PUBLIC` NO tienen EXECUTE sobre la función;
--      `authenticated` SÍ.
--   13. Concurrencia (SELECT ... FOR UPDATE): se prueba con dos conexiones
--      psql reales en supabase/scripts/pruebas/test_concurrencia_impuesto_acomodacion.sh
--      — no cabe acá (este archivo corre en UNA sola sesión/transacción).
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'ops3@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('66666666-6666-6666-6666-666666666666', 'ops3@test.com', 'Ops3', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

-- Helper de aserción: aborta con RAISE EXCEPTION si actual <> esperado.
create function pg_temp.assert_eq(actual anyelement, expected anyelement, etiqueta text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', etiqueta, expected, actual;
  end if;
end;
$$;

-- ── Caso 1: default `false` para un programa creado sin tocar la columna ──
insert into public.programas (id, nombre, moneda, modo_precio) values (9301, 'Programa impuesto acomodacion', 'USD', 'salida');
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_impuesto_por_acomodacion from public.programas where id = 9301),
    false, 'caso 1: default explícito de la columna nueva'
  );
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','66666666-6666-6666-6666-666666666666','role','authenticated')::text, true);

-- ── Caso 2: CHECK rechaza activar la opción con modo <> 'impuesto' (UPDATE directo) ──
do $$
declare
  v_lanzo boolean := false;
  v_constraint text;
begin
  begin
    update public.programas
       set regla_comisionable_modo = 'pct', regla_comisionable_impuesto_por_acomodacion = true
     where id = 9301;
  exception
    when check_violation then
      v_lanzo := true;
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'programas_impuesto_por_acomodacion_modo_check' then
        raise exception 'ASSERT FALLÓ (caso 2): violó un CHECK distinto al esperado: %', v_constraint;
      end if;
    when others then
      raise exception 'ASSERT FALLÓ (caso 2): error inesperado sqlstate=% mensaje=%', sqlstate, sqlerrm;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 2): activar la opción con modo <> impuesto debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_impuesto_por_acomodacion from public.programas where id = 9301),
    false, 'caso 2: la columna no debía cambiar tras el intento rechazado'
  );
end $$;

-- ── Caso 2b: el CHECK está atado a public.programas (conrelid) ───────────
do $$
begin
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_constraint
      where conname = 'programas_impuesto_por_acomodacion_modo_check'
        and conrelid = 'public.programas'::regclass),
    1, 'caso 2b: el CHECK debe existir exactamente una vez, atado a public.programas'
  );
end $$;

-- ── Caso 3: CHECK rechaza un impuesto_* negativo (UPDATE directo) ────────
insert into public.programa_salidas (programa_id, orden, etiqueta, tarifa_sencilla)
values (9301, 0, 'S negativa', 1000000);
do $$
declare
  v_lanzo boolean := false;
  v_constraint text;
begin
  begin
    update public.programa_salidas set impuesto_sencilla = -1 where programa_id = 9301;
  exception
    when check_violation then
      v_lanzo := true;
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'programa_salidas_impuestos_no_negativos_check' then
        raise exception 'ASSERT FALLÓ (caso 3): violó un CHECK distinto al esperado: %', v_constraint;
      end if;
    when others then
      raise exception 'ASSERT FALLÓ (caso 3): error inesperado sqlstate=% mensaje=%', sqlstate, sqlerrm;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 3): un impuesto_sencilla negativo debía rechazarse y no lo hizo';
  end if;
end $$;

-- ── Caso 3b: el CHECK está atado a public.programa_salidas (conrelid) ────
do $$
begin
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_constraint
      where conname = 'programa_salidas_impuestos_no_negativos_check'
        and conrelid = 'public.programa_salidas'::regclass),
    1, 'caso 3b: el CHECK debe existir exactamente una vez, atado a public.programa_salidas'
  );
end $$;

delete from public.programa_salidas where programa_id = 9301;

-- ── Caso 4: impuesto GLOBAL histórico — opción apagada, modo 'impuesto',
-- usa v_valor (100000) sin importar los impuestos por acomodación mandados
-- (se ignoran porque impuestoPorAcomodacion=false). ───────────────────────
select public.guardar_programa_salidas(
  9301::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 100000, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": false}'::jsonb,
  '[{"orden":0,"etiqueta":"S global","tarifa_sencilla":1000000,"neto_sencilla":810000,"impuesto_sencilla":999999}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_impuesto_por_acomodacion from public.programas where id = 9301),
    false, 'caso 4: opción queda apagada (comportamiento histórico por default)'
  );
  perform pg_temp.assert_eq(
    (select impuesto_sencilla from public.programa_salidas where programa_id = 9301),
    999999::numeric, 'caso 4: el impuesto por acomodación se GUARDA igual (informativo), aunque el cálculo del RPC no lo use con la opción apagada'
  );
end $$;

-- ── Caso 5: activar la opción con modo <> 'impuesto' vía RPC → rechazada ──
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9301::bigint,
      '{"activa": true, "modo": "pct", "valor": 10, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
      '[{"orden":0,"etiqueta":"S modo invalido","tarifa_sencilla":1000000}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001'
         or v_msg is distinct from 'El impuesto por acomodacion solo se puede usar con el modo "impuesto".' then
        raise exception 'ASSERT FALLÓ (caso 5): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 5): activar la opción con modo pct debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
begin
  -- El intento fallido no debió alterar nada (sigue como en el caso 4).
  perform pg_temp.assert_eq(
    (select regla_comisionable_modo from public.programas where id = 9301),
    'impuesto', 'caso 5: el programa no debía cambiar tras el intento rechazado'
  );
end $$;

-- ── Caso 6: cuatro impuestos DISTINTOS — cada tarifa usa el SUYO ─────────
select public.guardar_programa_salidas(
  9301::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999999, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
  '[{"orden":0,"etiqueta":"S cuatro impuestos","tarifa_sencilla":1000000,"tarifa_doble":1000000,"tarifa_triple":1000000,"tarifa_multiple":1000000,"impuesto_sencilla":100000,"impuesto_doble":80000,"impuesto_triple":60000,"impuesto_multiple":40000}]'::jsonb
);
do $$
declare v_row record;
begin
  select impuesto_sencilla, impuesto_doble, impuesto_triple, impuesto_multiple
    into v_row from public.programa_salidas where programa_id = 9301;
  perform pg_temp.assert_eq(v_row.impuesto_sencilla, 100000::numeric, 'caso 6: impuesto sencilla');
  perform pg_temp.assert_eq(v_row.impuesto_doble, 80000::numeric, 'caso 6: impuesto doble');
  perform pg_temp.assert_eq(v_row.impuesto_triple, 60000::numeric, 'caso 6: impuesto triple');
  perform pg_temp.assert_eq(v_row.impuesto_multiple, 40000::numeric, 'caso 6: impuesto multiple');
  perform pg_temp.assert_eq(
    (select regla_comisionable_impuesto_por_acomodacion from public.programas where id = 9301),
    true, 'caso 6: la opción queda activa'
  );
end $$;

-- ── Caso 7: tarifa > 0 SIN su impuesto correspondiente (opción activa) →
-- rechazada, fail-closed. ─────────────────────────────────────────────────
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9301::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 999999, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
      '[{"orden":0,"etiqueta":"S falta impuesto","tarifa_sencilla":1000000,"impuesto_sencilla":null}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg !~ 'Falta el impuesto de la acomodacion sencilla' then
        raise exception 'ASSERT FALLÓ (caso 7): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 7): tarifa sencilla sin su impuesto debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
begin
  -- El intento fallido no debió alterar la salida sobreviviente del caso 6.
  perform pg_temp.assert_eq(
    (select impuesto_sencilla from public.programa_salidas where programa_id = 9301),
    100000::numeric, 'caso 7: la salida previa al intento fallido debía sobrevivir intacta'
  );
end $$;

-- ── Caso 7b: tarifa = 0 (o ausente) SIN su impuesto NO se rechaza — no es
-- una acomodación ofrecida, mismo criterio que el editor y la Server Action. ──
select public.guardar_programa_salidas(
  9301::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999999, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
  '[{"orden":0,"etiqueta":"S tarifa cero sin impuesto","tarifa_sencilla":1000000,"impuesto_sencilla":100000,"tarifa_doble":0,"impuesto_doble":null,"tarifa_triple":null,"impuesto_triple":null}]'::jsonb
);
do $$
declare v_row record;
begin
  select tarifa_doble, impuesto_doble, tarifa_triple, impuesto_triple
    into v_row from public.programa_salidas where programa_id = 9301;
  perform pg_temp.assert_eq(v_row.tarifa_doble, 0::numeric, 'caso 7b: tarifa_doble=0 se guarda igual');
  perform pg_temp.assert_eq(v_row.impuesto_doble, null::numeric, 'caso 7b: impuesto_doble queda null, nunca se exige ni se fuerza a 0');
  perform pg_temp.assert_eq(v_row.tarifa_triple, null::numeric, 'caso 7b: tarifa_triple ausente se guarda null');
end $$;

-- ── Caso 8: impuesto_* negativo se rechaza también por el camino del RPC ──
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9301::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 999999, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": true}'::jsonb,
      '[{"orden":0,"etiqueta":"S impuesto negativo","tarifa_sencilla":1000000,"impuesto_sencilla":-1}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg !~ 'no pueden ser negativos' then
        raise exception 'ASSERT FALLÓ (caso 8): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 8): un impuesto_sencilla=-1 en el payload debía rechazarse y no lo hizo';
  end if;
end $$;

-- ── Caso 9: modalidad 'base_neta_impuestos_al_final' — la base neta se
-- calcula con el impuesto DE LA ACOMODACIÓN, no con el global. ────────────
-- 9a) Impuesto global (v_valor) es enorme (rechazaría cualquier tarifa), pero
--     el impuesto de la acomodación puntual es pequeño → NO debe rechazarse.
select public.guardar_programa_salidas(
  9301::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999999999, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final", "impuestoPorAcomodacion": true}'::jsonb,
  '[{"orden":0,"etiqueta":"S base neta usa impuesto acomodacion","tarifa_sencilla":1000000,"impuesto_sencilla":100000}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9301),
    1000000::numeric, 'caso 9a: se guarda porque usa el impuesto de la acomodación (100000), no el global (999999999)'
  );
end $$;

-- 9b) Impuesto global (v_valor) es inocuo, pero el impuesto de ESTA
--     acomodación puntual es enorme (tarifa - impuesto < 0) → SÍ se rechaza.
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9301::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 1, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final", "impuestoPorAcomodacion": true}'::jsonb,
      '[{"orden":0,"etiqueta":"S base neta negativa por acomodacion","tarifa_sencilla":1000,"impuesto_sencilla":999999}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg !~ 'base neta negativa' then
        raise exception 'ASSERT FALLÓ (caso 9b): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 9b): tarifa 1000 con impuesto de ACOMODACIÓN 999999 (base neta negativa) debía rechazarse aunque el impuesto global (1) sea inocuo';
  end if;
end $$;
do $$
begin
  -- El intento fallido no debió alterar la salida sobreviviente del caso 9a.
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9301),
    1000000::numeric, 'caso 9b: la salida previa al intento fallido debía sobrevivir intacta'
  );
end $$;

-- ── Caso 10: payload SIN la clave `impuestoPorAcomodacion` CONSERVA el valor
-- ya guardado (true, del caso 9a) — no lo apaga en silencio. ─────────────
select public.guardar_programa_salidas(
  9301::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 999999999, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S payload antiguo","tarifa_sencilla":1000000,"impuesto_sencilla":100000}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_impuesto_por_acomodacion from public.programas where id = 9301),
    true, 'caso 10: sin la clave impuestoPorAcomodacion en el payload, CONSERVA el valor ya guardado (no lo apaga)'
  );
end $$;

-- ── Caso 11: `impuestoPorAcomodacion` presente pero NO booleano se rechaza ──
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9301::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 100000, "pctComision": 10, "modalidadMk": "historica", "impuestoPorAcomodacion": "si"}'::jsonb,
      '[]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg is distinct from 'impuestoPorAcomodacion debe ser booleano.' then
        raise exception 'ASSERT FALLÓ (caso 11): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 11): impuestoPorAcomodacion como string debía rechazarse y no lo hizo';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ── Caso 12: ACL — anon y PUBLIC sin EXECUTE, authenticated sí ───────────
do $$
begin
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    false, 'caso 12: anon NO debe tener EXECUTE sobre guardar_programa_salidas'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    false, 'caso 12: PUBLIC NO debe tener EXECUTE sobre guardar_programa_salidas'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    true, 'caso 12: authenticated SÍ debe tener EXECUTE sobre guardar_programa_salidas'
  );
end $$;

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_programa_impuesto_por_acomodacion.sql (13 casos + ACL, migración 163)';
end $$;

rollback;
