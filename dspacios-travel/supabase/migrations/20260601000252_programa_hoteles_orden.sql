-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 252 · Programas — guardar_programa_hoteles ya no falla por el ORDEN de insertar/actualizar/borrar.
-- Scripts: supabase/scripts/{preflight,postcheck,rollback}_252_programa_hoteles_orden.sql
--
-- Causa exacta: la 244 aplicaba la lista hotel por hotel (actualizar o insertar con el nombre pedido) y borraba los hoteles omitidos AL FINAL. El índice único
-- uq_programa_hoteles_nombre (programa_id, lower(btrim(nombre))) se comprueba fila a fila, así que un estado final SIN nombres repetidos fallaba igual cuando una
-- operación intermedia chocaba con una fila que aún no se había movido o borrado: (1) quitar un hotel y agregar otro con el mismo nombre (el INSERT corría antes del
-- DELETE), (2) intercambiar los nombres de dos hoteles, (3) renombrar en cadena (A→B, B→C).
-- Qué cambia: la función valida los ids, BORRA primero los hoteles omitidos y libera el nombre de los que se conservan (nombre temporal único por id) antes de aplicar la
-- lista. Mismo contrato (firma, permisos, SECURITY INVOKER, search_path, vigencias solapadas, conservación de ids). Un nombre realmente repetido en la lista sigue
-- rechazándolo el índice, y como todo ocurre en una transacción, un fallo no deja cambios parciales.
--
-- Seguridad del reemplazo: antes de tocar nada COMPRUEBA por tokens que el cuerpo vigente es el de la 244; un hotfix o diferencia de lógica la ABORTA. Guarda la
-- definición previa EXACTA (pg_get_functiondef + md5) en public.respaldo_252 solo para service_role/superusuario. No toca datos; no edita migraciones aplicadas.
-- Orden: preflight → 252 → postcheck → recién después el código.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
declare v_ok boolean;
begin
  if to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)') is null then
    raise exception '252 ABORTADA: falta public.guardar_programa_hoteles (cadena 001-251).';
  end if;
  if to_regclass('public.respaldo_252') is not null then
    raise exception '252 ABORTADA: ya existe public.respaldo_252 (la 252 ya está aplicada; usa el rollback antes de reaplicar).';
  end if;
  with
  textos(nombre, origen, cuerpo) as (
    values
      ('guardar', 'vivo', (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)'))),
      ('guardar', 'de_la_244', $aud$
declare
  h        jsonb;
  x        jsonb;
  v_id     bigint;
  v_ids    bigint[] := '{}';
  v_orden  integer := 0;
begin
  perform 1 from public.programas where id = p_programa_id for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;
  if p_hoteles is null or jsonb_typeof(p_hoteles) <> 'array' then
    raise exception 'La lista de hoteles debe ser un arreglo.';
  end if;

  for h in select value from jsonb_array_elements(p_hoteles) loop
    v_id := nullif(h->>'id', '')::bigint;
    if v_id is not null then
      if not exists (select 1 from public.programa_hoteles where id = v_id and programa_id = p_programa_id) then
        raise exception 'El hotel % no pertenece al programa % (o no tienes acceso).', v_id, p_programa_id;
      end if;
      update public.programa_hoteles
         set orden = v_orden,
             nombre = h->>'nombre',
             zona = nullif(btrim(coalesce(h->>'zona', '')), ''),
             tipo_habitacion = nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
             max_pax_habitacion = nullif(h->>'max_pax_habitacion', '')::integer,
             max_menores_habitacion = nullif(h->>'max_menores_habitacion', '')::integer,
             proveedor_id = nullif(h->>'proveedor_id', '')::bigint
       where id = v_id;
    else
      insert into public.programa_hoteles (programa_id, orden, nombre, zona, tipo_habitacion, max_pax_habitacion, max_menores_habitacion, proveedor_id)
      values (
        p_programa_id, v_orden, h->>'nombre',
        nullif(btrim(coalesce(h->>'zona', '')), ''),
        nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
        nullif(h->>'max_pax_habitacion', '')::integer,
        nullif(h->>'max_menores_habitacion', '')::integer,
        nullif(h->>'proveedor_id', '')::bigint
      ) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
    v_orden := v_orden + 1;

    delete from public.programa_hotel_precios where hotel_id = v_id;
    delete from public.programa_hotel_noches where hotel_id = v_id;

    for x in select value from jsonb_array_elements(coalesce(h->'base', '[]'::jsonb)) loop
      insert into public.programa_hotel_precios (hotel_id, desde, hasta, modalidad_servicios, bajo_solicitud,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'modalidad_servicios',
        coalesce((x->>'bajo_solicitud')::boolean, false),
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;

    for x in select value from jsonb_array_elements(coalesce(h->'noches', '[]'::jsonb)) loop
      insert into public.programa_hotel_noches (hotel_id, desde, hasta, unidad_cobro,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'unidad_cobro',
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;
  end loop;

  delete from public.programa_hoteles where programa_id = p_programa_id and not (id = any (v_ids));

  -- Vigencias solapadas: se rechazan AL GUARDAR (el motor de reserva las bloquea igual
  -- si llegaran por otra vía, pero lo correcto es no dejarlas entrar).
  if exists (
    select 1
      from public.programa_hotel_precios a
      join public.programa_hotel_precios b
        on b.hotel_id = a.hotel_id and b.modalidad_servicios = a.modalidad_servicios and b.id > a.id
       and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios.';
  end if;
  if exists (
    select 1
      from public.programa_hotel_noches a
      join public.programa_hotel_noches b
        on b.hotel_id = a.hotel_id and b.id > a.id and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de noche adicional solapadas para un mismo hotel.';
  end if;
end;
$aud$)
  ),
  tokens as (
  select t.nombre, t.origen, x.ord,
         case when left(x.r[1], 1) in ('''', '"') then x.r[1] else lower(x.r[1]) end as tok
    from textos t
   cross join lateral regexp_matches(coalesce(t.cuerpo, ''), '(--[^\n]*|''(?:[^'']|'''')*''|"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*|[0-9]+(?:\.[0-9]+)?|::|->>|->|#>>|#>|<=|>=|<>|!=|\|\||[^\s])', 'g') with ordinality as x(r, ord)
   where x.r[1] not like '--%'
),
firmas as (
  select nombre, origen, md5(string_agg(tok, ' ' order by ord)) as huella
    from tokens group by nombre, origen
)
  select coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'guardar' and fa.origen = 'vivo' and fb.origen = 'de_la_244'), false) into v_ok;
  if v_ok is not true then
    raise exception '252 ABORTADA: el cuerpo vigente de guardar_programa_hoteles NO coincide con el de la 244 (hotfix o diferencia de lógica). Revísalo antes de reemplazar.';
  end if;
end;
$$;

-- Definición previa EXACTA, para el rollback.
create table public.respaldo_252 (
  nombre     text primary key,
  firma      text not null,
  definicion text not null,
  md5        text not null,
  creado_en  timestamptz not null default now()
);
revoke all on table public.respaldo_252 from public, anon, authenticated;
alter table public.respaldo_252 enable row level security;
insert into public.respaldo_252 (nombre, firma, definicion, md5)
select 'guardar_programa_hoteles', 'public.guardar_programa_hoteles(bigint,jsonb)', pg_get_functiondef(to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)')), md5(pg_get_functiondef(to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)')));

create or replace function public.guardar_programa_hoteles(p_programa_id bigint, p_hoteles jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  h        jsonb;
  x        jsonb;
  v_id     bigint;
  v_ids    bigint[] := '{}';
  v_orden  integer := 0;
begin
  perform 1 from public.programas where id = p_programa_id for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;
  if p_hoteles is null or jsonb_typeof(p_hoteles) <> 'array' then
    raise exception 'La lista de hoteles debe ser un arreglo.';
  end if;

  -- 252: el estado FINAL solicitado puede tener nombres únicos aunque el orden de las operaciones los choque (quitar un hotel y agregar otro con su nombre, intercambiar
  -- nombres, renombrar en cadena). Por eso, antes de escribir: (1) se validan los ids, (2) se borran los hoteles omitidos y (3) los que se conservan liberan su nombre con
  -- uno temporal propio (único por id); recién entonces se aplica la lista. Todo en esta misma transacción: si algo falla (incluido un nombre realmente repetido,
  -- que sigue rechazando uq_programa_hoteles_nombre) no queda ningún cambio.
  for h in select value from jsonb_array_elements(p_hoteles) loop
    v_id := nullif(h->>'id', '')::bigint;
    if v_id is not null then
      if not exists (select 1 from public.programa_hoteles where id = v_id and programa_id = p_programa_id) then
        raise exception 'El hotel % no pertenece al programa % (o no tienes acceso).', v_id, p_programa_id;
      end if;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  delete from public.programa_hoteles where programa_id = p_programa_id and not (id = any (v_ids));
  update public.programa_hoteles set nombre = chr(1) || 'tmp-' || id where programa_id = p_programa_id and id = any (v_ids);

  for h in select value from jsonb_array_elements(p_hoteles) loop
    v_id := nullif(h->>'id', '')::bigint;
    if v_id is not null then
      update public.programa_hoteles
         set orden = v_orden,
             nombre = h->>'nombre',
             zona = nullif(btrim(coalesce(h->>'zona', '')), ''),
             tipo_habitacion = nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
             max_pax_habitacion = nullif(h->>'max_pax_habitacion', '')::integer,
             max_menores_habitacion = nullif(h->>'max_menores_habitacion', '')::integer,
             proveedor_id = nullif(h->>'proveedor_id', '')::bigint
       where id = v_id;
    else
      insert into public.programa_hoteles (programa_id, orden, nombre, zona, tipo_habitacion, max_pax_habitacion, max_menores_habitacion, proveedor_id)
      values (
        p_programa_id, v_orden, h->>'nombre',
        nullif(btrim(coalesce(h->>'zona', '')), ''),
        nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
        nullif(h->>'max_pax_habitacion', '')::integer,
        nullif(h->>'max_menores_habitacion', '')::integer,
        nullif(h->>'proveedor_id', '')::bigint
      ) returning id into v_id;
    end if;
    v_orden := v_orden + 1;

    delete from public.programa_hotel_precios where hotel_id = v_id;
    delete from public.programa_hotel_noches where hotel_id = v_id;

    for x in select value from jsonb_array_elements(coalesce(h->'base', '[]'::jsonb)) loop
      insert into public.programa_hotel_precios (hotel_id, desde, hasta, modalidad_servicios, bajo_solicitud,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'modalidad_servicios',
        coalesce((x->>'bajo_solicitud')::boolean, false),
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;

    for x in select value from jsonb_array_elements(coalesce(h->'noches', '[]'::jsonb)) loop
      insert into public.programa_hotel_noches (hotel_id, desde, hasta, unidad_cobro,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'unidad_cobro',
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;
  end loop;

  -- Vigencias solapadas: se rechazan AL GUARDAR (el motor de reserva las bloquea igual
  -- si llegaran por otra vía, pero lo correcto es no dejarlas entrar).
  if exists (
    select 1
      from public.programa_hotel_precios a
      join public.programa_hotel_precios b
        on b.hotel_id = a.hotel_id and b.modalidad_servicios = a.modalidad_servicios and b.id > a.id
       and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios.';
  end if;
  if exists (
    select 1
      from public.programa_hotel_noches a
      join public.programa_hotel_noches b
        on b.hotel_id = a.hotel_id and b.id > a.id and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de noche adicional solapadas para un mismo hotel.';
  end if;
end;
$$;

revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from public;
revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from anon;
grant execute on function public.guardar_programa_hoteles(bigint, jsonb) to authenticated;

commit;
