-- ROLLBACK 310 (#125). PROTEGIDO: aborta si alguna promoción ya usa el modo nuevo (seguir-base / niño gratis): quitarle el modo es una decisión del dueño,
-- no un efecto del rollback. Restaura la RPC de 4 parámetros y el trigger de reglas de la 300 y retira columnas y restricción. Correr una sola vez.
begin;
do $$
begin
  if exists (select 1 from public.hotel_temporadas where promo_sigue_base or nino_gratis or nino_gratis_edad_min is not null or nino_gratis_edad_max is not null) then
    raise exception 'ROLLBACK 310 ABORTADO: hay promociones en modo seguir-base o con niño gratis; edítalas primero (quitar reglas y desvincular).';
  end if;
end $$;

drop function if exists public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb, boolean, boolean, smallint, smallint);
drop function if exists public._promo_125_validar_sigue_base(bigint);

-- Versión de la 300 de la RPC (4 parámetros).
create or replace function public.promocion_guardar_reglas(
  p_promocion_id bigint, p_base_id bigint, p_reglas jsonb, p_previas jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_actual jsonb;
  v_n int;
begin
  if jsonb_typeof(coalesce(p_reglas, 'null')) <> 'array' or jsonb_typeof(coalesce(p_previas, 'null')) <> 'object' then
    raise exception 'promocion_guardar_reglas: parámetros inválidos' using errcode = '22023';
  end if;
  perform 1 from public.hotel_temporadas t where t.id = p_promocion_id for update;
  if not found then
    raise exception 'La promoción no existe o no tienes permiso para editarla.' using errcode = '42501';
  end if;
  perform public._promo_300_candado_base(array_remove(array[p_base_id, (select promo_base_id from public.hotel_temporadas where id = p_promocion_id)], null));
  select jsonb_build_object('base', t.promo_base_id, 'reglas', coalesce((
           select jsonb_agg(jsonb_build_object('grupo_id', r.grupo_id, 'valor', r.valor, 'dias', to_jsonb(r.dias))
                            order by coalesce(r.grupo_id::text, ''))
           from public.hotel_promocion_reglas r where r.promocion_id = t.id), '[]'::jsonb))
    into v_actual from public.hotel_temporadas t where t.id = p_promocion_id;
  if (v_actual->>'base') is distinct from (p_previas->>'base')
     or exists (select grupo_id, valor, dias from jsonb_to_recordset(v_actual->'reglas') as a(grupo_id uuid, valor numeric, dias smallint[])
                except
                select grupo_id, valor, dias from jsonb_to_recordset(coalesce(p_previas->'reglas', '[]')) as b(grupo_id uuid, valor numeric, dias smallint[]))
     or exists (select grupo_id, valor, dias from jsonb_to_recordset(coalesce(p_previas->'reglas', '[]')) as b(grupo_id uuid, valor numeric, dias smallint[])
                except
                select grupo_id, valor, dias from jsonb_to_recordset(v_actual->'reglas') as a(grupo_id uuid, valor numeric, dias smallint[])) then
    raise exception 'La promoción cambió mientras la editabas; recarga y vuelve a revisarla.' using errcode = 'PT409';
  end if;
  if p_base_id is null and jsonb_array_length(p_reglas) > 0 then
    raise exception 'Las reglas por grupo exigen elegir la vigencia base.' using errcode = '22023';
  end if;
  if p_base_id is not null and jsonb_array_length(p_reglas) = 0 then
    raise exception 'Agrega al menos una regla (un grupo sin regla conserva la base).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.hotel_promocion_reglas where promocion_id = p_promocion_id) then
    perform set_config('app.e5_promocion_nueva', p_promocion_id::text, true);
  end if;
  delete from public.hotel_promocion_reglas where promocion_id = p_promocion_id;
  update public.hotel_temporadas set promo_base_id = p_base_id where id = p_promocion_id and promo_base_id is distinct from p_base_id;
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias)
  select p_promocion_id, r.grupo_id, r.valor, r.dias
  from jsonb_to_recordset(p_reglas) as r(grupo_id uuid, valor numeric, dias smallint[]);
  get diagnostics v_n = row_count;
  return jsonb_build_object('base', p_base_id, 'reglas', v_n);
end $$;
revoke all on function public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb) to authenticated, service_role;

-- Trigger de reglas de la 300 (sin el modo nuevo).
create or replace function public.tg_hotel_promocion_reglas_300()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  g record;
  v_base_con_grupos boolean;
begin
  select t.id, btrim(t.nombre) as nombre, t.tipo, t.promo_base_id, t.descuento_unidad into p
  from public.hotel_temporadas t where t.id = new.promocion_id for share;
  if not found or p.promo_base_id is null then
    raise exception 'Una regla por grupo exige una promoción vinculada a una base.' using errcode = '23514';
  end if;
  if p.tipo = 'descuento_pct' and new.valor >= 100 then
    raise exception 'El porcentaje de "%" debe ser mayor que 0 y menor que 100.', p.nombre using errcode = '23514';
  end if;
  v_base_con_grupos := exists (select 1 from public.hotel_temporada_grupos x where x.temporada_id = p.promo_base_id);
  if new.grupo_id is null then
    if v_base_con_grupos then
      raise exception 'La base de "%" tiene grupos de días: cada regla debe indicar su grupo.', p.nombre using errcode = '23514';
    end if;
    return new;
  end if;
  select x.temporada_id, btrim(x.nombre) as nombre, x.dias into g
  from public.hotel_temporada_grupos x where x.id = new.grupo_id for share;
  if not found or g.temporada_id <> p.promo_base_id then
    raise exception 'La regla de "%" usa un grupo que no es de su base.', p.nombre using errcode = '23514';
  end if;
  if new.dias is not null and not (new.dias <@ g.dias) then
    raise exception 'Los días elegidos en "%" deben pertenecer al grupo "%".', p.nombre, g.nombre using errcode = '23514';
  end if;
  new.actualizado_en := now();
  return new;
end $$;

alter table public.hotel_temporadas drop constraint if exists hotel_temporadas_promo_125;
alter table public.hotel_temporadas
  drop column if exists promo_sigue_base, drop column if exists nino_gratis,
  drop column if exists nino_gratis_edad_min, drop column if exists nino_gratis_edad_max;
commit;
