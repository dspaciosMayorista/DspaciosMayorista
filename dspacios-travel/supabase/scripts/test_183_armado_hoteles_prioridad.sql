-- Test 183 — cobertura funcional completa de `armado_hoteles.prioridad`
-- (hoteles recomendados por paquete). Usa DATOS SINTÉTICOS PROPIOS (dos
-- paquetes y hasta 7 hoteles de prueba) para no depender de que el entorno
-- ya tenga suficientes hoteles/paquetes reales — construidos y destruidos
-- dentro de transacciones con ROLLBACK, así que no deja NINGÚN dato persistido
-- sin importar el resultado. Requiere que ya exista al menos un `destino`
-- (para las FK de `hoteles`/`armado_paquetes`) — si no hay ninguno, el bloque
-- FALLA EXPLÍCITAMENTE con `raise exception` (nunca `rollback` dentro del
-- propio `do $$ ... $$`: PL/pgSQL no permite control de transacción dentro de
-- un bloque anónimo — abortarlo con una excepción deja la transacción en
-- estado fallido, y el `rollback;` final del script, fuera del bloque, la
-- cierra sin dejar ningún dato — mismo efecto, forma válida).

begin;

do $$
declare
  v_destino_id  bigint;
  v_paquete_a   bigint;
  v_paquete_b   bigint;
  v_hotel       bigint[] := array[]::bigint[];
  v_hotel_id    bigint;
  i             int;
  v_count       int;
begin
  select id into v_destino_id from public.destinos limit 1;
  if v_destino_id is null then
    raise exception 'TEST 183 NO EJECUTADO: no hay ningún destino en esta base (necesita al menos 1 fila en destinos para las FK de hoteles/armado_paquetes). Vuelve a correr este test sobre un entorno con datos base.';
  end if;

  -- ── Datos sintéticos: 2 paquetes, 7 hoteles de prueba ─────────────────────
  insert into public.armado_paquetes (nombre, tipo, destino_id, pct_mk)
    values ('TEST183 Paquete A', 'porcion_terrestre', v_destino_id, 0.20)
    returning id into v_paquete_a;
  insert into public.armado_paquetes (nombre, tipo, destino_id, pct_mk)
    values ('TEST183 Paquete B', 'porcion_terrestre', v_destino_id, 0.20)
    returning id into v_paquete_b;

  -- `insert ... returning` NO puede usarse como expresión dentro de una
  -- concatenación de arreglo (`v_hotel || (insert ...)` no es SQL válido) —
  -- cada INSERT captura su id en una variable escalar (`returning id into
  -- v_hotel_id`), y ESE valor se agrega al arreglo con `array_append`.
  for i in 1..7 loop
    insert into public.hoteles (nombre, destino_id, modelo_tarifario)
      values ('TEST183 Hotel ' || i, v_destino_id, 'persona')
      returning id into v_hotel_id;
    v_hotel := array_append(v_hotel, v_hotel_id);
  end loop;
  raise notice 'Datos sintéticos creados: paquete_a=%, paquete_b=%, hoteles=%', v_paquete_a, v_paquete_b, v_hotel;

  -- ── Caso: paquete con 0 recomendados ───────────────────────────────────────
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_a, v_hotel[1]);
  select count(*) into v_count from public.armado_hoteles where paquete_id = v_paquete_a and prioridad is not null;
  if v_count <> 0 then raise exception 'FALLO: paquete con 0 recomendados marcados no debería tener ninguna fila con prioridad.'; end if;
  raise notice 'OK: paquete con 0 recomendados — 0 filas con prioridad.';

  -- ── Caso: paquete con 1 recomendado ────────────────────────────────────────
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select count(*) into v_count from public.armado_hoteles where paquete_id = v_paquete_a and prioridad is not null;
  if v_count <> 1 then raise exception 'FALLO: paquete con 1 recomendado marcado debería tener exactamente 1 fila con prioridad (tiene %).', v_count; end if;
  raise notice 'OK: paquete con 1 recomendado — 1 fila con prioridad.';

  -- ── Caso: paquete con 2 y 3 recomendados ──────────────────────────────────
  insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values
    (v_paquete_a, v_hotel[2], 2),
    (v_paquete_a, v_hotel[3], 3);
  select count(*) into v_count from public.armado_hoteles where paquete_id = v_paquete_a and prioridad is not null;
  if v_count <> 3 then raise exception 'FALLO: paquete con 3 recomendados marcados debería tener exactamente 3 filas con prioridad (tiene %).', v_count; end if;
  raise notice 'OK: paquete con 3 recomendados — 3 filas con prioridad (1,2,3).';

  -- ── Caso: paquete con 6 recomendados (el máximo) ──────────────────────────
  insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values
    (v_paquete_a, v_hotel[4], 4),
    (v_paquete_a, v_hotel[5], 5),
    (v_paquete_a, v_hotel[6], 6);
  select count(*) into v_count from public.armado_hoteles where paquete_id = v_paquete_a and prioridad is not null;
  if v_count <> 6 then raise exception 'FALLO: paquete con 6 recomendados marcados debería tener exactamente 6 filas con prioridad (tiene %).', v_count; end if;
  raise notice 'OK: paquete con 6 recomendados (el máximo permitido) — 6 filas con prioridad (1..6).';

  -- ── Caso: séptimo recomendado rechazado ───────────────────────────────────
  -- No hay un CHECK de "máximo 6 filas" explícito — el límite de 6 sale de
  -- que solo existen las prioridades 1..6 (el CHECK de rango) y la unicidad
  -- parcial por paquete: un séptimo hotel NO puede tomar ninguna prioridad
  -- 1..6 porque las 6 ya están ocupadas en este paquete (7 no es un valor
  -- válido de por sí). Se prueban AMBOS ángulos del rechazo.
  begin
    insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values (v_paquete_a, v_hotel[7], 7);
    raise exception 'FALLO: se aceptó prioridad = 7 (fuera de rango) para el séptimo hotel.';
  exception when check_violation then
    raise notice 'OK: séptimo recomendado con prioridad=7 rechazado por el CHECK de rango.';
  end;
  begin
    insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values (v_paquete_a, v_hotel[7], 1);
    raise exception 'FALLO: se aceptó un séptimo hotel tomando la prioridad 1, ya ocupada en el mismo paquete.';
  exception when unique_violation then
    raise notice 'OK: séptimo recomendado intentando reusar la prioridad 1 (ya ocupada) rechazado por el índice único parcial.';
  end;

  -- ── Caso: prioridad duplicada dentro del mismo paquete rechazada ─────────
  -- (ya probado arriba con el séptimo hotel; se repite explícito con un
  -- UPDATE sobre una fila YA existente, no solo un INSERT nuevo.)
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_a, v_hotel[7]);
  begin
    update public.armado_hoteles set prioridad = 3 where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
    raise exception 'FALLO: se aceptó un UPDATE que duplica la prioridad 3 dentro del mismo paquete.';
  exception when unique_violation then
    raise notice 'OK: UPDATE que duplicaría la prioridad 3 dentro del mismo paquete, rechazado.';
  end;

  -- ── Caso: la MISMA prioridad en paquetes DISTINTOS sí es válida ─────────
  insert into public.armado_hoteles (paquete_id, hotel_id, prioridad) values (v_paquete_b, v_hotel[1], 1);
  select count(*) into v_count from public.armado_hoteles where hotel_id = v_hotel[1] and prioridad = 1;
  if v_count <> 2 then raise exception 'FALLO: el mismo hotel con prioridad 1 en DOS paquetes distintos (a y b) debería dar 2 filas (tiene %).', v_count; end if;
  raise notice 'OK: la misma prioridad (1) coexiste sin conflicto en dos paquetes distintos (a y b) — la unicidad es por paquete_id, no global.';

  -- ── Caso: desmarcar libera la prioridad ──────────────────────────────────
  update public.armado_hoteles set prioridad = null where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
  if not found then raise exception 'FALLO: tras desmarcar hotel[1], hotel[7] no pudo tomar la prioridad 1 recién liberada.'; end if;
  raise notice 'OK: desmarcar un hotel (prioridad -> NULL) libera su prioridad para otro hotel del mismo paquete.';

  -- ── Caso: cambiar de prioridad libera la anterior ────────────────────────
  -- hotel[7] tiene prioridad 1 (recién tomada); lo cambia a 2, que YA está
  -- ocupada por hotel[2] — debe rechazarse mientras hotel[2] la conserve...
  begin
    update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
    raise exception 'FALLO: se aceptó que hotel[7] tomara la prioridad 2 mientras hotel[2] todavía la tenía.';
  exception when unique_violation then
    raise notice 'OK: cambiar a una prioridad todavía ocupada por otro hotel del mismo paquete sigue rechazándose.';
  end;
  -- ...pero si hotel[2] LIBERA la 2 (cambia a otra prioridad libre, ej. la 1
  -- recién dejada por sí mismo no aplica — usa una prioridad realmente libre:
  -- ninguna queda libre en este punto salvo la que tenía hotel[1], ya null).
  -- Simplifica: hotel[2] se desmarca, y ENTONCES hotel[7] toma la 2.
  update public.armado_hoteles set prioridad = null where paquete_id = v_paquete_a and hotel_id = v_hotel[2];
  update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
  if not found then raise exception 'FALLO: tras liberar la prioridad 2, hotel[7] no pudo tomarla.'; end if;
  -- Confirma que la prioridad ANTERIOR de hotel[7] (1) quedó libre — otro
  -- hotel puede tomarla sin conflicto.
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_a and hotel_id = v_hotel[2];
  if not found then raise exception 'FALLO: la prioridad 1, anterior de hotel[7] antes de cambiar a 2, no quedó libre para hotel[2].'; end if;
  raise notice 'OK: cambiar la prioridad de un hotel (1 -> 2) libera automáticamente la prioridad anterior (1) para otro hotel del mismo paquete.';

  -- ── Caso: eliminar la asociación hotel-paquete no deja residuos ─────────
  delete from public.armado_hoteles where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
  select count(*) into v_count from public.armado_hoteles where paquete_id = v_paquete_a and hotel_id = v_hotel[7];
  if v_count <> 0 then raise exception 'FALLO: tras eliminar la asociación hotel[7]-paquete_a, sigue existiendo alguna fila.'; end if;
  -- La prioridad 2 (que tenía hotel[7]) debe quedar libre de inmediato.
  update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_a and hotel_id = v_hotel[6]; -- hotel[6] tenía 6, prueba que 2 está libre
  if not found then raise exception 'FALLO: tras eliminar la asociación de hotel[7] (prioridad 2), esa prioridad no quedó libre.'; end if;
  raise notice 'OK: eliminar la asociación hotel-paquete elimina su recomendación sin dejar residuos — la prioridad queda libre de inmediato.';

  raise notice 'TEST 183 COMPLETO: todos los casos de persistencia pasaron.';
end $$;

rollback;
-- ⚠️ ROLLBACK: NINGÚN dato sintético (paquetes, hoteles, asociaciones) de
-- este test queda persistido, sin importar el resultado.
