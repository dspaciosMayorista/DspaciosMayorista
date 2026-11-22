-- 326 · O-3 (corrección de la 325) — tope de pasajeros adicionales del aliado respetando el universo DECLARADO de viajeros del carrito.
-- La 325 calculaba el tope como el MÁXIMO de los pax de los ítems/tours (− 1): en un carrito con dos unidades independientes (p. ej. dos hoteles con viajeros distintos) bloqueaba pasajeros legítimos,
-- justo lo que la regla del carrito prohíbe (el total real no es el máximo ni la suma de los ítems: lo declara quien convierte). Ahora: UNA sola unidad con viajeros ⇒ su pax exacto − 1;
-- DOS o más unidades independientes ⇒ solo una COTA DE SEGURIDAD (suma de las unidades − 1). Un tour vinculado a un hotel (`hotelRef`) no cuenta como unidad. Cotización no carrito ⇒ `pax` − 1.
-- LÍMITE TÉCNICO: el CHECK de la tabla (325) admite entre 1 y 30 adicionales; la función lo respeta y lo DICE (F4721 con su propio texto) en vez de dejar que el CHECK dispare un 23514 genérico. No se sube el CHECK.
-- Solo reemplaza la función `cotizacion_pasajeros_aliado_guardar` (mismo dueño, SECURITY DEFINER, search_path y permisos: se comprueban). No toca tablas ni datos. Rollback: supabase/scripts/rollback_326_*.sql.
do $$ begin
  if to_regprocedure('public.cotizacion_pasajeros_aliado_guardar(bigint,uuid,jsonb)') is null then raise exception '326: falta la 325 (cotizacion_pasajeros_aliado_guardar).'; end if;
end $$;

create or replace function public.cotizacion_pasajeros_aliado_guardar(p_cotizacion_id bigint, p_actor uuid, p_pasajeros jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.cotizaciones; v_max integer; v_unidades integer; v_suma integer; v_maximo integer; v_limite constant integer := 30; v_i integer := 0; el jsonb; v_out jsonb := '[]'::jsonb;
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
  -- Los pasajeros adicionales son los que faltan además del titular. TOPE (326): una cotización ordinaria o de UNA sola unidad con viajeros (un hotel, con o sin tours vinculados a él;
  -- un tour suelto) admite hasta su pax exacto − 1. Con DOS o más unidades independientes el universo NO está determinado (pueden ser los mismos viajeros, distintos o solapados; lo declara el
  -- personal al convertir): ahí el tope es solo una COTA DE SEGURIDAD — la suma de los pax de esas unidades − 1 — nunca el máximo de los ítems (que bloqueaba grupos distintos legítimos).
  if c.tipo = 'carrito' then
    select count(*), coalesce(sum(u.pax), 0)
      into v_unidades, v_suma
      from (
        select (i ->> 'pax')::int as pax from jsonb_array_elements(coalesce(c.payload -> 'items', '[]'::jsonb)) i where (i ->> 'pax') ~ '^\d+$'
        union all
        select (t ->> 'pax')::int from jsonb_array_elements(coalesce(c.payload -> 'tours', '[]'::jsonb)) t
         where (t ->> 'pax') ~ '^\d+$' and coalesce(nullif(t ->> 'hotelRef', ''), '') = ''   -- un tour vinculado a un hotel viaja con los viajeros de ese hotel
      ) u;
    select coalesce(max((i ->> 'pax')::int), 1) into v_maximo
      from jsonb_array_elements(coalesce(c.payload -> 'items', '[]'::jsonb) || coalesce(c.payload -> 'tours', '[]'::jsonb)) i where (i ->> 'pax') ~ '^\d+$';
    v_max := (case when v_unidades >= 2 then greatest(v_suma, coalesce(c.pax, 1)) else greatest(coalesce(c.pax, 1), v_maximo) end) - 1;
  else
    v_max := greatest(coalesce(c.pax, 1), 1) - 1;
  end if;
  if v_max > v_limite then
    -- El universo pide más de lo que la lista del aliado puede guardar: se explica y el resto lo completa el personal al convertir (no se trunca ni se finge que están todos).
    if jsonb_array_length(p_pasajeros) > v_limite then
      raise exception 'F4721: Aquí se pueden dejar hasta % pasajeros adicionales; el personal de D''spacios completa el resto al convertir la cotización.', v_limite using errcode = 'F4721';
    end if;
  elsif jsonb_array_length(p_pasajeros) > v_max then
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
