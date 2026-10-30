-- ───────────────────────────────────────────────────────────────────────────
-- 250 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 250. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- Los cuerpos VIGENTES de f211_priv.crear_hija y f211_priv.madre_anonima se comparan por tokens con las definiciones auditadas de la 211: las diferencias de formato
-- (espacios, saltos de línea, comentarios) no cuentan; cualquier cambio de lógica, identificador o literal (un hotfix) da REVISAR y la 250 no debe aplicarse.
-- No imprime filas de negocio: solo conteos, atributos y huellas.
-- ───────────────────────────────────────────────────────────────────────────
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
),
f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.provolatile, p.prolang from pg_proc p
   where p.oid in (to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)'), to_regprocedure('f211_priv.madre_anonima(public.cotizaciones)'))
),
fch as (select * from f where proname = 'crear_hija'),
fma as (select * from f where proname = 'madre_anonima'),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'funciones_presentes', (select count(*) = 2 from f)::text, 'true', case when (select count(*) = 2 from f) then 'OK' else 'REVISAR' end
  union all
  select 2, 'crear_hija_cuerpo_igual_al_auditado_por_tokens', coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'auditado'), false)::text, 'true',
         case when coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'crear_hija' and fa.origen = 'vivo' and fb.origen = 'auditado'), false) then 'OK' else 'REVISAR' end
  union all
  select 3, 'madre_anonima_cuerpo_igual_al_auditado_por_tokens', coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'madre_anonima' and fa.origen = 'vivo' and fb.origen = 'auditado'), false)::text, 'true',
         case when coalesce((select fa.huella = fb.huella from firmas fa join firmas fb on fb.nombre = fa.nombre where fa.nombre = 'madre_anonima' and fa.origen = 'vivo' and fb.origen = 'auditado'), false) then 'OK' else 'REVISAR' end
  union all
  select 4, 'crear_hija_security_definer_y_search_path_fijo', coalesce((select (prosecdef and proconfig::text like '%search_path%')::text from fch), 'sin_funcion'), 'true',
         case when coalesce((select prosecdef and proconfig::text like '%search_path%' from fch), false) then 'OK' else 'REVISAR' end
  union all
  select 5, 'madre_anonima_inmutable_y_search_path_vacio', coalesce((select (provolatile = 'i' and proconfig::text like '%search_path=%')::text from fma), 'sin_funcion'), 'true',
         case when coalesce((select provolatile = 'i' and proconfig::text like '%search_path=%' from fma), false) then 'OK' else 'REVISAR' end
  union all
  select 6, 'respaldo_250_ausente_y_250_no_aplicada', (to_regclass('f211_priv.respaldo_250') is null)::text, 'true',
         case when to_regclass('f211_priv.respaldo_250') is null then 'OK' else 'REVISAR' end
  union all
  select 7, 'funciones_ejecutables_por_roles_de_la_api',
         coalesce((select bool_or(has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))::text from f), 'sin_funcion'),
         'igual en el postcheck', 'INFO'
  union all
  select 8, 'hijas_con_bloque_manuales', (select count(*) from public.cotizaciones h where h.cotizacion_origen_id is not null and jsonb_typeof(h.payload) = 'object' and h.payload ? 'manuales')::text, '0',
         case when (select count(*) from public.cotizaciones h where h.cotizacion_origen_id is not null and jsonb_typeof(h.payload) = 'object' and h.payload ? 'manuales') = 0 then 'OK' else 'INFO' end
  union all
  select 9, 'comparativas_ya_marcadas_para_compartir', (select count(*) from public.cotizaciones m where m.modo = 'comparativa' and jsonb_typeof(m.payload) = 'object' and m.payload ? 'compartirPublico')::text, '0',
         case when (select count(*) from public.cotizaciones m where m.modo = 'comparativa' and jsonb_typeof(m.payload) = 'object' and m.payload ? 'compartirPublico') = 0 then 'OK' else 'INFO' end
  union all
  select 10, 'cotizaciones_total', (select count(*) from public.cotizaciones)::text, 'igual en el postcheck', 'INFO'
  union all
  select 11, 'huella_de_cotizaciones_que_la_250_no_debe_tocar',
         md5(coalesce((select string_agg(c.id::text || ':' || md5(coalesce(c.payload::text, '') || coalesce(c.precio_venta::text, '')), '|' order by c.id) from public.cotizaciones c), '')),
         'igual en el postcheck', 'INFO'
  union all
  select 12, 'huella_exacta_de_las_definiciones_previas',
         md5(coalesce((select string_agg(md5(pg_get_functiondef(oid)), '|' order by proname) from f), '')), 'igual a la guardada en el respaldo', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
