-- ROLLBACK de la 308: restaura el texto EXACTO de las dos funciones de la 219. Solo estructura; no borra puestos ya registrados.
-- Si existen puestos de cotizaciones anónimas de paquete dinámico o de solicitudes de hotel (creados con la 308), los datos se conservan: lo único que se
-- pierde es la capacidad de registrar nuevos hasta volver a aplicar la 308.
begin;
set local lock_timeout = '10s';

create or replace function public.registrar_personas_cotizacion(
  p_cotizacion_id bigint,
  p_usuario_id uuid,
  p_participantes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q record;
  v_rol text;
  v_anonima boolean;
  e jsonb;
  v_rol_p text;
  v_ref uuid;
  v_tipo text;
  v_numero text;
  v_obs jsonb;
  v_nivel text;
  v_cap uuid;
  v_puesto record;
  v_res record;
  v_orden integer;
  v_refs uuid[] := '{}';
  v_titulares integer := 0;
  v_nuevos integer := 0;
  v_reintentos integer := 0;
  v_omitidos integer := 0;
  v_pasajeros jsonb;
begin
  perform p214_priv.exigir_read_committed();
  if p_cotizacion_id is null then
    raise exception 'cotizacion_inexistente' using errcode = '22023';
  end if;
  if p_participantes is null or jsonb_typeof(p_participantes) <> 'array' or jsonb_array_length(p_participantes) > 60 then
    raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Un arreglo de hasta 60 puestos.';
  end if;

  -- Primer candado: el mismo que pagos previos y conversión (cotización -> vínculo -> personas).
  select c.id, c.tenant, c.estado, c.tipo, c.modo, c.payload, c.creado_por_id, c.propietario_id, c.aliado_id
    into q
    from public.cotizaciones c
   where c.id = p_cotizacion_id
     for update;
  if not found then
    raise exception 'cotizacion_inexistente' using errcode = 'P0001';
  end if;
  if q.estado is distinct from 'abierta' then
    raise exception 'cotizacion_no_abierta' using errcode = 'P0001';
  end if;
  if q.tenant is null or q.tenant not in ('mayorista', 'minorista') then
    raise exception 'tenant_invalido' using errcode = '22023';
  end if;

  v_anonima := p214_priv.cotizacion_anonima(q.tenant, q.tipo, q.creado_por_id, q.propietario_id, q.aliado_id);
  v_rol := p214_priv.autorizar_actor_cotizacion(p_usuario_id, q.tenant, q.creado_por_id, v_anonima, false);
  v_pasajeros := case when jsonb_typeof(q.payload -> 'pasajeros') = 'array' then q.payload -> 'pasajeros' else '[]'::jsonb end;

  for e in select x.value from jsonb_array_elements(p_participantes) x loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'participantes_invalidos' using errcode = '22023';
    end if;
    v_rol_p := p214_priv.texto_entrada(e, 'rol');
    v_tipo := p214_priv.texto_entrada(e, 'tipo_doc');
    v_numero := p214_priv.texto_entrada(e, 'numero_doc');
    v_obs := coalesce(e -> 'observaciones', '[]'::jsonb);
    perform p214_priv.validar_campos_participante(v_rol_p, v_obs);
    if not p214_priv.participante_identificado(v_numero, v_obs) then
      raise exception 'participante_vacio' using errcode = '22023',
        detail = 'Una cantidad de viajeros sin datos no crea personas.';
    end if;
    -- D-6: toda captura anónima es provisional (el tipo no viene de una sesión).
    if v_anonima and v_tipo is not null then
      raise exception 'tipo_no_admitido' using errcode = '22023',
        detail = 'En una cotización anónima el tipo de documento no se registra.';
    end if;
    if jsonb_typeof(e -> 'orden') = 'number' then
      if (e ->> 'orden')::numeric < 0 or (e ->> 'orden')::numeric > 999
         or (e ->> 'orden')::numeric <> trunc((e ->> 'orden')::numeric) then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'orden: entero entre 0 y 999.';
      end if;
      v_orden := (e ->> 'orden')::numeric::integer;
    elsif e ? 'orden' and jsonb_typeof(e -> 'orden') <> 'null' then
      raise exception 'participantes_invalidos' using errcode = '22023';
    else
      v_orden := null;
    end if;
    v_nivel := case v_rol_p when 'titular' then 'comercial' else 'pasajero_cotizacion' end;

    if v_rol_p = 'titular' then
      v_titulares := v_titulares + 1;
      if v_titulares > 1 or (e ? 'ref' and jsonb_typeof(e -> 'ref') <> 'null') then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Un solo titular, sin ref.';
      end if;
      select cp.* into v_puesto
        from public.cotizacion_participantes cp
       where cp.cotizacion_id = q.id and cp.rol = 'titular' and cp.activo
         for update;
      if found then
        v_ref := v_puesto.id;
      else
        v_ref := gen_random_uuid();
      end if;
    else
      begin
        v_ref := p214_priv.texto_entrada(e, 'ref')::uuid;
      exception when invalid_text_representation then
        raise exception 'ref_invalido' using errcode = '22023';
      end;
      if v_ref is null then
        raise exception 'ref_invalido' using errcode = '22023', detail = 'Cada pasajero lleva el ref de su fila.';
      end if;
      if v_ref = any (v_refs) then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Ref repetido.';
      end if;
      v_refs := v_refs || v_ref;
      -- El ref debe ser el de una fila del payload de ESTA cotización.
      if not exists (select 1 from jsonb_array_elements(v_pasajeros) pj
                      where jsonb_typeof(pj) = 'object' and pj ->> 'ref' = v_ref::text) then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
      select cp.* into v_puesto from public.cotizacion_participantes cp where cp.id = v_ref for update;
      if found and (v_puesto.cotizacion_id <> q.id or v_puesto.rol <> 'pasajero') then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
      if not found and exists (select 1 from public.persona_capturas c
                                where c.participante_ref = v_ref and c.cotizacion_id is distinct from q.id) then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
    end if;

    v_cap := md5(v_ref::text || ':alta:' || v_nivel)::uuid;
    if v_puesto.id is not null and v_puesto.id = v_ref then
      -- Puesto ya creado: un alta repetida no escribe. Si su captura vigente sigue siendo la del
      -- alta se compara (otra carga con la misma clave = captura_inconsistente); si el editor ya
      -- lo corrigió (o lo creó), el alta no tiene nada que repetir.
      if v_puesto.captura_id = v_cap then
        select r.* into v_res
          from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                        p_usuario_id, v_rol, q.id, v_ref, v_rol_p) r;
        v_reintentos := v_reintentos + 1;
      else
        v_omitidos := v_omitidos + 1;
      end if;
    else
      select r.* into v_res
        from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                      p_usuario_id, v_rol, q.id, v_ref, v_rol_p) r;
      insert into public.cotizacion_participantes (id, cotizacion_id, tenant, rol, orden, persona_id, captura_id)
      values (v_ref, q.id, q.tenant, v_rol_p, v_orden, v_res.persona_id, v_cap);
      v_nuevos := v_nuevos + 1;
    end if;
  end loop;

  -- Nunca persona_id, ni si la ficha ya existía (D-4: el alta no informa coincidencias).
  return jsonb_build_object('cotizacion_id', q.id, 'nuevos', v_nuevos, 'reintentos', v_reintentos,
                            'omitidos', v_omitidos);
end;
$$;

create or replace function public.sellar_creador_cotizacion(
  p_cotizacion_id bigint,
  p_usuario_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q record;
  u record;
begin
  if p_usuario_id is null or p_cotizacion_id is null then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  select c.id, c.tenant, c.estado, c.tipo, c.modo, c.creado_por, c.creado_por_id, c.cotizacion_origen_id, c.created_at
    into q
    from public.cotizaciones c
   where c.id = p_cotizacion_id
     for update;
  if not found then
    raise exception 'cotizacion_inexistente' using errcode = 'P0001';
  end if;
  select x.id, x.rol::text as rol, x.tenant, x.activo, x.email into u
    from public.usuarios x where x.id = p_usuario_id;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'agencia', 'freelance')
     or (u.rol <> 'superadmin' and u.tenant is distinct from q.tenant) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if q.creado_por_id is not null then
    if q.creado_por_id = p_usuario_id then
      return 'ya_sellada';
    end if;
    raise exception 'sello_ajeno' using errcode = '42501';
  end if;
  if q.estado is distinct from 'abierta' then
    raise exception 'cotizacion_no_abierta' using errcode = 'P0001';
  end if;
  if q.modo is distinct from 'simple' or q.cotizacion_origen_id is not null
     or q.tipo not in ('tarifario', 'carrito') then
    raise exception 'sello_no_admitido' using errcode = '42501';
  end if;
  if q.creado_por is null or u.email is null
     or lower(btrim(q.creado_por, ' ')) <> lower(btrim(u.email, ' ')) then
    raise exception 'sello_no_admitido' using errcode = '42501';
  end if;
  if q.created_at < now() - interval '15 minutes' then
    raise exception 'sello_vencido' using errcode = '42501';
  end if;
  update public.cotizaciones c set creado_por_id = p_usuario_id where c.id = q.id;
  return 'sellada';
end;
$$;

alter function public.registrar_personas_cotizacion(bigint, uuid, jsonb) owner to current_user;
alter function public.sellar_creador_cotizacion(bigint, uuid) owner to current_user;
revoke all on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.sellar_creador_cotizacion(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.registrar_personas_cotizacion(bigint, uuid, jsonb), public.sellar_creador_cotizacion(bigint, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
