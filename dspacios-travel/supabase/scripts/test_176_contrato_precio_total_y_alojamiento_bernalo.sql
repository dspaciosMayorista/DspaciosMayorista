-- Prueba de comportamiento de la migracion 176.
-- Ejecutar solo en Postgres local despues de aplicar la migracion.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- psql -d <base-local> -v ON_ERROR_STOP=1 \
--   -f supabase/scripts/test_176_contrato_precio_total_y_alojamiento_bernalo.sql

begin;

do $$
declare
  v_destino_id   bigint;
  v_hotel_id     bigint;
  -- Debe cumplir el formato exigido por ventas_numero_contrato_formato_por_tenant
  -- (tenant default 'mayorista' -> '^DTM-[0-9]{4,}$').
  v_numero       constant text := 'DTM-9176000001';
  v_rechazo      boolean;
  v_item_id      bigint;
begin
  -- ── Datos reales mínimos (sin bypass de FK: se prueba el CASCADE/SET NULL
  -- de verdad, no una simulación) ──────────────────────────────────────────
  insert into public.destinos (nombre) values ('__test_176_destino__') returning id into v_destino_id;
  insert into public.hoteles (nombre, destino_id) values ('__test_176_hotel__', v_destino_id) returning id into v_hotel_id;
  insert into public.ventas (numero_contrato, cliente) values (v_numero, '__test_176_cliente__');

  -- ═══════════════════════════════════════════════════════════════════════
  -- A) contrato_items.modo_precio / valor_total
  -- ═══════════════════════════════════════════════════════════════════════

  -- A1) Fila legado: sin declarar modo_precio, debe quedar por_persona +
  -- valor_total null (comportamiento actual, sin cambios).
  insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
  values (v_numero, '__test_176_item_legado__', 2, 0, 100000, 0, 0)
  returning id into v_item_id;

  if not exists (
    select 1 from public.contrato_items
    where id = v_item_id and modo_precio = 'por_persona' and valor_total is null
  ) then
    raise exception 'TEST 176 fallo: una fila legado (sin modo_precio explicito) no quedo por_persona + valor_total null';
  end if;

  -- A2) Línea total: acepta un único valor_total con modo_precio='total'.
  insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
  values (v_numero, '__test_176_item_total__', 'total', 450000);

  if not exists (
    select 1 from public.contrato_items
    where numero_contrato = v_numero and descripcion = '__test_176_item_total__'
      and modo_precio = 'total' and valor_total = 450000
  ) then
    raise exception 'TEST 176 fallo: una linea total valida (valor_total >= 0) fue rechazada o no quedo con el valor esperado';
  end if;

  -- A3) CHECK rechaza modo_precio='total' sin valor_total.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_total_sin_valor__', 'total', null);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: modo_precio=total sin valor_total fue aceptado';
  end if;

  -- A4) CHECK rechaza modo_precio='por_persona' CON valor_total (los dos
  -- modelos a la vez en la misma fila).
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_persona_con_valor__', 'por_persona', 100000);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: modo_precio=por_persona con valor_total fue aceptado';
  end if;

  -- A5) CHECK rechaza un modo_precio fuera del enum.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_modo_invalido__', 'por_habitacion', 100000);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: un modo_precio fuera de (por_persona,total) fue aceptado';
  end if;

  -- A6) CHECK rechaza valor_total negativo en modo total.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_total_negativo__', 'total', -1);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: valor_total negativo en modo total fue aceptado';
  end if;

  -- A7) CORRECCIÓN: CHECK rechaza valor_total = NaN en modo total.
  -- `NaN >= 0` evalúa TRUE en Postgres (NaN compara como mayor que
  -- cualquier valor real de `numeric`) — sin el filtro explícito
  -- `valor_total::text not in (...)`, este insert pasaría el CHECK viejo.
  -- El tipo `numeric(15,2)` SÍ admite NaN como valor de columna (no hay
  -- overflow al convertir el literal): el rechazo debe venir DEL CHECK
  -- (check_violation), no de un error de tipo.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_total_nan__', 'total', 'NaN'::numeric);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: valor_total = NaN en modo total fue aceptado (regresion del bug corregido: NaN >= 0 es TRUE en Postgres)';
  end if;

  -- A8) CORRECCIÓN: valor_total = Infinity en modo total se rechaza — pero
  -- NO por el CHECK: `numeric(15,2)` (precisión/escala declaradas) rechaza
  -- el valor especial Infinity AL CONVERTIR el literal, antes de llegar a
  -- evaluar ningún CHECK. Documentado y verificado localmente contra
  -- PostgreSQL 15.8: SQLSTATE 22003 (numeric_value_out_of_range),
  -- mensaje "numeric field overflow". Esta prueba confirma que el rechazo
  -- sigue ocurriendo (por la razón que sea) y dejan constancia del SQLSTATE
  -- real en vez de asumir un check_violation que nunca llega a dispararse.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_total_infinity__', 'total', 'Infinity'::numeric);
  exception
    when numeric_value_out_of_range then
      v_rechazo := true;
      raise notice 'TEST 176 A8: Infinity rechazado por overflow de tipo (SQLSTATE %), no por el CHECK -- comportamiento esperado en numeric(15,2).', sqlstate;
    when check_violation then
      v_rechazo := true;
      raise notice 'TEST 176 A8: Infinity rechazado por el CHECK (SQLSTATE %) en este entorno -- tambien valido, el filtro explicito lo cubre igual.', sqlstate;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: valor_total = Infinity en modo total fue aceptado';
  end if;

  -- A9) CORRECCIÓN: valor_total = -Infinity en modo total, mismo criterio que A8.
  v_rechazo := false;
  begin
    insert into public.contrato_items (numero_contrato, descripcion, modo_precio, valor_total)
    values (v_numero, '__test_176_total_menos_infinity__', 'total', '-Infinity'::numeric);
  exception
    when numeric_value_out_of_range then
      v_rechazo := true;
      raise notice 'TEST 176 A9: -Infinity rechazado por overflow de tipo (SQLSTATE %), no por el CHECK -- comportamiento esperado en numeric(15,2).', sqlstate;
    when check_violation then
      v_rechazo := true;
      raise notice 'TEST 176 A9: -Infinity rechazado por el CHECK (SQLSTATE %) en este entorno -- tambien valido, el filtro explicito lo cubre igual.', sqlstate;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: valor_total = -Infinity en modo total fue aceptado';
  end if;

  raise notice 'TEST 176 A OK: modo_precio/valor_total de contrato_items se comportan segun lo esperado, incluida la correccion de finitud (NaN/Infinity/-Infinity rechazados)';

  -- ═══════════════════════════════════════════════════════════════════════
  -- B) contrato_alojamiento_bernalo
  -- ═══════════════════════════════════════════════════════════════════════

  insert into public.contrato_alojamiento_bernalo
    (numero_contrato, habitacion_id, orden, hotel_id, hotel_nombre, categoria, alimentacion, adultos, edades_menores, snapshot)
  values
    (v_numero, 'doble-0', 0, v_hotel_id, '__test_176_hotel__', 'Estandar', 'PC', 2, '[5, 8]'::jsonb, '{"tarifaId":"t1","totalNeto":400000}'::jsonb);

  insert into public.contrato_alojamiento_bernalo
    (numero_contrato, habitacion_id, orden, hotel_id, hotel_nombre, adultos, snapshot)
  values
    (v_numero, 'triple-0', 1, v_hotel_id, '__test_176_hotel__', 3, '{"tarifaId":"t2","totalNeto":600000}'::jsonb);

  -- B1) unique (numero_contrato, habitacion_id): la MISMA habitación no
  -- puede repetirse en el mismo contrato.
  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-0', v_hotel_id, '__test_176_hotel__', 2, '{"otra":true}'::jsonb);
  exception when unique_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: habitacion_id duplicada dentro del mismo contrato fue aceptada';
  end if;

  -- B2) edades_menores debe ser un ARREGLO JSON (no objeto/escalar).
  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, edades_menores, snapshot)
    values (v_numero, 'doble-1', v_hotel_id, '__test_176_hotel__', 2, '{"no":"es un arreglo"}'::jsonb, '{"x":1}'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: edades_menores como objeto (no arreglo) fue aceptado';
  end if;

  -- B3) snapshot debe ser un OBJETO JSON (no arreglo/escalar).
  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-2', v_hotel_id, '__test_176_hotel__', 2, '[1, 2, 3]'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: snapshot como arreglo (no objeto) fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-3', v_hotel_id, '__test_176_hotel__', 2, '"solo texto"'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: snapshot como escalar de texto (no objeto) fue aceptado';
  end if;

  -- B4) ids/textos obligatorios no vacíos.
  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, '   ', v_hotel_id, '__test_176_hotel__', 2, '{"x":1}'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: habitacion_id vacio/solo-espacios fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-4', v_hotel_id, '', 2, '{"x":1}'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: hotel_nombre vacio fue aceptado';
  end if;

  -- B5) orden/adultos no negativos.
  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, orden, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-5', -1, v_hotel_id, '__test_176_hotel__', 2, '{"x":1}'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: orden negativo fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.contrato_alojamiento_bernalo (numero_contrato, habitacion_id, hotel_id, hotel_nombre, adultos, snapshot)
    values (v_numero, 'doble-6', v_hotel_id, '__test_176_hotel__', -2, '{"x":1}'::jsonb);
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 176 fallo: adultos negativo fue aceptado';
  end if;

  raise notice 'TEST 176 B OK: unique/CHECK de contrato_alojamiento_bernalo se comportan segun lo esperado';

  -- B6) FK hotel_id ON DELETE SET NULL: borrar el hotel del catalogo NO
  -- borra el snapshot, solo pierde el vinculo.
  delete from public.hoteles where id = v_hotel_id;

  if exists (select 1 from public.contrato_alojamiento_bernalo where numero_contrato = v_numero and hotel_id is not null) then
    raise exception 'TEST 176 fallo: al borrar el hotel del catalogo, hotel_id no quedo en null en los snapshots existentes';
  end if;
  if (select count(*) from public.contrato_alojamiento_bernalo where numero_contrato = v_numero) <> 2 then
    raise exception 'TEST 176 fallo: borrar el hotel del catalogo borro (en cascada) filas de contrato_alojamiento_bernalo -- deberia ser SET NULL, nunca CASCADE';
  end if;

  raise notice 'TEST 176 B6 OK: FK hotel_id ON DELETE SET NULL confirmada (el snapshot historico sobrevive sin el hotel del catalogo)';

  -- B7) FK numero_contrato ON DELETE CASCADE: borrar el contrato SI borra
  -- sus snapshots y sus contrato_items (ambas tablas cuelgan de ventas).
  delete from public.ventas where numero_contrato = v_numero;

  if exists (select 1 from public.contrato_alojamiento_bernalo where numero_contrato = v_numero) then
    raise exception 'TEST 176 fallo: borrar la venta no elimino en cascada los snapshots de contrato_alojamiento_bernalo';
  end if;
  if exists (select 1 from public.contrato_items where numero_contrato = v_numero) then
    raise exception 'TEST 176 fallo: borrar la venta no elimino en cascada las filas de contrato_items (comportamiento preexistente, sin relacion con esta migracion, pero se verifica que sigue intacto)';
  end if;

  raise notice 'TEST 176 B7 OK: FK numero_contrato ON DELETE CASCADE confirmada para contrato_alojamiento_bernalo (y el CASCADE preexistente de contrato_items sigue intacto)';

  raise notice 'TEST 176 OK: todas las verificaciones de comportamiento pasaron';
end
$$;

rollback;

\echo '=== Verificacion post-ROLLBACK: nada de la prueba quedo en la base ==='
select
  (select count(*) from public.destinos where nombre = '__test_176_destino__')            as destinos_de_prueba,
  (select count(*) from public.hoteles where nombre = '__test_176_hotel__')                as hoteles_de_prueba,
  (select count(*) from public.ventas where numero_contrato = 'DTM-9176000001')     as ventas_de_prueba,
  (select count(*) from public.contrato_items where numero_contrato = 'DTM-9176000001') as items_de_prueba,
  (select count(*) from public.contrato_alojamiento_bernalo where numero_contrato = 'DTM-9176000001') as snapshots_de_prueba;
\echo 'esperado: las cinco columnas en 0 (la transaccion completa termino en ROLLBACK)'
