-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA AUTO-VERIFICABLE — regla comisionable de programas
-- (migración 151, guardar_programa_salidas)
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK). Se ejecuta
-- así, para que un fallo real corte la ejecución en vez de seguir de largo:
--
--   psql -v ON_ERROR_STOP=1 -f supabase/scripts/test_regla_comisionable_programa.sql <conn>
--
-- Cada caso es una ASERCIÓN real, no una exhibición: si el resultado no es
-- el esperado, el script aborta con RAISE EXCEPTION (nunca RAISE NOTICE) y
-- psql sale con código distinto de cero por ON_ERROR_STOP=1. Los casos que
-- DEBEN fallar comprueban además el SQLSTATE/mensaje/constraint exactos —
-- así un error accidental (de conexión, de sintaxis, de otra tabla) no se
-- confunde con el rechazo esperado. Si TODO pasa, termina con un solo
-- RAISE NOTICE de resumen y hace ROLLBACK: no deja fixtures.
--
-- Cobertura:
--   1. Guardado válido (regla activa + una tarifa) — valores exactos.
--   2. pctComision fuera de rango (150) → rechazado por el RPC.
--   3. valor negativo en modo 'pct' (-5) → rechazado por el RPC.
--   4. valor negativo en modo 'impuesto' (-1) → rechazado por el RPC.
--   5. activa=true + pctComision NULL → rechazado por el RPC.
--   6. activa=true + modo 'pct' + valor NULL → rechazado por el RPC.
--   7. activa=true + modo 'impuesto' + valor NULL → rechazado por el RPC.
--      (2-7 comprueban además que el programa QUEDÓ IGUAL que en el caso 1:
--      cada intento fallido no dejó rastro — la función es una transacción.)
--   8. valor grande en modo 'impuesto' → PERMITIDO (es un monto, sin tope).
--   9. modo 'ninguno' con valor NULL → PERMITIDO (el valor no participa).
--  10. tarifa de una salida negativa → rechazada por el CHECK de BD, Y la
--      salida guardada ANTES del intento fallido sigue intacta (la función
--      ya había hecho el DELETE cuando el INSERT falló — sin la atomicidad
--      de la 151, esa salida habría quedado borrada).
--  11. Round-trip exacto: activar → desactivar (mismo modo/valor/%) →
--      reactivar. El estado final debe ser IDÉNTICO al inicial.
--  12. Desactivar con un borrador inválido a medio escribir: si el llamador
--      manda `activa=false` pero SIGUE cargando el valor inválido (150), el
--      CHECK incondicional de BD lo rechaza igual (demuestra por qué el
--      front-end (ProgramaEditor) debe descartar el borrador ANTES de
--      armar el payload, no depender de que "inactiva" lo deje pasar). La
--      forma correcta — reactivar con los últimos valores YA GUARDADOS
--      (7/12), nunca con el borrador — sí funciona y los conserva exactos.
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'ops@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('44444444-4444-4444-4444-444444444444', 'ops@test.com', 'Ops', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

insert into public.programas (id, nombre, moneda, modo_precio) values (9101, 'Programa validación', 'USD', 'salida');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);

-- Helper de aserción: aborta con RAISE EXCEPTION si actual <> esperado.
create function pg_temp.assert_eq(actual anyelement, expected anyelement, etiqueta text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERT FALLÓ (%): esperado=%, obtuvo=%', etiqueta, expected, actual;
  end if;
end;
$$;

-- ── Caso 1: guardado válido (regla activa + una tarifa) ────────────────────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
  '[{"orden":0,"etiqueta":"S1","tarifa_sencilla":120,"neto_sencilla":108.36}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 1: regla_comisionable');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 1: modo');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 3::numeric, 'caso 1: valor');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 10::numeric, 'caso 1: pctComision');
  perform pg_temp.assert_eq(
    (select count(*) from public.programa_salidas where programa_id = 9101), 1::bigint, 'caso 1: cantidad de salidas'
  );
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9101), 120::numeric, 'caso 1: tarifa_sencilla guardada'
  );
end $$;

-- ── Casos 2-7: la regla activa a medias es rechazada por el RPC, y el
-- programa queda EXACTAMENTE como en el caso 1 tras cada intento fallido ──
do $$
declare
  v_lanzo boolean;
  v_regla jsonb;
  v_msg text;
  v_row record;
  v_casos jsonb := '[
    {"caso":"caso 2: pctComision fuera de rango","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":150},"mensaje":"El porcentaje de comision debe ser un numero entre 0 y 100."},
    {"caso":"caso 3: valor negativo modo pct","regla":{"activa":true,"modo":"pct","valor":-5,"pctComision":10},"mensaje":"El porcentaje a restar debe ser un numero entre 0 y 100."},
    {"caso":"caso 4: valor negativo modo impuesto","regla":{"activa":true,"modo":"impuesto","valor":-1,"pctComision":10},"mensaje":"El impuesto debe ser un numero mayor o igual a 0."},
    {"caso":"caso 5: pctComision null con activa=true","regla":{"activa":true,"modo":"pct","valor":3,"pctComision":null},"mensaje":"El porcentaje de comision debe ser un numero entre 0 y 100."},
    {"caso":"caso 6: valor null modo pct con activa=true","regla":{"activa":true,"modo":"pct","valor":null,"pctComision":10},"mensaje":"El porcentaje a restar debe ser un numero entre 0 y 100."},
    {"caso":"caso 7: valor null modo impuesto con activa=true","regla":{"activa":true,"modo":"impuesto","valor":null,"pctComision":10},"mensaje":"El impuesto debe ser un numero mayor o igual a 0."}
  ]'::jsonb;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_casos) loop
    v_lanzo := false;
    begin
      perform public.guardar_programa_salidas(9101::bigint, v_item->'regla', '[]'::jsonb);
    exception
      when others then
        v_lanzo := true;
        get stacked diagnostics v_msg = message_text;
        if sqlstate is distinct from 'P0001' or v_msg is distinct from (v_item->>'mensaje') then
          raise exception 'ASSERT FALLÓ (%): error inesperado sqlstate=% mensaje=%', v_item->>'caso', sqlstate, v_msg;
        end if;
    end;
    if not v_lanzo then
      raise exception 'ASSERT FALLÓ (%): debía rechazarse y no lo hizo', v_item->>'caso';
    end if;

    -- El programa debe seguir exactamente como en el caso 1 — el intento
    -- fallido no debe haber alterado NADA (la función es una transacción).
    select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
      into v_row from public.programas where id = 9101;
    perform pg_temp.assert_eq(v_row.regla_comisionable, true, (v_item->>'caso') || ': programa no debía cambiar (activa)');
    perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', (v_item->>'caso') || ': programa no debía cambiar (modo)');
    perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 3::numeric, (v_item->>'caso') || ': programa no debía cambiar (valor)');
    perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 10::numeric, (v_item->>'caso') || ': programa no debía cambiar (pctComision)');
    perform pg_temp.assert_eq(
      (select count(*) from public.programa_salidas where programa_id = 9101), 1::bigint,
      (v_item->>'caso') || ': las salidas tampoco debían cambiar'
    );
  end loop;
end $$;

-- ── Caso 8: valor grande permitido en modo impuesto (sin tope superior) ────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 500000, "pctComision": 10}'::jsonb,
  '[]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 8: regla_comisionable');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'impuesto', 'caso 8: modo');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 500000::numeric, 'caso 8: valor grande permitido');
end $$;

-- ── Caso 9: modo 'ninguno' con valor NULL — permitido (no participa) ──────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "ninguno", "valor": null, "pctComision": 10}'::jsonb,
  '[]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 9: regla_comisionable');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'ninguno', 'caso 9: modo');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, null::numeric, 'caso 9: valor debe quedar null');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 10::numeric, 'caso 9: pctComision sigue obligatorio');
end $$;

-- ── Caso 10: tarifa negativa rechazada por CHECK de BD, Y un fallo NO borra
-- las salidas guardadas antes del intento (prueba real de atomicidad: la
-- función ya ejecutó el DELETE cuando el INSERT choca con el CHECK) ───────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
  '[{"orden":0,"etiqueta":"S antes del fallo","tarifa_sencilla":999,"neto_sencilla":900}]'::jsonb
);
do $$
declare
  v_lanzo boolean := false;
  v_constraint text;
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
      '[{"orden":0,"etiqueta":"S intento fallido","tarifa_sencilla":-50}]'::jsonb
    );
  exception
    when check_violation then
      v_lanzo := true;
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'programa_salidas_tarifas_no_negativas_check' then
        raise exception 'ASSERT FALLÓ (caso 10): violó un CHECK distinto al esperado: %', v_constraint;
      end if;
    when others then
      raise exception 'ASSERT FALLÓ (caso 10): error inesperado sqlstate=% mensaje=%', sqlstate, sqlerrm;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 10): tarifa_sencilla=-50 debía rechazarse y no lo hizo';
  end if;
end $$;
do $$
declare v_row record;
begin
  perform pg_temp.assert_eq(
    (select count(*) from public.programa_salidas where programa_id = 9101), 1::bigint,
    'caso 10: la salida previa al fallo debía sobrevivir sola (sin la fallida)'
  );
  select etiqueta, tarifa_sencilla into v_row from public.programa_salidas where programa_id = 9101;
  perform pg_temp.assert_eq(v_row.etiqueta, 'S antes del fallo', 'caso 10: la salida sobreviviente es la correcta');
  perform pg_temp.assert_eq(v_row.tarifa_sencilla, 999::numeric, 'caso 10: la salida sobreviviente no se alteró');
end $$;

-- ── Caso 11: round-trip exacto — activar → desactivar → reactivar ─────────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 11a: regla_comisionable');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 11a: modo');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 7::numeric, 'caso 11a: valor');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 12::numeric, 'caso 11a: pctComision');
end $$;

-- Desactivar manda los MISMOS modo/valor/pctComision (así los arma
-- reglaPayload/setReglaOn en el cliente: nunca los limpia al apagar).
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": false, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, false, 'caso 11b: regla_comisionable tras desactivar');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 11b: modo se conserva');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 7::numeric, 'caso 11b: valor se conserva');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 12::numeric, 'caso 11b: pctComision se conserva');
  perform pg_temp.assert_eq(
    (select tarifa_sencilla from public.programa_salidas where programa_id = 9101), 200::numeric,
    'caso 11b: la tarifa de la salida no se toca al desactivar'
  );
end $$;

-- Reactivar: debe verse EXACTAMENTE igual que en 11a.
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 11c: debe = 11a (regla_comisionable)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 11c: debe = 11a (modo)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 7::numeric, 'caso 11c: debe = 11a (valor)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 12::numeric, 'caso 11c: debe = 11a (pctComision)');
end $$;

-- ── Caso 12: desactivar con un borrador inválido a medio escribir ─────────
-- Punto de partida: la última config VÁLIDA guardada es modo=pct/valor=7/
-- pctComision=12 (caso 11c). El usuario escribió temporalmente "150" en
-- pantalla y desactivó el check ANTES de que el front-end descartara ese
-- borrador (el bug que corrige ProgramaEditor.setReglaOn).

-- 12a) Si el llamador manda activa=false pero SIGUE cargando el 150 (el
-- comportamiento SIN el fix del front-end): el CHECK incondicional de BD
-- (no le importa si la regla está activa) lo rechaza igual.
do $$
declare
  v_lanzo boolean := false;
  v_constraint text;
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": false, "modo": "pct", "valor": 7, "pctComision": 150}'::jsonb,
      '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
    );
  exception
    when check_violation then
      v_lanzo := true;
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'programas_regla_comisionable_pct_comision_check' then
        raise exception 'ASSERT FALLÓ (caso 12a): violó un CHECK distinto al esperado: %', v_constraint;
      end if;
    when others then
      raise exception 'ASSERT FALLÓ (caso 12a): error inesperado sqlstate=% mensaje=%', sqlstate, sqlerrm;
  end;
  if not v_lanzo then
    raise exception 'ASSERT FALLÓ (caso 12a): pctComision=150 con activa=false debía rechazarse igual (CHECK incondicional) y no lo hizo';
  end if;
end $$;
do $$
declare v_row record;
begin
  -- El intento fallido no debió alterar NADA: sigue como en 11c.
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, true, 'caso 12a: el programa no debía cambiar (regla_comisionable)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 7::numeric, 'caso 12a: el programa no debía cambiar (valor)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 12::numeric, 'caso 12a: el programa no debía cambiar (pctComision)');
end $$;

-- 12b) La forma correcta (con el fix): el front-end descarta el borrador
-- ANTES de armar el payload y manda activa=false con los ÚLTIMOS valores
-- YA GUARDADOS (7/12) — nunca el 150. Debe funcionar y conservarlos exactos.
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": false, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
do $$
declare v_row record;
begin
  select regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
    into v_row from public.programas where id = 9101;
  perform pg_temp.assert_eq(v_row.regla_comisionable, false, 'caso 12b: regla_comisionable tras desactivar con el borrador descartado');
  perform pg_temp.assert_eq(v_row.regla_comisionable_modo, 'pct', 'caso 12b: modo preservado');
  perform pg_temp.assert_eq(v_row.regla_comisionable_valor, 7::numeric, 'caso 12b: valor preservado (no el 150 del borrador)');
  perform pg_temp.assert_eq(v_row.regla_comisionable_pct_comision, 12::numeric, 'caso 12b: pctComision preservado (no el 150 del borrador)');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

do $$
begin
  raise notice 'TODAS LAS PRUEBAS PASARON: test_regla_comisionable_programa.sql (12 casos)';
end $$;

rollback;
