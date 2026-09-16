-- Postcheck 180. Corre DESPUÉS de aplicar la migración 180.
-- Paso 3 de 3 — ver la cabecera de 20260601000180_tarifario_resultado_procedencia.sql.
-- Toda la sección de mutantes corre dentro de una transacción que termina en
-- ROLLBACK — ningún dato queda modificado. Usa una fila REAL y existente de
-- `tarifario_resultado` — nunca un `paquete_id` inventado.

-- 1) Las 5 columnas deben existir con los tipos/nullability esperados.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifario_resultado'
  and column_name in ('temporada_ganadora', 'es_promocion', 'precio_final_autoritativo', 'procedencia_temporadas', 'procedencia_mixta')
order by column_name;
-- Esperado: 5 filas — temporada_ganadora (text, YES), es_promocion (boolean,
-- YES), precio_final_autoritativo (boolean, YES), procedencia_temporadas
-- (jsonb, YES), procedencia_mixta (boolean, NO, default false).

-- 2) Ninguna fila existente quedó con procedencia poblada (sin backfill).
select count(*) as filas_con_procedencia
from public.tarifario_resultado
where temporada_ganadora is not null or es_promocion is not null
   or precio_final_autoritativo is not null or procedencia_temporadas is not null
   or procedencia_mixta;
-- Esperado: 0 (inmediatamente después de correr la migración).

-- 3) Los 4 CHECK existen, ligados a tarifario_resultado (conrelid).
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.tarifario_resultado'::regclass
  and conname in (
    'tarifario_resultado_procedencia_es_arreglo_check',
    'tarifario_resultado_procedencia_elementos_validos_check',
    'tarifario_resultado_procedencia_no_vacia_check',
    'tarifario_resultado_procedencia_estado_check'
  )
order by conname;
-- Esperado: 4 filas.

-- 3b) Las 2 funciones helper existen (immutable, nunca security definer —
--     no tocan tablas, no hay privilegio que elevar).
select proname, provolatile, prosecdef
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('_procedencia_temporadas_elementos_validos', '_tarifario_resultado_procedencia_valida')
order by proname;
-- Esperado: 2 filas, provolatile = 'i' (immutable), prosecdef = false.

-- 4) Pruebas MUTANTES sobre una fila REAL, dentro de una transacción que
--    termina en ROLLBACK.
begin;

do $$
declare
  v_id bigint;
begin
  select id into v_id from public.tarifario_resultado limit 1;

  if v_id is null then
    raise notice 'AVISO: tarifario_resultado no tiene NINGUNA fila — las pruebas mutantes NO se pudieron ejecutar. Vuelve a correr este postcheck cuando exista al menos una fila real.';
    return;
  end if;

  raise notice 'Usando tarifario_resultado.id = % para las pruebas mutantes.', v_id;

  -- 4a) Caso UNIFORME: 1 elemento en procedencia_temporadas, procedencia_mixta=false,
  --     columnas planas pobladas Y EXACTAMENTE IGUALES al único objeto — debe aceptarse.
  update public.tarifario_resultado set
    procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
    procedencia_mixta = false,
    temporada_ganadora = 'BAJA', es_promocion = false, precio_final_autoritativo = false
  where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (caso uniforme) no afectó ninguna fila (id=% ya no existe).', v_id;
  end if;
  raise notice 'OK: caso uniforme (1 elemento, procedencia_mixta=false, columnas planas pobladas e iguales al objeto) aceptado.';

  -- 4b) Caso MIXTO válido: 2 elementos, procedencia_mixta=true, columnas planas NULL.
  update public.tarifario_resultado set
    procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":true,"precio_final_autoritativo":true}]'::jsonb,
    procedencia_mixta = true,
    temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
  where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (caso mixto válido) no afectó ninguna fila (id=% ya no existe).', v_id;
  end if;
  raise notice 'OK: caso mixto válido (2 elementos, procedencia_mixta=true, columnas planas NULL) aceptado.';

  -- 4c) Mutante inválido: procedencia_mixta=true pero solo 1 elemento — el
  --     CHECK de estado (4) debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó procedencia_mixta=true con un solo elemento en el arreglo (debía rechazar tarifario_resultado_procedencia_estado_check).';
  exception when check_violation then
    raise notice 'OK: el CHECK de estado rechazó procedencia_mixta=true con 1 solo elemento.';
  end;

  -- 4d) Mutante inválido: procedencia_mixta=true pero con una columna plana
  --     poblada (discrepancia JSON↔columnas planas) — el CHECK de estado debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":true,"precio_final_autoritativo":true}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = 'BAJA', es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó procedencia_mixta=true con temporada_ganadora poblado (debía rechazar tarifario_resultado_procedencia_estado_check).';
  exception when check_violation then
    raise notice 'OK: el CHECK de estado rechazó procedencia_mixta=true con una columna plana poblada.';
  end;

  -- 4e) Mutante inválido: procedencia_temporadas es un OBJETO, no un
  --     arreglo — el CHECK 1 (es_arreglo) debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '{"temporada":"BAJA"}'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó procedencia_temporadas como objeto (no arreglo) sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó procedencia_temporadas como objeto (jsonb_typeof <> array) — y NUNCA lanzó un error de tipo (jsonb_array_length sobre no-arreglo), solo un check_violation limpio.';
  end;

  -- 4f) JSON MALFORMADO: arreglo con un elemento que NO es un objeto (un
  --     string suelto) — el CHECK 2 (elementos_validos) debe rechazar, y el
  --     CHECK de estado (4) NUNCA debe lanzar un error de tipo al intentar
  --     leer `->>'temporada'` de algo mal formado (ambos son `case` guardados).
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '["BAJA"]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = 'BAJA', es_promocion = false, precio_final_autoritativo = false
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo con un elemento que no es un objeto ("BAJA" suelto).';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo con un elemento que no es un objeto.';
  end;

  -- 4g) JSON MALFORMADO: objeto con `temporada` de tipo equivocado (número,
  --     no string) — el CHECK 2 debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":123,"es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un elemento con `temporada` numérico en vez de string.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó `temporada` de tipo numérico.';
  end;

  -- 4h) JSON MALFORMADO: `temporada` vacío después de trim (solo espacios) —
  --     el CHECK 2 debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"   ","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó `temporada` vacío después de btrim.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó `temporada` vacío (solo espacios) después de btrim.';
  end;

  -- 4i) JSON MALFORMADO: `es_promocion` de tipo equivocado (string "true" en
  --     vez de boolean jsonb) — el CHECK 2 debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":"true","precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó `es_promocion` como string en vez de boolean jsonb.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó `es_promocion` de tipo string.';
  end;

  -- 4j) ARREGLO VACÍO: `[]` no es ninguno de los 3 estados válidos — el
  --     CHECK 3 (no_vacia) debe rechazar.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo vacío ([]) como procedencia_temporadas.';
  exception when check_violation then
    raise notice 'OK: el CHECK de no-vacío rechazó procedencia_temporadas = [].';
  end;

  -- 4k) DISCREPANCIA caso uniforme: 1 elemento en el arreglo pero la columna
  --     plana `temporada_ganadora` NO coincide con `temporada` del objeto —
  --     el CHECK de estado debe rechazar (igualdad EXACTA exigida).
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = 'OTRA', es_promocion = false, precio_final_autoritativo = false
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó temporada_ganadora="OTRA" cuando el único objeto del arreglo trae temporada="BAJA".';
  exception when check_violation then
    raise notice 'OK: el CHECK de estado rechazó la discrepancia entre temporada_ganadora y el único objeto del arreglo.';
  end;

  -- 4l) DISCREPANCIA caso uniforme: mismo escenario pero en `es_promocion`
  --     (columna plana boolean distinta del objeto) — el CHECK de estado
  --     debe rechazar. Confirma que la comparación es jsonb=jsonb (nunca un
  --     cast a texto que pudiera "casi" coincidir).
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = false,
      temporada_ganadora = 'BAJA', es_promocion = true, precio_final_autoritativo = false
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó es_promocion=true cuando el único objeto del arreglo trae es_promocion:false.';
  exception when check_violation then
    raise notice 'OK: el CHECK de estado rechazó la discrepancia entre es_promocion y el único objeto del arreglo.';
  end;

  -- 4l2-4l7) HALLAZGO CORREGIDO: arreglos MIXTOS (2 elementos) donde el
  --     PRIMERO es válido y el SEGUNDO trae una clave ausente o en JSON
  --     null — el CHECK de estado NO inspecciona cada objeto del arreglo
  --     (solo compara columnas planas contra el ÚNICO objeto en el caso
  --     uniforme, y en el caso mixto ni siquiera eso); la única barrera que
  --     revisa CADA elemento es el CHECK de elementos (2). Antes de la
  --     corrección (`<>` en vez de `IS DISTINCT FROM`), una clave AUSENTE en
  --     el segundo elemento colaba el arreglo completo como "válido" pese a
  --     ser mixto. Las 6 variantes cubren las 3 claves × {ausente, JSON null}.
  --     procedencia_mixta=true / columnas planas NULL: el resto de la fila
  --     ya sería válido si no fuera por el elemento malformado — así se
  --     prueba SOLO el CHECK de elementos, no el de estado.

  -- 4l2) segundo elemento SIN la clave `temporada`.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"es_promocion":true,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con un elemento SIN la clave temporada.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con un elemento sin la clave `temporada`.';
  end;

  -- 4l3) segundo elemento SIN la clave `es_promocion`.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con un elemento SIN la clave es_promocion.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con un elemento sin la clave `es_promocion`.';
  end;

  -- 4l4) segundo elemento SIN la clave `precio_final_autoritativo`.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":true}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con un elemento SIN la clave precio_final_autoritativo.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con un elemento sin la clave `precio_final_autoritativo`.';
  end;

  -- 4l5) segundo elemento con `temporada` en JSON null.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":null,"es_promocion":true,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con `temporada` en JSON null.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con `temporada` en JSON null.';
  end;

  -- 4l6) segundo elemento con `es_promocion` en JSON null.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":null,"precio_final_autoritativo":false}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con `es_promocion` en JSON null.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con `es_promocion` en JSON null.';
  end;

  -- 4l7) segundo elemento con `precio_final_autoritativo` en JSON null.
  begin
    update public.tarifario_resultado set
      procedencia_temporadas = '[{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":true,"precio_final_autoritativo":null}]'::jsonb,
      procedencia_mixta = true,
      temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
    where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un arreglo mixto con `precio_final_autoritativo` en JSON null.';
  exception when check_violation then
    raise notice 'OK: el CHECK de elementos rechazó un arreglo mixto con `precio_final_autoritativo` en JSON null.';
  end;

  -- 4m) Caso uniforme válido CON precio_final_autoritativo=true (distingue
  --     de 4a, que lo probó en false) — confirma que la igualdad exacta
  --     también se exige/acepta correctamente en ese booleano.
  update public.tarifario_resultado set
    procedencia_temporadas = '[{"temporada":"PROMO10","es_promocion":true,"precio_final_autoritativo":true}]'::jsonb,
    procedencia_mixta = false,
    temporada_ganadora = 'PROMO10', es_promocion = true, precio_final_autoritativo = true
  where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (uniforme, precio_final_autoritativo=true) no afectó ninguna fila (id=% ya no existe).', v_id;
  end if;
  raise notice 'OK: caso uniforme con precio_final_autoritativo=true aceptado.';

  -- 4n) Estado histórico (todo NULL/false) — debe seguir siendo aceptado.
  update public.tarifario_resultado set
    procedencia_temporadas = null, procedencia_mixta = false,
    temporada_ganadora = null, es_promocion = null, precio_final_autoritativo = null
  where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (estado histórico) no afectó ninguna fila (id=% ya no existe).', v_id;
  end if;
  raise notice 'OK: estado histórico (sin procedencia) sigue aceptándose.';
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguno de los UPDATE queda persistido.
