-- ─────────────────────────────────────────────────────────────────────────────
-- 297 (NÚMERO PROVISIONAL — confirmar con el dueño y con #75/#97 antes de aplicar; la 296 de #75,
-- `identidad_borrado_en_cascada`, ya está aplicada) — #43/#60 entrega 3b: calculadoras por grupo de días.
--
-- Las calculadoras Dubai, Mixta y Corporativa pueden calcular las tarifas de UN grupo de días de una
-- vigencia y llevarlas a su PROPUESTA (295), que el motor sigue sin leer: nada se activa (3c).
--
--   1) `hotel_calculadora.version`: entero que cambia en CADA escritura (trigger: inserción = 1,
--      actualización = anterior + 1, aunque sean dos en la misma transacción y aunque el escritor
--      intente fijarla). Todos los escritores de la app condicionan su escritura a la versión leída;
--      el trigger garantiza que también un escritor externo (API directa) la cambie.
--   2) `hotel_calculadora_grupo_bases`: las BASES de cada grupo (valores de entrada), por tipo de
--      calculadora, con su propia versión. Los parámetros generales siguen en `hotel_calculadora`.
--      FK al grupo `on delete RESTRICT`: la RPC de borrado de la 295 (cuya huella no las cubre) ya no
--      puede llevárselas en silencio; el borrado con bases va por `grupos_dias_borrar_con_bases`, que
--      exige las versiones que mostró la vista previa. Cambiar el tipo de calculadora NO las borra.
--   3) RPC `grupos_dias_guardar_calculadora`: guarda la propuesta del grupo (llamando, sin
--      modificarla, a `grupos_dias_guardar_propuesta` de la 295) y sus bases en UNA transacción.
--      Cualquier error (permisos, huella, versión, tipo, validación, compra cerrada) revierte todo.
--      Una vigencia con la compra cerrada (regla de la RPC 203: todas sus filas con ese nombre tienen
--      compra_fin < fecha_negocio()) no se calcula ni se guarda por este recorrido.
--   4) RPC `grupos_dias_config_bases`: la configuración de la 295 + las bases (tipo y versión) de cada
--      grupo, en UNA lectura. `grupos_dias_borrar_con_bases`: borra el grupo, sus propuestas y sus
--      bases solo si las bases siguen en las versiones revisadas (si cambiaron: PT409, nada se borra).
--
-- NO edita la 293 ni la 295 ni retira el candado de inactividad. Orden: preflight_297 → 297 →
-- postcheck_297 → recién después el código. Rollback: scripts/rollback_297_calculadora_grupos_dias.sql.
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb)') is null
     or to_regprocedure('public._grupos_43_autorizar(boolean)') is null then
    raise exception '297: requiere la 295 (grupos_dias_guardar_propuesta) aplicada.';
  end if;
  if to_regclass('public.hotel_calculadora') is null or to_regclass('public.hotel_temporada_grupos') is null then
    raise exception '297: faltan hotel_calculadora u hotel_temporada_grupos.';
  end if;
end $$;

-- 1) Versión que cambia en cada escritura ----------------------------------------------
create or replace function public.tg_version_fila_43()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Nunca se confía en el valor que trae la fila: el escritor no puede fijar ni repetir la versión.
  if tg_op = 'INSERT' then new.version := 1; else new.version := old.version + 1; end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.tg_version_fila_43() from public, anon, authenticated;

alter table public.hotel_calculadora add column if not exists version bigint not null default 1;
comment on column public.hotel_calculadora.version is
  '#43/#60 3b: cambia en cada escritura (trigger). Los escritores condicionan su escritura a la versión leída.';
drop trigger if exists trg_hotel_calculadora_version_43 on public.hotel_calculadora;
create trigger trg_hotel_calculadora_version_43 before insert or update on public.hotel_calculadora
  for each row execute function public.tg_version_fila_43();

-- 2) Bases por grupo --------------------------------------------------------------------
create table if not exists public.hotel_calculadora_grupo_bases (
  id          bigint generated always as identity primary key,
  grupo_id    uuid not null references public.hotel_temporada_grupos(id) on delete restrict,
  tipo        text not null,
  bases       jsonb not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint hotel_calculadora_grupo_bases_uq unique (grupo_id, tipo),
  constraint hotel_calculadora_grupo_bases_tipo check (tipo in ('dubai', 'mixta', 'corporativa')),
  constraint hotel_calculadora_grupo_bases_forma check (
    (tipo = 'mixta' and jsonb_typeof(bases) = 'object') or (tipo <> 'mixta' and jsonb_typeof(bases) = 'array'))
);
comment on table public.hotel_calculadora_grupo_bases is
  '#43/#60 3b: bases (valores de entrada) de la calculadora por grupo de días. El motor no las lee.';

alter table public.hotel_calculadora_grupo_bases enable row level security;
drop policy if exists "hotel_calculadora_grupo_bases: interno" on public.hotel_calculadora_grupo_bases;
create policy "hotel_calculadora_grupo_bases: interno" on public.hotel_calculadora_grupo_bases
  for select using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));
-- Lectura para internos; las escrituras SOLO por la RPC (huella, versiones y candados).
revoke all on public.hotel_calculadora_grupo_bases from public, anon, authenticated;
grant select on public.hotel_calculadora_grupo_bases to authenticated;
grant all on public.hotel_calculadora_grupo_bases to service_role;

drop trigger if exists trg_hotel_calculadora_grupo_bases_version_43 on public.hotel_calculadora_grupo_bases;
create trigger trg_hotel_calculadora_grupo_bases_version_43 before insert or update on public.hotel_calculadora_grupo_bases
  for each row execute function public.tg_version_fila_43();
drop trigger if exists trg_auditoria on public.hotel_calculadora_grupo_bases;
create trigger trg_auditoria after insert or update or delete on public.hotel_calculadora_grupo_bases
  for each row execute function public.fn_auditoria();

-- 3) Validación de las bases (estructura y valores) ------------------------------------
create or replace function public._calc_grupos_43_numero(v jsonb, p_nulo boolean)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then p_nulo
    when jsonb_typeof(v) = 'number' then (v::text)::numeric >= 0 and (v::text)::numeric < 1e12
    else false end
$$;

create or replace function public._calc_grupos_43_validar_lista(
  p_tipo text, p_lista jsonb, p_categorias jsonb, p_regimenes jsonb, p_donde text)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  b jsonb; k text; s jsonb; e jsonb; v_cat text;
  v_vistas text[] := '{}';
  v_permitidos text[] := case p_tipo
    when 'dubai' then array['categoria','precio','usarEdadesPropias','edadesPropias','usarSuplementosPropios','suplementosPropios','condicionesPropias']
    when 'mixta' then array['categoria','sencilla','doble','triple','multiple','nino','nino2','infante']
    else array['categoria','precio'] end;
begin
  if jsonb_typeof(p_lista) is distinct from 'array' then
    raise exception 'Bases no válidas%: se esperaba una lista.', p_donde using errcode = '22023';
  end if;
  if jsonb_array_length(p_lista) > 500 then
    raise exception 'Demasiadas bases%.', p_donde using errcode = '22023';
  end if;
  for b in select x from jsonb_array_elements(p_lista) x loop
    if jsonb_typeof(b) is distinct from 'object' then
      raise exception 'Bases no válidas%: cada base debe ser un objeto.', p_donde using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(b) loop
      if not k = any (v_permitidos) then
        raise exception 'Campo no permitido en una base%: %.', p_donde, k using errcode = '22023';
      end if;
    end loop;
    v_cat := case when jsonb_typeof(b->'categoria') = 'string' then btrim(b->>'categoria') end;
    if v_cat is null or v_cat = '' then
      raise exception 'Cada base necesita su categoría%.', p_donde using errcode = '22023';
    end if;
    if not p_categorias ? v_cat then
      raise exception 'La categoría "%" no está configurada en el hotel%.', v_cat, p_donde using errcode = '23514';
    end if;
    if v_cat = any (v_vistas) then
      raise exception 'La categoría "%" se repite en las bases%.', v_cat, p_donde using errcode = '23505';
    end if;
    v_vistas := v_vistas || v_cat;
    if p_tipo = 'mixta' then
      if not (public._calc_grupos_43_numero(b->'sencilla', false) and public._calc_grupos_43_numero(b->'doble', false)
              and public._calc_grupos_43_numero(b->'triple', false) and public._calc_grupos_43_numero(b->'multiple', false)
              and public._calc_grupos_43_numero(b->'nino', false)
              and public._calc_grupos_43_numero(b->'nino2', true) and public._calc_grupos_43_numero(b->'infante', true)) then
        raise exception 'Valores no válidos en la base "%"%: deben ser números mayores o iguales a 0.', v_cat, p_donde using errcode = '22023';
      end if;
    else
      if jsonb_typeof(b->'precio') is distinct from 'number' or (b->>'precio')::numeric <= 0 or (b->>'precio')::numeric >= 1e12 then
        raise exception 'La base "%"% necesita un precio mayor que 0.', v_cat, p_donde using errcode = '22023';
      end if;
    end if;
    if p_tipo = 'dubai' then
      if b ? 'usarEdadesPropias' and jsonb_typeof(b->'usarEdadesPropias') <> 'boolean'
         or b ? 'usarSuplementosPropios' and jsonb_typeof(b->'usarSuplementosPropios') <> 'boolean' then
        raise exception 'Opciones no válidas en la base "%"%.', v_cat, p_donde using errcode = '22023';
      end if;
      if b ? 'condicionesPropias' and (jsonb_typeof(b->'condicionesPropias') <> 'string' or char_length(b->>'condicionesPropias') > 500) then
        raise exception 'La condición de la base "%"% debe ser un texto de hasta 500 caracteres.', v_cat, p_donde using errcode = '22023';
      end if;
      if b ? 'edadesPropias' then
        e := b->'edadesPropias';
        if jsonb_typeof(e) <> 'object'
           or (select count(*) from jsonb_object_keys(e) x where x not in ('infanteMin','infanteMax','ninoMin','ninoMax')) > 0
           or (select bool_or(jsonb_typeof(e->x) is distinct from 'number' or (e->>x)::numeric <> trunc((e->>x)::numeric))
                 from unnest(array['infanteMin','infanteMax','ninoMin','ninoMax']) x) then
          raise exception 'Edades propias no válidas en la base "%"%.', v_cat, p_donde using errcode = '22023';
        end if;
        -- Mismas reglas que tarifa_hotel (177) y la propuesta (295), solo si se usan.
        if coalesce((b->>'usarEdadesPropias')::boolean, false) and not (
             (e->>'infanteMin')::int = 0 and (e->>'infanteMax')::int >= 0
             and (e->>'ninoMin')::int = (e->>'infanteMax')::int + 1
             and (e->>'ninoMax')::int >= (e->>'ninoMin')::int and (e->>'ninoMax')::int <= 17) then
          raise exception 'Edades propias no válidas en la base "%"%: infante empieza en 0, el niño justo después del infante y llega como máximo a 17.', v_cat, p_donde using errcode = '23514';
        end if;
      end if;
      if b ? 'suplementosPropios' then
        if jsonb_typeof(b->'suplementosPropios') <> 'array' or jsonb_array_length(b->'suplementosPropios') > 50 then
          raise exception 'Suplementos propios no válidos en la base "%"%.', v_cat, p_donde using errcode = '22023';
        end if;
        for s in select x from jsonb_array_elements(b->'suplementosPropios') x loop
          if jsonb_typeof(s) <> 'object'
             or (select count(*) from jsonb_object_keys(s) x where x not in ('regimen','monto')) > 0
             or jsonb_typeof(s->'regimen') is distinct from 'string' or not p_regimenes ? btrim(s->>'regimen')
             or jsonb_typeof(s->'monto') is distinct from 'number' or abs((s->>'monto')::numeric) >= 1e12 then
            raise exception 'Suplemento propio no válido en la base "%"%.', v_cat, p_donde using errcode = '22023';
          end if;
        end loop;
      end if;
    end if;
  end loop;
end $$;

create or replace function public._calc_grupos_43_validar_bases(p_tipo text, p_bases jsonb, p_categorias jsonb, p_regimenes jsonb)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare r text;
begin
  if p_tipo = 'mixta' then
    if jsonb_typeof(p_bases) is distinct from 'object' then
      raise exception 'Bases de Mixta no válidas: se esperaba un objeto por régimen.' using errcode = '22023';
    end if;
    for r in select jsonb_object_keys(p_bases) loop
      if not p_regimenes ? r then
        raise exception 'El régimen "%" no está configurado en el hotel.', r using errcode = '23514';
      end if;
      perform public._calc_grupos_43_validar_lista(p_tipo, p_bases->r, p_categorias, p_regimenes, format(' (régimen %s)', r));
    end loop;
  else
    perform public._calc_grupos_43_validar_lista(p_tipo, p_bases, p_categorias, p_regimenes, '');
  end if;
end $$;
revoke all on function public._calc_grupos_43_numero(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._calc_grupos_43_validar_lista(text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._calc_grupos_43_validar_bases(text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- 4) RPC: propuesta del grupo + sus bases, atómico ---------------------------------------
create or replace function public.grupos_dias_guardar_calculadora(
  p_temporada_id bigint, p_huella text, p_grupo_id uuid, p_tipo text,
  p_calc_version bigint, p_bases_version bigint, p_bases jsonb, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r jsonb; cfg jsonb; f jsonb; k text;
  v_hotel bigint; v_temporada bigint; v_activo boolean;
  v_calc public.hotel_calculadora;
  v_bases public.hotel_calculadora_grupo_bases;
  v_nueva bigint;
  v_campos constant text[] := array['grupo_id','tipo_habitacion','alimentacion',
    'neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante',
    'origen_tarifa_id','nota_infante','notas','edad_infante_min','edad_infante_max','edad_nino_min','edad_nino_max'];
  v_netos constant text[] := array['neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante'];
begin
  -- Usuario interno y permiso de catálogo (Mayorista). La 295 lo vuelve a comprobar.
  perform public._grupos_43_autorizar(true);
  if p_tipo is null or p_tipo not in ('dubai', 'mixta', 'corporativa') then
    raise exception 'Tipo de calculadora no válido.' using errcode = '22023';
  end if;
  if p_grupo_id is null or p_temporada_id is null then
    raise exception 'Faltan la vigencia o el grupo.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) > 500 then
    raise exception 'p_filas debe ser una lista (máximo 500 filas).' using errcode = '22023';
  end if;
  select g.temporada_id, g.activo into v_temporada, v_activo from public.hotel_temporada_grupos g where g.id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if v_temporada <> p_temporada_id then
    raise exception 'El grupo no pertenece a esta vigencia.' using errcode = '23514';
  end if;
  if v_activo then
    raise exception 'Los grupos activos no se editan desde la calculadora.' using errcode = '23514';
  end if;

  -- Filas: EXCLUSIVAMENTE del grupo, campos conocidos, valores con tipo, sin «sugerencia aceptada» y con
  -- al menos un neto (la calculadora nunca quita combinaciones: eso se hace en el panel de grupos).
  for f in select x from jsonb_array_elements(p_filas) x loop
    if jsonb_typeof(f) is distinct from 'object' then
      raise exception 'Cada fila debe ser un objeto.' using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(f) loop
      if not k = any (v_campos) then
        raise exception 'Campo no permitido en una fila: %.', k using errcode = '22023';
      end if;
    end loop;
    if f->>'grupo_id' is distinct from p_grupo_id::text then
      raise exception 'Todas las filas deben ser del grupo solicitado.' using errcode = '23514';
    end if;
    if f ? 'origen_tarifa_id' and jsonb_typeof(f->'origen_tarifa_id') <> 'null' then
      raise exception 'Una fila calculada no puede marcarse como sugerencia aceptada.' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(v_netos) n where f ? n and not public._calc_grupos_43_numero(f->n, true)) then
      raise exception 'Los netos deben ser números mayores o iguales a 0, o vacíos.' using errcode = '22023';
    end if;
    if not exists (select 1 from unnest(v_netos) n where f ? n and jsonb_typeof(f->n) = 'number') then
      raise exception 'Una fila calculada necesita al menos un neto (la calculadora no quita combinaciones).' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(array['edad_infante_min','edad_infante_max','edad_nino_min','edad_nino_max']) n
               where f ? n and jsonb_typeof(f->n) <> 'null'
                 and (jsonb_typeof(f->n) <> 'number' or (f->>n)::numeric <> trunc((f->>n)::numeric))) then
      raise exception 'Las edades deben ser números enteros o vacías.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(array['nota_infante','notas']) n
               where f ? n and jsonb_typeof(f->n) <> 'null' and (jsonb_typeof(f->n) <> 'string' or char_length(f->>n) > 1000)) then
      raise exception 'Las notas deben ser textos de hasta 1000 caracteres.' using errcode = '22023';
    end if;
  end loop;

  -- Propuesta (295, sin cambios): candados en el orden de la 293, huella, catálogo, unidad, restricciones.
  r := public.grupos_dias_guardar_propuesta(p_temporada_id, p_huella, 'actualizar', p_grupo_id, p_filas);
  cfg := r->'config';
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  perform public._calc_grupos_43_validar_bases(p_tipo, p_bases, cfg->'categorias', cfg->'regimenes');

  -- Compra cerrada: misma regla que generar_tarifas_hotel_calculadora (203/237). La vigencia ya está
  -- bloqueada por la llamada anterior, así que su compra_fin no cambia hasta terminar.
  if exists (select 1 from public.hotel_temporadas t
              where t.hotel_id = v_hotel and btrim(t.nombre) = btrim(cfg->'vigencia'->>'nombre')
              group by btrim(t.nombre)
              having bool_and(t.compra_fin is not null and t.compra_fin < public.fecha_negocio())) then
    raise exception 'La vigencia "%" tiene la compra cerrada: no se calcula ni se guarda por grupo.', cfg->'vigencia'->>'nombre' using errcode = '23514';
  end if;

  -- Parámetros generales con los que se calculó: misma fila, mismo tipo, misma versión.
  select * into v_calc from public.hotel_calculadora c where c.hotel_id = v_hotel for share;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el hotel ya no tiene calculadora guardada. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if v_calc.tipo is distinct from p_tipo then
    raise exception 'CONFIG_DESACTUALIZADA: la calculadora del hotel cambió de tipo. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if p_calc_version is null or v_calc.version <> p_calc_version then
    raise exception 'CONFIG_DESACTUALIZADA: la calculadora del hotel cambió desde que la abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;

  -- Bases del grupo: versión comparada (cubre también un guardado que no cambió la propuesta).
  select * into v_bases from public.hotel_calculadora_grupo_bases b where b.grupo_id = p_grupo_id and b.tipo = p_tipo for update;
  if found then
    if p_bases_version is distinct from v_bases.version then
      raise exception 'CONFIG_DESACTUALIZADA: las bases de este grupo cambiaron desde que las abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
    end if;
    update public.hotel_calculadora_grupo_bases set bases = p_bases, updated_by = auth.uid()
     where id = v_bases.id returning version into v_nueva;
  else
    if p_bases_version is not null then
      raise exception 'CONFIG_DESACTUALIZADA: las bases de este grupo cambiaron desde que las abriste. Recarga y revisa de nuevo.' using errcode = 'PT409';
    end if;
    insert into public.hotel_calculadora_grupo_bases (grupo_id, tipo, bases, updated_by)
    values (p_grupo_id, p_tipo, p_bases, auth.uid()) returning version into v_nueva;
  end if;

  return r || jsonb_build_object('bases_version', v_nueva, 'calc_version', v_calc.version);
end $$;
revoke all on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) to authenticated;

-- 5) Lectura con bases y borrado que las incluye en lo confirmado -----------------------
-- Bases de los grupos de una vigencia (tipo, versión y cuántas categorías): lo que la vista previa del
-- borrado muestra y lo que su confirmación debe volver a encontrar.
create or replace function public._calc_grupos_43_bases_de(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('grupo_id', b.grupo_id, 'tipo', b.tipo, 'version', b.version,
           'categorias', case when b.tipo = 'mixta' then (select count(*) from jsonb_each(b.bases) e, jsonb_array_elements(e.value) x)
                              else jsonb_array_length(b.bases) end)
         order by b.grupo_id, b.tipo), '[]')
  from public.hotel_calculadora_grupo_bases b join public.hotel_temporada_grupos g on g.id = b.grupo_id
  where g.temporada_id = p_temporada_id
$$;
revoke all on function public._calc_grupos_43_bases_de(bigint) from public, anon, authenticated;

create or replace function public.grupos_dias_config_bases(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._grupos_43_autorizar(false);
  return public._grupos_43_config(p_temporada_id) || jsonb_build_object('bases', public._calc_grupos_43_bases_de(p_temporada_id));
end $$;
revoke all on function public.grupos_dias_config_bases(bigint) from public, anon;
grant execute on function public.grupos_dias_config_bases(bigint) to authenticated;

-- p_bases: las bases que mostró la vista previa del borrado ([{"tipo":..,"version":..}], [] si no tenía).
-- Si hoy son otras (se guardaron, cambiaron o se crearon después de revisar): PT409 y nada se borra.
create or replace function public.grupos_dias_borrar_con_bases(p_grupo_id uuid, p_huella text, p_bases jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_temporada bigint; v_actuales jsonb; v_esperadas jsonb; n_bases int; r jsonb;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_bases) is distinct from 'array' then
    raise exception 'p_bases debe ser una lista.' using errcode = '22023';
  end if;
  select temporada_id into v_temporada from public.hotel_temporada_grupos where id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  -- Mismo orden de candados que la 295 y que grupos_dias_guardar_calculadora: grupos → … → hotel; luego las bases.
  perform public._grupos_43_bloquear_y_comparar(v_temporada, p_huella);
  select coalesce(jsonb_agg(jsonb_build_object('tipo', b.tipo, 'version', b.version) order by b.tipo), '[]') into v_actuales
    from (select tipo, version from public.hotel_calculadora_grupo_bases where grupo_id = p_grupo_id order by tipo for update) b;
  select coalesce(jsonb_agg(jsonb_build_object('tipo', x->>'tipo', 'version', (x->>'version')::bigint) order by x->>'tipo'), '[]') into v_esperadas
    from jsonb_array_elements(p_bases) x;
  if v_actuales is distinct from v_esperadas then
    raise exception 'CONFIG_DESACTUALIZADA: las bases de calculadora de este grupo cambiaron desde que revisaste el borrado. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  delete from public.hotel_calculadora_grupo_bases where grupo_id = p_grupo_id;
  get diagnostics n_bases = row_count;
  r := public.grupos_dias_borrar(p_grupo_id, p_huella);   -- 295 sin cambios: propuestas y grupo (misma huella)
  return r || jsonb_build_object('bases_eliminadas', n_bases,
    'config', (r->'config') || jsonb_build_object('bases', public._calc_grupos_43_bases_de(v_temporada)));
end $$;
revoke all on function public.grupos_dias_borrar_con_bases(uuid, text, jsonb) from public, anon;
grant execute on function public.grupos_dias_borrar_con_bases(uuid, text, jsonb) to authenticated;

commit;
