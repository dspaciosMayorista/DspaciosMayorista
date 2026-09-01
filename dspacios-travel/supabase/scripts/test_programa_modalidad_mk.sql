-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — modalidad de MK de la tarifa comisionable
-- (migración 161, `programas.regla_comisionable_modalidad_mk` +
-- `guardar_programa_salidas`)
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK):
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_programa_modalidad_mk.sql <conn>
--
-- Mismo criterio que test_regla_comisionable_programa.sql (migración 151):
-- cada caso es una ASERCIÓN real (RAISE EXCEPTION si falla, nunca RAISE
-- NOTICE); los casos que DEBEN fallar comprueban SQLSTATE/constraint/mensaje
-- exactos. Termina con un solo resumen y ROLLBACK — no deja fixtures.
--
-- Cobertura (revisión PR #277 — reescrito, ya NO cae a 'historica' con un
-- payload sin `modalidadMk`; ver casos 4/5 abajo):
--   1. Columna nueva nace en 'historica' para un programa creado SIN tocarla
--      (default explícito — ningún programa existente cambia de comportamiento).
--   2. CHECK de BD rechaza un valor fuera del enum en un UPDATE directo a la
--      tabla (sin pasar por el RPC) — última barrera, no la única.
--   2b. El CHECK está atado específicamente a `public.programas`
--      (`conrelid`), no solo detectado por nombre.
--   3. `guardar_programa_salidas` persiste 'base_neta_impuestos_al_final'
--      cuando el llamador la manda explícita.
--   4. Payload SIN la clave `modalidadMk` (cliente desplegado ANTES de esta
--      migración) → CONSERVA la modalidad YA GUARDADA (sigue en
--      'base_neta_impuestos_al_final' del caso 3) — YA NO la pisa con
--      'historica'. Un payload que SÍ manda `modalidadMk:'historica'`
--      explícito sí la cambia.
--   5. `modalidadMk` fuera del enum, o presente pero vacía (`""`) o nula
--      (`null`) EXPLÍCITAS, se rechaza SIEMPRE (fail-closed — nunca se
--      ensancha en silencio a 'historica'), con `activa=true` y con
--      `activa=false` (validación incondicional) — Y el programa queda
--      exactamente como antes de cada intento.
--   6. Round-trip: activar con la modalidad nueva → desactivar (mandando la
--      MISMA modalidad, como arma `reglaPayload` en el cliente real) →
--      reactivar. La modalidad debe sobrevivir intacta los tres pasos, igual
--      que ya sucede con modo/valor/pctComision.
--   7. Base neta negativa (tarifa < impuesto, % comisión bajo) en la
--      modalidad NUEVA con la regla activa → RECHAZADA por el RPC ANTES del
--      DELETE/INSERT — la salida previamente guardada sobrevive intacta.
--   8. Base neta EXACTAMENTE 0 (ej. modo 'pct' con valor=100%, toda la
--      tarifa es "impuesto") → PERMITIDA (0 no es negativa) — el RPC no la
--      rechaza.
--   9. La MISMA combinación inválida del caso 7 (que en modalidad nueva se
--      rechaza) es ACEPTADA sin más cuando la modalidad es 'historica' — la
--      regla nueva nunca bloquea datos/programas en modalidad histórica.
--   10. ACL: `anon` y `PUBLIC` NO tienen EXECUTE sobre la función;
--      `authenticated` SÍ (`has_function_privilege`).
--   11. (Revisión PR #277, ronda 2) Paridad numérica JS↔Postgres: tarifa=100,
--      impuesto=100.004, comisión=10% → base neta EXACTA -0,0036 (negativa) —
--      el RPC la rechaza porque calcula con aritmética `numeric` exacta, sin
--      redondear ningún paso intermedio (el mismo caso que antes podía
--      "pasar" del lado JS si se comparaba contra el baseNeta ya redondeado a
--      2 decimales — ver `baseNetaExacta()` en lib/calc/programaPrecio.ts).
--   12. Apply→rollback→reapply: se prueba en un script aparte (ver
--      supabase/scripts/pruebas — no se repite acá porque exige DROP/CREATE
--      de objetos reales, incompatible con "de solo lectura, termina en
--      ROLLBACK" de este archivo). La CONCURRENCIA (SELECT ... FOR UPDATE)
--      se prueba con dos conexiones psql reales en
--      supabase/scripts/pruebas/test_concurrencia_modalidad_mk.sh — tampoco
--      cabe acá (este archivo corre en UNA sola sesión/transacción).
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'ops2@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('55555555-5555-5555-5555-555555555555', 'ops2@test.com', 'Ops2', 'operaciones', true)
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

-- ── Caso 1: default 'historica' para un programa creado sin tocar la columna ──
insert into public.programas (id, nombre, moneda, modo_precio) values (9201, 'Programa modalidad MK', 'USD', 'salida');
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 1: default explícito de la columna nueva'
  );
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','55555555-5555-5555-5555-555555555555','role','authenticated')::text, true);

-- ── Caso 2: CHECK de BD rechaza un valor fuera del enum en un UPDATE directo ──
do $$
declare
  v_lanzo boolean := false;
  v_constraint text;
begin
  begin
    update public.programas set regla_comisionable_modalidad_mk = 'otra_cosa' where id = 9201;
  exception
    when check_violation then
      v_lanzo := true;
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'programas_regla_comisionable_modalidad_mk_check' then
        raise exception 'ASSERT FALLÓ (caso 2): violó un CHECK distinto al esperado: %', v_constraint;
      end if;
    when others then
      raise exception 'ASSERT FALLÓ (caso 2): error inesperado sqlstate=% mensaje=%', sqlstate, sqlerrm;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 2): un valor fuera del enum debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
begin
  -- El intento fallido no debió alterar nada.
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 2: la columna no debía cambiar tras el intento rechazado'
  );
end $$;

-- ── Caso 2b: el CHECK está atado a public.programas (conrelid), no solo detectado por nombre ──
do $$
begin
  perform pg_temp.assert_eq(
    (select count(*)::int from pg_constraint
      where conname = 'programas_regla_comisionable_modalidad_mk_check'
        and conrelid = 'public.programas'::regclass),
    1, 'caso 2b: el CHECK debe existir exactamente una vez, atado a public.programas'
  );
end $$;

-- ── Caso 3: guardar_programa_salidas persiste la modalidad nueva ──────────
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 100000, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S1","tarifa_sencilla":1000000,"neto_sencilla":910000}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'base_neta_impuestos_al_final', 'caso 3: modalidad nueva persistida'
  );
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9201),
    1000000::numeric, 'caso 3: tarifa_sencilla guardada'
  );
end $$;

-- ── Caso 4: payload SIN la clave modalidadMk CONSERVA la modalidad ya
-- guardada (cliente desplegado ANTES de esta migración) — YA NO la pisa con
-- 'historica'. Confirmado con la modalidad nueva ya activa desde el caso 3. ──
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
  '[{"orden":0,"etiqueta":"S2","tarifa_sencilla":120,"neto_sencilla":108.36}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'base_neta_impuestos_al_final',
    'caso 4: sin la clave modalidadMk en el payload, CONSERVA la modalidad ya guardada (no la pisa con historica)'
  );
end $$;

-- Un payload que SÍ manda modalidadMk explícito ('historica') sí la cambia.
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10, "modalidadMk": "historica"}'::jsonb,
  '[{"orden":0,"etiqueta":"S2","tarifa_sencilla":120,"neto_sencilla":108.36}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 4b: payload explícito con modalidadMk:"historica" SÍ cambia la modalidad'
  );
end $$;

-- ── Caso 5: modalidadMk inválida/vacía/nula EXPLÍCITA se rechaza SIEMPRE,
-- con activa=true Y con activa=false — fail-closed, nunca se ensancha en
-- silencio — y el programa no cambia tras cada intento ──────────────────
do $$
declare
  v_lanzo boolean;
  v_msg text;
  v_casos jsonb := '[
    {"caso":"caso 5a: modalidadMk inválida con activa=true","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":"otra"}},
    {"caso":"caso 5b: modalidadMk inválida con activa=false","regla":{"activa":false,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":"otra"}},
    {"caso":"caso 5c: modalidadMk vacía (\"\") EXPLÍCITA con activa=true — fail-closed, ya NO se ensancha a historica","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":""}},
    {"caso":"caso 5d: modalidadMk nula (JSON null) EXPLÍCITA con activa=true — fail-closed","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":null}}
  ]'::jsonb;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_casos) loop
    v_lanzo := false;
    begin
      perform public.guardar_programa_salidas(9201::bigint, v_item->'regla', '[]'::jsonb);
    exception
      when others then
        v_lanzo := true;
        get stacked diagnostics v_msg = message_text;
        if sqlstate is distinct from 'P0001'
           or v_msg is distinct from 'La modalidad de MK debe ser "historica" o "base_neta_impuestos_al_final".' then
          raise exception 'ASSERT FALLÓ (%): error inesperado sqlstate=% mensaje=%', v_item->>'caso', sqlstate, v_msg;
        end if;
    end;
    if not v_lanzo then
      raise exception 'ASSERT FALLÓ (%): debía rechazarse y no lo hizo', v_item->>'caso';
    end if;
  end loop;
end $$;
do $$
begin
  -- Tras los 4 intentos rechazados, el programa sigue como en el caso 4b
  -- (historica) — ningún intento fallido debió alterar la columna.
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 5: el programa no debía cambiar tras los intentos rechazados'
  );
end $$;

-- ── Caso 6: round-trip — activar con la modalidad nueva → desactivar
-- (mandando la MISMA modalidad, como arma reglaPayload en el cliente real) →
-- reactivar. Debe sobrevivir los tres pasos intacta. ──────────────────────
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 5, "pctComision": 8, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":300,"neto_sencilla":275.7}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'base_neta_impuestos_al_final', 'caso 6a: modalidad nueva activa'
  );
end $$;

select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": false, "modo": "pct", "valor": 5, "pctComision": 8, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":300,"neto_sencilla":275.7}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modalidad_mk into v_row from public.programas where id = 9201;
  perform pg_temp.assert_eq(v_row.regla_comisionable, false, 'caso 6b: regla_comisionable tras desactivar');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modalidad_mk, 'base_neta_impuestos_al_final', 'caso 6b: modalidad se conserva al desactivar');
end $$;

select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 5, "pctComision": 8, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":300,"neto_sencilla":275.7}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modalidad_mk into v_row from public.programas where id = 9201;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 6c: debe = 6a (regla_comisionable)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modalidad_mk, 'base_neta_impuestos_al_final', 'caso 6c: debe = 6a (modalidad)');
end $$;

-- ── Caso 7: base neta negativa (tarifa 100 < impuesto 1000, comisión 10%)
-- en la modalidad NUEVA con la regla activa → RECHAZADA por el RPC ANTES
-- del DELETE/INSERT — la salida previamente guardada (caso 6c) sobrevive. ──
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9201::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 1000, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
      '[{"orden":0,"etiqueta":"S invalida","tarifa_sencilla":100}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg !~ 'base neta negativa' then
        raise exception 'ASSERT FALLÓ (caso 7): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 7): tarifa 100 con impuesto 1000 (base neta negativa) debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
declare v_row record;
begin
  -- El intento fallido no debió alterar NADA — ni la regla ni las salidas
  -- (que siguen siendo las del caso 6c: tarifa_sencilla=300).
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision, regla_comisionable_modalidad_mk
    into v_row from public.programas where id = 9201;
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 7: el programa no debía cambiar (modo)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 5::numeric, 'caso 7: el programa no debía cambiar (valor)');
  perform pg_temp.assert_eq(
    (select count(*) from public.programa_salidas where programa_id = 9201), 1::bigint,
    'caso 7: la salida previa al intento fallido debía sobrevivir sola'
  );
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9201), 300::numeric,
    'caso 7: la salida sobreviviente no se alteró'
  );
end $$;

-- ── Caso 8: base neta EXACTAMENTE 0 (modo 'pct', valor=100% → toda la
-- tarifa es "impuesto", nada comisionable) → PERMITIDA, el RPC no la
-- rechaza (0 no es negativa). ─────────────────────────────────────────────
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 100, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
  '[{"orden":0,"etiqueta":"S base cero","tarifa_sencilla":500}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9201), 500::numeric,
    'caso 8: base neta = 0 (valor=100%) se permite y la salida se guarda'
  );
end $$;

-- ── Caso 9: la MISMA combinación inválida del caso 7 (impuesto > tarifa) es
-- ACEPTADA sin más cuando la modalidad es 'historica' — la regla nueva
-- NUNCA bloquea datos/programas en modalidad histórica. ───────────────────
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 1000, "pctComision": 10, "modalidadMk": "historica"}'::jsonb,
  '[{"orden":0,"etiqueta":"S historica sin bloqueo","tarifa_sencilla":100}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 9: modalidad histórica activa'
  );
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9201), 100::numeric,
    'caso 9: la misma tarifa que se rechazó en modalidad nueva se acepta sin más en historica'
  );
end $$;

-- ── Caso 11 (revisión PR #277, ronda 2): paridad numérica JS↔Postgres —
-- tarifa=100, impuesto=100.004, comisión=10%. Con aritmética REDONDEADA a 2
-- decimales antes de comparar (el bug que corrigió `baseNetaExacta` del lado
-- JS), esto pasaba como "no negativo". Postgres SIEMPRE calculó exacto (sin
-- redondear ningún paso) — este caso confirma que el RPC rechaza esta
-- combinación, coincidiendo con lo que ahora también rechaza
-- `validarTarifaModalidad` (lib/calc/programaPrecio.ts) del lado JS. ───────
do $$
declare
  v_lanzo boolean := false;
  v_msg text;
begin
  begin
    perform public.guardar_programa_salidas(
      9201::bigint,
      '{"activa": true, "modo": "impuesto", "valor": 100.004, "pctComision": 10, "modalidadMk": "base_neta_impuestos_al_final"}'::jsonb,
      '[{"orden":0,"etiqueta":"S paridad numerica","tarifa_sencilla":100}]'::jsonb
    );
  exception
    when others then
      v_lanzo := true;
      get stacked diagnostics v_msg = message_text;
      if sqlstate is distinct from 'P0001' or v_msg !~ 'base neta negativa' then
        raise exception 'ASSERT FALLÓ (caso 11): error inesperado sqlstate=% mensaje=%', sqlstate, v_msg;
      end if;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 11): tarifa 100 con impuesto 100.004 (base neta exacta -0,0036) debía rechazarse — si esto pasa, el RPC dejó de usar aritmética exacta';
  end if;
end $$;
do $$
begin
  -- El intento fallido no debió alterar la salida del caso 9 (tarifa_sencilla=100,
  -- que casualmente coincide en valor con la tarifa de este caso, pero es la
  -- MISMA fila sobreviviente — se confirma que sigue en modalidad historica).
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 11: el programa no debía cambiar tras el intento rechazado'
  );
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

-- ── Caso 10: ACL — anon y PUBLIC sin EXECUTE, authenticated sí ────────────
do $$
begin
  perform pg_temp.assert_eq(
    has_function_privilege('anon', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    false, 'caso 10: anon NO debe tener EXECUTE sobre guardar_programa_salidas'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('public', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    false, 'caso 10: PUBLIC NO debe tener EXECUTE sobre guardar_programa_salidas'
  );
  perform pg_temp.assert_eq(
    has_function_privilege('authenticated', 'public.guardar_programa_salidas(bigint, jsonb, jsonb)', 'EXECUTE'),
    true, 'caso 10: authenticated SÍ debe tener EXECUTE sobre guardar_programa_salidas'
  );
end $$;

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_programa_modalidad_mk.sql (11 casos + ACL, migración 161)';
end $$;

rollback;
