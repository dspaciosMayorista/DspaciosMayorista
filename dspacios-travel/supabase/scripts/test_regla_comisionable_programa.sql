-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA — regla comisionable de programas (migración 151, guardar_programa_salidas)
--
-- Corre contra una base local construida con `local-desde-cero.sh` (o en el
-- editor SQL de Supabase, DE SOLO LECTURA: termina en ROLLBACK). Comprueba
-- que los CHECK de la migración 151 son la última barrera cuando algo
-- se cuela sin pasar por `validarReglaComisionable` (navegador o Server
-- Action) — no reemplazan esa validación, la respaldan:
--
--   1. Guardado válido (regla activa + una tarifa) funciona.
--   2. % de comisión fuera de [0,100] → rechazado.
--   3. valor negativo en modo 'pct' → rechazado.
--   4. valor negativo en modo 'impuesto' → rechazado.
--   5. valor grande en modo 'impuesto' → PERMITIDO (es un monto, sin tope).
--   6. tarifa de una salida negativa → rechazada.
--   7. Round-trip desactivar→reactivar: modo/valor/%comisión y la tarifa de
--      la salida quedan EXACTAMENTE iguales antes y después — apagar el
--      check nunca debe perder ni alterar esos valores.
-- ─────────────────────────────────────────────────────────────────────────

begin;

insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'ops@test.com');
insert into public.usuarios (id, email, nombre, rol, activo) values
  ('44444444-4444-4444-4444-444444444444', 'ops@test.com', 'Ops', 'operaciones', true)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

insert into public.programas (id, nombre, moneda, modo_precio) values (9101, 'Programa validación', 'USD', 'salida');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-4444-444444444444','role','authenticated')::text, true);

-- ── 1) Regla activa VÁLIDA con una salida con tarifaSencilla (guarda igual) ──
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
  '[{"orden":0,"etiqueta":"S1","tarifa_sencilla":120,"neto_sencilla":108.36}]'::jsonb
);
select 'caso 1: guardado válido' as caso, regla_comisionable, regla_comisionable_valor, regla_comisionable_pct_comision
  from public.programas where id = 9101;

-- ── 2) pctComision fuera de rango → constraint debe rechazar ──────────────
do $$
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 150}'::jsonb,
      '[]'::jsonb
    );
    raise notice 'ERROR DE PRUEBA: pctComision=150 se guardó';
  exception when check_violation then
    raise notice 'OK: pctComision fuera de rango rechazado por CHECK';
  end;
end $$;

-- ── 3) valor negativo en modo pct → constraint debe rechazar ──────────────
do $$
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": true, "modo": "pct", "valor": -5, "pctComision": 10}'::jsonb,
      '[]'::jsonb
    );
    raise notice 'ERROR DE PRUEBA: valor=-5 en modo pct se guardó';
  exception when check_violation then
    raise notice 'OK: valor negativo (modo pct) rechazado por CHECK';
  end;
end $$;

-- ── 4) valor negativo en modo impuesto → constraint debe rechazar ─────────
do $$
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": true, "modo": "impuesto", "valor": -1, "pctComision": 10}'::jsonb,
      '[]'::jsonb
    );
    raise notice 'ERROR DE PRUEBA: impuesto negativo se guardó';
  exception when check_violation then
    raise notice 'OK: impuesto negativo rechazado por CHECK';
  end;
end $$;

-- ── 5) valor grande permitido en modo impuesto (sin tope superior) ────────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "impuesto", "valor": 500000, "pctComision": 10}'::jsonb,
  '[]'::jsonb
);
select 'caso 5: impuesto grande permitido' as caso, regla_comisionable_modo, regla_comisionable_valor
  from public.programas where id = 9101;

-- ── 6) tarifa negativa en una salida → constraint debe rechazar ───────────
do $$
begin
  begin
    perform public.guardar_programa_salidas(
      9101::bigint,
      '{"activa": true, "modo": "pct", "valor": 3, "pctComision": 10}'::jsonb,
      '[{"orden":0,"etiqueta":"S negativa","tarifa_sencilla":-50}]'::jsonb
    );
    raise notice 'ERROR DE PRUEBA: tarifa_sencilla=-50 se guardó';
  exception when check_violation then
    raise notice 'OK: tarifa negativa rechazada por CHECK';
  end;
end $$;

-- ── 7) Round-trip: desactivar conserva modo/valor/% comisión exactos ─────
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
select 'caso 7a: antes de desactivar' as caso, regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
  from public.programas where id = 9101;

-- Desactivar (activa=false) DEBE mandar los mismos modo/valor/pctComision
-- (así es como lo arma reglaPayload en el cliente: nunca los limpia).
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": false, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
select 'caso 7b: tras desactivar' as caso, regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
  from public.programas where id = 9101;
select 'caso 7b: tarifa tras desactivar' as caso, tarifa_sencilla, neto_sencilla from public.programa_salidas where programa_id = 9101;

-- Reactivar: debe verse EXACTAMENTE lo mismo que en 7a.
select public.guardar_programa_salidas(
  9101::bigint,
  '{"activa": true, "modo": "pct", "valor": 7, "pctComision": 12}'::jsonb,
  '[{"orden":0,"etiqueta":"S round","tarifa_sencilla":200,"neto_sencilla":180.44}]'::jsonb
);
select 'caso 7c: tras reactivar (debe = 7a)' as caso, regla_comisionable, regla_comisionable_modo, regla_comisionable_valor, regla_comisionable_pct_comision
  from public.programas where id = 9101;

reset role;
select set_config('request.jwt.claims', null, true);

rollback;
