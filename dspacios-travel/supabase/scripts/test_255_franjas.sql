-- Prueba SQL de la 255 (franjas horarias de traslado). Termina en ROLLBACK: no deja datos. Ejecutar SOLO en un Postgres LOCAL con la 255 ya aplicada
-- (preflight → migración → postcheck → ESTE script → rollback_255). NO ejecutar en la base compartida.
-- Salida: UNA tabla caso | esperado | observado | estado (OK / FALLA).
begin;

create temp table _res255 (n int, caso text, esperado text, observado text, estado text) on commit drop;

do $$
declare
  v_srv bigint; v_temp bigint; v_temp2 bigint; v_obs text; n int := 0;
begin
  -- Datos mínimos: un servicio con dos vigencias.
  insert into public.servicios_adicionales (nombre) values ('__test255__') returning id into v_srv;
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (v_srv, 'T1', '2026-01-01', '2026-12-31') returning id into v_temp;
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (v_srv, 'T2', '2027-01-01', '2027-12-31') returning id into v_temp2;

  -- 1. franja nocturna que cruza medianoche: se acepta
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp, '19:00', '06:00', 'llegada', 'monto', 40000, 'grupo');
    v_obs := 'aceptada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'franja 19:00–06:00 llegada (cruza medianoche)', 'aceptada', v_obs, case when v_obs = 'aceptada' then 'OK' else 'FALLA' end);

  -- 2. misma franja horaria pero tramo SALIDA: no se solapa con la de llegada
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp, '19:00', '06:00', 'salida', 'porcentaje', 15, 'persona');
    v_obs := 'aceptada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'mismo horario en tramo salida (no solapa con llegada)', 'aceptada', v_obs, case when v_obs = 'aceptada' then 'OK' else 'FALLA' end);

  -- 3. solape dentro de la medianoche, mismo tramo: rechazada (23P01)
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp, '05:00', '08:00', 'llegada', 'monto', 1, 'grupo');
    v_obs := 'aceptada';
  exception when sqlstate '23P01' then v_obs := 'rechazada 23P01'; when others then v_obs := 'otro error: ' || sqlerrm; end;
  insert into _res255 values (n, 'solape 05:00–08:00 con 19:00–06:00 (llegada)', 'rechazada 23P01', v_obs, case when v_obs = 'rechazada 23P01' then 'OK' else 'FALLA' end);

  -- 4. contigua: empieza donde termina la otra (06:00): se acepta (fin excluido)
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp, '06:00', '19:00', 'llegada', 'monto', 10000, 'grupo');
    v_obs := 'aceptada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'franja contigua 06:00–19:00 (límite fin/inicio)', 'aceptada', v_obs, case when v_obs = 'aceptada' then 'OK' else 'FALLA' end);

  -- 5. «ambos» choca con las de llegada y salida
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp, '10:00', '11:00', 'ambos', 'monto', 1, 'grupo');
    v_obs := 'aceptada';
  exception when sqlstate '23P01' then v_obs := 'rechazada 23P01'; when others then v_obs := 'otro error: ' || sqlerrm; end;
  insert into _res255 values (n, '«ambos» 10:00–11:00 choca con 06:00–19:00', 'rechazada 23P01', v_obs, case when v_obs = 'rechazada 23P01' then 'OK' else 'FALLA' end);

  -- 6. otra vigencia: mismo horario sin conflicto
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '19:00', '06:00', 'llegada', 'monto', 50000, 'grupo');
    v_obs := 'aceptada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'mismo horario en OTRA vigencia', 'aceptada', v_obs, case when v_obs = 'aceptada' then 'OK' else 'FALLA' end);

  -- 7. checks: desde = hasta, hora inválida, valor 0, tramo/tipo/cobro fuera de dominio
  n := n + 1;
  begin insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '10:00', '10:00', 'salida', 'monto', 1, 'grupo'); v_obs := 'aceptada';
  exception when check_violation then v_obs := 'check'; when others then v_obs := 'otro: ' || sqlerrm; end;
  insert into _res255 values (n, 'desde = hasta', 'check', v_obs, case when v_obs = 'check' then 'OK' else 'FALLA' end);
  n := n + 1;
  begin insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '25:00', '10:00', 'salida', 'monto', 1, 'grupo'); v_obs := 'aceptada';
  exception when check_violation then v_obs := 'check'; when others then v_obs := 'otro: ' || sqlerrm; end;
  insert into _res255 values (n, 'hora 25:00', 'check', v_obs, case when v_obs = 'check' then 'OK' else 'FALLA' end);
  n := n + 1;
  begin insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '10:00', '11:00', 'salida', 'monto', 0, 'grupo'); v_obs := 'aceptada';
  exception when check_violation then v_obs := 'check'; when others then v_obs := 'otro: ' || sqlerrm; end;
  insert into _res255 values (n, 'valor 0', 'check', v_obs, case when v_obs = 'check' then 'OK' else 'FALLA' end);
  n := n + 1;
  begin insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '10:00', '11:00', 'otro', 'monto', 1, 'grupo'); v_obs := 'aceptada';
  exception when check_violation then v_obs := 'check'; when others then v_obs := 'otro: ' || sqlerrm; end;
  insert into _res255 values (n, 'tramo fuera de dominio', 'check', v_obs, case when v_obs = 'check' then 'OK' else 'FALLA' end);

  -- 8. 24:00 solo como hora final (todo el día de una vigencia sin otras franjas)
  n := n + 1;
  begin
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (v_temp2, '00:00', '24:00', 'salida', 'monto', 1, 'grupo');
    v_obs := 'aceptada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'franja 00:00–24:00 (todo el día) en salida de T2', 'aceptada', v_obs, case when v_obs = 'aceptada' then 'OK' else 'FALLA' end);

  -- 9. editar una franja sobre sí misma no choca consigo
  n := n + 1;
  begin
    update public.servicio_suplementos_franja set valor = 99 where servicio_temporada_id = v_temp and hora_desde = '19:00' and tramo = 'llegada';
    v_obs := 'actualizada';
  exception when others then v_obs := 'rechazada: ' || sqlerrm; end;
  insert into _res255 values (n, 'UPDATE de una franja sin cambiar su horario', 'actualizada', v_obs, case when v_obs = 'actualizada' then 'OK' else 'FALLA' end);

  -- 10. borrar la vigencia borra sus franjas (CASCADE)
  n := n + 1;
  delete from public.servicio_temporadas where id = v_temp2;
  insert into _res255 values (n, 'borrar vigencia borra sus franjas', '0', (select count(*) from public.servicio_suplementos_franja where servicio_temporada_id = v_temp2)::text,
    case when (select count(*) from public.servicio_suplementos_franja where servicio_temporada_id = v_temp2) = 0 then 'OK' else 'FALLA' end);
end $$;

select n, caso, esperado, observado, estado from _res255 order by n;

rollback;
