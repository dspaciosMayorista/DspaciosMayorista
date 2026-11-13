-- ─────────────────────────────────────────────────────────────────────────────
-- 298 (NÚMERO PROVISIONAL — confirmar con el dueño y con #75/#97 antes de aplicar; 296 y 297 aplicadas)
-- #43/#60 entrega 3b — parámetros de la fórmula PROPIOS de cada grupo de días.
--
-- Corrección del dueño tras Preview: en modo grupo los modificadores, suplementos (incluido FULL),
-- descuento de la tarifa, IVA, pax… estaban bloqueados con los generales del hotel. Ahora cada grupo
-- elige explícitamente: usar los generales del hotel (referencia, sin tocarlos) o valores propios.
--
--   1) `hotel_calculadora_grupo_bases.generales` (jsonb, null = usa los generales del hotel). Las bases
--      ya guardadas con la 297 quedan en null: siguen calculándose exactamente igual.
--   2) Solo parámetros de la FÓRMULA, por tipo; nunca promociones ni bases (`promos`, `bases`,
--      `bases_por_regimen` se rechazan): una promoción comercial no puede colarse como «parámetro».
--   3) RPC `grupos_dias_guardar_calculadora_grupo` = la RPC de la 297 SIN CAMBIOS (propuesta, bases,
--      huella, versión de la calculadora y de las bases, compra cerrada, candados) + los generales del
--      grupo, en UNA transacción. Cualquier escritura de las bases por otro camino (p. ej. la RPC de la
--      297 llamada sola, que calcula con los generales del hotel) deja `generales` en null: la fila nunca
--      guarda unos parámetros distintos de los usados para calcular.
--
-- NO edita la 293, la 295 ni la 297 (aplicadas). Orden: preflight_298 → 298 → postcheck_298 → código.
-- Rollback: scripts/rollback_298_calculadora_grupos_generales.sql (aborta si hay generales propios).
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb)') is null
     or to_regclass('public.hotel_calculadora_grupo_bases') is null then
    raise exception '298: requiere la 297 aplicada.';
  end if;
end $$;

-- 1) Columna ----------------------------------------------------------------------------
alter table public.hotel_calculadora_grupo_bases add column if not exists generales jsonb;
alter table public.hotel_calculadora_grupo_bases drop constraint if exists hotel_calculadora_grupo_bases_generales_forma;
alter table public.hotel_calculadora_grupo_bases add constraint hotel_calculadora_grupo_bases_generales_forma
  check (generales is null or jsonb_typeof(generales) = 'object');
comment on column public.hotel_calculadora_grupo_bases.generales is
  '#43/#60 3b (298): parámetros de la fórmula propios del grupo; null = usa los generales del hotel.';

-- Toda escritura que no venga de la RPC nueva deja generales en null (= los del hotel con los que se calculó).
create or replace function public.tg_calc_grupo_generales_43()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.calc_generales_43', true), '') <> 'rpc' then
    new.generales := null;
  end if;
  return new;
end $$;
revoke all on function public.tg_calc_grupo_generales_43() from public, anon, authenticated;
drop trigger if exists trg_calc_grupo_generales_43 on public.hotel_calculadora_grupo_bases;
create trigger trg_calc_grupo_generales_43 before insert or update on public.hotel_calculadora_grupo_bases
  for each row execute function public.tg_calc_grupo_generales_43();

-- 2) Validación de los generales (solo fórmula) -------------------------------------------
create or replace function public._calc_grupos_43_validar_generales(p_tipo text, g jsonb, p_regimenes jsonb)
returns void language plpgsql immutable set search_path = public, pg_temp as $$
declare
  k text; s jsonb; a text;
  v_permitidos text[] := case p_tipo
    when 'dubai' then array['regimen_base','modificadores','suplementos','infante_nota']
    when 'mixta' then array['iva_pct','acom','nino','pax','infante_nota']
    else array['regimen_base','persona_adicional','nino_adicional','impuesto_pct','descuento_pct','suplementos_regimen','infante_nota'] end;
  num constant text := 'number';
  fin boolean;
begin
  if g is null then return; end if;
  if jsonb_typeof(g) is distinct from 'object' then
    raise exception 'Los parámetros del grupo deben ser un objeto.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(g) loop
    if not k = any (v_permitidos) then
      raise exception 'Parámetro no permitido en el grupo: % (solo parámetros de la fórmula; las promociones no van aquí).', k using errcode = '22023';
    end if;
  end loop;
  if g ? 'infante_nota' and jsonb_typeof(g->'infante_nota') not in ('string', 'null') then
    raise exception 'La nota de infante debe ser un texto.' using errcode = '22023';
  end if;
  if g ? 'regimen_base' and (jsonb_typeof(g->'regimen_base') <> 'string' or not p_regimenes ? btrim(g->>'regimen_base')) then
    raise exception 'El régimen base "%" no está configurado en el hotel.', g->>'regimen_base' using errcode = '23514';
  end if;
  if p_tipo = 'dubai' then
    if g ? 'modificadores' then
      if jsonb_typeof(g->'modificadores') <> 'object' then raise exception 'Modificadores no válidos.' using errcode = '22023'; end if;
      for k in select jsonb_object_keys(g->'modificadores') loop
        if k not in ('sencilla_pct','pax3_pct','pax4_pct','nino_pct','nino2_pct','infante_pct')
           or jsonb_typeof(g->'modificadores'->k) <> num or abs((g->'modificadores'->>k)::numeric) > 1000 then
          raise exception 'Modificador no válido: %.', k using errcode = '22023';
        end if;
      end loop;
    end if;
    if g ? 'suplementos' then
      if jsonb_typeof(g->'suplementos') <> 'array' then raise exception 'Suplementos no válidos.' using errcode = '22023'; end if;
      for s in select x from jsonb_array_elements(g->'suplementos') x loop
        if jsonb_typeof(s) <> 'object' or (select count(*) from jsonb_object_keys(s) x where x not in ('regimen','monto')) > 0
           or jsonb_typeof(s->'regimen') <> 'string' or not p_regimenes ? btrim(s->>'regimen')
           or jsonb_typeof(s->'monto') <> num or abs((s->>'monto')::numeric) >= 1e12 then
          raise exception 'Suplemento no válido (régimen configurado y monto numérico).' using errcode = '22023';
        end if;
      end loop;
    end if;
  elsif p_tipo = 'mixta' then
    if g ? 'iva_pct' and (jsonb_typeof(g->'iva_pct') <> num or (g->>'iva_pct')::numeric not between 0 and 100) then
      raise exception 'El IVA debe estar entre 0 y 100.' using errcode = '22023';
    end if;
    if g ? 'acom' then
      if jsonb_typeof(g->'acom') <> 'object' then raise exception 'Modo por acomodación no válido.' using errcode = '22023'; end if;
      for a in select jsonb_object_keys(g->'acom') loop
        if a not in ('sencilla','doble','triple','multiple') or jsonb_typeof(g->'acom'->a) <> 'object'
           or g->'acom'->a->>'modo' not in ('hab','pax') or jsonb_typeof(g->'acom'->a->'iva') <> 'boolean' then
          raise exception 'Modo por acomodación no válido: %.', a using errcode = '22023';
        end if;
      end loop;
    end if;
    if g ? 'nino' and (jsonb_typeof(g->'nino') <> 'object' or jsonb_typeof(g->'nino'->'iva') <> 'boolean') then
      raise exception 'IVA de niño no válido.' using errcode = '22023';
    end if;
    if g ? 'pax' then
      if jsonb_typeof(g->'pax') <> 'object' then raise exception 'Pax por habitación no válidos.' using errcode = '22023'; end if;
      for a in select jsonb_object_keys(g->'pax') loop
        fin := jsonb_typeof(g->'pax'->a) = num;
        if a not in ('sencilla','doble','triple','multiple') or not fin
           or (g->'pax'->>a)::numeric <> trunc((g->'pax'->>a)::numeric) or (g->'pax'->>a)::int not between 1 and 20 then
          raise exception 'Pax por habitación no válido: %.', a using errcode = '22023';
        end if;
      end loop;
    end if;
  else
    for k in select unnest(array['persona_adicional','nino_adicional']) loop
      if g ? k and (jsonb_typeof(g->k) <> num or (g->>k)::numeric < 0 or (g->>k)::numeric >= 1e12) then
        raise exception '% debe ser un número mayor o igual a 0.', k using errcode = '22023';
      end if;
    end loop;
    for k in select unnest(array['impuesto_pct','descuento_pct']) loop
      if g ? k and (jsonb_typeof(g->k) <> num or (g->>k)::numeric not between 0 and 100) then
        raise exception '% debe estar entre 0 y 100.', k using errcode = '22023';
      end if;
    end loop;
    if g ? 'suplementos_regimen' then
      if jsonb_typeof(g->'suplementos_regimen') <> 'array' then raise exception 'Suplementos no válidos.' using errcode = '22023'; end if;
      for s in select x from jsonb_array_elements(g->'suplementos_regimen') x loop
        if jsonb_typeof(s) <> 'object' or (select count(*) from jsonb_object_keys(s) x where x not in ('regimen','adulto','nino')) > 0
           or jsonb_typeof(s->'regimen') <> 'string' or not p_regimenes ? btrim(s->>'regimen')
           or jsonb_typeof(s->'adulto') <> num or jsonb_typeof(s->'nino') <> num
           or abs((s->>'adulto')::numeric) >= 1e12 or abs((s->>'nino')::numeric) >= 1e12 then
          raise exception 'Suplemento no válido (régimen configurado, adulto y niño numéricos).' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;
end $$;
revoke all on function public._calc_grupos_43_validar_generales(text, jsonb, jsonb) from public, anon, authenticated;

-- 3) RPC: propuesta + bases + generales del grupo, atómico ---------------------------------
create or replace function public.grupos_dias_guardar_calculadora_grupo(
  p_temporada_id bigint, p_huella text, p_grupo_id uuid, p_tipo text,
  p_calc_version bigint, p_bases_version bigint, p_bases jsonb, p_generales jsonb, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r jsonb; v_nueva bigint;
begin
  -- La 297 (sin cambios) autoriza, valida filas y bases, bloquea, compara huella y versiones y guarda.
  perform set_config('app.calc_generales_43', 'rpc', true);
  r := public.grupos_dias_guardar_calculadora(p_temporada_id, p_huella, p_grupo_id, p_tipo, p_calc_version, p_bases_version, p_bases, p_filas);
  perform public._calc_grupos_43_validar_generales(p_tipo, p_generales, r->'config'->'regimenes');
  update public.hotel_calculadora_grupo_bases set generales = p_generales
   where grupo_id = p_grupo_id and tipo = p_tipo returning version into v_nueva;
  perform set_config('app.calc_generales_43', '', true);
  return r || jsonb_build_object('bases_version', v_nueva);
end $$;
revoke all on function public.grupos_dias_guardar_calculadora_grupo(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.grupos_dias_guardar_calculadora_grupo(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb, jsonb) to authenticated;

-- 4) La vista previa del borrado dice si el grupo tiene parámetros propios -------------------
create or replace function public._calc_grupos_43_bases_de(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('grupo_id', b.grupo_id, 'tipo', b.tipo, 'version', b.version,
           'categorias', case when b.tipo = 'mixta' then (select count(*) from jsonb_each(b.bases) e, jsonb_array_elements(e.value) x)
                              else jsonb_array_length(b.bases) end,
           'generales_propios', b.generales is not null)
         order by b.grupo_id, b.tipo), '[]')
  from public.hotel_calculadora_grupo_bases b join public.hotel_temporada_grupos g on g.id = b.grupo_id
  where g.temporada_id = p_temporada_id
$$;
revoke all on function public._calc_grupos_43_bases_de(bigint) from public, anon, authenticated;

commit;
