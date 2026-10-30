-- ───────────────────────────────────────────────────────────────────────────
-- 252 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 252. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- El cuerpo VIGENTE de guardar_programa_hoteles se compara por tokens con el de la 244: cualquier cambio de lógica (un hotfix) da REVISAR y la 252 no debe aplicarse.
-- No imprime filas de negocio: solo conteos, atributos y huellas.
-- ───────────────────────────────────────────────────────────────────────────
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
),
f as (select p.oid, p.prosecdef, p.proconfig from pg_proc p where p.oid = to_regprocedure('public.guardar_programa_hoteles(bigint,jsonb)')),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'funcion_presente', (select count(*) = 1 from f)::text, 'true', case when (select count(*) = 1 from f) then 'OK' else 'REVISAR' end
  union all
  select 2, 'cuerpo_igual_al_de_la_244_por_tokens', coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'guardar' and fa.origen = 'vivo' and fb.origen = 'de_la_244'), false)::text, 'true', case when coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'guardar' and fa.origen = 'vivo' and fb.origen = 'de_la_244'), false) then 'OK' else 'REVISAR' end
  union all
  select 3, 'security_invoker_y_search_path_fijo', coalesce((select (not prosecdef and proconfig::text like '%search_path%')::text from f), 'sin_funcion'), 'true',
         case when coalesce((select not prosecdef and proconfig::text like '%search_path%' from f), false) then 'OK' else 'REVISAR' end
  union all
  select 4, 'solo_authenticated_ejecuta', coalesce(((select bool_or(has_function_privilege('authenticated', f.oid, 'EXECUTE')) from f) and not (select bool_or(has_function_privilege('anon', f.oid, 'EXECUTE')) from f))::text, 'sin_funcion'), 'true', case when coalesce((select bool_or(has_function_privilege('authenticated', f.oid, 'EXECUTE')) from f) and not (select bool_or(has_function_privilege('anon', f.oid, 'EXECUTE')) from f), false) then 'OK' else 'REVISAR' end
  union all
  select 5, 'indice_unico_de_nombre_presente', (to_regclass('public.uq_programa_hoteles_nombre') is not null)::text, 'true', case when to_regclass('public.uq_programa_hoteles_nombre') is not null then 'OK' else 'REVISAR' end
  union all
  select 6, 'respaldo_252_ausente_y_252_no_aplicada', (to_regclass('public.respaldo_252') is null)::text, 'true', case when to_regclass('public.respaldo_252') is null then 'OK' else 'REVISAR' end
  union all
  select 7, 'hoteles_con_nombre_temporal_residual', (select count(*) from public.programa_hoteles where nombre like chr(1) || '%')::text, '0', case when (select count(*) from public.programa_hoteles where nombre like chr(1) || '%') = 0 then 'OK' else 'REVISAR' end
  union all
  select 8, 'programa_hoteles_total', (select count(*) from public.programa_hoteles)::text, 'igual en el postcheck', 'INFO'
  union all
  select 9, 'huella_de_programa_hoteles_que_la_252_no_debe_tocar',
         md5(coalesce((select string_agg(h.id::text || ':' || h.programa_id::text || ':' || h.orden::text || ':' || h.nombre, '|' order by h.id) from public.programa_hoteles h), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 10, 'huella_exacta_de_la_definicion_previa', md5(coalesce((select md5(pg_get_functiondef(oid)) from f), '')), 'igual a la guardada en el respaldo', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
