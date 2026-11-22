-- ROLLBACK 326: restaura la definición de cotizacion_pasajeros_aliado_guardar de la 325 (tope = máximo de los pax − 1). No toca datos.
begin;
create or replace function public.cotizacion_pasajeros_aliado_guardar(p_cotizacion_id bigint, p_actor uuid, p_pasajeros jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.cotizaciones; v_max integer; v_i integer := 0; el jsonb; v_out jsonb := '[]'::jsonb;
  v_nom text; v_ape text; v_tipo text; v_num text; v_nac text; v_nacion text;
begin
  c := public.f325_cotizacion_propia(p_cotizacion_id, p_actor);
  if p_pasajeros is null or jsonb_typeof(p_pasajeros) <> 'array' then raise exception 'F4720: la lista de pasajeros no es válida.' using errcode = 'F4720'; end if;
  -- Solo se guarda donde la conversión CONSUME la lista (la pantalla del carrito y la del tarifario sin pasajeros); en cualquier otra vía se dice antes de guardar, no después de prometer.
  -- Vaciar la lista siempre se permite.
  if jsonb_array_length(p_pasajeros) > 0 then
    if c.tipo not in ('carrito', 'tarifario') then
      raise exception 'F4722: esta cotización se convierte con el titular; no admite pasajeros adicionales escritos por el aliado.' using errcode = 'F4722';
    end if;
    if jsonb_typeof(c.payload -> 'pasajeros') = 'array' and jsonb_array_length(c.payload -> 'pasajeros') > 0 then
      raise exception 'F4723: esta cotización ya trae sus pasajeros (los capturó D''spacios); no se reemplazan.' using errcode = 'F4723';
    end if;
  end if;
  -- Los pasajeros adicionales son los que faltan además del titular: nunca más que los viajeros cotizados.
  select greatest(coalesce(c.pax, 1),
                  coalesce((select max((i ->> 'pax')::int) from jsonb_array_elements(coalesce(c.payload -> 'items', '[]'::jsonb) || coalesce(c.payload -> 'tours', '[]'::jsonb)) i where (i ->> 'pax') ~ '^\d+$'), 1)) - 1
    into v_max;
  if jsonb_array_length(p_pasajeros) > v_max then
    raise exception 'F4721: esta cotización admite hasta % pasajero(s) adicional(es) además del titular.', v_max using errcode = 'F4721';
  end if;
  for el in select * from jsonb_array_elements(p_pasajeros) loop
    v_i := v_i + 1;
    if jsonb_typeof(el) <> 'object' then raise exception 'F4720: pasajero %: formato inválido.', v_i using errcode = 'F4720'; end if;
    v_nom := btrim(coalesce(el ->> 'nombres', '')); v_ape := btrim(coalesce(el ->> 'apellidos', ''));
    v_tipo := btrim(coalesce(el ->> 'tipoDoc', '')); v_num := btrim(coalesce(el ->> 'numeroDoc', ''));
    v_nac := btrim(coalesce(el ->> 'fechaNacimiento', '')); v_nacion := btrim(coalesce(el ->> 'nacionalidad', ''));
    if v_nom = '' or v_ape = '' then raise exception 'F4720: pasajero %: nombres y apellidos son obligatorios.', v_i using errcode = 'F4720'; end if;
    if length(v_nom) > 100 or length(v_ape) > 100 or length(v_nacion) > 60 then raise exception 'F4720: pasajero %: un texto es demasiado largo.', v_i using errcode = 'F4720'; end if;
    if v_tipo <> '' and v_tipo not in ('CC', 'CE', 'TI', 'RC', 'PAS') then raise exception 'F4720: pasajero %: tipo de documento inválido.', v_i using errcode = 'F4720'; end if;
    if v_num <> '' then
      if v_tipo = '' then raise exception 'F4720: pasajero %: elige el tipo de documento.', v_i using errcode = 'F4720'; end if;
      if length(v_num) > 30 then raise exception 'F4720: pasajero %: el número de documento es demasiado largo.', v_i using errcode = 'F4720'; end if;
      if v_tipo <> 'PAS' and v_num !~ '^\d+$' then raise exception 'F4720: pasajero %: el documento debe ser solo números (excepto Pasaporte).', v_i using errcode = 'F4720'; end if;
      if v_tipo = 'PAS' and v_num !~ '^[A-Za-z0-9]+$' then raise exception 'F4720: pasajero %: el pasaporte solo admite letras y números.', v_i using errcode = 'F4720'; end if;
    elsif v_tipo <> '' then v_tipo := '';  -- tipo sin número: no se guarda un tipo suelto
    end if;
    if v_nac <> '' then
      if v_nac !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'F4720: pasajero %: fecha de nacimiento inválida.', v_i using errcode = 'F4720'; end if;
      begin
        if v_nac::date > (now() at time zone 'America/Bogota')::date or v_nac::date < date '1900-01-01' then raise exception 'F4720: pasajero %: fecha de nacimiento fuera de rango.', v_i using errcode = 'F4720'; end if;
      exception when datetime_field_overflow or invalid_datetime_format then raise exception 'F4720: pasajero %: fecha de nacimiento inválida.', v_i using errcode = 'F4720';
      end;
    end if;
    v_out := v_out || jsonb_build_object('nombres', v_nom, 'apellidos', v_ape, 'tipoDoc', v_tipo, 'numeroDoc', v_num, 'fechaNacimiento', v_nac, 'nacionalidad', v_nacion);
  end loop;
  if jsonb_array_length(v_out) = 0 then
    delete from public.cotizacion_pasajeros_aliado where cotizacion_id = c.id;
    return jsonb_build_object('guardados', 0);
  end if;
  insert into public.cotizacion_pasajeros_aliado (cotizacion_id, tenant, pasajeros, actualizado_por) values (c.id, c.tenant, v_out, p_actor)
  on conflict (cotizacion_id) do update set pasajeros = excluded.pasajeros, actualizado_en = now(), actualizado_por = excluded.actualizado_por;
  return jsonb_build_object('guardados', jsonb_array_length(v_out));
end $$;
revoke all on function public.cotizacion_pasajeros_aliado_guardar(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cotizacion_pasajeros_aliado_guardar(bigint, uuid, jsonb) to service_role;
commit;
