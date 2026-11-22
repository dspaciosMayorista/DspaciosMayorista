-- ─────────────────────────────────────────────────────────────────────────────
-- 315 · #127 — Un cierre GENERAL del hotel (`hotel_blackouts`) oculta de inmediato lo ya publicado que cierra (aditiva, sin tocar migraciones anteriores).
--
-- Hueco que cierra: la 181/260 invalidan el tarifario publicado cuando cambian las tarifas o las vigencias (`tarifa_hotel`, `hotel_temporadas`), pero NO el cierre general de ventas del
-- hotel (`hotel_blackouts`, 064/145). Guardar un cierre solo refrescaba la pantalla del hotel: las filas de estadías cerradas seguían publicadas y comprables hasta que alguien regenerara a mano
-- (caso real: hotel 62 / paquete 36, estadía 30-dic-2026 → 02-ene-2027 ofrecida con un cierre total 29-dic → 09-ene).
--
-- Qué hace (no cambia precios, reglas comerciales ni migraciones anteriores):
--   · INSERT/UPDATE de un cierre → sube la revisión de fuente de los paquetes que usan el hotel (la publicación por lotes en curso queda descartada) y OCULTA, por fila
--     (`tarifario_fila_oculta`, el mismo mecanismo de la 260), solo las filas publicadas cuya estadía toca una noche cerrada para su categoría/acomodación:
--       · bloqueo / dinámico (estadía fija): alguna noche ocupada de [fecha_ida, fecha_ida + noches − 1] dentro del cierre. Extremos del cierre INCLUSIVOS; el día de salida no es noche ocupada.
--       · porción terrestre: la fila con testigo (`desde_entrada`: la estadía que justifica su precio) como una estadía fija; la de ventana «desde» SIN testigo, cuando un cierre aplicable toca cualquier
--         estadía de la ventana (que quede una fecha libre no prueba que ESE precio exista): oculta hasta una regeneración verificada, que la publica con su testigo.
--   · DELETE (reabrir) → solo sube la revisión (el paquete queda «pendiente» de regenerar). Lo que ya se ocultó sigue oculto hasta la regeneración: falla cerrado, no vende de más.
--   El criterio es el MISMO que aplica la aplicación (lib/tarifario/cierresHotel.ts): total = todo; si no, categorías/acomodaciones vacías = todas.
-- Aditiva e idempotente. Requiere la 181 (tarifario_invalidar) y la 260 (tarifario_fila_oculta). Rollback: supabase/scripts/rollback_315_tarifario_oculta_por_cierre_general.sql.
-- Preflight: supabase/scripts/preflight_315_cierre_general.sql · Postcheck: supabase/scripts/postcheck_315_cierre_general.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.hotel_blackouts') is null or to_regclass('public.tarifario_fila_oculta') is null or to_regclass('public.tarifario_resultado') is null then
    raise exception '315 ABORTADA: faltan hotel_blackouts / tarifario_fila_oculta / tarifario_resultado (migraciones 064 y 260).';
  end if;
  if to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is null then
    raise exception '315 ABORTADA: falta tarifario_invalidar(bigint[], boolean) (migración 181/260).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hotel_blackouts' and column_name = 'categorias') then
    raise exception '315 ABORTADA: falta hotel_blackouts.categorias (migración 145).';
  end if;
end $$;

-- ¿Alguna entrada `p_entrada` con `p_noches` noches toca un cierre general que aplique a esa categoría y acomodación?
create or replace function public.tarifario_estadia_cerrada_general(p_hotel bigint, p_categoria text, p_acomodacion text, p_entrada date, p_noches integer)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.hotel_blackouts b
     where b.hotel_id = p_hotel
       and b.fecha_inicio <= p_entrada + (greatest(coalesce(p_noches, 1), 1) - 1)
       and b.fecha_fin >= p_entrada
       and (b.total
            or ((coalesce(cardinality(b.categorias), 0) = 0 or p_categoria = any (b.categorias))
                and (coalesce(cardinality(b.acomodaciones), 0) = 0 or p_acomodacion = any (b.acomodaciones))))
  )
$$;

-- Fila publicada → ¿el cierre general la deja sin estadía vendible? (misma regla que lib/tarifario/vigencia.ts → filaCerradaPorCierre)
create or replace function public.tarifario_fila_cerrada_general(p_hotel bigint, p_categoria text, p_acomodacion text, p_modulo text, p_ida date, p_regreso date, p_noches integer, p_desde_entrada date)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_hotel is null or p_ida is null then return false; end if;
  if p_modulo = 'porcion_terrestre' then
    if p_desde_entrada is not null then
      return public.tarifario_estadia_cerrada_general(p_hotel, p_categoria, p_acomodacion, p_desde_entrada, coalesce(p_noches, 1));
    end if;
    -- Ventana «desde» SIN testigo (publicada antes del cierre): el precio es el de una estadía concreta y no se puede probar que siga existiendo aunque quede alguna fecha libre.
    -- Se oculta si un cierre aplicable toca CUALQUIER noche de las estadías de la ventana ([ida, regreso + noches − 1]) hasta una regeneración verificada, que publica la fila con su testigo.
    return public.tarifario_estadia_cerrada_general(p_hotel, p_categoria, p_acomodacion, p_ida, (coalesce(p_regreso, p_ida) - p_ida) + greatest(coalesce(p_noches, 1), 1));
  end if;
  if p_modulo in ('bloqueo', 'dinamico') then
    if coalesce(p_noches, 0) <= 0 then return false; end if;
    return public.tarifario_estadia_cerrada_general(p_hotel, p_categoria, p_acomodacion, p_ida, p_noches);
  end if;
  return false;
end $$;

-- Punto común: sube la revisión de los paquetes del hotel (un candado por paquete, en orden de id, como la 266) y, si se cerró algo, oculta las filas que ya no se pueden vender.
create or replace function public.tarifario_cierre_general_aplicar(p_hoteles bigint[], p_ocultar boolean)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids bigint[]; v_n integer := 0;
begin
  if p_hoteles is null or array_length(p_hoteles, 1) is null then return 0; end if;
  select array_agg(distinct paquete_id order by paquete_id) into v_ids from public.armado_hoteles where hotel_id = any (p_hoteles);
  if v_ids is null then return 0; end if;
  perform 1 from public.armado_paquetes where id = any (v_ids) order by id for update;
  perform public.tarifario_invalidar(v_ids, false);
  if p_ocultar then
    insert into public.tarifario_fila_oculta (fila_id, paquete_id, revision, motivo)
    select r.id, r.paquete_id, ap.tarifario_revision_fuente, 'cierre general del hotel'
      from public.tarifario_resultado r
      join public.armado_paquetes ap on ap.id = r.paquete_id
     where r.hotel_id = any (p_hoteles)
       and r.paquete_id = any (v_ids)
       and (r.generacion is null or r.generacion in (ap.tarifario_generacion_publicada, ap.tarifario_generacion))
       and not exists (select 1 from public.tarifario_fila_oculta o where o.fila_id = r.id)
       and public.tarifario_fila_cerrada_general(r.hotel_id, r.categoria, r.acomodacion::text, r.modulo::text, r.fecha_ida, r.fecha_regreso, r.noches, r.desde_entrada)
    on conflict (fila_id) do nothing;
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end $$;

-- Disparadores por SENTENCIA con tablas de transición (una carga de varios cierres evalúa una vez, no una por fila).
create or replace function public.tarifario_trg_cierre_ins() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cierre_general_aplicar((select array_agg(distinct hotel_id) from nt), true);
  return null;
end $$;
create or replace function public.tarifario_trg_cierre_upd() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cierre_general_aplicar((select array_agg(distinct h) from (select hotel_id as h from nt union select hotel_id from ot) x), true);
  return null;
end $$;
create or replace function public.tarifario_trg_cierre_del() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.tarifario_cierre_general_aplicar((select array_agg(distinct hotel_id) from ot), false);
  return null;
end $$;

revoke all on function public.tarifario_estadia_cerrada_general(bigint, text, text, date, integer) from public, anon, authenticated;
revoke all on function public.tarifario_fila_cerrada_general(bigint, text, text, text, date, date, integer, date) from public, anon, authenticated;
revoke all on function public.tarifario_cierre_general_aplicar(bigint[], boolean) from public, anon, authenticated;
revoke all on function public.tarifario_trg_cierre_ins(), public.tarifario_trg_cierre_upd(), public.tarifario_trg_cierre_del() from public, anon, authenticated;

drop trigger if exists tarifario_trg_hotel_blackouts_ins on public.hotel_blackouts;
drop trigger if exists tarifario_trg_hotel_blackouts_upd on public.hotel_blackouts;
drop trigger if exists tarifario_trg_hotel_blackouts_del on public.hotel_blackouts;
create trigger tarifario_trg_hotel_blackouts_ins after insert on public.hotel_blackouts referencing new table as nt for each statement execute function public.tarifario_trg_cierre_ins();
create trigger tarifario_trg_hotel_blackouts_upd after update on public.hotel_blackouts referencing old table as ot new table as nt for each statement execute function public.tarifario_trg_cierre_upd();
create trigger tarifario_trg_hotel_blackouts_del after delete on public.hotel_blackouts referencing old table as ot for each statement execute function public.tarifario_trg_cierre_del();

notify pgrst, 'reload schema';
