-- 325 · O-3 — evidencia previa del aliado + pasajeros adicionales del aliado, ambas sobre la COTIZACIÓN (antes del contrato).
--
-- EVIDENCIA. El aliado adjunta comprobantes (PDF/JPG/PNG) a su cotización para que el personal autorizado los vea ANTES de registrar/confirmar un pago.
--   · Una evidencia NO es un pago: esta migración no toca `abonos`, `cotizacion_pagos_previos`, saldos, asientos ni el mínimo de confirmación.
--   · Reemplazar/retirar conserva el archivo (nada se borra: ni fila ni objeto). Máximo 5 vigentes por cotización. El mismo contenido (sha256) vigente no se repite.
--   · Lectura interna por RLS (superadmin; gerencia/administración/operaciones de la agencia de la cotización). El aliado NO lee la tabla: el servidor autoriza.
--   · Bucket PRIVADO `evidencias-cotizacion` sin ninguna policy en storage.objects (todo pasa por el servidor con service-role tras autorizar).
-- PASAJEROS. Lista OPCIONAL de pasajeros adicionales que el aliado escribe en su cotización; se guarda aparte (no se muta `cotizaciones.payload`) y la pantalla de
--   conversión la precarga sin retipear. Nadie se inventa: solo lo escrito. Reglas de documento = las de la 167/168 (solo dígitos salvo PAS, ≤ 30).
-- AUTORIZACIÓN. Funciones SECURITY DEFINER, solo service_role. El actor llega como id y TODO (rol, propiedad de la cotización, estado) se re-verifica aquí,
--   igual que la 323 (propiedad por correo de creación o por aliado_id de la ficha congelada). Otra cosa responde igual que «no existe».
-- Errores: F4701 actor · F4702 no es tuya / no existe · F4703 ya convertida · F4704 no aplica · F4705 vencida · F4706 salida pasada ·
--          F4710 límite de evidencias · F4711 contenido repetido · F4712 evidencia inexistente o no vigente · F4720 pasajeros inválidos · F4721 demasiados pasajeros ·
--          F4722 vía de conversión sin captura de pasajeros adicionales · F4723 la cotización ya trae pasajeros.
-- Aditiva. Rollback: supabase/scripts/rollback_325_evidencia_y_pasajeros_aliado.sql (se niega si ya hay filas).
do $$ begin
  if to_regclass('public.cotizaciones') is null or to_regclass('public.usuarios') is null then raise exception '325: faltan cotizaciones/usuarios.'; end if;
  if to_regprocedure('public.solicitar_contrato_cotizacion(bigint,uuid)') is null then raise exception '325: falta la 323 (solicitar_contrato_cotizacion).'; end if;
  if to_regclass('public.cotizacion_evidencias') is not null or to_regclass('public.cotizacion_pasajeros_aliado') is not null then raise exception '325: ya aplicada.'; end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias-cotizacion', 'evidencias-cotizacion', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create table public.cotizacion_evidencias (
  id              bigserial primary key,
  cotizacion_id   bigint not null references public.cotizaciones(id) on delete cascade,
  tenant          text not null,
  path            text not null unique,
  nombre_original text not null check (length(btrim(nombre_original)) between 1 and 200),
  mime            text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      bigint not null check (size_bytes > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  subido_por      uuid not null,
  subido_en       timestamptz not null default now(),
  vigente         boolean not null default true,
  retirado_en     timestamptz,
  retirado_por    uuid,
  constraint evidencia_vigencia_coherente check ((vigente and retirado_en is null and retirado_por is null) or (not vigente and retirado_en is not null and retirado_por is not null))
);
create unique index uq_evidencia_cot_contenido on public.cotizacion_evidencias (cotizacion_id, sha256) where vigente;
create index idx_evidencia_cot on public.cotizacion_evidencias (cotizacion_id, vigente);
alter table public.cotizacion_evidencias enable row level security;
revoke all on public.cotizacion_evidencias from public, anon, authenticated, service_role;
revoke all on sequence public.cotizacion_evidencias_id_seq from public, anon, authenticated, service_role;
grant select on public.cotizacion_evidencias to authenticated, service_role;
create policy "evidencias_cot: lectura interna" on public.cotizacion_evidencias for select to authenticated
  using (public.mi_rol() = 'superadmin' or (public.mi_rol() in ('gerencia', 'administracion', 'operaciones') and tenant = public.mi_tenant()));
comment on table public.cotizacion_evidencias is '325 (O-3): evidencia previa que el aliado adjunta a su cotización. NO es un pago. Solo se escribe vía las funciones evidencia_cotizacion_*().';

create table public.cotizacion_pasajeros_aliado (
  cotizacion_id  bigint primary key references public.cotizaciones(id) on delete cascade,
  tenant         text not null,
  pasajeros      jsonb not null check (jsonb_typeof(pasajeros) = 'array' and jsonb_array_length(pasajeros) between 1 and 30),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid not null
);
alter table public.cotizacion_pasajeros_aliado enable row level security;
revoke all on public.cotizacion_pasajeros_aliado from public, anon, authenticated, service_role;
grant select on public.cotizacion_pasajeros_aliado to authenticated, service_role;
create policy "pasajeros_aliado_cot: lectura interna" on public.cotizacion_pasajeros_aliado for select to authenticated
  using (public.mi_rol() = 'superadmin' or (public.mi_rol() in ('gerencia', 'administracion', 'operaciones', 'venta') and tenant = public.mi_tenant()));
comment on table public.cotizacion_pasajeros_aliado is '325 (O-3): pasajeros adicionales opcionales escritos por el aliado en su cotización. Solo vía cotizacion_pasajeros_aliado_guardar().';

-- Propiedad + estado de la cotización (bloquea la fila: serializa evidencias/pasajeros/solicitud de la MISMA cotización).
create function public.f325_cotizacion_propia(p_cotizacion_id bigint, p_actor uuid)
returns public.cotizaciones language plpgsql security definer set search_path = '' as $$
declare u record; c public.cotizaciones;
begin
  select id, email, rol, activo, aliado_id into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true or u.rol not in ('agencia', 'freelance') then
    raise exception 'SOPORTE_COT_ACTOR: solo un aliado B2B activo puede hacerlo.' using errcode = 'F4701';
  end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id for update;
  if not found
     or not (coalesce(c.creado_por is not null and lower(c.creado_por) = lower(u.email), false)
             or coalesce(u.aliado_id is not null and (c.payload -> 'b2bAsistido' ->> 'aliado_id') = u.aliado_id::text, false)) then
    raise exception 'SOPORTE_COT_NO_ENCONTRADA: la cotización no existe o no es tuya.' using errcode = 'F4702';
  end if;
  if c.numero_contrato is not null then raise exception 'SOPORTE_COT_CONVERTIDA: esta cotización ya es un contrato.' using errcode = 'F4703'; end if;
  if c.estado = 'descartada' or c.modo = 'comparativa' then raise exception 'SOPORTE_COT_NO_APLICA: esta cotización no admite esta acción.' using errcode = 'F4704'; end if;
  if c.vigencia_hasta is not null and c.vigencia_hasta < (now() at time zone 'America/Bogota')::date then raise exception 'SOPORTE_COT_VENCIDA: la cotización venció.' using errcode = 'F4705'; end if;
  if c.fecha_salida is not null and c.fecha_salida < (now() at time zone 'America/Bogota')::date then raise exception 'SOPORTE_COT_SALIDA_PASADA: la fecha de salida ya pasó.' using errcode = 'F4706'; end if;
  return c;
end $$;
revoke all on function public.f325_cotizacion_propia(bigint, uuid) from public, anon, authenticated;

create function public.evidencia_cotizacion_registrar(p_cotizacion_id bigint, p_actor uuid, p_path text, p_nombre text, p_mime text, p_size bigint, p_sha text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cotizaciones; v_n integer; v_id bigint;
begin
  c := public.f325_cotizacion_propia(p_cotizacion_id, p_actor);
  if exists (select 1 from public.cotizacion_evidencias e where e.cotizacion_id = c.id and e.vigente and e.sha256 = p_sha) then
    raise exception 'SOPORTE_COT_REPETIDA: ya adjuntaste ese archivo a esta cotización.' using errcode = 'F4711';
  end if;
  select count(*) into v_n from public.cotizacion_evidencias e where e.cotizacion_id = c.id and e.vigente;
  if v_n >= 5 then raise exception 'SOPORTE_COT_LIMITE: ya hay 5 evidencias vigentes; retira una para adjuntar otra.' using errcode = 'F4710'; end if;
  insert into public.cotizacion_evidencias (cotizacion_id, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
  values (c.id, c.tenant, p_path, p_nombre, p_mime, p_size, p_sha, p_actor) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Precomprobación SIN efectos: el servidor la llama antes de subir el archivo para no tocar Storage por una cotización ajena o cerrada. La base vuelve a decidir al registrar.
create function public.evidencia_cotizacion_verificar(p_cotizacion_id bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.f325_cotizacion_propia(p_cotizacion_id, p_actor);
  return jsonb_build_object('ok', true);
end $$;

create function public.evidencia_cotizacion_retirar(p_id bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.cotizacion_evidencias;
begin
  select * into e from public.cotizacion_evidencias where id = p_id;
  if not found then raise exception 'SOPORTE_COT_INEXISTENTE: la evidencia no existe.' using errcode = 'F4712'; end if;
  perform public.f325_cotizacion_propia(e.cotizacion_id, p_actor);  -- propiedad y estado, con la cotización bloqueada
  update public.cotizacion_evidencias set vigente = false, retirado_en = now(), retirado_por = p_actor where id = p_id and vigente;
  if not found then raise exception 'SOPORTE_COT_INEXISTENTE: la evidencia ya no está vigente.' using errcode = 'F4712'; end if;
  return jsonb_build_object('id', p_id);
end $$;

-- Reemplaza la lista completa (vacía = la borra). Valida cada pasajero con las reglas de la 167/168; nombre y apellido obligatorios, el resto opcional.
create function public.cotizacion_pasajeros_aliado_guardar(p_cotizacion_id bigint, p_actor uuid, p_pasajeros jsonb)
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

revoke all on function public.evidencia_cotizacion_registrar(bigint, uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.evidencia_cotizacion_verificar(bigint, uuid) from public, anon, authenticated;
revoke all on function public.evidencia_cotizacion_retirar(bigint, uuid) from public, anon, authenticated;
revoke all on function public.cotizacion_pasajeros_aliado_guardar(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.evidencia_cotizacion_registrar(bigint, uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.evidencia_cotizacion_verificar(bigint, uuid) to service_role;
grant execute on function public.evidencia_cotizacion_retirar(bigint, uuid) to service_role;
grant execute on function public.cotizacion_pasajeros_aliado_guardar(bigint, uuid, jsonb) to service_role;
