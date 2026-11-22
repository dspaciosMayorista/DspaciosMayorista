-- ROLLBACK de la migración 314 (#35). Restaura el cuerpo de public.crear_cotizacion_comparativa de la 211 (permite una comparativa manual B2B sin aliado del catálogo).
-- No modifica filas ni permisos (create or replace conserva los GRANT de la 211). Úsalo solo si hay una razón operativa: reabre el hueco de #35.
begin;
create or replace function public.crear_cotizacion_comparativa(
  p_usuario_id uuid, p_cabecera jsonb, p_servicios jsonb, p_opciones jsonb, p_aliado_id bigint
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_tipo text := p_cabecera->>'tipo';
  v_tenant text := coalesce(nullif(p_cabecera->>'tenant',''), 'mayorista');
  v_moneda text := upper(coalesce(p_cabecera->>'moneda',''));
  v_vig date := nullif(p_cabecera->>'vigencia_hasta','')::date;
  v_u public.usuarios;
  v_al public.aliados;
  v_tipo_asesor text := coalesce(p_cabecera#>>'{payload,tipoAsesor}', 'interno');
  v_id bigint;
  o jsonb; s jsonb;
  v_refs text[];
  v_pares text[] := '{}';
  v_par text;
begin
  if v_tipo not in ('comparativa_manual','comparativa_carrito') then
    raise exception 'COMPARATIVA_DATOS: tipo de comparativa inválido.' using errcode = 'P0001';
  end if;
  if v_moneda not in ('COP','USD') then
    raise exception 'COMPARATIVA_DATOS: moneda inválida.' using errcode = 'P0001';
  end if;
  if v_vig is null or v_vig < public.fecha_negocio() then
    raise exception 'COMPARATIVA_DATOS: la vigencia debe ser hoy o posterior.' using errcode = 'P0001';
  end if;

  -- Actor: manual = interno; carrito = anónimo, B2B o interno (identidad releída).
  if p_usuario_id is not null then
    select * into v_u from public.usuarios where id = p_usuario_id;
    if not found or v_u.activo is not true then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para crear la comparativa.' using errcode = '42501';
    end if;
  end if;
  if v_tipo = 'comparativa_manual' then
    if v_u.id is null or v_u.rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: solo personal interno crea una comparativa manual.' using errcode = '42501';
    end if;
    if v_u.rol = 'superadmin' then
      if v_tenant not in ('mayorista','minorista') then
        raise exception 'COMPARATIVA_DATOS: agencia inválida.' using errcode = 'P0001';
      end if;
    else
      v_tenant := v_u.tenant;      -- ignora lo que diga el cliente
    end if;
  else
    v_tenant := 'mayorista';       -- el tarifario público es exclusivo de mayorista
    if v_u.id is not null and v_u.rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: tu rol no crea comparativas.' using errcode = '42501';
    end if;
  end if;

  -- Aliado: vínculo del catálogo (nunca texto libre).
  if p_aliado_id is not null then
    select * into v_al from public.aliados where id = p_aliado_id;
    if not found then
      raise exception 'COMPARATIVA_DATOS: el aliado no existe.' using errcode = 'P0001';
    end if;
    if v_tipo_asesor = 'interno' or v_tipo_asesor not in ('agencia','freelance') then
      raise exception 'COMPARATIVA_DATOS: el tipo de venta no admite aliado.' using errcode = 'P0001';
    end if;
    if v_al.tipo is not null and lower(v_al.tipo) not like '%' || (case v_tipo_asesor when 'agencia' then 'agencia' else 'free' end) || '%' then
      raise exception 'COMPARATIVA_DATOS: el aliado es de otro tipo que la venta.' using errcode = 'P0001';
    end if;
  elsif v_tipo_asesor <> 'interno' and v_tipo = 'comparativa_manual' then
    -- Sin aliado del catálogo solo personal interno podrá resolverla: se permite, queda sin propietario B2B.
    null;
  end if;

  -- Opciones: 2..3 hoteles (opcion_ref), una moneda, totales positivos, pares únicos.
  if jsonb_typeof(p_opciones) <> 'array' or jsonb_array_length(p_opciones) < 2 or jsonb_array_length(p_opciones) > 9 then
    raise exception 'COMPARATIVA_DATOS: una comparativa necesita entre 2 y 3 hoteles.' using errcode = 'P0001';
  end if;
  select array_agg(distinct x->>'opcion_ref') into v_refs from jsonb_array_elements(p_opciones) x;
  if array_length(v_refs, 1) < 2 or array_length(v_refs, 1) > 3 then
    raise exception 'COMPARATIVA_DATOS: una comparativa necesita entre 2 y 3 hoteles.' using errcode = 'P0001';
  end if;
  for o in select * from jsonb_array_elements(p_opciones) loop
    v_par := (o->>'opcion_ref') || '/' || (o->>'acomodacion_ref');
    if v_par = any (v_pares) then
      raise exception 'COMPARATIVA_DATOS: opción y acomodación repetidas (%).', v_par using errcode = 'P0001';
    end if;
    v_pares := v_pares || v_par;
    if upper(o->>'moneda') <> v_moneda then
      raise exception 'COMPARATIVA_DATOS: todas las opciones deben estar en la misma moneda.' using errcode = 'P0001';
    end if;
    if coalesce((o->>'total')::numeric, 0) <= 0 then
      raise exception 'COMPARATIVA_DATOS: cada opción necesita un total positivo.' using errcode = 'P0001';
    end if;
  end loop;

  -- v_id fijo antes de insertar: así la madre nace con su propio id en el payload si hiciera falta.
  insert into public.cotizaciones (
    tenant, tipo, modo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
    plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por,
    aliado_id, propietario_id, creado_por_id
  ) values (
    v_tenant, v_tipo, 'comparativa', 'abierta', p_cabecera->'payload', p_cabecera->'detalle',
    p_cabecera->>'cliente', p_cabecera->>'cliente_documento', p_cabecera->>'destino', null,
    case when v_tipo = 'comparativa_manual' then 'manual' else 'carrito' end,
    p_cabecera->>'plan_nombre', nullif(p_cabecera->>'pax','')::int, null, v_moneda,
    nullif(p_cabecera->>'fecha_salida','')::date, nullif(p_cabecera->>'fecha_regreso','')::date,
    v_vig, p_cabecera->>'asesor', p_cabecera->>'creado_por',
    p_aliado_id,
    case when v_u.rol in ('agencia','freelance') then v_u.id else null end,
    v_u.id
  ) returning id into v_id;

  for s in select * from jsonb_array_elements(coalesce(p_servicios, '[]'::jsonb)) loop
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio,
        proveedor, costo_neto, modo, pct_markup, ta, valor, opcion_ref)
    values (v_id, coalesce((s->>'orden')::int, 0), s->>'tipo_servicio', s->>'plataforma', s->>'nombre_servicio',
        s->>'proveedor', coalesce((s->>'costo_neto')::numeric, 0), coalesce(s->>'modo','mk'),
        coalesce((s->>'pct_markup')::numeric, 0), coalesce((s->>'ta')::numeric, 0),
        coalesce((s->>'valor')::numeric, 0), nullif(s->>'opcion_ref',''));
  end loop;

  for o in select * from jsonb_array_elements(p_opciones) loop
    insert into public.cotizacion_opciones (cotizacion_id, tenant, opcion_ref, acomodacion_ref, orden, etiqueta,
        moneda, tarifa_persona, total, resumen_publico, plantilla_hija)
    values (v_id, v_tenant, o->>'opcion_ref', o->>'acomodacion_ref', coalesce((o->>'orden')::int, 0),
        o->>'etiqueta', v_moneda, nullif(o->>'tarifa_persona','')::numeric, (o->>'total')::numeric,
        o->'resumen_publico', o->'plantilla_hija');
  end loop;

  update public.cotizaciones set sello_economico = f211_priv.sello_madre(v_id) where id = v_id;

  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, actor_tipo, actor_id, version, detalle)
  values (v_id, v_tenant, 'creada',
          case when v_u.id is null then 'publico' when v_u.rol in ('agencia','freelance') then 'b2b' else 'interno' end,
          v_u.id, 1, jsonb_build_object('opciones', jsonb_array_length(p_opciones)));
  return v_id;
end $$;
commit;
