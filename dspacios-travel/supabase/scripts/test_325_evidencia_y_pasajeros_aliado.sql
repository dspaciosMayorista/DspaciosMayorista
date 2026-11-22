-- TEST 325 — evidencia previa y pasajeros del aliado (reglas de la BASE, sin pasar por la app). SOLO sobre una base DESECHABLE con la 325 aplicada y los usuarios de revisión
-- (freelance@, freelance2@, administracion@revision.test; cotización C-REV78 de freelance@). Todo ocurre en UNA transacción que termina en ROLLBACK.
-- Uso: docker exec -i -e PGPASSWORD=postgres <pg> psql -h 127.0.0.1 -U supabase_admin -d <base_desechable> -X -v ON_ERROR_STOP=1 < test_325_evidencia_y_pasajeros_aliado.sql
begin;
do $$
declare
  cot bigint; camila uuid; beto uuid; adm uuid; r jsonb; n int; sha text; i int; e1 bigint;
  pax_antes int; ab_antes int; pp_antes int;
  -- La función compara contra la fecha de BOGOTÁ; la fecha del servidor (UTC) y de noche en Colombia va un día adelante: el fixture usa la misma fecha que la función.
  hoy_bogota date := (now() at time zone 'America/Bogota')::date;
begin
  select id into cot from public.cotizaciones where codigo = 'C-REV78';
  select id into camila from public.usuarios where lower(email) = 'freelance@revision.test';
  select id into beto from public.usuarios where lower(email) = 'freelance2@revision.test';
  select id into adm from public.usuarios where lower(email) = 'administracion@revision.test';
  if cot is null or camila is null or beto is null or adm is null then raise exception 'FALLO: faltan fixtures (C-REV78 / usuarios de revisión).'; end if;
  -- C-REV78 debe poder recibir evidencia: sin contrato y sin salida/vigencia vencidas (se fija dentro de la transacción; termina en ROLLBACK).
  update public.cotizaciones set vigencia_hasta = hoy_bogota + 30, fecha_salida = hoy_bogota + 60, numero_contrato = null, estado = 'abierta', pax = 3 where id = cot;
  select count(*) into ab_antes from public.abonos; select count(*) into pp_antes from public.cotizacion_pagos_previos;

  -- 1. propiedad y rol
  begin perform public.evidencia_cotizacion_registrar(cot, beto, 'x/1.pdf', 'a.pdf', 'application/pdf', 10, repeat('a', 64)); raise exception 'FALLO 1a: otro aliado adjuntó a una cotización ajena';
  exception when sqlstate 'F4702' then null; end;
  begin perform public.evidencia_cotizacion_registrar(cot, adm, 'x/2.pdf', 'a.pdf', 'application/pdf', 10, repeat('a', 64)); raise exception 'FALLO 1b: un usuario interno adjuntó como aliado';
  exception when sqlstate 'F4701' then null; end;
  begin perform public.evidencia_cotizacion_verificar(cot, beto); raise exception 'FALLO 1c: la verificación admitió una cotización ajena';
  exception when sqlstate 'F4702' then null; end;
  begin perform public.evidencia_cotizacion_registrar(-1, camila, 'x/3.pdf', 'a.pdf', 'application/pdf', 10, repeat('a', 64)); raise exception 'FALLO 1d: cotización inexistente aceptada';
  exception when sqlstate 'F4702' then null; end;

  -- 2. alta, contenido repetido y límite de 5
  r := public.evidencia_cotizacion_registrar(cot, camila, 'c/1.pdf', 'uno.pdf', 'application/pdf', 100, repeat('1', 64)); e1 := (r ->> 'id')::bigint;
  begin perform public.evidencia_cotizacion_registrar(cot, camila, 'c/1b.pdf', 'uno-otra-vez.pdf', 'application/pdf', 100, repeat('1', 64)); raise exception 'FALLO 2a: el mismo contenido vigente se repitió';
  exception when sqlstate 'F4711' then null; end;
  for i in 2..5 loop perform public.evidencia_cotizacion_registrar(cot, camila, 'c/' || i || '.png', 'n' || i || '.png', 'image/png', 100, repeat(i::text, 64)); end loop;
  begin perform public.evidencia_cotizacion_registrar(cot, camila, 'c/6.png', 'n6.png', 'image/png', 100, repeat('6', 64)); raise exception 'FALLO 2b: se admitió una sexta evidencia vigente';
  exception when sqlstate 'F4710' then null; end;
  select count(*) into n from public.cotizacion_evidencias where cotizacion_id = cot and vigente; if n <> 5 then raise exception 'FALLO 2c: % vigentes (esperado 5)', n; end if;

  -- 3. retirar: ajeno no puede; propio sí, conserva la fila; libera cupo; el mismo contenido puede volver
  begin perform public.evidencia_cotizacion_retirar(e1, beto); raise exception 'FALLO 3a: otro aliado retiró una evidencia ajena';
  exception when sqlstate 'F4702' then null; end;
  perform public.evidencia_cotizacion_retirar(e1, camila);
  select count(*) into n from public.cotizacion_evidencias where id = e1 and not vigente and retirado_en is not null and retirado_por = camila; if n <> 1 then raise exception 'FALLO 3b: el retiro no conservó la fila'; end if;
  begin perform public.evidencia_cotizacion_retirar(e1, camila); raise exception 'FALLO 3c: se retiró dos veces';
  exception when sqlstate 'F4712' then null; end;
  perform public.evidencia_cotizacion_registrar(cot, camila, 'c/7.pdf', 'uno-de-nuevo.pdf', 'application/pdf', 100, repeat('1', 64));

  -- 4. una evidencia NO es un pago
  if (select count(*) from public.abonos) <> ab_antes or (select count(*) from public.cotizacion_pagos_previos) <> pp_antes then raise exception 'FALLO 4: la evidencia tocó abonos o pagos previos'; end if;

  -- 5. pasajeros: reglas de documento (167/168), cupo y borrado
  r := public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"Marco","apellidos":"Vega"},{"nombres":"Sol","apellidos":"Vega","tipoDoc":"PAS","numeroDoc":"AB12345","fechaNacimiento":"2015-03-04"}]'::jsonb);
  if (r ->> 'guardados')::int <> 2 then raise exception 'FALLO 5a: no guardó 2'; end if;
  select jsonb_array_length(pasajeros) into n from public.cotizacion_pasajeros_aliado where cotizacion_id = cot; if n <> 2 then raise exception 'FALLO 5b'; end if;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B","tipoDoc":"CE","numeroDoc":"E1234567"}]'::jsonb); raise exception 'FALLO 5c: letras bajo CE aceptadas';
  exception when sqlstate 'F4720' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B","numeroDoc":"123"}]'::jsonb); raise exception 'FALLO 5d: número sin tipo aceptado';
  exception when sqlstate 'F4720' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"","apellidos":"B"}]'::jsonb); raise exception 'FALLO 5e: sin nombres aceptado';
  exception when sqlstate 'F4720' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B","fechaNacimiento":"2999-01-01"}]'::jsonb); raise exception 'FALLO 5f: nacimiento futuro aceptado';
  exception when sqlstate 'F4720' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B","fechaNacimiento":"2020-02-31"}]'::jsonb); raise exception 'FALLO 5g: fecha imposible aceptada';
  exception when sqlstate 'F4720' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B"},{"nombres":"C","apellidos":"D"},{"nombres":"E","apellidos":"F"}]'::jsonb); raise exception 'FALLO 5h: más pasajeros que viajeros cotizados';
  exception when sqlstate 'F4721' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, beto, '[{"nombres":"A","apellidos":"B"}]'::jsonb); raise exception 'FALLO 5i: otro aliado escribió pasajeros ajenos';
  exception when sqlstate 'F4702' then null; end;
  select jsonb_array_length(pasajeros) into n from public.cotizacion_pasajeros_aliado where cotizacion_id = cot; if n <> 2 then raise exception 'FALLO 5j: un intento rechazado cambió la lista guardada (%)', n; end if;
  perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[]'::jsonb);
  if exists (select 1 from public.cotizacion_pasajeros_aliado where cotizacion_id = cot) then raise exception 'FALLO 5k: la lista vacía no borró'; end if;

  -- 5b. vías de conversión que NO consumen la lista: se rechaza antes de guardar (F4722 dinámica/manual, F4723 ya trae pasajeros); vaciar siempre se permite
  update public.cotizaciones set tipo = 'manual' where id = cot;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B"}]'::jsonb); raise exception 'FALLO 5l: pasajeros guardados en una cotización dinámica';
  exception when sqlstate 'F4722' then null; end;
  perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[]'::jsonb);
  update public.cotizaciones set tipo = 'tarifario', payload = jsonb_build_object('pasajeros', jsonb_build_array(jsonb_build_object('nombres', 'Ya', 'apellidos', 'Capturado'))) where id = cot;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B"}]'::jsonb); raise exception 'FALLO 5m: se reemplazaron los pasajeros que ya traía la cotización';
  exception when sqlstate 'F4723' then null; end;
  update public.cotizaciones set payload = '{}'::jsonb where id = cot;
  perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B"}]'::jsonb);  -- tarifario sin pasajeros previos: se guarda
  perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[]'::jsonb);

  -- 6. estado: convertida, descartada, vencida o con salida pasada ya no aceptan nada
  update public.cotizaciones set numero_contrato = (select numero_contrato from public.ventas order by numero_contrato limit 1) where id = cot;
  begin perform public.evidencia_cotizacion_registrar(cot, camila, 'c/8.pdf', 'z.pdf', 'application/pdf', 100, repeat('9', 64)); raise exception 'FALLO 6a: adjuntó a una cotización convertida';
  exception when sqlstate 'F4703' then null; end;
  begin perform public.cotizacion_pasajeros_aliado_guardar(cot, camila, '[{"nombres":"A","apellidos":"B"}]'::jsonb); raise exception 'FALLO 6b: pasajeros en una cotización convertida';
  exception when sqlstate 'F4703' then null; end;
  update public.cotizaciones set numero_contrato = null, vigencia_hasta = hoy_bogota - 1 where id = cot;
  begin perform public.evidencia_cotizacion_verificar(cot, camila); raise exception 'FALLO 6c: cotización vencida aceptada';
  exception when sqlstate 'F4705' then null; end;

  raise notice 'TEST 325: OK (propiedad, rol, repetido, límite, retiro, no-es-pago, documentos, cupo, estado)';
end $$;
rollback;
