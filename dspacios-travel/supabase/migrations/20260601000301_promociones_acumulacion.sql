-- ─────────────────────────────────────────────────────────────────────────────
-- 301 · #43/#60 entrega 5 — Acumulación y precedencia de promociones con EBB / Long Stay (PROVISIONAL; sin aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Especificación §5 (historial Q, R, S.1, Z/P3; diseño de esta entrega en AK). Exige la 300.
--   1) `hotel_promocion_combinacion`: por promoción, si acumula con EBB y con Long Stay (sí/no) y, cuando algún par no
--      acumula, el ORDEN explícito entre las alternativas que coinciden (promoción, EBB, Long Stay). EBB y Long Stay
--      nunca acumulan entre sí. Estados: 'heredada' (coincidencia que ya existía al aplicar la 301: acumula como hoy),
--      'configurada' y 'pendiente' (promoción NUEVA con coincidencias sin responder: no se vende).
--   2) Se pregunta SOLO si pueden coincidir (Q.2): EBB de U días coincide si la última noche aplicable de la promoción
--      queda a ≥ U días de la reserva más temprana posible (hoy o el inicio de su compra); Long Stay de U noches, si
--      U ≤ 30 (estadía máxima, §3.8) y la promoción tiene alguna noche vendible.
--   3) P3: lo autorizado sigue vendiéndose. Editar una promoción que se vende de modo que cree un par sin resolver se
--      rechaza (salvo que el mismo guardado traiga la configuración: `promocion_guardar_combinacion` con los cambios).
--      Una regla EBB / Long Stay nueva, habilitada o modificada que crea pares sin resolver queda RETENIDA
--      (`autorizada = false` o `propuesta`): el motor solo lee la versión autorizada. Se aplica cuando los pares están
--      resueltos (`regla_descuento_aplicar`).
--   4) Contradicción entre dos promociones configuradas que pueden coincidir en una estadía con órdenes o acumulaciones
--      distintos: se rechaza (R.7.5 / S.1).
-- Comprobación al confirmar (trigger de restricción diferido) en promociones, reglas y combinaciones; serializada por hotel.
-- No cambia ningún precio: todo par que coincide al aplicar queda 'heredada' (mismo cálculo de siempre).
-- Orden: preflight_301 → 301 → postcheck_301 → código. Rollback: rollback_301 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.hotel_promocion_reglas') is null or to_regclass('public.hotel_reglas_descuento') is null then
    raise exception '301 ABORTADA: requiere la 278 y la 300 aplicadas';
  end if;
end $$;

-- 1) Reglas: versión autorizada (la que se vende) y propuesta retenida ------------------
alter table public.hotel_reglas_descuento
  add column if not exists autorizada boolean not null default true,
  add column if not exists propuesta jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotel_reglas_descuento_propuesta_301') then
    alter table public.hotel_reglas_descuento add constraint hotel_reglas_descuento_propuesta_301 check (
      propuesta is null or (jsonb_typeof(propuesta) = 'object' and propuesta ?& array['umbral', 'pct', 'activa']
        and (propuesta->>'umbral')::int >= 1 and (propuesta->>'pct')::numeric > 0 and (propuesta->>'pct')::numeric < 100));
  end if;
end $$;
comment on column public.hotel_reglas_descuento.autorizada is
  '#43/#60 (301): false = regla NUEVA retenida (crea combinaciones sin configurar): el motor no la lee hasta aplicarla.';
comment on column public.hotel_reglas_descuento.propuesta is
  '#43/#60 (301): cambio retenido de una regla autorizada {umbral, pct, activa}; se vende la versión actual hasta aplicarlo.';

-- 2) Combinación por promoción ---------------------------------------------------------
create or replace function public._e5_sin_repetidos(a text[]) returns boolean language sql immutable as $$
  select cardinality(a) = (select count(distinct x) from unnest(a) x)
$$;
create table if not exists public.hotel_promocion_combinacion (
  promocion_id         bigint primary key references public.hotel_temporadas(id) on delete cascade,
  estado               text not null check (estado in ('heredada', 'configurada', 'pendiente')),
  alternativas         text[] not null default '{}' check (alternativas <@ array['ebb', 'long_stay']::text[]),
  acumulable_ebb       boolean,
  acumulable_long_stay boolean,
  orden                text[] check (orden is null or (orden <@ array['promocion', 'ebb', 'long_stay']::text[] and public._e5_sin_repetidos(orden))),
  decidido_por         uuid default auth.uid(),
  actualizado_en       timestamptz not null default now()
);
comment on table public.hotel_promocion_combinacion is
  '#43/#60 (301): acumulación y orden de una promoción frente a EBB / Long Stay. Sin fila = no coincide con ninguna regla.';

alter table public.hotel_promocion_combinacion enable row level security;
drop policy if exists "hotel_promocion_combinacion: interno" on public.hotel_promocion_combinacion;
create policy "hotel_promocion_combinacion: interno" on public.hotel_promocion_combinacion
  for select using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));
revoke all on public.hotel_promocion_combinacion from public, anon, authenticated;
grant select on public.hotel_promocion_combinacion to authenticated;  -- escrituras solo por las RPC de abajo
grant all on public.hotel_promocion_combinacion to service_role;
drop trigger if exists trg_auditoria on public.hotel_promocion_combinacion;
create trigger trg_auditoria after insert or update or delete on public.hotel_promocion_combinacion
  for each row execute function public.fn_auditoria();

-- 3) Coincidencias -----------------------------------------------------------------------
create or replace function public._e5_max_noches() returns int language sql immutable as $$ select 30 $$;

-- Noches en que la promoción puede aplicar desde hoy: [primera, última] (NULL = ninguna). Cobertura de la promoción
-- (rangos − blackouts); con reglas por grupo, la noche debe cubrirla su base y tener regla; persona/estadía con días
-- de entrada: solo esos días. Un cruce de más de 1.096 noches no se recorre: se toma completo (lado prudente: puede
-- preguntar de más, nunca de menos).
create or replace function public._e5_rango(p_promo bigint)
returns daterange language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.hotel_temporadas; b public.hotel_temporadas;
  v_hoy date := public.fecha_negocio(); v_bmin date; v_desde date; v_hasta date; v_min date; v_max date;
begin
  select * into p from public.hotel_temporadas where id = p_promo;
  if not found then return null; end if;
  v_bmin := greatest(v_hoy, coalesce(p.compra_inicio, v_hoy));
  if p.compra_fin is not null and p.compra_fin < v_bmin then return null; end if;
  v_desde := greatest(v_bmin, public._promo_300_extremo(p.rangos, p.fecha_inicio, p.fecha_fin, true));
  v_hasta := public._promo_300_extremo(p.rangos, p.fecha_inicio, p.fecha_fin, false);
  if v_desde is null or v_hasta is null or v_desde > v_hasta then return null; end if;
  if v_hasta - v_desde > 1096 then return daterange(v_desde, v_hasta, '[]'); end if;
  if p.promo_base_id is not null then select * into b from public.hotel_temporadas where id = p.promo_base_id; end if;
  select min(d::date), max(d::date) into v_min, v_max
  from generate_series(v_desde, v_hasta, interval '1 day') d
  where public._promo_300_cubre(p.rangos, p.fecha_inicio, p.fecha_fin, p.blackouts, d::date)
    and (p.promo_base_id is null or (public._promo_300_cubre(b.rangos, b.fecha_inicio, b.fecha_fin, b.blackouts, d::date)
                                     and public._promo_300_regla(p.id, p.promo_base_id, d::date)))
    and (p.dias_promo is null or p.descuento_unidad is distinct from 'persona_estadia' or extract(isodow from d)::int = any (p.dias_promo));
  return case when v_min is null then null else daterange(v_min, v_max, '[]') end;
end $$;

-- Familias (ebb / long_stay) de `p_reglas` ([{tipo, umbral}], solo activas) que pueden coincidir con la promoción.
create or replace function public._e5_requeridas(p_promo bigint, p_reglas jsonb)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p public.hotel_temporadas; r daterange; v_bmin date; v_ultima date; v_out text[] := '{}'; x jsonb;
begin
  select * into p from public.hotel_temporadas where id = p_promo;
  if not found or coalesce(p.tipo, 'tarifa') = 'tarifa' then return v_out; end if;
  r := public._e5_rango(p_promo);
  if r is null then return v_out; end if;
  v_bmin := greatest(public.fecha_negocio(), coalesce(p.compra_inicio, public.fecha_negocio()));
  v_ultima := upper(r) - 1;
  for x in select * from jsonb_array_elements(coalesce(p_reglas, '[]'::jsonb)) loop
    if x->>'tipo' = 'ebb' and v_ultima - v_bmin >= (x->>'umbral')::int then v_out := v_out || 'ebb'::text; end if;
    if x->>'tipo' = 'long_stay' and (x->>'umbral')::int <= public._e5_max_noches()
       and coalesce(p.min_noches, 1) <= public._e5_max_noches() then v_out := v_out || 'long_stay'::text; end if;
  end loop;
  return array(select distinct unnest(v_out) order by 1);
end $$;

-- Reglas activas del hotel: solo las AUTORIZADAS (lo que se vende) o, con p_propuestas, la versión propuesta.
create or replace function public._e5_reglas(p_hotel bigint, p_propuestas boolean)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'umbral', r.umbral)), '[]'::jsonb)
  from (select g.tipo,
               case when p_propuestas and g.autorizada and g.propuesta is not null then (g.propuesta->>'umbral')::int else g.umbral end as umbral,
               case when p_propuestas and g.autorizada and g.propuesta is not null then (g.propuesta->>'activa')::boolean else g.activa end as activa,
               g.autorizada
        from public.hotel_reglas_descuento g where g.hotel_id = p_hotel) r
  where r.activa and (r.autorizada or p_propuestas)
$$;

-- ¿Pueden coincidir dos promociones en una misma estadía (≤ 30 noches)? régimen compatible, compras que se cruzan y
-- noches aplicables a menos de 30 noches de distancia.
create or replace function public._e5_coinciden_promos(p_a bigint, p_b bigint)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.hotel_temporadas; b public.hotel_temporadas; ra daterange; rb daterange;
begin
  select * into a from public.hotel_temporadas where id = p_a;
  select * into b from public.hotel_temporadas where id = p_b;
  if a.regimen_restringido is not null and b.regimen_restringido is not null and btrim(a.regimen_restringido) <> btrim(b.regimen_restringido) then return false; end if;
  if greatest(coalesce(a.compra_inicio, '-infinity'::date), coalesce(b.compra_inicio, '-infinity'::date))
     > least(coalesce(a.compra_fin, 'infinity'::date), coalesce(b.compra_fin, 'infinity'::date)) then return false; end if;
  ra := public._e5_rango(p_a); rb := public._e5_rango(p_b);
  if ra is null or rb is null then return false; end if;
  return lower(ra) <= (upper(rb) - 1) + (public._e5_max_noches() - 1) and lower(rb) <= (upper(ra) - 1) + (public._e5_max_noches() - 1);
end $$;

create or replace function public._e5_texto_familias(f text[]) returns text language sql immutable as $$
  select string_agg(case x when 'ebb' then 'compra anticipada (EBB)' else 'larga estadía (Long Stay)' end, ' y ' order by x) from unnest(f) x
$$;

-- ¿Deciden igual dos combinaciones donde las dos tienen respuesta? Solo cuentan las reglas que ambas contemplan: misma
-- acumulación en cada una y, si alguna no acumula (o son las dos: EBB y Long Stay nunca acumulan entre sí), el mismo orden
-- relativo de la promoción y esas reglas. Una regla que una de ellas aún no contempla no es contradicción (falta configurarla).
create or replace function public._e5_misma_config(a public.hotel_promocion_combinacion, b public.hotel_promocion_combinacion)
returns boolean language plpgsql immutable as $$
declare v_com text[] := array(select x from unnest(a.alternativas) x where x = any (b.alternativas) order by x); v_orden boolean := false; f text;
begin
  foreach f in array v_com loop
    if (case f when 'ebb' then a.acumulable_ebb else a.acumulable_long_stay end) is distinct from
       (case f when 'ebb' then b.acumulable_ebb else b.acumulable_long_stay end) then return false; end if;
    if (case f when 'ebb' then a.acumulable_ebb else a.acumulable_long_stay end) is not true then v_orden := true; end if;
  end loop;
  if cardinality(v_com) = 2 then v_orden := true; end if;
  if not v_orden then return true; end if;
  return array(select x from unnest(a.orden) with ordinality o(x, i) where x = 'promocion' or x = any (v_com) order by i)
       = array(select x from unnest(b.orden) with ordinality o(x, i) where x = 'promocion' or x = any (v_com) order by i);
end $$;

-- Textos del aviso de contradicción (solo presentación; la regla es `_e5_misma_config`). Misma redacción que
-- `textoDiferenciaPromociones` en lib/calc/precedenciaPromociones.ts.
create or replace function public._e5_texto_alt(x text) returns text language sql immutable as $$
  select case x when 'promocion' then 'promoción' when 'ebb' then 'compra anticipada (EBB)' else 'larga estadía (Long Stay)' end
$$;
-- Qué decisión difiere entre dos combinaciones que `_e5_misma_config` declaró distintas: la acumulación con una regla o el orden.
create or replace function public._e5_texto_diferencia(a public.hotel_promocion_combinacion, b public.hotel_promocion_combinacion, na text, nb text)
returns text language plpgsql immutable as $$
declare v_com text[] := array(select x from unnest(a.alternativas) x where x = any (b.alternativas) order by x); f text; va boolean; vb boolean;
begin
  foreach f in array v_com loop
    va := case f when 'ebb' then a.acumulable_ebb else a.acumulable_long_stay end;
    vb := case f when 'ebb' then b.acumulable_ebb else b.acumulable_long_stay end;
    if va is distinct from vb then
      return format('«%s» %s con %s y «%s» %s', na, case when va then 'acumula' else 'no acumula' end, public._e5_texto_alt(f), nb, case when vb then 'sí' else 'no' end);
    end if;
  end loop;
  return format('el orden de aplicación: «%s» %s; «%s» %s', na,
    (select string_agg(public._e5_texto_alt(x), ' → ' order by i) from unnest(a.orden) with ordinality o(x, i) where x = 'promocion' or x = any (v_com)), nb,
    (select string_agg(public._e5_texto_alt(x), ' → ' order by i) from unnest(b.orden) with ordinality o(x, i) where x = 'promocion' or x = any (v_com)));
end $$;
-- Una estadía de ejemplo que incluye noches de las dos (con las mismas fechas posibles que usa `_e5_coinciden_promos`):
-- una noche en la intersección o, si no se tocan, de la última noche de la primera a la primera noche de la segunda.
create or replace function public._e5_ejemplo_estadia(p_a bigint, p_b bigint)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ra daterange := public._e5_rango(p_a); rb daterange := public._e5_rango(p_b); r1 daterange; r2 daterange; v_ent date; v_sal date;
begin
  if ra is null or rb is null then return null; end if;
  if lower(ra) <= lower(rb) then r1 := ra; r2 := rb; else r1 := rb; r2 := ra; end if;
  if lower(r2) <= upper(r1) - 1 then v_ent := lower(r2); v_sal := v_ent + 1;
  else v_ent := upper(r1) - 1; v_sal := lower(r2) + 1; end if;
  return format('una estadía del %s al %s (%s noche%s) incluye noches de las dos', to_char(v_ent, 'DD/MM/YYYY'), to_char(v_sal, 'DD/MM/YYYY'),
    v_sal - v_ent, case when v_sal - v_ent = 1 then '' else 's' end);
end $$;

-- Revisión de UN hotel (la corre el trigger diferido): promociones con coincidencias sin resolver y contradicciones.
create or replace function public._e5_revisar(p_hotel bigint, p_promo_nueva bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reglas jsonb := public._e5_reglas(p_hotel, false);
  p record; c public.hotel_promocion_combinacion; v_req text[]; x record;
begin
  for p in select t.id, btrim(t.nombre) as nombre from public.hotel_temporadas t
           where t.hotel_id = p_hotel and coalesce(t.tipo, 'tarifa') <> 'tarifa' order by t.id loop
    v_req := public._e5_requeridas(p.id, v_reglas);
    select * into c from public.hotel_promocion_combinacion where promocion_id = p.id;
    if cardinality(v_req) = 0 then
      if c.estado = 'pendiente' then delete from public.hotel_promocion_combinacion where promocion_id = p.id; end if;
      continue;
    end if;
    if c.estado in ('heredada', 'configurada') and v_req <@ c.alternativas then continue; end if;
    if c.estado = 'pendiente' then
      update public.hotel_promocion_combinacion set alternativas = v_req, actualizado_en = now() where promocion_id = p.id;
      continue;
    end if;
    if p.id = p_promo_nueva then
      insert into public.hotel_promocion_combinacion (promocion_id, estado, alternativas) values (p.id, 'pendiente', v_req)
      on conflict (promocion_id) do update set estado = 'pendiente', alternativas = excluded.alternativas, actualizado_en = now();
      continue;
    end if;
    raise exception 'COMBINACION_SIN_CONFIGURAR: «%» puede coincidir con %, sin acumulación ni orden configurados. La versión que hoy se vende no cambia: configura la combinación junto con el cambio.',
      p.nombre, public._e5_texto_familias(array(select unnest(v_req) except select unnest(coalesce(c.alternativas, '{}')))) using errcode = '23514';
  end loop;
  -- Contradicciones: dos promociones configuradas que pueden coincidir no pueden tener acumulación u orden distintos.
  for x in select a.promocion_id as ia, b.promocion_id as ib, ta.nombre as na, tb.nombre as nb,
                  public._e5_texto_diferencia(a, b, btrim(ta.nombre), btrim(tb.nombre)) as dif
           from public.hotel_promocion_combinacion a
           join public.hotel_promocion_combinacion b on b.promocion_id > a.promocion_id and b.estado = 'configurada'
           join public.hotel_temporadas ta on ta.id = a.promocion_id and ta.hotel_id = p_hotel
           join public.hotel_temporadas tb on tb.id = b.promocion_id and tb.hotel_id = p_hotel
           where a.estado = 'configurada'
             and not public._e5_misma_config(a, b) loop
    if public._e5_coinciden_promos(x.ia, x.ib) then
      raise exception 'CONTRADICCION_PROMOCIONES: «%» y «%» pueden aplicar en una misma estadía y deciden distinto frente a EBB / Long Stay: %. Ejemplo: %. Dales la misma configuración o separa sus fechas, compra o régimen para que no coincidan.',
        btrim(x.na), btrim(x.nb), x.dif, coalesce(public._e5_ejemplo_estadia(x.ia, x.ib), 'una estadía que cruce las fechas de las dos') using errcode = '23514';
    end if;
  end loop;
end $$;

create or replace function public.tg_e5_revisar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel bigint; v_nueva bigint;
begin
  -- La fila «pendiente» la mantiene la propia revisión: volver a revisar por ella sería una recursión sin fin.
  if tg_table_name = 'hotel_promocion_combinacion' then
    if to_jsonb(new)->>'estado' = 'pendiente' then return null; end if;
  end if;
  if tg_table_name = 'hotel_temporadas' then
    v_hotel := new.hotel_id;
    if tg_op = 'INSERT' then v_nueva := new.id; end if;
  elsif tg_table_name = 'hotel_reglas_descuento' then
    v_hotel := new.hotel_id;
  elsif tg_table_name = 'hotel_promocion_reglas' then
    select t.hotel_id into v_hotel from public.hotel_temporadas t where t.id = new.promocion_id;
    -- Reglas por grupo guardadas por primera vez (la promoción todavía no se vendía): puede quedar pendiente.
    v_nueva := nullif(current_setting('app.e5_promocion_nueva', true), '')::bigint;
  else
    select t.hotel_id into v_hotel from public.hotel_temporadas t where t.id = new.promocion_id;
  end if;
  if v_hotel is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('e5_hotel:' || v_hotel::text, 0));
  perform public._e5_revisar(v_hotel, v_nueva);
  return null;
end $$;

drop trigger if exists trg_e5_revisar on public.hotel_temporadas;
create constraint trigger trg_e5_revisar after insert or update on public.hotel_temporadas
  deferrable initially deferred for each row execute function public.tg_e5_revisar();
drop trigger if exists trg_e5_revisar on public.hotel_reglas_descuento;
create constraint trigger trg_e5_revisar after insert or update on public.hotel_reglas_descuento
  deferrable initially deferred for each row execute function public.tg_e5_revisar();
drop trigger if exists trg_e5_revisar on public.hotel_promocion_reglas;
create constraint trigger trg_e5_revisar after insert or update on public.hotel_promocion_reglas
  deferrable initially deferred for each row execute function public.tg_e5_revisar();
drop trigger if exists trg_e5_revisar on public.hotel_promocion_combinacion;
create constraint trigger trg_e5_revisar after insert or update on public.hotel_promocion_combinacion
  deferrable initially deferred for each row execute function public.tg_e5_revisar();

-- 4) RPC ----------------------------------------------------------------------------------
create or replace function public._e5_autorizar()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.mi_rol() is null or not (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]))
     or not coalesce(public.puede_escribir_catalogo_global(), false) then
    raise exception 'No tienes permiso para configurar promociones de este hotel.' using errcode = '42501';
  end if;
end $$;

-- Aplica a una promoción un cambio de sus columnas editables (p_cambios: objeto con columnas de hotel_temporadas) y devuelve la fila nueva.
create or replace function public._e5_aplicar_cambios(p_id bigint, p_cambios jsonb)
returns public.hotel_temporadas language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.hotel_temporadas;
begin
  if jsonb_typeof(p_cambios) is distinct from 'object' or p_cambios ?| array['id', 'hotel_id', 'promo_base_id'] then
    raise exception 'Cambios no válidos.' using errcode = '22023';
  end if;
  select * into t from public.hotel_temporadas where id = p_id;
  t := jsonb_populate_record(t, p_cambios);
  update public.hotel_temporadas set nombre = t.nombre, fecha_inicio = t.fecha_inicio, fecha_fin = t.fecha_fin, prioridad = t.prioridad,
    compra_inicio = t.compra_inicio, compra_fin = t.compra_fin, tipo = t.tipo, descuento_valor = t.descuento_valor, min_noches = t.min_noches,
    regimen_restringido = t.regimen_restringido, rangos = t.rangos, blackouts = t.blackouts, condicion_pago_tipo = t.condicion_pago_tipo,
    condicion_pago_pct_inicial = t.condicion_pago_pct_inicial, condicion_pago_dias_saldo = t.condicion_pago_dias_saldo,
    descuento_unidad = t.descuento_unidad, noche_gratis_regla = t.noche_gratis_regla, dias_promo = t.dias_promo
  where id = p_id returning * into t;
  return t;
end $$;

-- Guarda la combinación de una promoción y, opcionalmente, un cambio de la propia promoción (p_cambios: columnas de
-- hotel_temporadas) en UNA transacción. p_combinacion: {"acumulable": {"ebb": bool, "long_stay": bool}, "orden": [...]}.
-- Solo se responden las familias que pueden coincidir (incluidas reglas retenidas, para poder destrabarlas).
create or replace function public.promocion_guardar_combinacion(p_promocion_id bigint, p_combinacion jsonb, p_cambios jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.hotel_temporadas; v_req text[]; v_alts text[]; v_noacum boolean; v_orden text[]; a_ebb boolean; a_ls boolean;
begin
  perform public._e5_autorizar();
  select * into t from public.hotel_temporadas where id = p_promocion_id for update;
  if not found or coalesce(t.tipo, 'tarifa') = 'tarifa' then raise exception 'La promoción no existe.' using errcode = 'P0002'; end if;
  if p_cambios is not null then t := public._e5_aplicar_cambios(p_promocion_id, p_cambios); end if;
  v_req := public._e5_requeridas(p_promocion_id, public._e5_reglas(t.hotel_id, true));
  if cardinality(v_req) = 0 then
    if p_cambios is not null then return jsonb_build_object('estado', 'sin_coincidencias'); end if;
    raise exception 'Esta promoción no puede coincidir con ninguna regla de compra anticipada o larga estadía: no hay nada que configurar.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_combinacion->'acumulable', 'null')) <> 'object' then raise exception 'Responde si acumula con cada regla.' using errcode = '22023'; end if;
  a_ebb := case when 'ebb' = any (v_req) then (p_combinacion->'acumulable'->>'ebb')::boolean end;
  a_ls := case when 'long_stay' = any (v_req) then (p_combinacion->'acumulable'->>'long_stay')::boolean end;
  if ('ebb' = any (v_req) and a_ebb is null) or ('long_stay' = any (v_req) and a_ls is null) then
    raise exception 'Responde, según el proveedor, si la promoción acumula con %.', public._e5_texto_familias(v_req) using errcode = '22023';
  end if;
  v_alts := array['promocion'] || v_req;
  v_noacum := a_ebb is false or a_ls is false or cardinality(v_req) = 2;  -- EBB y Long Stay nunca acumulan entre sí
  if v_noacum then
    -- Solo cuentan las alternativas que de verdad coinciden (el formulario puede responder por todas las reglas del hotel); se conserva su orden.
    v_orden := array(select x from jsonb_array_elements_text(coalesce(p_combinacion->'orden', '[]'::jsonb)) with ordinality o(x, i) where x = any (v_alts) order by i);
    if cardinality(v_orden) <> cardinality(v_alts) or not (v_orden <@ v_alts and v_alts <@ v_orden)
       or cardinality(v_orden) <> (select count(distinct x) from unnest(v_orden) x) then
      raise exception 'Ordena, según el proveedor, todas las alternativas que coinciden (%), sin repetir ni agregar otras.',
        array_to_string(v_alts, ', ') using errcode = '22023';
    end if;
  end if;
  insert into public.hotel_promocion_combinacion (promocion_id, estado, alternativas, acumulable_ebb, acumulable_long_stay, orden, decidido_por, actualizado_en)
  values (p_promocion_id, 'configurada', v_req, a_ebb, a_ls, v_orden, auth.uid(), now())
  on conflict (promocion_id) do update set estado = 'configurada', alternativas = excluded.alternativas, acumulable_ebb = excluded.acumulable_ebb,
    acumulable_long_stay = excluded.acumulable_long_stay, orden = excluded.orden, decidido_por = excluded.decidido_por, actualizado_en = now();
  return jsonb_build_object('estado', 'configurada', 'alternativas', v_req, 'orden', v_orden);
end $$;

-- Promociones que quedarían con pares sin resolver si las reglas fueran `p_reglas` (no cuentan las pendientes: no se venden).
create or replace function public._e5_sin_resolver(p_hotel bigint, p_reglas jsonb)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('promocion', btrim(t.nombre), 'faltan', q.faltan) order by t.id), '[]'::jsonb)
  from public.hotel_temporadas t
  left join public.hotel_promocion_combinacion c on c.promocion_id = t.id
  cross join lateral (select array(select unnest(public._e5_requeridas(t.id, p_reglas))
                                   except select unnest(case when c.estado in ('heredada', 'configurada') then c.alternativas else '{}'::text[] end)) as faltan) q
  where t.hotel_id = p_hotel and coalesce(t.tipo, 'tarifa') <> 'tarifa' and coalesce(c.estado, '') <> 'pendiente' and cardinality(q.faltan) > 0
$$;

-- Guarda una regla EBB / Long Stay: si no crea pares sin resolver, se aplica; si los crea, queda RETENIDA y se devuelve
-- qué promociones falta configurar. La versión autorizada sigue vendiéndose.
create or replace function public.regla_descuento_guardar(p_hotel bigint, p_id bigint, p_tipo text, p_umbral int, p_pct numeric, p_activa boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.hotel_reglas_descuento; v_sim jsonb; v_pend jsonb; v_id bigint;
begin
  perform public._e5_autorizar();
  if p_tipo not in ('ebb', 'long_stay') or p_umbral is null or p_umbral < 1 or p_pct is null or p_pct <= 0 or p_pct >= 100 then
    raise exception 'Datos de la promoción no válidos.' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into g from public.hotel_reglas_descuento where id = p_id and hotel_id = p_hotel for update;
    if not found then raise exception 'La promoción ya no existe.' using errcode = 'P0002'; end if;
    if g.tipo <> p_tipo then raise exception 'No se cambia el tipo de una regla: crea otra.' using errcode = '22023'; end if;
  end if;
  -- Reglas que quedarían autorizadas con este cambio.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_sim from (
    select jsonb_build_object('tipo', r.tipo, 'umbral', r.umbral) as x from public.hotel_reglas_descuento r
    where r.hotel_id = p_hotel and r.autorizada and r.activa and r.id is distinct from p_id
    union all select jsonb_build_object('tipo', p_tipo, 'umbral', p_umbral) where p_activa) s;
  v_pend := public._e5_sin_resolver(p_hotel, v_sim);
  if jsonb_array_length(v_pend) = 0 then
    if p_id is null then
      insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (p_hotel, p_tipo, p_umbral, p_pct, p_activa) returning id into v_id;
    else
      update public.hotel_reglas_descuento set umbral = p_umbral, pct = p_pct, activa = p_activa, autorizada = true, propuesta = null where id = p_id;
      v_id := p_id;
    end if;
    return jsonb_build_object('estado', 'aplicada', 'id', v_id);
  end if;
  if p_id is null then
    insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa, autorizada) values (p_hotel, p_tipo, p_umbral, p_pct, p_activa, false) returning id into v_id;
  elsif not g.autorizada then
    update public.hotel_reglas_descuento set umbral = p_umbral, pct = p_pct, activa = p_activa where id = p_id; v_id := p_id;
  else
    update public.hotel_reglas_descuento set propuesta = jsonb_build_object('umbral', p_umbral, 'pct', p_pct, 'activa', p_activa) where id = p_id; v_id := p_id;
  end if;
  return jsonb_build_object('estado', 'retenida', 'id', v_id, 'pendientes', v_pend);
end $$;

-- Aplica una regla retenida (nueva o cambio) si ya no deja pares sin resolver.
create or replace function public.regla_descuento_aplicar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.hotel_reglas_descuento; v_umbral int; v_pct numeric; v_activa boolean; r jsonb;
begin
  perform public._e5_autorizar();
  select * into g from public.hotel_reglas_descuento where id = p_id for update;
  if not found then raise exception 'La promoción ya no existe.' using errcode = 'P0002'; end if;
  if g.autorizada and g.propuesta is null then return jsonb_build_object('estado', 'aplicada', 'id', p_id); end if;
  v_umbral := coalesce((g.propuesta->>'umbral')::int, g.umbral); v_pct := coalesce((g.propuesta->>'pct')::numeric, g.pct);
  v_activa := coalesce((g.propuesta->>'activa')::boolean, g.activa);
  r := public.regla_descuento_guardar(g.hotel_id, p_id, g.tipo, v_umbral, v_pct, v_activa);
  if r->>'estado' <> 'aplicada' then
    raise exception 'COMBINACION_SIN_CONFIGURAR: aún faltan configurar: %.',
      (select string_agg(format('«%s» con %s', x->>'promocion', public._e5_texto_familias(array(select jsonb_array_elements_text(x->'faltan')))), '; ')
       from jsonb_array_elements(r->'pendientes') x) using errcode = '23514';
  end if;
  return r;
end $$;

create or replace function public.regla_descuento_descartar(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.hotel_reglas_descuento;
begin
  perform public._e5_autorizar();
  select * into g from public.hotel_reglas_descuento where id = p_id for update;
  if not found then return; end if;
  if not g.autorizada then delete from public.hotel_reglas_descuento where id = p_id;
  else update public.hotel_reglas_descuento set propuesta = null where id = p_id; end if;
end $$;

-- 4b) P3: cambio PENDIENTE de una promoción que ya se vende -----------------------------------------------------
-- Un cambio que crearía coincidencias sin configurar se guarda aquí (una fila por promoción, la última propuesta) y NO
-- toca la vigencia: se sigue vendiendo la versión autorizada. `base` = la vigencia al proponer; activar exige que siga
-- igual (si otra sesión la cambió, se rechaza). Al activar se valida todo dentro de la misma transacción.
create table if not exists public.hotel_promocion_cambio_pendiente (
  promocion_id  bigint primary key references public.hotel_temporadas(id) on delete cascade,
  cambios       jsonb not null check (jsonb_typeof(cambios) = 'object'),
  base          jsonb not null,
  faltan        text[] not null default '{}' check (faltan <@ array['ebb', 'long_stay']::text[]),
  propuesto_por uuid default auth.uid(),
  propuesto_en  timestamptz not null default now()
);
comment on table public.hotel_promocion_cambio_pendiente is
  '#43/#60 (301, P3): cambio de una promoción que se vende, retenido hasta configurar su combinación. No lo lee el motor.';
alter table public.hotel_promocion_cambio_pendiente enable row level security;
drop policy if exists "hotel_promocion_cambio_pendiente: interno" on public.hotel_promocion_cambio_pendiente;
create policy "hotel_promocion_cambio_pendiente: interno" on public.hotel_promocion_cambio_pendiente
  for select using (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[]));
revoke all on public.hotel_promocion_cambio_pendiente from public, anon, authenticated;
grant select on public.hotel_promocion_cambio_pendiente to authenticated;  -- escrituras solo por las RPC de abajo
grant all on public.hotel_promocion_cambio_pendiente to service_role;
drop trigger if exists trg_auditoria on public.hotel_promocion_cambio_pendiente;
create trigger trg_auditoria after insert or update or delete on public.hotel_promocion_cambio_pendiente
  for each row execute function public.fn_auditoria();

-- Guarda el cambio como pendiente. Si con él no falta configurar nada, se aplica directamente (nada que retener).
create or replace function public.promocion_cambio_proponer(p_promocion_id bigint, p_cambios jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.hotel_temporadas; c public.hotel_promocion_combinacion; v_req text[]; v_faltan text[];
begin
  perform public._e5_autorizar();
  select * into t from public.hotel_temporadas where id = p_promocion_id for update;
  if not found or coalesce(t.tipo, 'tarifa') = 'tarifa' then raise exception 'La promoción no existe.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('e5_hotel:' || t.hotel_id::text, 0));
  -- Qué coincidiría CON el cambio: se aplica dentro de un subbloque y se deshace (la vigencia queda como estaba).
  begin
    perform public._e5_aplicar_cambios(p_promocion_id, p_cambios);
    v_req := public._e5_requeridas(p_promocion_id, public._e5_reglas(t.hotel_id, false));
    raise exception 'E5_SIMULACION' using errcode = 'P0001';
  exception when raise_exception then
    if sqlerrm <> 'E5_SIMULACION' then raise; end if;
  end;
  select * into c from public.hotel_promocion_combinacion where promocion_id = p_promocion_id;
  v_faltan := array(select unnest(v_req) except select unnest(case when c.estado in ('heredada', 'configurada') then c.alternativas else '{}'::text[] end) order by 1);
  if cardinality(v_faltan) = 0 or c.estado = 'pendiente' then
    perform public._e5_aplicar_cambios(p_promocion_id, p_cambios);  -- el disparador diferido sigue validando al confirmar
    delete from public.hotel_promocion_cambio_pendiente where promocion_id = p_promocion_id;
    return jsonb_build_object('estado', 'aplicada');
  end if;
  insert into public.hotel_promocion_cambio_pendiente (promocion_id, cambios, base, faltan, propuesto_por, propuesto_en)
  values (p_promocion_id, p_cambios, to_jsonb(t), v_faltan, auth.uid(), now())
  on conflict (promocion_id) do update set cambios = excluded.cambios, base = excluded.base, faltan = excluded.faltan,
    propuesto_por = excluded.propuesto_por, propuesto_en = now();
  return jsonb_build_object('estado', 'pendiente', 'faltan', v_faltan);
end $$;

-- Activa el cambio pendiente (con la combinación si hace falta). Todo en una transacción: rechaza si otra sesión ya lo
-- activó o descartó, si la vigencia cambió desde que se propuso, o si quedan pares sin resolver / contradicciones.
create or replace function public.promocion_cambio_activar(p_promocion_id bigint, p_combinacion jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.hotel_temporadas; pc public.hotel_promocion_cambio_pendiente; r jsonb;
begin
  perform public._e5_autorizar();
  select * into t from public.hotel_temporadas where id = p_promocion_id for update;
  if not found then raise exception 'La promoción ya no existe.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('e5_hotel:' || t.hotel_id::text, 0));
  select * into pc from public.hotel_promocion_cambio_pendiente where promocion_id = p_promocion_id for update;
  if not found then
    raise exception 'CAMBIO_NO_PENDIENTE: este cambio ya no está pendiente (se activó o se descartó en otra sesión). Recarga la ficha.' using errcode = 'P0002';
  end if;
  if to_jsonb(t) is distinct from pc.base then
    raise exception 'CAMBIO_CONCURRENTE: «%» cambió después de dejar este cambio pendiente. Descártalo y vuelve a hacerlo sobre la versión actual.',
      btrim(t.nombre) using errcode = '40001';
  end if;
  delete from public.hotel_promocion_cambio_pendiente where promocion_id = p_promocion_id;
  if p_combinacion is not null then
    r := public.promocion_guardar_combinacion(p_promocion_id, p_combinacion, pc.cambios);
  else
    perform public._e5_aplicar_cambios(p_promocion_id, pc.cambios);
    r := jsonb_build_object('estado', 'aplicada');
  end if;
  set constraints all immediate;  -- la revisión del hotel corre AQUÍ: si falta algo, nada de lo anterior queda
  return r;
end $$;

create or replace function public.promocion_cambio_descartar(p_promocion_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._e5_autorizar();
  delete from public.hotel_promocion_cambio_pendiente where promocion_id = p_promocion_id;
end $$;

-- Lo que la ficha muestra: por promoción, qué familias coinciden (con reglas autorizadas y con las retenidas) y su estado.
create or replace function public.promociones_combinacion_estado(p_hotel bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.mi_rol() is null or not (public.mi_rol() = any (array['superadmin','gerencia','administracion','operaciones']::public.rol_usuario[])) then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('promocion_id', t.id, 'nombre', btrim(t.nombre),
      'requeridas', public._e5_requeridas(t.id, public._e5_reglas(p_hotel, false)),
      'requeridas_con_retenidas', public._e5_requeridas(t.id, public._e5_reglas(p_hotel, true)),
      'combinacion', (select to_jsonb(c) - 'decidido_por' from public.hotel_promocion_combinacion c where c.promocion_id = t.id),
      'cambio_pendiente', (select jsonb_build_object('cambios', pc.cambios, 'faltan', pc.faltan, 'propuesto_en', pc.propuesto_en,
        'desactualizado', to_jsonb(t) is distinct from pc.base) from public.hotel_promocion_cambio_pendiente pc where pc.promocion_id = t.id)) order by t.id)
    from public.hotel_temporadas t where t.hotel_id = p_hotel and coalesce(t.tipo, 'tarifa') <> 'tarifa'), '[]'::jsonb);
end $$;

revoke all on function public._e5_rango(bigint), public._e5_requeridas(bigint, jsonb), public._e5_reglas(bigint, boolean),
  public._e5_coinciden_promos(bigint, bigint), public._e5_revisar(bigint, bigint), public.tg_e5_revisar(), public._e5_autorizar(),
  public._e5_sin_resolver(bigint, jsonb), public._e5_aplicar_cambios(bigint, jsonb), public._e5_ejemplo_estadia(bigint, bigint) from public, anon, authenticated;
revoke all on function public.promocion_guardar_combinacion(bigint, jsonb, jsonb), public.regla_descuento_guardar(bigint, bigint, text, int, numeric, boolean),
  public.regla_descuento_aplicar(bigint), public.regla_descuento_descartar(bigint), public.promociones_combinacion_estado(bigint), public.promocion_cambio_proponer(bigint, jsonb), public.promocion_cambio_activar(bigint, jsonb), public.promocion_cambio_descartar(bigint) from public, anon;
grant execute on function public.promocion_guardar_combinacion(bigint, jsonb, jsonb), public.regla_descuento_guardar(bigint, bigint, text, int, numeric, boolean),
  public.regla_descuento_aplicar(bigint), public.regla_descuento_descartar(bigint), public.promociones_combinacion_estado(bigint), public.promocion_cambio_proponer(bigint, jsonb), public.promocion_cambio_activar(bigint, jsonb), public.promocion_cambio_descartar(bigint) to authenticated, service_role;

-- 5) Línea base: lo que coincide HOY queda 'heredada' (acumula exactamente como hasta ahora) -------------------
insert into public.hotel_promocion_combinacion (promocion_id, estado, alternativas, decidido_por)
select t.id, 'heredada', q.req, null
from public.hotel_temporadas t
cross join lateral (select public._e5_requeridas(t.id, public._e5_reglas(t.hotel_id, false)) as req) q
where coalesce(t.tipo, 'tarifa') <> 'tarifa' and cardinality(q.req) > 0
on conflict (promocion_id) do nothing;

commit;
