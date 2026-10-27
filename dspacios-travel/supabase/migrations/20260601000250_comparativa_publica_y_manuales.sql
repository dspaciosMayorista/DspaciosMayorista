-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 250 · #64 — vuelos manuales COMUNES en una comparativa del carrito, y elección PÚBLICA solo de las comparativas que el interno marcó para compartir.
-- Scripts: supabase/scripts/{preflight,postcheck,rollback}_250_comparativa_publica_y_manuales.sql
--
-- (1) f211_priv.crear_hija comprueba que el total de la opción sea items + tours. Una opción con vuelo manual común (payload.manuales[].precio) suma más y la
--     base la rechazaba (COMPARATIVA_INCOHERENTE). Ahora el total esperado suma también los manuales, una sola vez.
-- (2) f211_priv.madre_anonima decide si el canal PÚBLICO puede validar y elegir una opción. Hasta hoy solo admitía madres anónimas, así que una comparativa creada por
--     personal interno (la única que puede llevar vuelos manuales) nunca la podía elegir el visitante. Ahora también admite la comparativa del CARRITO del mayorista
--     que un usuario interno ACTIVO marcó expresamente (payload.compartirPublico = true) y que no es de un aliado. Las demás internas siguen cerradas. La marca viaja en el
--     payload, que sello_madre cubre: cambiarla después deja la comparativa inelegible (COMPARATIVA_MADRE_ALTERADA) en vez de abrirla. registrar_solicitud_comparativa sigue
--     rechazando a las que continúan por el checkout (anónimas o compartidas).
--
-- Seguridad del reemplazo: antes de tocar nada la migración COMPRUEBA, por tokens (espacios y comentarios no cuentan; literales e identificadores sí), que los cuerpos
-- vigentes de ambas funciones son las definiciones auditadas de la 211; un hotfix o diferencia de lógica la ABORTA. Guarda las definiciones previas EXACTAS
-- (pg_get_functiondef + md5) en f211_priv.respaldo_250 para que el rollback las restaure y verifique byte a byte.
-- No toca datos ni otras funciones; no edita la 211 ni la 249. Orden: preflight → 250 → postcheck → recién después el código.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
declare v_ok boolean;
begin
  if to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)') is null or to_regprocedure('f211_priv.madre_anonima(public.cotizaciones)') is null then
    raise exception '250 ABORTADA: faltan f211_priv.crear_hija o f211_priv.madre_anonima (cadena 001-249).';
  end if;
  if to_regclass('f211_priv.respaldo_250') is not null then
    raise exception '250 ABORTADA: ya existe f211_priv.respaldo_250 (la 250 ya está aplicada; usa el rollback antes de reaplicar).';
  end if;
  with
  textos(nombre, origen, cuerpo) as (
    values
      ('crear_hija', 'vivo', (select p.prosrc from pg_proc p where p.oid = to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)'))),
      ('crear_hija', 'auditado', $aud1$
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
      v_esperado := v_suma + coalesce((select sum((t->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'tours','[]'::jsonb)) t), 0);
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
  end $aud1$),
      ('madre_anonima', 'vivo', (select p.prosrc from pg_proc p where p.oid = to_regprocedure('f211_priv.madre_anonima(public.cotizaciones)'))),
      ('madre_anonima', 'auditado', $aud2$
    select c.creado_por_id is null and c.propietario_id is null and c.aliado_id is null
  $aud2$)
  ),
  tokens as (
    select t.nombre, t.origen, x.ord,
           case when left(x.r[1], 1) in ('''', '"') then x.r[1] else lower(x.r[1]) end as tok
      from textos t
     cross join lateral regexp_matches(coalesce(t.cuerpo, ''), '(--[^\n]*|''(?:[^'']|'''')*''|"[^"]*"|[A-Za-z_][A-Za-z0-9_$]*|[0-9]+(?:\.[0-9]+)?|::|->>|->|#>>|#>|<=|>=|<>|!=|\|\||[^\s])', 'g') with ordinality as x(r, ord)
     where x.r[1] not like '--%'
  ),
  firmas as (
    select nombre, origen, count(*) as n, md5(string_agg(tok, ' ' order by ord)) as huella
      from tokens group by nombre, origen
  )
  select coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'auditado'), false) and coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'madre_anonima' and fa.origen = 'vivo' and fb.origen = 'auditado'), false) into v_ok;
  if v_ok is not true then
    raise exception '250 ABORTADA: el cuerpo vigente de crear_hija o madre_anonima NO coincide con la definición auditada de la 211 (hotfix o diferencia de lógica). Revísalo antes de reemplazar.';
  end if;
end;
$$;

-- Definiciones previas EXACTAS, para el rollback.
create table f211_priv.respaldo_250 (
  nombre     text primary key,
  firma      text not null,
  definicion text not null,
  md5        text not null,
  creado_en  timestamptz not null default now()
);
revoke all on table f211_priv.respaldo_250 from public, anon, authenticated;
alter table f211_priv.respaldo_250 enable row level security;
insert into f211_priv.respaldo_250 (nombre, firma, definicion, md5)
select v.nombre, v.firma, pg_get_functiondef(to_regprocedure(v.firma)), md5(pg_get_functiondef(to_regprocedure(v.firma)))
  from (values ('crear_hija', 'f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)'), ('madre_anonima', 'f211_priv.madre_anonima(public.cotizaciones)')) as v(nombre, firma);

create or replace function f211_priv.crear_hija(
  p_madre_id bigint, p_opcion text, p_acom text, p_version integer, p_canal text,
  p_actor_id uuid, p_validacion uuid, p_solicitud bigint, p_clave text, p_huella text,
  p_datos_cliente jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;

create or replace function f211_priv.madre_anonima(c public.cotizaciones) returns boolean
language sql stable set search_path = '' as $$
  -- «Elegible por el canal público»: (1) anónima (la creó el propio visitante) o (2) una comparativa del CARRITO del mayorista que el personal INTERNO
  -- marcó expresamente para compartir (payload.compartirPublico = true). Nunca una comparativa de un aliado ni una interna sin esa marca.
  -- La marca viaja en el payload, que sello_madre cubre: alterarla después invalida la elección (COMPARATIVA_MADRE_ALTERADA).
  -- coalesce: un payload sin marca da NULL en la comparación y `not NULL` NO dispara las puertas (if not madre_anonima(c) ...); aquí tiene que ser false.
  select coalesce(
        (c.creado_por_id is null and c.propietario_id is null and c.aliado_id is null)
      or (c.tipo = 'comparativa_carrito' and c.tenant = 'mayorista'
          and c.creado_por_id is not null and c.propietario_id is null and c.aliado_id is null
          and jsonb_typeof(c.payload) = 'object' and c.payload -> 'compartirPublico' = 'true'::jsonb
          and exists (select 1 from public.usuarios u
                       where u.id = c.creado_por_id and u.activo is true
                         and u.rol in ('superadmin','gerencia','administracion','operaciones','venta'))), false)
$$;

commit;
