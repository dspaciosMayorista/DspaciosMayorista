-- ───────────────────────────────────────────────────────────────────────────
-- 251 · POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre DESPUÉS de la 251. Columnas: control · valor · esperado · estado.
-- El cuerpo vigente se compara por tokens con el ESPERADO de la 251; el respaldo debe guardar la previa exacta (la de la 250).
-- Compara 'funcion_ejecutable_por_roles_de_la_api', 'cotizaciones_total' y las huellas con las del preflight (la 251 no escribe datos de negocio).
-- ───────────────────────────────────────────────────────────────────────────
with
textos(nombre, origen, cuerpo) as (
  values
    ('crear_hija', 'vivo', (select p.prosrc from pg_proc p where p.oid = to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)'))),
    ('crear_hija', 'esperado', $esp$
declare
  c public.cotizaciones; op public.cotizacion_opciones; pl jsonb; v_pay jsonb; v_det jsonb;
  v_hija bigint; v_vig date; v_suma numeric; v_esperado numeric; v_email text; n int; v_neto boolean; v_pn text; v_pd text; v_tipo text;
begin
  select * into c from public.cotizaciones where id = p_madre_id for update;
  if not found or c.modo <> 'comparativa' or c.estado <> 'abierta' then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la comparativa ya no está disponible.' using errcode = 'P0001';
  end if;
  if p_version is distinct from c.version then
    raise exception 'COMPARATIVA_VERSION: la comparativa cambió; recárgala.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'COMPARATIVA_VENCIDA: la comparativa venció.' using errcode = 'P0001';
  end if;
  -- Integridad: nadie alteró lo económico (ni siquiera fuera de la API).
  if c.sello_economico is null or c.sello_economico <> f211_priv.sello_madre(c.id) then
    raise exception 'COMPARATIVA_MADRE_ALTERADA: la comparativa fue alterada; no se puede elegir.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizaciones h where h.cotizacion_origen_id = c.id and h.estado <> 'descartada') then
    raise exception 'COMPARATIVA_HIJA_ACTIVA: ya hay una opción elegida; descártala (sin pagos) para elegir otra.' using errcode = 'P0001';
  end if;
  select * into op from public.cotizacion_opciones
   where cotizacion_id = c.id and opcion_ref = p_opcion and acomodacion_ref = p_acom;
  if not found then
    raise exception 'COMPARATIVA_OPCION: la opción o la acomodación no existen.' using errcode = 'P0001';
  end if;

  pl := op.plantilla_hija;
  v_vig := least(c.vigencia_hasta, case when p_canal = 'publico' then public.fecha_negocio() + 1 else c.vigencia_hasta end);
  v_pay := pl->'payload';
  v_det := pl->'detalle';
  -- 251 (#64): en una opción B2B asistida en NETO el cliente comercial es el ALIADO (su identidad ya está congelada en la fila y en detalle.venta de la plantilla).
  -- Quien la elige desde el enlace es el TITULAR de la reserva: sus datos van a payload.cliente y a detalle.venta.titular_*; ni la fila ni el cliente del detalle se
  -- sobrescriben con la persona. En PVP con comisión y B2C el visitante sigue siendo el cliente, como hasta ahora.
  v_neto := coalesce(v_pay #>> '{b2bAsistido,modo_compra}', '') = 'neta';
  if v_neto then
    -- La plantilla NETO debe nombrar AL ALIADO del plan congelado (nombre, y documento y tipo fiscal cuando el plan los trae): una plantilla con el cliente de otra persona
    -- se rechaza antes de insertar nada, en vez de heredar su identidad.
    v_pn := lower(regexp_replace(btrim(coalesce(v_pay #>> '{b2bAsistido,aliado_nombre}', '')), '\s+', ' ', 'g'));
    if v_pn = ''
       or lower(regexp_replace(btrim(coalesce(pl->>'cliente', '')), '\s+', ' ', 'g')) is distinct from v_pn
       or lower(regexp_replace(btrim(coalesce(v_det #>> '{venta,cliente}', pl->>'cliente', '')), '\s+', ' ', 'g')) is distinct from v_pn then
      raise exception 'COMPARATIVA_INCOHERENTE: el cliente comercial de la opción NETO no es el aliado del plan congelado.' using errcode = 'P0001';
    end if;
    if (v_pay->'b2bAsistido') ? 'aliado_documento' then
      v_pd := nullif(btrim(coalesce(v_pay #>> '{b2bAsistido,aliado_documento}', '')), '');
      if coalesce(nullif(btrim(coalesce(pl->>'cliente_documento', '')), ''), '') is distinct from coalesce(v_pd, '')
         or coalesce(nullif(btrim(coalesce(v_det #>> '{venta,cliente_documento}', pl->>'cliente_documento', '')), ''), '') is distinct from coalesce(v_pd, '') then
        raise exception 'COMPARATIVA_INCOHERENTE: el documento del cliente comercial de la opción NETO no es el del aliado del plan congelado.' using errcode = 'P0001';
      end if;
    end if;
    if nullif(btrim(coalesce(v_pay #>> '{b2bAsistido,aliado_tipo_documento}', '')), '') is not null
       and nullif(btrim(coalesce(v_det #>> '{venta,cliente_tipo_documento}', '')), '') is not null
       and upper(btrim(v_det #>> '{venta,cliente_tipo_documento}')) is distinct from upper(btrim(v_pay #>> '{b2bAsistido,aliado_tipo_documento}')) then
      raise exception 'COMPARATIVA_INCOHERENTE: el tipo de documento del cliente comercial de la opción NETO no es el del aliado del plan congelado.' using errcode = 'P0001';
    end if;
  end if;
  -- Tipo del documento de quien sustituye a la persona: solo el que el visitante suministró, del catálogo y con número; nunca el de la plantilla ni uno inventado (null).
  v_tipo := case
              when upper(btrim(coalesce(p_datos_cliente->>'tipoDoc', ''))) in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT')
                   and nullif(btrim(coalesce(p_datos_cliente->>'numeroDoc', '')), '') is not null
              then upper(btrim(p_datos_cliente->>'tipoDoc')) else null end;
  if p_datos_cliente is not null then
    v_pay := jsonb_set(coalesce(v_pay, '{}'::jsonb), '{cliente}',
               (p_datos_cliente - 'tipoDoc') || case when v_tipo is null then '{}'::jsonb else jsonb_build_object('tipoDoc', v_tipo) end, true);
    if v_neto then
      v_det := jsonb_set(coalesce(v_det, '{}'::jsonb), '{venta,titular_nombre}',
                 to_jsonb(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos',''))), true);
      v_det := jsonb_set(v_det, '{venta,titular_documento}', to_jsonb(coalesce(p_datos_cliente->>'numeroDoc','')), true);
      v_det := jsonb_set(v_det, '{venta,titular_tipo_documento}', coalesce(to_jsonb(v_tipo), 'null'::jsonb), true);
      v_det := jsonb_set(v_det, '{venta,titular_telefono}', to_jsonb(coalesce(p_datos_cliente->>'telefono','')), true);
      v_det := jsonb_set(v_det, '{venta,titular_email}', to_jsonb(coalesce(p_datos_cliente->>'email','')), true);
    else
      v_det := jsonb_set(coalesce(v_det, '{}'::jsonb), '{venta,cliente}',
                 to_jsonb(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos',''))), true);
      v_det := jsonb_set(v_det, '{venta,cliente_documento}', to_jsonb(coalesce(p_datos_cliente->>'numeroDoc','')), true);
      v_det := jsonb_set(v_det, '{venta,cliente_tipo_documento}', coalesce(to_jsonb(v_tipo), 'null'::jsonb), true);
      v_det := jsonb_set(v_det, '{venta,cliente_telefono}', to_jsonb(coalesce(p_datos_cliente->>'telefono','')), true);
    end if;
  end if;
  if p_actor_id is not null then select email into v_email from public.usuarios where id = p_actor_id; end if;

  insert into public.cotizaciones (
    tenant, tipo, modo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre,
    pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por,
    aliado_id, propietario_id, creado_por_id,
    cotizacion_origen_id, opcion_ref, acomodacion_ref, madre_version, madre_sello, vigencia_tope
  ) values (
    c.tenant, case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end, 'simple', 'abierta',
    v_pay, v_det,
    case when v_neto then pl->>'cliente'
         else coalesce(nullif(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos','')), ''), pl->>'cliente', c.cliente) end,
    case when v_neto then pl->>'cliente_documento'
         else coalesce(nullif(p_datos_cliente->>'numeroDoc',''), pl->>'cliente_documento', c.cliente_documento) end,
    coalesce(pl->>'destino', c.destino), pl->>'hotel',
    case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end,
    coalesce(pl->>'plan_nombre', c.plan_nombre), coalesce(nullif(pl->>'pax','')::int, c.pax),
    op.total, op.moneda,
    coalesce(nullif(pl->>'fecha_salida','')::date, c.fecha_salida), coalesce(nullif(pl->>'fecha_regreso','')::date, c.fecha_regreso),
    v_vig, c.asesor, c.creado_por,
    c.aliado_id, c.propietario_id, c.creado_por_id,
    c.id, p_opcion, p_acom, c.version, c.sello_economico, c.vigencia_hasta
  ) returning id into v_hija;

  if c.tipo = 'comparativa_manual' then
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio,
        proveedor, costo_neto, modo, pct_markup, ta, valor, opcion_ref)
    -- `orden` se renumera 0..n-1 (igual que una cotización dinámica común).
    select v_hija, (row_number() over (order by s.orden, s.id) - 1)::int, s.tipo_servicio, s.plataforma, s.nombre_servicio,
           s.proveedor, s.costo_neto, s.modo, s.pct_markup, s.ta, s.valor, null
      from public.cotizacion_servicios s
     where s.cotizacion_id = c.id and (s.opcion_ref is null or s.opcion_ref = p_opcion)
     order by s.orden, s.id;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'COMPARATIVA_INCOHERENTE: la opción no tiene servicios.' using errcode = 'P0001';
    end if;
    select coalesce(sum(valor), 0) into v_suma from public.cotizacion_servicios where cotizacion_id = v_hija;
    v_esperado := v_suma + greatest(coalesce((v_pay->>'recobro')::numeric, 0), 0)
                  + greatest(floor(coalesce((v_pay->>'ninos')::numeric, 0)), 0) * greatest(coalesce((v_pay->>'tarifaNino')::numeric, 0), 0);
  else
    select coalesce(sum((i->>'precio')::numeric), 0) into v_suma from jsonb_array_elements(coalesce(v_pay->'items','[]'::jsonb)) i;
    v_esperado := v_suma + coalesce((select sum((t->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'tours','[]'::jsonb)) t), 0)
                  -- 250 (#64): los vuelos manuales COMUNES de la opción (payload.manuales, precio declarado) también son parte del total, una sola vez.
                  + coalesce((select sum((m->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'manuales','[]'::jsonb)) m), 0);
  end if;
  if abs(v_esperado - op.total) > 0.5 then
    raise exception 'COMPARATIVA_INCOHERENTE: el total de la opción no coincide con sus componentes (% vs %).', v_esperado, op.total using errcode = 'P0001';
  end if;

  insert into public.cotizacion_comparativa_eventos
    (cotizacion_id, tenant, tipo, hija_id, opcion_ref, acomodacion_ref, version, actor_tipo, actor_id,
     validacion_id, solicitud_id, clave, huella, detalle)
  values (c.id, c.tenant, 'elegida', v_hija, p_opcion, p_acom, c.version, p_canal, p_actor_id,
     p_validacion, p_solicitud, p_clave, p_huella, jsonb_build_object('total', op.total, 'moneda', op.moneda));

  -- Las demás solicitudes pendientes quedan "superadas" (con evento).
  with sup as (
    update public.cotizacion_comparativa_solicitudes
       set estado = 'superada', ip_huella = null
     where cotizacion_id = c.id and estado = 'pendiente' and id is distinct from p_solicitud
    returning id)
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo)
  select c.id, c.tenant, 'solicitud_superada', id, v_hija, 'sistema' from sup;
  return v_hija;
end
$esp$),
    ('crear_hija', 'de_la_250', $aud$
declare
  c public.cotizaciones; op public.cotizacion_opciones; pl jsonb; v_pay jsonb; v_det jsonb;
  v_hija bigint; v_vig date; v_suma numeric; v_esperado numeric; v_email text; n int;
begin
  select * into c from public.cotizaciones where id = p_madre_id for update;
  if not found or c.modo <> 'comparativa' or c.estado <> 'abierta' then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la comparativa ya no está disponible.' using errcode = 'P0001';
  end if;
  if p_version is distinct from c.version then
    raise exception 'COMPARATIVA_VERSION: la comparativa cambió; recárgala.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'COMPARATIVA_VENCIDA: la comparativa venció.' using errcode = 'P0001';
  end if;
  -- Integridad: nadie alteró lo económico (ni siquiera fuera de la API).
  if c.sello_economico is null or c.sello_economico <> f211_priv.sello_madre(c.id) then
    raise exception 'COMPARATIVA_MADRE_ALTERADA: la comparativa fue alterada; no se puede elegir.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizaciones h where h.cotizacion_origen_id = c.id and h.estado <> 'descartada') then
    raise exception 'COMPARATIVA_HIJA_ACTIVA: ya hay una opción elegida; descártala (sin pagos) para elegir otra.' using errcode = 'P0001';
  end if;
  select * into op from public.cotizacion_opciones
   where cotizacion_id = c.id and opcion_ref = p_opcion and acomodacion_ref = p_acom;
  if not found then
    raise exception 'COMPARATIVA_OPCION: la opción o la acomodación no existen.' using errcode = 'P0001';
  end if;

  pl := op.plantilla_hija;
  v_vig := least(c.vigencia_hasta, case when p_canal = 'publico' then public.fecha_negocio() + 1 else c.vigencia_hasta end);
  v_pay := pl->'payload';
  v_det := pl->'detalle';
  if p_datos_cliente is not null then
    v_pay := jsonb_set(coalesce(v_pay, '{}'::jsonb), '{cliente}', p_datos_cliente, true);
    v_det := jsonb_set(coalesce(v_det, '{}'::jsonb), '{venta,cliente}',
               to_jsonb(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos',''))), true);
    v_det := jsonb_set(v_det, '{venta,cliente_documento}', to_jsonb(coalesce(p_datos_cliente->>'numeroDoc','')), true);
    v_det := jsonb_set(v_det, '{venta,cliente_telefono}', to_jsonb(coalesce(p_datos_cliente->>'telefono','')), true);
  end if;
  if p_actor_id is not null then select email into v_email from public.usuarios where id = p_actor_id; end if;

  insert into public.cotizaciones (
    tenant, tipo, modo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre,
    pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por,
    aliado_id, propietario_id, creado_por_id,
    cotizacion_origen_id, opcion_ref, acomodacion_ref, madre_version, madre_sello, vigencia_tope
  ) values (
    c.tenant, case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end, 'simple', 'abierta',
    v_pay, v_det,
    coalesce(nullif(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos','')), ''), pl->>'cliente', c.cliente),
    coalesce(nullif(p_datos_cliente->>'numeroDoc',''), pl->>'cliente_documento', c.cliente_documento),
    coalesce(pl->>'destino', c.destino), pl->>'hotel',
    case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end,
    coalesce(pl->>'plan_nombre', c.plan_nombre), coalesce(nullif(pl->>'pax','')::int, c.pax),
    op.total, op.moneda,
    coalesce(nullif(pl->>'fecha_salida','')::date, c.fecha_salida), coalesce(nullif(pl->>'fecha_regreso','')::date, c.fecha_regreso),
    v_vig, c.asesor, c.creado_por,
    c.aliado_id, c.propietario_id, c.creado_por_id,
    c.id, p_opcion, p_acom, c.version, c.sello_economico, c.vigencia_hasta
  ) returning id into v_hija;

  if c.tipo = 'comparativa_manual' then
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio,
        proveedor, costo_neto, modo, pct_markup, ta, valor, opcion_ref)
    -- `orden` se renumera 0..n-1 (igual que una cotización dinámica común).
    select v_hija, (row_number() over (order by s.orden, s.id) - 1)::int, s.tipo_servicio, s.plataforma, s.nombre_servicio,
           s.proveedor, s.costo_neto, s.modo, s.pct_markup, s.ta, s.valor, null
      from public.cotizacion_servicios s
     where s.cotizacion_id = c.id and (s.opcion_ref is null or s.opcion_ref = p_opcion)
     order by s.orden, s.id;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'COMPARATIVA_INCOHERENTE: la opción no tiene servicios.' using errcode = 'P0001';
    end if;
    select coalesce(sum(valor), 0) into v_suma from public.cotizacion_servicios where cotizacion_id = v_hija;
    v_esperado := v_suma + greatest(coalesce((v_pay->>'recobro')::numeric, 0), 0)
                  + greatest(floor(coalesce((v_pay->>'ninos')::numeric, 0)), 0) * greatest(coalesce((v_pay->>'tarifaNino')::numeric, 0), 0);
  else
    select coalesce(sum((i->>'precio')::numeric), 0) into v_suma from jsonb_array_elements(coalesce(v_pay->'items','[]'::jsonb)) i;
    v_esperado := v_suma + coalesce((select sum((t->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'tours','[]'::jsonb)) t), 0)
                  -- 250 (#64): los vuelos manuales COMUNES de la opción (payload.manuales, precio declarado) también son parte del total, una sola vez.
                  + coalesce((select sum((m->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'manuales','[]'::jsonb)) m), 0);
  end if;
  if abs(v_esperado - op.total) > 0.5 then
    raise exception 'COMPARATIVA_INCOHERENTE: el total de la opción no coincide con sus componentes (% vs %).', v_esperado, op.total using errcode = 'P0001';
  end if;

  insert into public.cotizacion_comparativa_eventos
    (cotizacion_id, tenant, tipo, hija_id, opcion_ref, acomodacion_ref, version, actor_tipo, actor_id,
     validacion_id, solicitud_id, clave, huella, detalle)
  values (c.id, c.tenant, 'elegida', v_hija, p_opcion, p_acom, c.version, p_canal, p_actor_id,
     p_validacion, p_solicitud, p_clave, p_huella, jsonb_build_object('total', op.total, 'moneda', op.moneda));

  -- Las demás solicitudes pendientes quedan "superadas" (con evento).
  with sup as (
    update public.cotizacion_comparativa_solicitudes
       set estado = 'superada', ip_huella = null
     where cotizacion_id = c.id and estado = 'pendiente' and id is distinct from p_solicitud
    returning id)
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo)
  select c.id, c.tenant, 'solicitud_superada', id, v_hija, 'sistema' from sup;
  return v_hija;
end
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
f as (select p.oid, p.prosecdef, p.proconfig from pg_proc p where p.oid = to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)')),
resp as (select * from f211_priv.respaldo_251),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'funcion_presente', (select count(*) = 1 from f)::text, 'true', case when (select count(*) = 1 from f) then 'OK' else 'REVISAR' end
  union all
  select 2, 'crear_hija_conserva_al_aliado_en_neto_y_el_resto_igual_a_lo_esperado', coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'esperado'), false)::text, 'true', case when coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'esperado'), false) then 'OK' else 'REVISAR' end
  union all
  select 3, 'crear_hija_ya_no_es_la_de_la_250', (not coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'de_la_250'), false))::text, 'true', case when not coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'de_la_250'), false) then 'OK' else 'REVISAR' end
  union all
  select 4, 'crear_hija_security_definer_y_search_path_fijo', coalesce((select (prosecdef and proconfig::text like '%search_path%')::text from f), 'sin_funcion'), 'true',
         case when coalesce((select prosecdef and proconfig::text like '%search_path%' from f), false) then 'OK' else 'REVISAR' end
  union all
  select 5, 'respaldo_con_la_definicion_previa', (select count(*) = 1 from resp)::text, 'true', case when (select count(*) = 1 from resp) then 'OK' else 'REVISAR' end
  union all
  select 6, 'respaldo_integro_md5', (select coalesce(bool_and(md5(definicion) = md5), false)::text from resp), 'true', case when (select coalesce(bool_and(md5(definicion) = md5), false) from resp) then 'OK' else 'REVISAR' end
  union all
  select 7, 'respaldo_distinto_de_lo_vigente_y_no_accesible_por_la_api',
         ((select bool_and(r.md5 <> md5(pg_get_functiondef(to_regprocedure(r.firma)))) from resp r)
           and not has_table_privilege('anon', 'f211_priv.respaldo_251', 'SELECT') and not has_table_privilege('authenticated', 'f211_priv.respaldo_251', 'SELECT'))::text, 'true',
         case when (select bool_and(r.md5 <> md5(pg_get_functiondef(to_regprocedure(r.firma)))) from resp r)
                   and not has_table_privilege('anon', 'f211_priv.respaldo_251', 'SELECT') and not has_table_privilege('authenticated', 'f211_priv.respaldo_251', 'SELECT') then 'OK' else 'REVISAR' end
  union all
  select 8, 'huella_exacta_de_la_definicion_previa_en_el_respaldo', md5(coalesce((select string_agg(md5, '|' order by nombre) from resp), '')), 'igual al control 10 del preflight', 'INFO'
  union all
  select 9, 'funcion_ejecutable_por_roles_de_la_api', coalesce((select (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))::text from f), 'sin_funcion'), 'igual al preflight', 'INFO'
  union all
  select 10, 'cotizaciones_total', (select count(*) from public.cotizaciones)::text, 'igual al preflight', 'INFO'
  union all
  select 11, 'huella_de_cotizaciones_que_la_251_no_debe_tocar',
         md5(coalesce((select string_agg(c.id::text || ':' || md5(coalesce(c.payload::text, '') || coalesce(c.detalle::text, '') || coalesce(c.cliente, '') || coalesce(c.precio_venta::text, '')), '|' order by c.id) from public.cotizaciones c), '')),
         'igual al preflight', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
