-- TEST 326 — tope de pasajeros adicionales del aliado según el universo DECLARADO de viajeros (reglas de la BASE). SOLO sobre una base DESECHABLE con la 325 y la 326 aplicadas y los
-- usuarios de revisión (freelance@revision.test, cotización C-REV78). Todo ocurre en UNA transacción que termina en ROLLBACK.
-- Uso: docker exec -i -e PGPASSWORD=postgres <pg> psql -h 127.0.0.1 -U supabase_admin -d <base_desechable> -X -v ON_ERROR_STOP=1 < test_326_pasajeros_aliado_tope_universo.sql
begin;
do $$
declare
  cot bigint; camila uuid; r jsonb;
  function_src text;
  p1 jsonb := '[{"nombres":"A","apellidos":"Uno"}]';
  p2 jsonb := '[{"nombres":"A","apellidos":"Uno"},{"nombres":"B","apellidos":"Dos"}]';
  p3 jsonb := '[{"nombres":"A","apellidos":"Uno"},{"nombres":"B","apellidos":"Dos"},{"nombres":"C","apellidos":"Tres"}]';
  p4 jsonb := '[{"nombres":"A","apellidos":"Uno"},{"nombres":"B","apellidos":"Dos"},{"nombres":"C","apellidos":"Tres"},{"nombres":"D","apellidos":"Cuatro"}]';
begin
  select id into cot from public.cotizaciones where codigo = 'C-REV78';
  select id into camila from public.usuarios where lower(email) = 'freelance@revision.test';
  if cot is null or camila is null then raise exception 'FALLO: faltan fixtures (C-REV78 / freelance@revision.test).'; end if;
  select prosrc into function_src from pg_proc where proname = 'cotizacion_pasajeros_aliado_guardar' and pronamespace = 'public'::regnamespace;
  if function_src not like '%v_unidades%' then raise exception 'FALLO 0: la función no es la de la 326 (¿falta aplicarla?).'; end if;
  update public.cotizaciones set vigencia_hasta = current_date + 30, fecha_salida = current_date + 60, numero_contrato = null, estado = 'abierta' where id = cot;

  -- A. carrito con UNA sola unidad de 2 viajeros ⇒ 1 adicional; el segundo se rechaza
  update public.cotizaciones set tipo = 'carrito', pax = 2, payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 2)), 'tours', '[]'::jsonb) where id = cot;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, p1); if (r ->> 'guardados')::int <> 1 then raise exception 'FALLO A1: %', r; end if;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, p2); raise exception 'FALLO A2: una sola unidad de 2 admitió 2 adicionales';
  exception when sqlstate 'F4721' then null; end;

  -- B. DOS unidades independientes de 2 (pueden ser viajeros distintos) ⇒ universo ambiguo; cota = suma (4) ⇒ hasta 3 adicionales (la 325 solo dejaba 1)
  update public.cotizaciones set payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 2), jsonb_build_object('pax', 2)), 'tours', '[]'::jsonb) where id = cot;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, p3); if (r ->> 'guardados')::int <> 3 then raise exception 'FALLO B1: %', r; end if;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, p4); raise exception 'FALLO B2: la cota (suma de unidades) no se aplicó';
  exception when sqlstate 'F4721' then null; end;

  -- C. un tour VINCULADO a su hotel no es una unidad aparte ⇒ vuelve al universo exacto (2 ⇒ 1 adicional)
  update public.cotizaciones set payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 2, 'ref', 'h1')), 'tours', jsonb_build_array(jsonb_build_object('pax', 2, 'hotelRef', 'h1'))) where id = cot;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, p2); raise exception 'FALLO C1: el tour vinculado contó como unidad independiente';
  exception when sqlstate 'F4721' then null; end;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, p1); if (r ->> 'guardados')::int <> 1 then raise exception 'FALLO C2: %', r; end if;

  -- D. un tour SIN hotel (independiente) junto a un hotel de 2 ⇒ dos unidades ⇒ ambiguo (3 adicionales)
  update public.cotizaciones set payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 2, 'ref', 'h1')), 'tours', jsonb_build_array(jsonb_build_object('pax', 2))) where id = cot;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, p3); if (r ->> 'guardados')::int <> 3 then raise exception 'FALLO D1: %', r; end if;

  -- E. un tipo que no es carrito se rige por su pax (3 ⇒ 2 adicionales); el resto de reglas de la 325 sigue intacto (vaciar siempre se permite)
  update public.cotizaciones set tipo = 'tarifario', pax = 3, payload = '{}'::jsonb where id = cot;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, p2); if (r ->> 'guardados')::int <> 2 then raise exception 'FALLO E1: %', r; end if;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, p3); raise exception 'FALLO E2: tarifario de 3 admitió 3 adicionales';
  exception when sqlstate 'F4721' then null; end;
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[]'::jsonb); if (r ->> 'guardados')::int <> 0 then raise exception 'FALLO E3: %', r; end if;
  update public.cotizaciones set tipo = 'manual' where id = cot;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, p1); raise exception 'FALLO E4: una cotización manual aceptó pasajeros';
  exception when sqlstate 'F4722' then null; end;

  -- G. LÍMITE TÉCNICO de captura (30 = CHECK de la tabla): en la frontera guarda; una más se rechaza con el mensaje propio (F4721), NUNCA con el 23514 del CHECK; nada se trunca
  declare
    lista30 jsonb; lista31 jsonb; r2 jsonb; n int;
  begin
    select jsonb_agg(jsonb_build_object('nombres', 'P' || i, 'apellidos', 'Z')) into lista30 from generate_series(1, 30) i;
    select jsonb_agg(jsonb_build_object('nombres', 'P' || i, 'apellidos', 'Z')) into lista31 from generate_series(1, 31) i;
    -- G1: dos servicios independientes de 16 (universo 2..32): se ofrecen hasta 30 y 30 guardan
    update public.cotizaciones set tipo = 'carrito', pax = 16, payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 16), jsonb_build_object('pax', 16)), 'tours', '[]'::jsonb) where id = cot;
    r2 := public.cotizacion_pasajeros_aliado_guardar(cot, camila, lista30);
    if (r2 ->> 'guardados')::int <> 30 then raise exception 'FALLO G1: %', r2; end if;
    -- G2: 31 supera el límite técnico aunque el universo (31 adicionales) lo permitiría
    begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, lista31); raise exception 'FALLO G2: 31 pasajeros guardados con el universo 16+16';
    exception when sqlstate 'F4721' then if sqlerrm not like '%hasta 30 pasajeros adicionales%completa el resto%' then raise exception 'FALLO G2b: mensaje inesperado: %', sqlerrm; end if;
              when check_violation then raise exception 'FALLO G2c: el CHECK de la tabla disparó (23514) en vez del mensaje propio'; end;
    select jsonb_array_length(pasajeros) into n from public.cotizacion_pasajeros_aliado where cotizacion_id = cot;
    if n <> 30 then raise exception 'FALLO G3: el intento rechazado cambió la lista guardada (% en vez de 30)', n; end if;
    -- G4: universo EXACTO de 40 (un solo servicio): 30 guardan, 31 se rechaza con el mismo mensaje (el universo pide 39; no se miente que estén todos)
    update public.cotizaciones set pax = 40, payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 40)), 'tours', '[]'::jsonb) where id = cot;
    r2 := public.cotizacion_pasajeros_aliado_guardar(cot, camila, lista30);
    if (r2 ->> 'guardados')::int <> 30 then raise exception 'FALLO G4: %', r2; end if;
    begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, lista31); raise exception 'FALLO G5: 31 guardados con universo exacto de 40';
    exception when sqlstate 'F4721' then null; end;
    -- G6: bajo el límite técnico el mensaje sigue siendo el del universo (frontera 29 adicionales de un universo de 30)
    update public.cotizaciones set pax = 30, payload = jsonb_build_object('items', jsonb_build_array(jsonb_build_object('pax', 30)), 'tours', '[]'::jsonb) where id = cot;
    begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, lista30); raise exception 'FALLO G6: universo de 30 admitió 30 adicionales';
    exception when sqlstate 'F4721' then if sqlerrm not like '%admite hasta 29 pasajero(s) adicional(es)%' then raise exception 'FALLO G6b: %', sqlerrm; end if; end;
  end;

  -- F. permisos: ni anon ni authenticated ejecutan la función (solo service_role)
  if has_function_privilege('authenticated', 'public.cotizacion_pasajeros_aliado_guardar(bigint,uuid,jsonb)', 'execute') or has_function_privilege('anon', 'public.cotizacion_pasajeros_aliado_guardar(bigint,uuid,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.cotizacion_pasajeros_aliado_guardar(bigint,uuid,jsonb)', 'execute') then raise exception 'FALLO F1: permisos de ejecución'; end if;
  raise notice 'TEST 326: OK (A–G)';
end $$;
rollback;
