-- ─────────────────────────────────────────────────────────────────────────────
-- 310 · #125 — Promoción que SIGUE la base ganadora cada noche + «un niño gratis por habitación» (número PROVISIONAL; sin aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Depende de la 300 (promociones por grupo) y de la 301 (acumulación). No toca la 298/299. Todo ADITIVO: ninguna fila existente cambia.
--
-- Qué agrega:
--   1) `hotel_temporadas`:
--      · promo_sigue_base      → modo EXPLÍCITO (default false): la promoción por noche aplica su regla sobre la base que GANA cada noche, sin vínculo a una
--                                sola (`promo_base_id` queda NULL). Solo promociones `descuento_pct`. Excluyente con `promo_base_id`.
--      · nino_gratis           → «un niño gratis por habitación» (con al menos 2 adultos); solo `descuento_pct` con reglas (vinculada o seguir-base).
--      · nino_gratis_edad_min/max → edad PROPIA de la promoción (opcional; ambas o ninguna, 0–17, min ≤ max). NULL = rige la regla de edad del hotel.
--   2) `tg_hotel_promocion_reglas_300`: acepta la regla de una promoción en modo seguir-base (exactamente una, sin grupo, % < 100).
--   3) `_promo_125_validar_sigue_base`: validación por noche al guardar, POR RÉGIMEN aplicable (cobertura, empate de bases, prioridad, promociones de la misma
--      prioridad que se cruzan, filas guardadas de la misma promoción). Solo diagnostica.
--   4) `promocion_guardar_reglas` pasa a 8 parámetros (los 4 nuevos con default): MISMA transacción y MISMA foto de PT409 (ahora también modo y niño gratis).
--      Se elimina la firma de 4 parámetros para no dejar dos sobrecargas que PostgREST no sabría elegir; los llamadores con 4 parámetros siguen funcionando.
-- Lo que NO hace: no convierte ninguna promoción existente (ni de fila propia ni vinculada), no recalcula documentos, no cambia el infante de las vinculadas.
-- Editada EN EL LUGAR tras la auditoría Codex de #125 (F5: validación por régimen) — legítimo porque la 310 no está aplicada en ningún entorno.
-- Orden: preflight_310 → 310 → postcheck_310 → código (el código lee estas columnas: no desplegarlo antes). Rollback: rollback_310 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.hotel_promocion_reglas') is null
     or to_regprocedure('public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb)') is null
     or to_regprocedure('public._promo_300_candado_base(bigint[])') is null then
    raise exception '310 ABORTADA: requiere la 300 (y la 301) aplicadas y la firma de 4 parámetros de promocion_guardar_reglas';
  end if;
end $$;

-- 1) Columnas ---------------------------------------------------------------------
alter table public.hotel_temporadas
  add column if not exists promo_sigue_base     boolean not null default false,
  add column if not exists nino_gratis          boolean not null default false,
  add column if not exists nino_gratis_edad_min smallint,
  add column if not exists nino_gratis_edad_max smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotel_temporadas_promo_125' and conrelid = 'public.hotel_temporadas'::regclass) then
    alter table public.hotel_temporadas add constraint hotel_temporadas_promo_125 check (
      (not promo_sigue_base or (promo_base_id is null and tipo = 'descuento_pct'))
      and (not nino_gratis or (tipo = 'descuento_pct' and (promo_base_id is not null or promo_sigue_base)))
      and ((nino_gratis_edad_min is null and nino_gratis_edad_max is null)
           or (nino_gratis and nino_gratis_edad_min is not null and nino_gratis_edad_max is not null
               and nino_gratis_edad_min between 0 and 17 and nino_gratis_edad_max between 0 and 17
               and nino_gratis_edad_min <= nino_gratis_edad_max))
    );
  end if;
end $$;

comment on column public.hotel_temporadas.promo_sigue_base is
  '#125 (310): modo explícito «seguir la base ganadora cada noche». Default false = promociones existentes sin cambios. Excluyente con promo_base_id; solo descuento_pct.';
comment on column public.hotel_temporadas.nino_gratis is
  '#125 (310): un niño gratis por habitación con al menos 2 adultos; solo descuento_pct con reglas. Solo alojamiento del hotel promocionado.';
comment on column public.hotel_temporadas.nino_gratis_edad_min is '#125 (310): edad propia mínima (años cumplidos) del niño gratis; NULL con la máxima = regla de edad del hotel.';
comment on column public.hotel_temporadas.nino_gratis_edad_max is '#125 (310): edad propia máxima (años cumplidos) del niño gratis; NULL con la mínima = regla de edad del hotel.';

-- 2) La regla de una promoción en modo seguir-base ------------------------------------
create or replace function public.tg_hotel_promocion_reglas_300()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  g record;
  v_base_con_grupos boolean;
begin
  select t.id, btrim(t.nombre) as nombre, t.tipo, t.promo_base_id, t.descuento_unidad, t.promo_sigue_base into p
  from public.hotel_temporadas t where t.id = new.promocion_id for share;
  if not found or (p.promo_base_id is null and not p.promo_sigue_base) then
    raise exception 'Una regla por grupo exige una promoción vinculada a una base o que siga la base ganadora.' using errcode = '23514';
  end if;
  if p.tipo = 'descuento_pct' and new.valor >= 100 then
    raise exception 'El porcentaje de "%" debe ser mayor que 0 y menor que 100.', p.nombre using errcode = '23514';
  end if;
  if p.promo_sigue_base then
    -- #125: UNA regla para todas las bases (y todos sus grupos): sin grupo.
    if new.grupo_id is not null then
      raise exception 'La promoción "%" sigue la base ganadora: su regla es una sola, sin grupo.', p.nombre using errcode = '23514';
    end if;
    new.actualizado_en := now();
    return new;
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

-- 3) Validación por noche del modo seguir-base (solo diagnostica; NULL = sin problema) ---------
create or replace function public._promo_125_validar_sigue_base(p_promocion bigint)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.hotel_temporadas;
  v_desde date; v_hasta date; v_msg text;
begin
  select * into p from public.hotel_temporadas where id = p_promocion;
  if not found then return 'La promoción no existe.'; end if;
  v_desde := public._promo_300_extremo(p.rangos, p.fecha_inicio, p.fecha_fin, true);
  v_hasta := public._promo_300_extremo(p.rangos, p.fecha_inicio, p.fecha_fin, false);
  if v_desde is null or v_hasta is null or v_desde > v_hasta then
    return format('La promoción "%s" no tiene fechas de viaje cargadas.', btrim(p.nombre));
  end if;
  if v_hasta - v_desde + 1 > 1096 then
    return format('"%s" cubre más de 1.096 noches: no se puede verificar; divídela en periodos.', btrim(p.nombre));
  end if;
  -- F5 (auditoría Codex): se valida POR RÉGIMEN con la misma regla de aplicabilidad del motor (`aplicaRegimen`): una vigencia sin restricción aplica a todos los
  -- regímenes; una restringida, solo al suyo; la promoción solo a los regímenes que su propia restricción permite. Regímenes candidatos = las restricciones distintas
  -- de las bases del hotel y de la promoción + el cajón «sin régimen» (solo bases sin restricción). Una base PAM y una FULL de igual prioridad NO compiten.
  -- «Sin base» se evalúa sobre la UNIÓN de cajones aplicables (una noche que ningún cajón cubre); empate y prioridad, dentro de cada cajón con bases esa noche.
  with noches as (
    select g::date as d from generate_series(v_desde, v_hasta, interval '1 day') g
    where public._promo_300_cubre(p.rangos, p.fecha_inicio, p.fecha_fin, p.blackouts, g::date)
  ), bases as (
    select b.rangos, b.fecha_inicio, b.fecha_fin, b.blackouts, btrim(b.nombre) as nombre, coalesce(b.prioridad, 1) as prio, btrim(b.regimen_restringido) as reg
    from public.hotel_temporadas b
    where b.hotel_id = p.hotel_id and coalesce(b.tipo, 'tarifa') = 'tarifa'
  ), regs as (
    select distinct reg as r from bases where reg is not null
    union select btrim(p.regimen_restringido) where p.regimen_restringido is not null
    union select null::text
  ), aplica as (
    select r from regs where p.regimen_restringido is null or r = btrim(p.regimen_restringido)
  ), cubre as (
    select a.r, n.d, b.nombre, b.prio, (b.reg is not null) as restringida
    from aplica a cross join noches n
    join bases b on (b.reg is null or b.reg = a.r) and public._promo_300_cubre(b.rangos, b.fecha_inicio, b.fecha_fin, b.blackouts, n.d)
  ), tope as (
    select r, d, max(prio) as prio from cubre group by r, d
  ), ganadoras as (
    select c.r, c.d, t.prio, array_agg(distinct c.nombre order by c.nombre) as nombres, bool_or(c.restringida) as con_restringida
    from cubre c join tope t on t.r is not distinct from c.r and t.d = c.d and c.prio = t.prio
    group by c.r, c.d, t.prio
  ), problemas as (
    select 1 as orden, n.d, null::text as r, format('El %s no lo cubre ninguna temporada base: la promoción no crea disponibilidad.', to_char(n.d, 'DD/MM/YYYY')) as msg
      from noches n where not exists (select 1 from ganadoras g where g.d = n.d)
    union all
    select 2, g.d, g.r, format('El %s empatan en prioridad las bases %s%s: no se sabe sobre cuál aplicar la promoción.', to_char(g.d, 'DD/MM/YYYY'), array_to_string(g.nombres, ', '),
                               case when g.con_restringida and g.r is not null then format(' en el régimen %s', g.r) else '' end)
      from ganadoras g where array_length(g.nombres, 1) > 1
    union all
    select 3, g.d, g.r, format('El %s la promoción (prioridad %s) no tiene mayor prioridad que su base %s (prioridad %s)%s.',
                               to_char(g.d, 'DD/MM/YYYY'), coalesce(p.prioridad, 1), array_to_string(g.nombres, ', '), g.prio,
                               case when g.con_restringida and g.r is not null then format(' en el régimen %s', g.r) else '' end)
      from ganadoras g where coalesce(p.prioridad, 1) <= g.prio
  )
  select msg into v_msg from problemas order by orden, d, r nulls first limit 1;
  if v_msg is not null then return v_msg; end if;
  -- Otra promoción por noche de la MISMA prioridad que se cruce con esta en alguna noche: ambigüedad (el motor no vende esa noche).
  select format('La promoción "%s" tiene la misma prioridad (%s) y se cruza con esta; cambia una de las dos prioridades.', btrim(o.nombre), coalesce(o.prioridad, 1)) into v_msg
  from public.hotel_temporadas o
  where o.hotel_id = p.hotel_id and o.id <> p.id
    and coalesce(o.tipo, 'tarifa') in ('descuento_pct', 'descuento_monto')
    and not (o.tipo = 'descuento_monto' and coalesce(o.descuento_unidad, '') = 'persona_estadia')
    and coalesce(o.prioridad, 1) = coalesce(p.prioridad, 1)
    and (o.regimen_restringido is null or p.regimen_restringido is null or btrim(o.regimen_restringido) = btrim(p.regimen_restringido))
    and exists (select 1 from generate_series(v_desde, v_hasta, interval '1 day') g
                where public._promo_300_cubre(p.rangos, p.fecha_inicio, p.fecha_fin, p.blackouts, g::date)
                  and public._promo_300_cubre(o.rangos, o.fecha_inicio, o.fecha_fin, o.blackouts, g::date))
  order by o.id limit 1;
  return v_msg;
end $$;

-- 4) Guardar reglas (8 parámetros) ---------------------------------------------------------
drop function if exists public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb);
create or replace function public.promocion_guardar_reglas(
  p_promocion_id bigint, p_base_id bigint, p_reglas jsonb, p_previas jsonb,
  p_sigue_base boolean default false, p_nino_gratis boolean default false,
  p_nino_edad_min smallint default null, p_nino_edad_max smallint default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_actual jsonb;
  v_n int;
  p public.hotel_temporadas;
  v_msg text;
  v_prev_sigue boolean := coalesce((p_previas->>'sigue_base')::boolean, false);
  v_prev_ng boolean := coalesce((p_previas->>'nino_gratis')::boolean, false);
begin
  if jsonb_typeof(coalesce(p_reglas, 'null')) <> 'array' or jsonb_typeof(coalesce(p_previas, 'null')) <> 'object' then
    raise exception 'promocion_guardar_reglas: parámetros inválidos' using errcode = '22023';
  end if;
  select * into p from public.hotel_temporadas t where t.id = p_promocion_id for update;
  if not found then
    raise exception 'La promoción no existe o no tienes permiso para editarla.' using errcode = '42501';
  end if;
  perform public._promo_300_candado_base(array_remove(array[p_base_id, p.promo_base_id], null));
  select jsonb_build_object('base', t.promo_base_id, 'sigue_base', t.promo_sigue_base, 'nino_gratis', t.nino_gratis,
           'nino_edad_min', t.nino_gratis_edad_min, 'nino_edad_max', t.nino_gratis_edad_max,
           'reglas', coalesce((
             select jsonb_agg(jsonb_build_object('grupo_id', r.grupo_id, 'valor', r.valor, 'dias', to_jsonb(r.dias))
                              order by coalesce(r.grupo_id::text, ''))
             from public.hotel_promocion_reglas r where r.promocion_id = t.id), '[]'::jsonb))
    into v_actual from public.hotel_temporadas t where t.id = p_promocion_id;
  -- Foto: misma base, mismo modo, mismo niño gratis y mismas reglas (sin importar el orden ni la forma numérica del valor).
  if (v_actual->>'base') is distinct from (p_previas->>'base')
     or (v_actual->>'sigue_base')::boolean is distinct from v_prev_sigue
     or (v_actual->>'nino_gratis')::boolean is distinct from v_prev_ng
     or (v_actual->>'nino_edad_min') is distinct from (p_previas->>'nino_edad_min')
     or (v_actual->>'nino_edad_max') is distinct from (p_previas->>'nino_edad_max')
     or exists (select grupo_id, valor, dias from jsonb_to_recordset(v_actual->'reglas') as a(grupo_id uuid, valor numeric, dias smallint[])
                except
                select grupo_id, valor, dias from jsonb_to_recordset(coalesce(p_previas->'reglas', '[]')) as b(grupo_id uuid, valor numeric, dias smallint[]))
     or exists (select grupo_id, valor, dias from jsonb_to_recordset(coalesce(p_previas->'reglas', '[]')) as b(grupo_id uuid, valor numeric, dias smallint[])
                except
                select grupo_id, valor, dias from jsonb_to_recordset(v_actual->'reglas') as a(grupo_id uuid, valor numeric, dias smallint[])) then
    raise exception 'La promoción cambió mientras la editabas; recarga y vuelve a revisarla.' using errcode = 'PT409';
  end if;
  if coalesce(p_sigue_base, false) then
    if p_base_id is not null then
      raise exception 'Una promoción que sigue la base ganadora no se vincula a una sola base.' using errcode = '22023';
    end if;
    if coalesce(p.tipo, 'tarifa') <> 'descuento_pct' then
      raise exception 'Seguir la base ganadora solo aplica a una promoción de porcentaje.' using errcode = '23514';
    end if;
    if jsonb_array_length(p_reglas) <> 1 or (p_reglas->0->>'grupo_id') is not null then
      raise exception 'Seguir la base ganadora usa una sola regla (porcentaje y días), sin grupo.' using errcode = '22023';
    end if;
  elsif p_base_id is null and jsonb_array_length(p_reglas) > 0 then
    raise exception 'Las reglas por grupo exigen elegir la vigencia base.' using errcode = '22023';
  elsif p_base_id is not null and jsonb_array_length(p_reglas) = 0 then
    raise exception 'Agrega al menos una regla (un grupo sin regla conserva la base).' using errcode = '22023';
  end if;
  if coalesce(p_nino_gratis, false) then
    if p_base_id is null and not coalesce(p_sigue_base, false) then
      raise exception 'Un niño gratis por habitación exige que la promoción tenga reglas.' using errcode = '23514';
    end if;
    if coalesce(p.tipo, 'tarifa') <> 'descuento_pct' then
      raise exception 'Un niño gratis por habitación solo se combina con una promoción de porcentaje.' using errcode = '23514';
    end if;
    if (p_nino_edad_min is null) <> (p_nino_edad_max is null) then
      raise exception 'Indica la edad mínima y la máxima del niño gratis, o deja ambas vacías.' using errcode = '22023';
    end if;
  elsif p_nino_edad_min is not null or p_nino_edad_max is not null then
    raise exception 'La edad del niño gratis solo se guarda con «Un niño gratis por habitación» activo.' using errcode = '22023';
  end if;
  -- Modo nuevo: una promoción que todavía vende con FILA propia no puede pasar al cálculo por noche sin retirarlas antes (nunca dos cálculos a la vez).
  if coalesce(p_sigue_base, false) and not p.promo_sigue_base
     and exists (select 1 from public.tarifa_hotel f where f.hotel_id = p.hotel_id and btrim(coalesce(f.temporada, '')) = btrim(p.nombre)) then
    raise exception 'La promoción "%" tiene tarifas guardadas con su nombre; retíralas antes de calcularla por noche sobre la base ganadora.', btrim(p.nombre)
      using errcode = '23514';
  end if;
  -- (301) Primera vez que la promoción recibe reglas: todavía no se vendía; si coincide con EBB / Long Stay queda pendiente.
  if not exists (select 1 from public.hotel_promocion_reglas where promocion_id = p_promocion_id) then
    perform set_config('app.e5_promocion_nueva', p_promocion_id::text, true);
  end if;
  delete from public.hotel_promocion_reglas where promocion_id = p_promocion_id;
  update public.hotel_temporadas
     set promo_base_id = p_base_id, promo_sigue_base = coalesce(p_sigue_base, false),
         nino_gratis = coalesce(p_nino_gratis, false),
         nino_gratis_edad_min = case when coalesce(p_nino_gratis, false) then p_nino_edad_min else null end,
         nino_gratis_edad_max = case when coalesce(p_nino_gratis, false) then p_nino_edad_max else null end
   where id = p_promocion_id
     and (promo_base_id is distinct from p_base_id or promo_sigue_base is distinct from coalesce(p_sigue_base, false)
          or nino_gratis is distinct from coalesce(p_nino_gratis, false)
          or nino_gratis_edad_min is distinct from (case when coalesce(p_nino_gratis, false) then p_nino_edad_min else null end)
          or nino_gratis_edad_max is distinct from (case when coalesce(p_nino_gratis, false) then p_nino_edad_max else null end));
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias)
  select p_promocion_id, r.grupo_id, r.valor, r.dias
  from jsonb_to_recordset(p_reglas) as r(grupo_id uuid, valor numeric, dias smallint[]);
  get diagnostics v_n = row_count;
  if coalesce(p_sigue_base, false) then
    v_msg := public._promo_125_validar_sigue_base(p_promocion_id);
    if v_msg is not null then raise exception '%', v_msg using errcode = '23514'; end if;
  end if;
  return jsonb_build_object('base', p_base_id, 'sigue_base', coalesce(p_sigue_base, false), 'nino_gratis', coalesce(p_nino_gratis, false), 'reglas', v_n);
end $$;

revoke all on function public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb, boolean, boolean, smallint, smallint) from public, anon;
grant execute on function public.promocion_guardar_reglas(bigint, bigint, jsonb, jsonb, boolean, boolean, smallint, smallint) to authenticated, service_role;
-- Solo diagnostica (lee vigencias del hotel): la llama la RPC de arriba, que corre con los permisos de quien edita.
revoke all on function public._promo_125_validar_sigue_base(bigint) from public, anon;
grant execute on function public._promo_125_validar_sigue_base(bigint) to authenticated, service_role;

commit;
