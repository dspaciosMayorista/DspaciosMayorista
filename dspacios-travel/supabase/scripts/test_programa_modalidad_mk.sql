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
-- Cobertura:
--   1. Columna nueva nace en 'historica' para un programa creado SIN tocarla
--      (default explícito — ningún programa existente cambia de comportamiento).
--   2. CHECK de BD rechaza un valor fuera del enum en un UPDATE directo a la
--      tabla (sin pasar por el RPC) — última barrera, no la única.
--   3. `guardar_programa_salidas` persiste 'base_neta_impuestos_al_final'
--      cuando el llamador la manda explícita.
--   4. `guardar_programa_salidas` con `p_regla` que NO trae la clave
--      `modalidadMk` (payload de un cliente desplegado ANTES de esta
--      migración, durante la ventana de despliegue) → cae a 'historica',
--      nunca revienta ni deja la columna en null/vacío.
--   5. `guardar_programa_salidas` rechaza un `modalidadMk` fuera del enum,
--      SIN importar si `activa` es true o false (validación incondicional,
--      igual criterio que `regla_comisionable_modo`) — Y el programa queda
--      exactamente como antes del intento (transacción íntegra).
--   6. Round-trip: activar con la modalidad nueva → desactivar (sin tocar
--      modalidadMk) → reactivar. La modalidad debe sobrevivir intacta los
--      tres pasos, igual que ya sucede con modo/valor/pctComision.
--   7. Apply→rollback→reapply: se prueba en un script aparte
--      (ver supabase/scripts/pruebas — no se repite acá porque exige DROP/
--      CREATE de objetos reales, incompatible con "de solo lectura, termina
--      en ROLLBACK" de este archivo).
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

-- ── Caso 4: p_regla SIN la clave modalidadMk → cae a 'historica' (cliente
-- desplegado antes de esta migración, durante el rollout) ─────────────────
select public.guardar_programa_salidas(
  9201::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
  '[{"orden":0,"etiqueta":"S2","tarifa_sencilla":120,"neto_sencilla":108.36}]'::jsonb
);
do $$
begin
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 4: sin la clave modalidadMk en el payload, cae a historica (compat de despliegue)'
  );
end $$;

-- ── Caso 5: modalidadMk fuera del enum se rechaza SIEMPRE, con activa=true
-- Y con activa=false (validación incondicional) — y el programa no cambia ──
do $$
declare
  v_lanzo boolean;
  v_msg text;
  v_casos jsonb := '[
    {"caso":"caso 5a: modalidadMk inválida con activa=true","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":"otra"}},
    {"caso":"caso 5b: modalidadMk inválida con activa=false","regla":{"activa":false,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":"otra"}},
    {"caso":"caso 5c: modalidadMk vacía con activa=true cae a historica (no es un rechazo — cadena vacía se trata como ausente)","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":10,"modalidadMk":""},"permite":true}
  ]'::jsonb;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_casos) loop
    if (v_item ? 'permite') then
      -- Caso 5c: no debe lanzar — cadena vacía se normaliza a 'historica'
      -- (mismo `coalesce(nullif(x,''), 'historica')` que el resto del RPC).
      perform public.guardar_programa_salidas(9201::bigint, v_item->'regla', '[]'::jsonb);
      perform pg_temp.assert_eq(
        (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
        'historica', (v_item->>'caso')
      );
      continue;
    end if;
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
  -- Tras los intentos rechazados (5a/5b), el programa sigue como en el caso 4
  -- (historica) — ningún intento fallido debió alterar la columna.
  perform pg_temp.assert_eq(
    (select regla_comisionable_modalidad_mk from public.programas where id = 9201),
    'historica', 'caso 5: el programa no debía cambiar tras los intentos rechazados'
  );
end $$;

-- ── Caso 6: round-trip — activar con la modalidad nueva → desactivar (sin
-- tocar modalidadMk) → reactivar. Debe sobrevivir los tres pasos intacta,
-- igual que modo/valor/pctComision (mismo criterio § requisito 7). ────────
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

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_programa_modalidad_mk.sql (6 casos, migración 161)';
end $$;

rollback;
