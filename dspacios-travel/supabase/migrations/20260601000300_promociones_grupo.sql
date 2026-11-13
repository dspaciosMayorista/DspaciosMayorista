-- ─────────────────────────────────────────────────────────────────────────────
-- 300 · #43/#60 entrega 4 — Promociones por grupo (número PROVISIONAL; sin aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Especificación §4 (historial X, Y, P, S, T, O; diseño de esta entrega en AI).
-- Depende de la 293 (grupos) y de la 299 (activación). No depende de la 298.
--
-- Qué agrega (todo ADITIVO; ninguna fila existente cambia):
--   1) `hotel_temporadas`:
--      · promo_base_id      → promoción POR NOCHE con reglas, vinculada a UNA base ('tarifa', mismo hotel).
--      · descuento_unidad   → monto fijo: 'persona_noche' | 'habitacion_noche' | 'persona_estadia'.
--                             NULL = «unidad anterior» (todas las existentes).
--      · noche_gratis_regla → «N noches, 1 gratis»: 'mas_barata' | 'mas_cara' | 'ultima'.
--                             NULL = promedio heredado (todas las existentes).
--      · dias_promo         → noche gratis: días que se pueden bonificar; persona/estadía: días de
--                             entrada. NULL = todos los días.
--   2) `hotel_promocion_reglas`: una regla por grupo de la base (o una sola, sin grupo, si la base
--      no tiene grupos), con su valor (% o monto) y sus días (NULL = todos los días del grupo).
--      Grupo sin regla = conserva la base. La promoción no tiene filas propias en `tarifa_hotel`:
--      el motor aplica la regla sobre la tarifa de la base que GANA la noche (base primero, N1).
--   3) Integridad en la base: vínculo coherente (base 'tarifa' del mismo hotel), días dentro del
--      grupo, prioridad de la promoción mayor que la de su base y distinta de otra promoción de esa
--      base, grupo con reglas que no se borra ni cambia de días por debajo de ellas.
--   4) `promocion_guardar_reglas`: reemplaza vínculo + reglas en UNA transacción comparando la foto
--      que vio quien edita (PT409 si cambió).
-- «Elegir» (unidad, noche bonificada, días) es obligatorio para promociones NUEVAS: lo exigen el
-- formulario y la acción del servidor; la base solo valida los valores (no puede distinguir una
-- promoción nueva de la copia de una existente).
-- Fuera de alcance (entrega 5): acumulación y precedencia con EBB / Long Stay.
-- Orden: preflight_300 → 300 → postcheck_300 → código. Rollback: rollback_300 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.hotel_temporada_grupos') is null
     or to_regprocedure('public.grupos_dias_activar(bigint, text, jsonb)') is null then
    raise exception '300 ABORTADA: requiere la 293 y la 299 aplicadas';
  end if;
end $$;

-- 1) Columnas de la promoción ----------------------------------------------------
alter table public.hotel_temporadas
  add column if not exists promo_base_id      bigint references public.hotel_temporadas(id) on delete restrict,
  add column if not exists descuento_unidad   text,
  add column if not exists noche_gratis_regla text,
  add column if not exists dias_promo         smallint[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotel_temporadas_promo_300' and conrelid = 'public.hotel_temporadas'::regclass) then
    alter table public.hotel_temporadas add constraint hotel_temporadas_promo_300 check (
      (descuento_unidad is null or (descuento_unidad in ('persona_noche', 'habitacion_noche', 'persona_estadia') and tipo = 'descuento_monto'))
      and (noche_gratis_regla is null or (noche_gratis_regla in ('mas_barata', 'mas_cara', 'ultima') and tipo = 'promo_noche_gratis'))
      and (dias_promo is null or (
            cardinality(dias_promo) between 1 and 7 and array_position(dias_promo, null) is null
            and dias_promo <@ array[1,2,3,4,5,6,7]::smallint[]
            and (tipo = 'promo_noche_gratis' or coalesce(descuento_unidad, '') = 'persona_estadia')))
      and (promo_base_id is null or (promo_base_id <> id and (
            tipo = 'descuento_pct' or coalesce(descuento_unidad, '') in ('persona_noche', 'habitacion_noche'))))
    );
  end if;
end $$;
create index if not exists hotel_temporadas_promo_base_idx on public.hotel_temporadas (promo_base_id) where promo_base_id is not null;

comment on column public.hotel_temporadas.promo_base_id is
  '#43/#60 (300): promoción por noche con reglas por grupo, vinculada a esta vigencia base. NULL = promoción existente (fila propia).';
comment on column public.hotel_temporadas.descuento_unidad is
  '#43/#60 (300): unidad del monto fijo. NULL = «unidad anterior» (promociones existentes, sin reinterpretar).';
comment on column public.hotel_temporadas.noche_gratis_regla is
  '#43/#60 (300): noche que se bonifica. NULL = promedio heredado (promociones existentes).';
comment on column public.hotel_temporadas.dias_promo is
  '#43/#60 (300): noche gratis = días bonificables; persona/estadía = días de entrada. NULL = todos.';

-- 2) Reglas por grupo -------------------------------------------------------------
create table if not exists public.hotel_promocion_reglas (
  id              uuid primary key default gen_random_uuid(),
  promocion_id    bigint not null references public.hotel_temporadas(id) on delete cascade,
  grupo_id        uuid references public.hotel_temporada_grupos(id) on delete restrict,
  valor           numeric(14, 2) not null,
  dias            smallint[],
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint hotel_promocion_reglas_valor check (valor > 0),
  constraint hotel_promocion_reglas_dias check (dias is null or (
    cardinality(dias) between 1 and 7 and array_position(dias, null) is null and dias <@ array[1,2,3,4,5,6,7]::smallint[]))
);
comment on table public.hotel_promocion_reglas is
  '#43/#60 (300): regla de una promoción por noche para un grupo de su base (grupo NULL = base sin grupos). Valor = % o monto; días NULL = todos los del grupo.';
create unique index if not exists hotel_promocion_reglas_uq
  on public.hotel_promocion_reglas (promocion_id, coalesce(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists hotel_promocion_reglas_grupo_idx on public.hotel_promocion_reglas (grupo_id) where grupo_id is not null;

-- 3) Integridad --------------------------------------------------------------------
-- 3.1 Vigencias: vínculo, prioridades y bases referenciadas.
create or replace function public.tg_hotel_temporadas_promo_300()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b record;
  v_otra text;
begin
  if new.promo_base_id is not null then
    select t.hotel_id, t.tipo, t.prioridad, btrim(t.nombre) as nombre into b
    from public.hotel_temporadas t where t.id = new.promo_base_id;
    if not found or b.hotel_id <> new.hotel_id or coalesce(b.tipo, 'tarifa') <> 'tarifa' then
      raise exception 'La promoción "%" debe vincularse a una vigencia de tarifa del mismo hotel.', btrim(new.nombre) using errcode = '23514';
    end if;
    if coalesce(new.prioridad, 1) <= coalesce(b.prioridad, 1) then
      raise exception 'La promoción "%" debe tener mayor prioridad que su base "%" (prioridad %).', btrim(new.nombre), b.nombre, coalesce(b.prioridad, 1)
        using errcode = '23514';
    end if;
    -- Igual prioridad que OTRA promoción de la misma base: no se rechaza aquí; solo si pueden coincidir
    -- (compra, fechas, días, régimen). Lo decide la comprobación diferida 3.4 al confirmar.
    if exists (select 1 from public.hotel_promocion_reglas r
               left join public.hotel_temporada_grupos g on g.id = r.grupo_id
               where r.promocion_id = new.id and r.grupo_id is not null and g.temporada_id is distinct from new.promo_base_id) then
      raise exception 'La promoción "%" tiene reglas de grupos de otra base; guárdala desde su editor de reglas.', btrim(new.nombre) using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' and old.promo_base_id is not null
        and exists (select 1 from public.hotel_promocion_reglas r where r.promocion_id = new.id) then
    raise exception 'La promoción "%" tiene reglas por grupo; quítalas desde su editor antes de desvincularla.', btrim(new.nombre) using errcode = '23514';
  end if;
  -- (Los check usan coalesce: una comparación con NULL dejaría pasar la fila.)
  -- Una base con promociones vinculadas sigue siendo 'tarifa' y con menor prioridad que todas ellas.
  if tg_op = 'UPDATE' then
    select btrim(t.nombre) into v_otra from public.hotel_temporadas t
    where t.promo_base_id = new.id and (coalesce(new.tipo, 'tarifa') <> 'tarifa' or coalesce(t.prioridad, 1) <= coalesce(new.prioridad, 1)
                                        or t.hotel_id <> new.hotel_id) limit 1;
    if found then
      raise exception 'La vigencia "%" es la base de la promoción "%": debe seguir siendo de tarifa, del mismo hotel y con menor prioridad que ella.', btrim(new.nombre), v_otra
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_hotel_temporadas_promo_300 on public.hotel_temporadas;
create trigger trg_hotel_temporadas_promo_300
  before insert or update of promo_base_id, hotel_id, tipo, prioridad, descuento_unidad, nombre on public.hotel_temporadas
  for each row execute function public.tg_hotel_temporadas_promo_300();

-- 3.2 Reglas: promoción con vínculo; grupo de SU base (o sin grupo si la base no tiene grupos);
--     días dentro del grupo; porcentaje < 100.
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

drop trigger if exists trg_hotel_promocion_reglas_300 on public.hotel_promocion_reglas;
create trigger trg_hotel_promocion_reglas_300
  before insert or update on public.hotel_promocion_reglas
  for each row execute function public.tg_hotel_promocion_reglas_300();

-- 3.3 Grupos: no se borran, no cambian de días por debajo de una regla, y una base con reglas
--     «todos los días» no se divide en grupos sin resolverlas antes (V.3).
create or replace function public.tg_hotel_temporada_grupos_promo_300()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_promo text;
begin
  if tg_op = 'DELETE' then
    select string_agg(distinct btrim(t.nombre), ', ') into v_promo
    from public.hotel_promocion_reglas r join public.hotel_temporadas t on t.id = r.promocion_id where r.grupo_id = old.id;
    if v_promo is not null then
      raise exception 'El grupo "%" tiene reglas de las promociones %; quítalas o cámbialas antes de borrarlo.', btrim(old.nombre), v_promo
        using errcode = '23503';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.dias is distinct from old.dias then
    select string_agg(distinct btrim(t.nombre), ', ') into v_promo
    from public.hotel_promocion_reglas r join public.hotel_temporadas t on t.id = r.promocion_id
    where r.grupo_id = new.id and r.dias is not null and not (r.dias <@ new.dias);
    if v_promo is not null then
      raise exception 'Las promociones % usan días que dejarían de ser del grupo "%"; ajústalas antes.', v_promo, btrim(new.nombre)
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    select string_agg(distinct btrim(t.nombre), ', ') into v_promo
    from public.hotel_promocion_reglas r join public.hotel_temporadas t on t.id = r.promocion_id
    where t.promo_base_id = new.temporada_id and r.grupo_id is null;
    if v_promo is not null then
      raise exception 'Las promociones % tienen una regla para todos los días de esta vigencia; quítala antes de dividirla en grupos.', v_promo
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_hotel_temporada_grupos_promo_300 on public.hotel_temporada_grupos;
create trigger trg_hotel_temporada_grupos_promo_300
  before insert or update or delete on public.hotel_temporada_grupos
  for each row execute function public.tg_hotel_temporada_grupos_promo_300();

-- 3.4 Igual prioridad entre promociones de la MISMA base: conflicto SOLO si pueden coincidir en una noche que se
--     pueda vender (N4/W aplicado a promociones, S.1). Condiciones, todas necesarias:
--       · régimen compatible (libre o el mismo);
--       · existe una fecha de reserva ≥ hoy dentro de las dos ventanas de compra (y ≤ la noche);
--       · existe una noche cubierta por las dos promociones Y por su base (rangos menos blackouts);
--       · ese día de la semana tiene regla en las dos (mismo grupo de la base, días elegidos incluidos).
--     Se consideran TODOS los grupos de la base (también los preparados): coincidirían en cuanto se vendan.
--     La acomodación no las separa en v1: toda promoción por noche aplica a las habitaciones (las de monto por
--     habitación no aplican a niños, donde el motor ya decide sin empate). Si el cruce supera 1.096 noches se
--     informa «no verificable» y bloquea igual (nunca se declara sin conflicto lo que no se revisó).
--     Se comprueba al confirmar (trigger de restricción diferido), venga la escritura de donde venga.
create or replace function public._promo_300_cubre(p_rangos jsonb, p_ini date, p_fin date, p_blackouts jsonb, p_d date)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(case when jsonb_typeof(p_rangos) = 'array' and jsonb_array_length(p_rangos) > 0
                       then exists (select 1 from jsonb_array_elements(p_rangos) r
                                    where p_d between public._fecha_43(r->>'fecha_inicio') and public._fecha_43(r->>'fecha_fin'))
                       else p_d between p_ini and p_fin end, false)
     and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_blackouts) = 'array' then p_blackouts else '[]'::jsonb end) bo
                     where p_d between public._fecha_43(bo->>'fecha_inicio') and public._fecha_43(bo->>'fecha_fin'))
$$;

create or replace function public._promo_300_extremo(p_rangos jsonb, p_ini date, p_fin date, p_inicio boolean)
returns date language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_rangos) = 'array' and jsonb_array_length(p_rangos) > 0
              then (select case when p_inicio then min(public._fecha_43(r->>'fecha_inicio')) else max(public._fecha_43(r->>'fecha_fin')) end
                    from jsonb_array_elements(p_rangos) r)
              else case when p_inicio then p_ini else p_fin end end
$$;

-- ¿La promoción p tiene regla para la noche d de su base p_base? (grupo de la base que cubre el día, o regla sin grupo).
create or replace function public._promo_300_regla(p_promo bigint, p_base bigint, p_d date)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.hotel_promocion_reglas r
    where r.promocion_id = p_promo
      and r.grupo_id is not distinct from (select g.id from public.hotel_temporada_grupos g
                                            where g.temporada_id = p_base and extract(isodow from p_d)::int = any (g.dias) limit 1)
      and (r.dias is null or extract(isodow from p_d)::int = any (r.dias)))
$$;

create or replace function public._promo_300_conflictos(p_base bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b public.hotel_temporadas; a public.hotel_temporadas; c public.hotel_temporadas;
  v_out jsonb := '[]'::jsonb; v_hoy date := public.fecha_negocio();
  v_compra_ini date; v_compra_fin date; v_desde date; v_hasta date; v_hit date;
begin
  select * into b from public.hotel_temporadas where id = p_base;
  if not found then return v_out; end if;
  for a in select * from public.hotel_temporadas where promo_base_id = p_base order by id loop
    for c in select * from public.hotel_temporadas where promo_base_id = p_base and id > a.id
               and coalesce(prioridad, 1) = coalesce(a.prioridad, 1) order by id loop
      if a.regimen_restringido is not null and c.regimen_restringido is not null
         and btrim(a.regimen_restringido) <> btrim(c.regimen_restringido) then continue; end if;
      v_compra_ini := greatest(v_hoy, coalesce(a.compra_inicio, v_hoy), coalesce(c.compra_inicio, v_hoy));
      v_compra_fin := least(coalesce(a.compra_fin, 'infinity'::date), coalesce(c.compra_fin, 'infinity'::date));
      if v_compra_ini > v_compra_fin then continue; end if;
      v_desde := greatest(public._promo_300_extremo(a.rangos, a.fecha_inicio, a.fecha_fin, true),
                          public._promo_300_extremo(c.rangos, c.fecha_inicio, c.fecha_fin, true), v_compra_ini);
      v_hasta := least(public._promo_300_extremo(a.rangos, a.fecha_inicio, a.fecha_fin, false),
                       public._promo_300_extremo(c.rangos, c.fecha_inicio, c.fecha_fin, false));
      if v_desde is null or v_hasta is null or v_desde > v_hasta then continue; end if;
      if v_hasta - v_desde + 1 > 1096 then
        v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', 'no_verificable', 'a', btrim(a.nombre), 'b', btrim(c.nombre),
                   'prioridad', coalesce(a.prioridad, 1), 'base', btrim(b.nombre), 'desde', v_desde, 'hasta', v_hasta));
        continue;
      end if;
      select min(d::date) into v_hit from generate_series(v_desde, v_hasta, interval '1 day') d
      where public._promo_300_cubre(a.rangos, a.fecha_inicio, a.fecha_fin, a.blackouts, d::date)
        and public._promo_300_cubre(c.rangos, c.fecha_inicio, c.fecha_fin, c.blackouts, d::date)
        and public._promo_300_cubre(b.rangos, b.fecha_inicio, b.fecha_fin, b.blackouts, d::date)
        and public._promo_300_regla(a.id, p_base, d::date) and public._promo_300_regla(c.id, p_base, d::date);
      if v_hit is not null then
        v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', 'conflicto', 'a', btrim(a.nombre), 'b', btrim(c.nombre),
                   'prioridad', coalesce(a.prioridad, 1), 'base', btrim(b.nombre), 'noche', v_hit,
                   'grupo', (select btrim(g.nombre) from public.hotel_temporada_grupos g
                             where g.temporada_id = p_base and extract(isodow from v_hit)::int = any (g.dias) limit 1)));
      end if;
    end loop;
  end loop;
  return v_out;
end $$;

create or replace function public._promo_300_texto(e jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when e->>'tipo' = 'no_verificable'
    then format('CONFLICTO_PROMOCIONES: No se puede verificar si «%s» y «%s» (prioridad %s sobre «%s») coinciden: su cruce va del %s al %s, más de 1.096 noches. Acota las fechas o cambia la prioridad de una.',
                e->>'a', e->>'b', e->>'prioridad', e->>'base', e->>'desde', e->>'hasta')
    else format('CONFLICTO_PROMOCIONES: «%s» y «%s» tienen la misma prioridad (%s) sobre «%s» y pueden aplicar la misma noche (por ejemplo el %s%s). No se elige ninguna: cambia la prioridad de una, o sus fechas, días, régimen o ventana de compra.',
                e->>'a', e->>'b', e->>'prioridad', e->>'base', e->>'noche', coalesce(', grupo ' || (e->>'grupo'), ''))
  end
$$;

create or replace function public.tg_promo_300_conflictos()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_base bigint; v jsonb;
begin
  if tg_table_name = 'hotel_promocion_reglas' then
    select t.promo_base_id into v_base from public.hotel_temporadas t where t.id = new.promocion_id;
  elsif new.promo_base_id is not null then
    v_base := new.promo_base_id;
  elsif exists (select 1 from public.hotel_temporadas t where t.promo_base_id = new.id) then
    v_base := new.id; -- la base cambió (fechas, blackouts): revisa sus promociones
  end if;
  if v_base is null then return null; end if;
  -- Serializa por base: dos transacciones que por separado no empatan pero juntas sí no confirman las dos (la segunda
  -- espera y, ya con lo de la primera a la vista, se rechaza).
  perform pg_advisory_xact_lock(hashtextextended('promo_300_base:' || v_base::text, 0));
  v := public._promo_300_conflictos(v_base);
  if jsonb_array_length(v) > 0 then
    raise exception '%', public._promo_300_texto(v->0) using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists trg_promo_300_conflictos on public.hotel_temporadas;
create constraint trigger trg_promo_300_conflictos after insert or update on public.hotel_temporadas
  deferrable initially deferred for each row execute function public.tg_promo_300_conflictos();
drop trigger if exists trg_promo_300_conflictos on public.hotel_promocion_reglas;
create constraint trigger trg_promo_300_conflictos after insert or update on public.hotel_promocion_reglas
  deferrable initially deferred for each row execute function public.tg_promo_300_conflictos();
revoke all on function public._promo_300_conflictos(bigint) from public, anon, authenticated;
revoke all on function public.tg_promo_300_conflictos() from public, anon, authenticated;

revoke all on function public.tg_hotel_temporadas_promo_300() from public, anon, authenticated;
revoke all on function public.tg_hotel_promocion_reglas_300() from public, anon, authenticated;
revoke all on function public.tg_hotel_temporada_grupos_promo_300() from public, anon, authenticated;

drop trigger if exists trg_auditoria on public.hotel_promocion_reglas;
create trigger trg_auditoria
  after insert or update or delete on public.hotel_promocion_reglas
  for each row execute function public.fn_auditoria();

-- 4) RLS y permisos: iguales a los grupos de la 293 (internos; escritura del catálogo global solo
--    en sesión Mayorista; anon sin acceso).
alter table public.hotel_promocion_reglas enable row level security;
drop policy if exists "hotel_promocion_reglas: interno" on public.hotel_promocion_reglas;
create policy "hotel_promocion_reglas: interno" on public.hotel_promocion_reglas
  for all
  using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]))
  with check (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));
drop policy if exists "catalogo global: insertar solo Mayorista" on public.hotel_promocion_reglas;
create policy "catalogo global: insertar solo Mayorista" on public.hotel_promocion_reglas
  as restrictive for insert with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: actualizar solo Mayorista" on public.hotel_promocion_reglas;
create policy "catalogo global: actualizar solo Mayorista" on public.hotel_promocion_reglas
  as restrictive for update using ((select public.puede_escribir_catalogo_global()))
  with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: borrar solo Mayorista" on public.hotel_promocion_reglas;
create policy "catalogo global: borrar solo Mayorista" on public.hotel_promocion_reglas
  as restrictive for delete using ((select public.puede_escribir_catalogo_global()));
revoke all on public.hotel_promocion_reglas from public, anon;
grant select, insert, update, delete on public.hotel_promocion_reglas to authenticated;
grant all on public.hotel_promocion_reglas to service_role;

-- 4.bis Revisión de «Aplicar a la venta» (V.1/V.4: sin consecuencias ocultas) -------------------------
-- Promociones por grupo vinculadas a una base, con sus reglas (grupo, días, valor) y los conflictos de prioridad.
create or replace function public._promo_300_revision(p_base bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'nombre', btrim(t.nombre), 'tipo', t.tipo, 'unidad', t.descuento_unidad, 'prioridad', coalesce(t.prioridad, 1),
      'fecha_inicio', t.fecha_inicio, 'fecha_fin', t.fecha_fin, 'compra_inicio', t.compra_inicio, 'compra_fin', t.compra_fin,
      'regimen', t.regimen_restringido,
      'reglas', coalesce((select jsonb_agg(jsonb_build_object('grupo_id', r.grupo_id, 'grupo', btrim(g.nombre), 'dias_grupo', g.dias,
                                                              'valor', r.valor, 'dias', r.dias) order by g.dias[1], r.grupo_id)
                          from public.hotel_promocion_reglas r left join public.hotel_temporada_grupos g on g.id = r.grupo_id
                          where r.promocion_id = t.id), '[]'::jsonb),
      'huella', md5(to_jsonb(t)::text || coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.hotel_promocion_reglas r
                                                   where r.promocion_id = t.id)::text, ''))
    ) order by t.id), '[]'::jsonb)
  from public.hotel_temporadas t where t.promo_base_id = p_base
$$;

-- La configuración de grupos (299) gana las promociones vinculadas y sus conflictos, y su HUELLA las cubre: si alguien
-- cambia una promoción o sus reglas entre «Revisar» y «Aplicar», la aplicación se rechaza (PT409) en vez de activar con
-- una consecuencia que no se vio. No se edita la 299: su función se conserva con otro nombre y se envuelve.
do $$
begin
  if to_regprocedure('public._grupos_43_config_299(bigint)') is null then
    alter function public._grupos_43_config(bigint) rename to _grupos_43_config_299;
  end if;
end $$;
create or replace function public._grupos_43_config(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb; p jsonb; k jsonb;
begin
  r := public._grupos_43_config_299(p_temporada_id);
  p := public._promo_300_revision(p_temporada_id);
  k := public._promo_300_conflictos(p_temporada_id);
  return r || jsonb_build_object('promociones_reglas', p, 'promociones_conflictos', k,
                                 'huella', md5(coalesce(r->>'huella', '') || '|' || p::text));
end $$;
revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_config_299(bigint) from public, anon, authenticated;
revoke all on function public._promo_300_revision(bigint) from public, anon, authenticated;

-- Candados de la RPC de reglas en el MISMO orden que «Aplicar a la venta» (grupos → vigencia base), compartidos:
-- guardar reglas y aplicar a la venta sobre la misma base se serializan sin interbloqueo. Solo internos con escritura.
create or replace function public._promo_300_candado_base(p_bases bigint[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.mi_rol() is null or not (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[])) then
    raise exception 'La promoción no existe o no tienes permiso para editarla.' using errcode = '42501';
  end if;
  perform 1 from public.hotel_temporada_grupos g where g.temporada_id = any (p_bases) order by g.id for share;
  perform 1 from public.hotel_temporadas t where t.id = any (p_bases) order by t.id for share;
end $$;
revoke all on function public._promo_300_candado_base(bigint[]) from public, anon;
grant execute on function public._promo_300_candado_base(bigint[]) to authenticated, service_role;

-- 5) Guardar vínculo + reglas en una transacción ------------------------------------
-- p_previas: {"base": <id|null>, "reglas": [{grupo_id, valor, dias}]} tal como lo vio quien edita.
-- p_reglas:  [{grupo_id, valor, dias}] nuevas (vacío + p_base_id NULL = desvincular).
-- SECURITY INVOKER: la RLS de quien llama decide (mismos roles que escriben tarifas).
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
  -- Foto: misma base y mismas reglas (sin importar el orden ni la forma numérica del valor).
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
  -- (301) Primera vez que la promoción recibe reglas: todavía no se vendía; si coincide con EBB / Long Stay queda pendiente.
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

commit;
