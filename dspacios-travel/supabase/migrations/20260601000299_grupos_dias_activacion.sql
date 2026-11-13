-- ─────────────────────────────────────────────────────────────────────────────
-- 299 · #43/#60 entrega 3c — Activación controlada y tarifas reales por grupo de días
-- ─────────────────────────────────────────────────────────────────────────────
-- NÚMERO PROVISIONAL (2026-11-11): revisados todos los worktrees y ramas: 296 es de #75
-- (aplicada), 297 de este frente (aplicada), 298 de este frente (local, pendiente de auditoría).
-- 299 estaba libre. Se confirma con el dueño y #75/#97 antes de aplicarla. NO depende de la 298
-- (puede aplicarse con o sin ella; si se aplican las dos, la 298 va primero).
--
-- NO edita la 293, la 295 ni la 297 (aplicadas): las funciones suyas que cambian se REDEFINEN aquí.
--
-- MODELO: la propuesta (295) es el BORRADOR de cada grupo; las tarifas por grupo en `tarifa_hotel`
-- (grupo_id no nulo) son lo que se VENDE. «Aplicar a la venta» copia el borrador a la venta en una
-- transacción, con alcance revisado (huella), habilitaciones confirmadas una por una, regla de edad
-- coherente y sin empates de prioridad (N4). Lo vigente sigue vendiéndose mientras se edita el
-- borrador; descartar el borrador vuelve a lo vigente. Calculadoras por grupo y CSV escriben en el
-- borrador, nunca directo en la venta.
--
-- QUÉ HACE:
--   1) Retira el candado de inactividad de la 293. Activar/desactivar grupos y escribir tarifas por
--      grupo solo es posible desde las RPC de este frente (marca de transacción `app.grupos_43_rpc`);
--      `authenticated` pierde la escritura directa de `hotel_temporada_grupos`.
--   2) Empates de prioridad (N4, §W): detector en SQL con la misma semántica del motor (cobertura con
--      rangos y blackouts, compra posible, régimen, día cubierto por el grupo, neto no nulo por
--      acomodación) y comprobación DIFERIDA al confirmar cualquier transacción que toque tarifas,
--      vigencias o grupos de un hotel con grupos activos (y otra vez si se escribe de nuevo tras una
--      comprobación en la misma transacción). Serializada por hotel: sin carreras. Cada par se analiza
--      sobre el cruce COMPLETO de sus fechas; un cruce de más de 1.096 noches se devuelve como «no
--      verificable» y bloquea (nunca se declara sin conflictos lo que no se revisó).
--   3) Configuración y huella con las tarifas vigentes por grupo; candados de escritura en el orden de
--      la 293 (grupos → vigencia → tarifas → candado del hotel → hotel).
--   4) RPC: alcance (lectura), aplicar a la venta, descartar borrador, volver a «todos los días» con
--      elección explícita por combinación; borrar un grupo activo; días de un grupo activo bloqueados.
--   5) La calculadora general nunca escribe ni borra tarifas de vigencias con grupos activos (ni las
--      promociones calculadas desde ellas): se conservan como las de compra cerrada.
--
-- ORDEN: preflight_299 → esta migración → postcheck_299 → recién después el código.
-- Rollback: rollback_299 (protegido: aborta si hay grupos activos o tarifas por grupo).
-- ─────────────────────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '8s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.hotel_grupo_tarifa_propuesta') is null
     or to_regprocedure('public._grupos_43_config(bigint)') is null
     or to_regprocedure('public.grupos_dias_guardar_propuesta(bigint, text, text, uuid, jsonb)') is null then
    raise exception '299 ABORTADA: requiere la 295 aplicada';
  end if;
  if to_regclass('public.hotel_calculadora_grupo_bases') is null
     or to_regprocedure('public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb)') is null then
    raise exception '299 ABORTADA: requiere la 297 aplicada';
  end if;
  if to_regprocedure('public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text)') is null
     or not exists (select 1 from pg_proc where proname = 'fecha_negocio' and pronamespace = 'public'::regnamespace) then
    raise exception '299 ABORTADA: falta generar_tarifas_hotel_calculadora (203/237) o fecha_negocio';
  end if;
end $$;

-- 1) Candado de inactividad y escrituras solo por RPC ---------------------------------
alter table public.hotel_temporada_grupos drop constraint if exists hotel_temporada_grupos_inactivos_43;
comment on table public.hotel_temporada_grupos is
  '#43/#60: grupos de días de la semana (1=lun … 7=dom) de una vigencia. Se activan solo con «Aplicar a la venta» (299).';

revoke insert, update, delete on public.hotel_temporada_grupos from authenticated;

-- Marca de transacción que ponen SOLO las RPC de este frente (security definer). PostgREST no expone
-- set_config: un cliente no puede ponerla.
create or replace function public._grupos_43_en_rpc()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('app.grupos_43_rpc', true), '') = 'on'
$$;

create or replace function public.tg_hotel_temporada_grupos_activo_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._grupos_43_en_rpc() then return new; end if;
  if (tg_op = 'INSERT' and new.activo)
     or (tg_op = 'UPDATE' and new.activo is distinct from old.activo) then
    raise exception 'Los grupos de días se activan o desactivan solo con «Aplicar a la venta» o «Volver a todos los días».'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.activo and new.dias is distinct from old.dias then
    raise exception 'Los días de un grupo que ya se vende no se cambian directamente.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_hotel_temporada_grupos_activo_43 on public.hotel_temporada_grupos;
create trigger trg_hotel_temporada_grupos_activo_43
  before insert or update on public.hotel_temporada_grupos
  for each row execute function public.tg_hotel_temporada_grupos_activo_43();

-- Tarifas por grupo: solo por las RPC. Fuera de ellas se permite únicamente el cambio de nombre de la
-- vigencia (cascada del renombre) y la copia de días que propaga la 293.
create or replace function public.tg_tarifa_hotel_grupo_rpc_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_msg constant text := 'Las tarifas por grupo de días se cambian desde «Grupos de días» (revisar y aplicar a la venta).';
begin
  if public._grupos_43_en_rpc() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.grupo_id is not null then raise exception '%', v_msg using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.grupo_id is not null then raise exception '%', v_msg using errcode = '42501'; end if;
    return new;
  end if;
  if old.grupo_id is null and new.grupo_id is null then return new; end if;
  if new.grupo_id is distinct from old.grupo_id
     or row(new.hotel_id, new.tipo_habitacion, new.alimentacion, new.neto_sencilla, new.neto_doble, new.neto_triple,
            new.neto_multiple, new.neto_nino, new.neto_nino2, new.neto_infante, new.nota_infante, new.notas,
            new.edad_infante_min, new.edad_infante_max, new.edad_nino_min, new.edad_nino_max,
            new.precio_final_autoritativo, new.temporada_base)
        is distinct from
        row(old.hotel_id, old.tipo_habitacion, old.alimentacion, old.neto_sencilla, old.neto_doble, old.neto_triple,
            old.neto_multiple, old.neto_nino, old.neto_nino2, old.neto_infante, old.nota_infante, old.notas,
            old.edad_infante_min, old.edad_infante_max, old.edad_nino_min, old.edad_nino_max,
            old.precio_final_autoritativo, old.temporada_base) then
    raise exception '%', v_msg using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_tarifa_hotel_grupo_rpc_43 on public.tarifa_hotel;
create trigger trg_tarifa_hotel_grupo_rpc_43
  before insert or update or delete on public.tarifa_hotel
  for each row execute function public.tg_tarifa_hotel_grupo_rpc_43();

-- 2) Empates de prioridad (N4) ---------------------------------------------------------
-- Fecha segura: un texto que no es fecha no cubre nada (el motor lo descarta igual: NaN).
create or replace function public._fecha_43(p text)
returns date language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^\d{4,}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- Conflictos de prioridad del hotel, agrupados en rangos de noches. Misma regla que el motor
-- (lib/calc/paquetes.ts `entradasNoche` + `candidatoNoche` + lib/calc/empatesPrioridad.ts):
--  · dos vigencias de la MISMA prioridad, al menos una de tarifa con grupos activos;
--  · la noche está en los rangos de las dos y fuera de sus blackouts;
--  · existe una fecha de reserva posible (≥ hoy y ≤ la noche) dentro de las dos ventanas de compra;
--  · régimen compatible (restringida a un régimen = solo ese régimen);
--  · las dos aportan neto NO NULO para la misma categoría, régimen y acomodación esa noche (con grupos:
--    el del grupo que cubre el día; sin grupos: la fila «todos los días»).
-- COBERTURA COMPLETA Y ACOTADA: por cada par se analiza el CRUCE REAL de sus fechas futuras, completo, sin
-- ventana desde hoy. Si ese cruce supera 1.096 noches, el par NO se analiza y se devuelve EXPLÍCITAMENTE como
-- {tipo: 'no_verificable'} (bloquea igual que un empate: nunca se declara «sin conflictos» lo que no se revisó).
-- Más de 200 conflictos: se devuelven 200 y un elemento {tipo: 'truncado', total} (la lista no se recorta en silencio).
-- p_simular: vigencia cuya propuesta se evalúa como si ya estuviera aplicada (todos sus grupos activos y
-- sus tarifas = la propuesta). 'promo_noche_gratis' no aporta precio por noche: no participa.
create or replace function public._grupos_43_empates(p_hotel bigint, p_simular bigint default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
with
hoy as (select public.fecha_negocio() as d),
vig as (
  select t.id, btrim(t.nombre) as nombre, coalesce(t.prioridad, 1) as prioridad,
         coalesce(t.compra_inicio, '-infinity'::date) as ci, coalesce(t.compra_fin, 'infinity'::date) as cf,
         t.regimen_restringido as rr, t.fecha_inicio, t.fecha_fin, t.rangos, t.blackouts,
         (coalesce(t.tipo, 'tarifa') = 'tarifa' and exists (
            select 1 from public.hotel_temporada_grupos g
             where g.temporada_id = t.id and (g.activo or t.id = p_simular))) as con_grupos
    from public.hotel_temporadas t, hoy
   where t.hotel_id = p_hotel and coalesce(t.tipo, 'tarifa') <> 'promo_noche_gratis'
     and coalesce(t.compra_fin, 'infinity'::date) >= hoy.d
),
rangos as (
  select v.id, public._fecha_43(r->>'fecha_inicio') as i, public._fecha_43(r->>'fecha_fin') as f
    from vig v
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v.rangos) = 'array' and jsonb_array_length(v.rangos) > 0 then v.rangos
           else jsonb_build_array(jsonb_build_object('fecha_inicio', v.fecha_inicio::text, 'fecha_fin', v.fecha_fin::text)) end) r
),
rv as (select id, i, f from rangos where i is not null and f is not null and f >= i),
bl as (
  select v.id, public._fecha_43(b->>'fecha_inicio') as i, public._fecha_43(b->>'fecha_fin') as f
    from vig v cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v.blackouts) = 'array' then v.blackouts else '[]'::jsonb end) b
),
limites as (select id, min(i) as lo, max(f) as hi from rv group by id),
pares as (
  select a.id as a, b.id as b,
         greatest((select d from hoy), la.lo, lb.lo, a.ci, b.ci) as ini,
         least(la.hi, lb.hi, a.cf, b.cf) as fin
    from vig a join vig b on a.id < b.id and a.prioridad = b.prioridad
    join limites la on la.id = a.id join limites lb on lb.id = b.id
   where (a.con_grupos or b.con_grupos)
     and (a.rr is null or b.rr is null or a.rr = b.rr)
),
pares_ok as (select * from pares where fin >= ini and fin - ini + 1 <= 1096),
no_verificables as (select * from pares where fin >= ini and fin - ini + 1 > 1096),
noches_par as (
  select p.a, p.b, n::date as noche
    from pares_ok p cross join lateral generate_series(p.ini, p.fin, interval '1 day') n
   where exists (select 1 from rv where rv.id = p.a and n::date between rv.i and rv.f)
     and exists (select 1 from rv where rv.id = p.b and n::date between rv.i and rv.f)
     and not exists (select 1 from bl where bl.id in (p.a, p.b) and n::date between bl.i and bl.f)
),
filas as (
  select v.id as vig, t.grupo_id, btrim(t.tipo_habitacion) as cat, btrim(t.alimentacion) as reg,
         t.neto_sencilla, t.neto_doble, t.neto_triple, t.neto_multiple, t.neto_nino, t.neto_nino2, t.neto_infante
    from vig v join public.tarifa_hotel t
      on t.hotel_id = p_hotel and btrim(coalesce(t.temporada, '')) = v.nombre
   where v.id is distinct from p_simular
     and v.id in (select a from pares_ok union select b from pares_ok)
     and ((v.con_grupos and t.grupo_id is not null) or (not v.con_grupos and t.grupo_id is null))
  union all
  select v.id, p.grupo_id, p.tipo_habitacion, p.alimentacion,
         p.neto_sencilla, p.neto_doble, p.neto_triple, p.neto_multiple, p.neto_nino, p.neto_nino2, p.neto_infante
    from vig v join public.hotel_temporada_grupos g on g.temporada_id = v.id
    join public.hotel_grupo_tarifa_propuesta p on p.grupo_id = g.id
   where v.id = p_simular and v.id in (select a from pares_ok union select b from pares_ok)
),
precios as (
  -- dias = días del grupo que aporta la fila (null = todos los días); solo grupos que cuentan (activos o simulados).
  select f.vig, f.cat, f.reg, a.acom, g.dias
    from filas f
    join vig v on v.id = f.vig
    left join public.hotel_temporada_grupos g on g.id = f.grupo_id and (g.activo or f.vig = p_simular)
    cross join lateral (values ('sencilla', f.neto_sencilla), ('doble', f.neto_doble), ('triple', f.neto_triple),
                               ('multiple', f.neto_multiple), ('nino', f.neto_nino), ('nino2', f.neto_nino2),
                               ('infante', f.neto_infante)) a(acom, neto)
   where a.neto is not null
     and (v.rr is null or f.reg = v.rr)
     and (f.grupo_id is null or g.id is not null)
),
cruces as (
  select np.a, np.b, pa.cat, pa.reg, pa.acom, np.noche
    from noches_par np
    join precios pa on pa.vig = np.a and (pa.dias is null or extract(isodow from np.noche)::smallint = any (pa.dias))
    join precios pb on pb.vig = np.b and pb.cat = pa.cat and pb.reg = pa.reg and pb.acom = pa.acom
                   and (pb.dias is null or extract(isodow from np.noche)::smallint = any (pb.dias))
  group by np.a, np.b, pa.cat, pa.reg, pa.acom, np.noche
),
islas as (
  select a, b, cat, reg, acom, noche,
         noche - (row_number() over (partition by a, b, cat, reg, acom order by noche))::int as isla
    from cruces
),
conf as (
  select 'empate'::text as tipo, a, b, cat, reg, acom, min(noche) as desde, max(noche) as hasta, count(*)::int as noches
    from islas group by a, b, cat, reg, acom, isla
  union all
  select 'no_verificable', a, b, null, null, null, ini, fin, (fin - ini + 1)::int from no_verificables
),
total as (select count(*) as n from conf),
primeros as (select * from conf order by desde, a, b, cat nulls first, reg, acom limit 200)
select coalesce(jsonb_agg(x.e order by x.orden), '[]'::jsonb) from (
  select 1 as orden, jsonb_build_object(
           'tipo', r.tipo,
           'a', jsonb_build_object('id', va.id, 'nombre', va.nombre, 'con_grupos', va.con_grupos),
           'b', jsonb_build_object('id', vb.id, 'nombre', vb.nombre, 'con_grupos', vb.con_grupos),
           'prioridad', va.prioridad, 'tipo_habitacion', r.cat, 'alimentacion', r.reg, 'acomodacion', r.acom,
           'desde', r.desde, 'hasta', r.hasta, 'noches', r.noches) as e
    from primeros r join vig va on va.id = r.a join vig vb on vb.id = r.b
  union all
  select 2, jsonb_build_object('tipo', 'truncado', 'total', t.n, 'mostrados', 200) from total t where t.n > 200
) x
$$;

create or replace function public._grupos_43_texto_empates(p_conf jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
  select string_agg(case c->>'tipo'
      when 'no_verificable' then format('No se pueden verificar empates entre %s y %s (prioridad %s): comparten %s noches, del %s al %s, más de las 1.096 que se revisan; acota las fechas de una de las dos',
                                        c->'a'->>'nombre', c->'b'->>'nombre', c->>'prioridad', c->>'noches', c->>'desde', c->>'hasta')
      when 'truncado' then format('y %s conflicto(s) más', (c->>'total')::int - (c->>'mostrados')::int)
      else format('Empate de prioridad entre %s y %s (prioridad %s): %s / %s / %s, del %s al %s',
                  c->'a'->>'nombre', c->'b'->>'nombre', c->>'prioridad', c->>'tipo_habitacion',
                  c->>'alimentacion', c->>'acomodacion', c->>'desde', c->>'hasta') end, '; ')
    from (select c from jsonb_array_elements(p_conf) c
           where c->>'tipo' <> 'truncado'
           limit 5) x
$$;

-- Comprobación de empates al confirmar (DIFERIDA), serializada por hotel con un candado propio: la segunda
-- transacción espera a que la primera confirme y luego ve sus cambios, así dos cambios que juntos empatan nunca
-- pasan los dos. Hoteles sin grupos activos: no cambia nada.
-- «Sucio»: un trigger NORMAL (barato, sin lecturas salvo el hotel de un grupo) marca el hotel en cada escritura;
-- la comprobación solo corre si el hotel está marcado y lo desmarca al terminar. Así:
--  · varias filas de un mismo commit se comprueban UNA vez (el resto encuentra la marca apagada);
--  · una escritura POSTERIOR en la misma transacción (por ejemplo tras SET CONSTRAINTS ... IMMEDIATE) vuelve a
--    marcar el hotel y su evento vuelve a comprobar: nada se salta.
-- El trigger de marca se llama trg_43_empates_marca para ordenarse ANTES que trg_empates_43 (orden alfabético)
-- cuando la comprobación es inmediata.
create or replace function public._grupos_43_hotel_de(p_tabla text, p_hotel bigint, p_temporada bigint)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_tabla = 'hotel_temporada_grupos'
              then (select t.hotel_id from public.hotel_temporadas t where t.id = p_temporada)
              else p_hotel end
$$;

create or replace function public.tg_empates_43_marca()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hotel bigint;
begin
  if tg_table_name = 'hotel_temporada_grupos' then
    v_hotel := public._grupos_43_hotel_de(tg_table_name, null, case when tg_op = 'DELETE' then old.temporada_id else new.temporada_id end);
  else
    v_hotel := case when tg_op = 'DELETE' then old.hotel_id else new.hotel_id end;
  end if;
  if v_hotel is not null then perform set_config('app.empates_43_sucio_' || v_hotel::text, 'si', true); end if;
  return null;
end $$;

create or replace function public.tg_empates_43()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel bigint;
  v_marca text;
  v_conf jsonb;
begin
  if tg_table_name = 'hotel_temporada_grupos' then
    v_hotel := public._grupos_43_hotel_de(tg_table_name, null, case when tg_op = 'DELETE' then old.temporada_id else new.temporada_id end);
  else
    v_hotel := case when tg_op = 'DELETE' then old.hotel_id else new.hotel_id end;
  end if;
  if v_hotel is null then return null; end if;
  v_marca := 'app.empates_43_sucio_' || v_hotel::text;
  if coalesce(current_setting(v_marca, true), '') <> 'si' then return null; end if;   -- ya comprobado tras la última escritura
  perform pg_advisory_xact_lock(hashtextextended('t43_60_empates:' || v_hotel::text, 0));
  if exists (select 1 from public.hotel_temporada_grupos g join public.hotel_temporadas t on t.id = g.temporada_id
              where t.hotel_id = v_hotel and g.activo) then
    v_conf := public._grupos_43_empates(v_hotel, null);
    if jsonb_array_length(v_conf) > 0 then
      raise exception 'EMPATE_PRIORIDAD: %. Corrige la prioridad, las fechas, los días, el régimen o la compra para que no compitan.',
        public._grupos_43_texto_empates(v_conf) using errcode = '23514';
    end if;
  end if;
  perform set_config(v_marca, 'no', true);
  return null;
end $$;

drop trigger if exists trg_43_empates_marca on public.tarifa_hotel;
create trigger trg_43_empates_marca after insert or update or delete on public.tarifa_hotel
  for each row execute function public.tg_empates_43_marca();
drop trigger if exists trg_43_empates_marca on public.hotel_temporadas;
create trigger trg_43_empates_marca after insert or update or delete on public.hotel_temporadas
  for each row execute function public.tg_empates_43_marca();
drop trigger if exists trg_43_empates_marca on public.hotel_temporada_grupos;
create trigger trg_43_empates_marca after insert or update or delete on public.hotel_temporada_grupos
  for each row execute function public.tg_empates_43_marca();

drop trigger if exists trg_empates_43 on public.tarifa_hotel;
create constraint trigger trg_empates_43 after insert or update or delete on public.tarifa_hotel
  deferrable initially deferred for each row execute function public.tg_empates_43();
drop trigger if exists trg_empates_43 on public.hotel_temporadas;
create constraint trigger trg_empates_43 after insert or update or delete on public.hotel_temporadas
  deferrable initially deferred for each row execute function public.tg_empates_43();
drop trigger if exists trg_empates_43 on public.hotel_temporada_grupos;
create constraint trigger trg_empates_43 after insert or update or delete on public.hotel_temporada_grupos
  deferrable initially deferred for each row execute function public.tg_empates_43();

-- 3) Configuración, huella y candados --------------------------------------------------
-- Igual que en la 295 (mismas claves) + `vigentes` (tarifas por grupo que se venden), `estado`
-- ('preparado' | 'activo') y `compra_cerrada`. La huella cubre también las tarifas vigentes por grupo.
create or replace function public._grupos_43_config(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v public.hotel_temporadas;
  r jsonb;
begin
  select * into v from public.hotel_temporadas where id = p_temporada_id;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  with
  grupos as (select g.* from public.hotel_temporada_grupos g where g.temporada_id = v.id),
  props as (select p.* from public.hotel_grupo_tarifa_propuesta p join grupos g on g.id = p.grupo_id),
  origen as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = btrim(v.nombre) and t.grupo_id is null),
  vigentes as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = btrim(v.nombre) and t.grupo_id is not null),
  promo_filas as (
    select t.* from public.tarifa_hotel t
    where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada_base, '')) = btrim(v.nombre)),
  promo_vigs as (
    select ht.* from public.hotel_temporadas ht
    where ht.hotel_id = v.hotel_id and btrim(ht.nombre) in (select btrim(coalesce(temporada, '')) from promo_filas))
  select jsonb_build_object(
    'vigencia', jsonb_build_object('id', v.id, 'nombre', v.nombre, 'hotel_id', v.hotel_id, 'tipo', coalesce(v.tipo, 'tarifa'),
                  'prioridad', v.prioridad, 'fecha_inicio', v.fecha_inicio, 'fecha_fin', v.fecha_fin,
                  'nombre_repetido', exists (select 1 from public.hotel_temporadas o
                                             where o.hotel_id = v.hotel_id and o.id <> v.id and btrim(o.nombre) = btrim(v.nombre))),
    'hotel', (select jsonb_build_object('id', h.id, 'modelo_tarifario', h.modelo_tarifario,
                       'edad_infante_min', h.edad_infante_min, 'edad_infante_max', h.edad_infante_max,
                       'edad_nino_min', h.edad_nino_min, 'edad_nino_max', h.edad_nino_max)
                from public.hoteles h where h.id = v.hotel_id),
    'categorias', coalesce((select jsonb_agg(c.nombre order by c.nombre) from public.hotel_categorias hc
                            join public.categorias_habitacion c on c.id = hc.categoria_id where hc.hotel_id = v.hotel_id), '[]'),
    'regimenes', coalesce((select jsonb_agg(pa.codigo order by pa.codigo) from public.hotel_regimenes hr
                           join public.planes_alimentacion pa on pa.id = hr.plan_id where hr.hotel_id = v.hotel_id), '[]'),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'nombre', g.nombre, 'dias', g.dias, 'activo', g.activo)
                                         order by g.dias[1], g.id) from grupos g), '[]'),
    'estado', case when exists (select 1 from grupos g where g.activo) then 'activo' else 'preparado' end,
    'compra_cerrada', (v.compra_fin is not null and v.compra_fin < public.fecha_negocio()),
    'propuestas', coalesce((select jsonb_agg((to_jsonb(p) - 'confirmado_por') order by p.id) from props p), '[]'),
    'origen', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'tipo_habitacion', t.tipo_habitacion, 'alimentacion', t.alimentacion,
        'neto_sencilla', t.neto_sencilla, 'neto_doble', t.neto_doble, 'neto_triple', t.neto_triple, 'neto_multiple', t.neto_multiple,
        'neto_nino', t.neto_nino, 'neto_nino2', t.neto_nino2, 'neto_infante', t.neto_infante, 'nota_infante', t.nota_infante, 'notas', t.notas,
        'edad_infante_min', t.edad_infante_min, 'edad_infante_max', t.edad_infante_max, 'edad_nino_min', t.edad_nino_min, 'edad_nino_max', t.edad_nino_max,
        'huella', md5(to_jsonb(t)::text)) order by t.id) from origen t), '[]'),
    'vigentes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'grupo_id', t.grupo_id, 'tipo_habitacion', t.tipo_habitacion, 'alimentacion', t.alimentacion,
        'neto_sencilla', t.neto_sencilla, 'neto_doble', t.neto_doble, 'neto_triple', t.neto_triple, 'neto_multiple', t.neto_multiple,
        'neto_nino', t.neto_nino, 'neto_nino2', t.neto_nino2, 'neto_infante', t.neto_infante, 'nota_infante', t.nota_infante, 'notas', t.notas,
        'edad_infante_min', t.edad_infante_min, 'edad_infante_max', t.edad_infante_max, 'edad_nino_min', t.edad_nino_min, 'edad_nino_max', t.edad_nino_max)
        order by t.id) from vigentes t), '[]'),
    'promociones', coalesce((select jsonb_agg(jsonb_build_object('temporada', x.temporada, 'filas', x.n) order by x.temporada)
                             from (select temporada, count(*) as n from promo_filas group by temporada) x), '[]'),
    'huella', md5(concat_ws('|',
        to_jsonb(v)::text,
        coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from grupos g)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from props p)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from origen t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from vigentes t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_filas t)::text, '[]'),
        coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from promo_vigs t)::text, '[]'),
        coalesce((select jsonb_build_object('m', h.modelo_tarifario, 'a', h.edad_infante_min, 'b', h.edad_infante_max,
                                            'c', h.edad_nino_min, 'd', h.edad_nino_max)::text
                    from public.hoteles h where h.id = v.hotel_id), ''))))
  into r;
  return r;
end $$;

-- Candados (orden de la 293) + huella. p_escribe: las tarifas de la vigencia (todos los días y por grupo)
-- se toman FOR UPDATE antes del candado del hotel, para escribirlas sin ascender un candado compartido.
create or replace function public._grupos_43_bloquear(p_temporada_id bigint, p_huella text, p_escribe boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hotel bigint; v_nombre text; v_modelo text; r jsonb;
begin
  perform 1 from public.hotel_temporada_grupos g where g.temporada_id = p_temporada_id order by g.id for update;
  select t.hotel_id, btrim(t.nombre) into v_hotel, v_nombre from public.hotel_temporadas t where t.id = p_temporada_id for update;
  if not found then
    raise exception 'La vigencia % no existe.', p_temporada_id using errcode = 'P0002';
  end if;
  if p_escribe then
    perform 1 from public.tarifa_hotel t
     where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre order by t.id for update;
  else
    perform 1 from public.tarifa_hotel t
     where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre order by t.id for share;
  end if;
  perform 1 from public.tarifa_hotel t
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada_base, '')) = v_nombre
     and btrim(coalesce(t.temporada, '')) <> v_nombre
   order by t.id for share;
  perform 1 from public.hotel_temporadas ht
   where ht.hotel_id = v_hotel and ht.id <> p_temporada_id
     and btrim(ht.nombre) in (select btrim(coalesce(t.temporada, '')) from public.tarifa_hotel t
                              where t.hotel_id = v_hotel and btrim(coalesce(t.temporada_base, '')) = v_nombre)
   order by ht.id for share;
  perform public.t43_60_candado_hotel(v_hotel, true);
  select h.modelo_tarifario into v_modelo from public.hoteles h where h.id = v_hotel for share;
  if v_modelo = 'unidad' then
    raise exception 'Los hoteles de modelo por unidad no admiten grupos de días.' using errcode = '23514';
  end if;
  r := public._grupos_43_config(p_temporada_id);
  if p_huella is null or r->>'huella' is distinct from p_huella then
    raise exception 'CONFIG_DESACTUALIZADA: la configuración de esta vigencia cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar.'
      using errcode = 'PT409';
  end if;
  return r;
end $$;

-- La función de la 295 conserva su firma y su comportamiento (lectura compartida) sobre la huella nueva.
create or replace function public._grupos_43_bloquear_y_comparar(p_temporada_id bigint, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public._grupos_43_bloquear(p_temporada_id, p_huella, false);
end $$;

-- 4) Reglas de la aplicación -------------------------------------------------------------
-- ¿Una acomodación se vende con este neto? Habitación: > 0 (0 = no aplica). Niño 1/2: no nulo (0 = gratis).
-- Infante: siempre «viaja» (sin tarifa = gratis): ponerle precio no es habilitar.
create or replace function public._grupos_43_vende(p_acom text, p_neto numeric)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case when p_acom in ('nino', 'nino2') then p_neto is not null
              when p_acom = 'infante' then true
              else coalesce(p_neto, 0) > 0 end
$$;

-- Acomodaciones que HOY no se venden en esa combinación y la propuesta pondría a la venta. «Hoy» = la tarifa
-- del grupo que se vende (si el grupo está activo) o la tarifa «todos los días» de la vigencia (si no).
create or replace function public._grupos_43_habilitaciones(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
with v as (select hotel_id, btrim(nombre) as nombre from public.hotel_temporadas where id = p_temporada_id),
pares as (
  select g.id as grupo_id, g.nombre as grupo, g.activo, p.tipo_habitacion, p.alimentacion, a.acom, a.nuevo,
         case when g.activo then
           (select (case a.acom when 'sencilla' then t.neto_sencilla when 'doble' then t.neto_doble when 'triple' then t.neto_triple
                     when 'multiple' then t.neto_multiple when 'nino' then t.neto_nino when 'nino2' then t.neto_nino2 else t.neto_infante end)
              from public.tarifa_hotel t, v where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = v.nombre
               and t.grupo_id = g.id and btrim(t.tipo_habitacion) = p.tipo_habitacion and btrim(t.alimentacion) = p.alimentacion
             order by t.id desc limit 1)
         else
           (select (case a.acom when 'sencilla' then t.neto_sencilla when 'doble' then t.neto_doble when 'triple' then t.neto_triple
                     when 'multiple' then t.neto_multiple when 'nino' then t.neto_nino when 'nino2' then t.neto_nino2 else t.neto_infante end)
              from public.tarifa_hotel t, v where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = v.nombre
               and t.grupo_id is null and btrim(t.tipo_habitacion) = p.tipo_habitacion and btrim(t.alimentacion) = p.alimentacion
             order by t.id desc limit 1)
         end as hoy
    from public.hotel_temporada_grupos g
    join public.hotel_grupo_tarifa_propuesta p on p.grupo_id = g.id
   cross join lateral (values ('sencilla', p.neto_sencilla), ('doble', p.neto_doble), ('triple', p.neto_triple),
                              ('multiple', p.neto_multiple), ('nino', p.neto_nino), ('nino2', p.neto_nino2)) a(acom, nuevo)
   where g.temporada_id = p_temporada_id
)
select coalesce(jsonb_agg(jsonb_build_object('grupo_id', grupo_id, 'grupo', grupo, 'tipo_habitacion', tipo_habitacion,
         'alimentacion', alimentacion, 'acomodacion', acom, 'nuevo', nuevo, 'hoy', hoy)
       order by grupo, tipo_habitacion, alimentacion, acom), '[]'::jsonb)
  from pares where public._grupos_43_vende(acom, nuevo) and not public._grupos_43_vende(acom, hoy)
$$;

-- Combinaciones cuya regla de edad EFECTIVA (override de la fila ?? general del hotel ?? 0-2 / 3-10)
-- difiere entre grupos: el motor no elegiría ninguna (G.4), así que no se aplica.
create or replace function public._grupos_43_edades_conflicto(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
with h as (
  select coalesce(ho.edad_infante_min, 0) as imin, coalesce(ho.edad_infante_max, 2) as imax,
         coalesce(ho.edad_nino_min, coalesce(ho.edad_infante_max, 2) + 1) as nmin, coalesce(ho.edad_nino_max, 10) as nmax
    from public.hotel_temporadas t join public.hoteles ho on ho.id = t.hotel_id where t.id = p_temporada_id),
ef as (
  select p.tipo_habitacion, p.alimentacion, g.nombre as grupo,
         case when p.edad_infante_min is null then format('%s-%s / %s-%s', h.imin, h.imax, h.nmin, h.nmax)
              else format('%s-%s / %s-%s', p.edad_infante_min, p.edad_infante_max, p.edad_nino_min, p.edad_nino_max) end as regla
    from public.hotel_grupo_tarifa_propuesta p join public.hotel_temporada_grupos g on g.id = p.grupo_id, h
   where g.temporada_id = p_temporada_id)
select coalesce(jsonb_agg(jsonb_build_object('tipo_habitacion', tipo_habitacion, 'alimentacion', alimentacion, 'reglas', reglas)
       order by tipo_habitacion, alimentacion), '[]'::jsonb)
  from (select tipo_habitacion, alimentacion, jsonb_agg(jsonb_build_object('grupo', grupo, 'regla', regla) order by grupo) as reglas
          from ef group by tipo_habitacion, alimentacion having count(distinct regla) > 1) x
$$;

-- Sugerencias aceptadas cuya tarifa de origen cambió o desapareció desde que se aceptaron.
create or replace function public._grupos_43_obsoletas(p_temporada_id bigint)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('grupo', g.nombre, 'tipo_habitacion', p.tipo_habitacion, 'alimentacion', p.alimentacion)
         order by g.nombre, p.tipo_habitacion, p.alimentacion), '[]'::jsonb)
    from public.hotel_grupo_tarifa_propuesta p join public.hotel_temporada_grupos g on g.id = p.grupo_id
   where g.temporada_id = p_temporada_id and p.origen_tarifa_id is not null
     and not exists (select 1 from public.tarifa_hotel t where t.id = p.origen_tarifa_id and md5(to_jsonb(t)::text) = p.origen_huella)
$$;

-- ¿El borrador difiere de lo que se vende? (grupos inactivos, filas distintas, de más o de menos)
create or replace function public._grupos_43_pendientes(p_temporada_id bigint)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
with v as (select hotel_id, btrim(nombre) as nombre from public.hotel_temporadas where id = p_temporada_id),
b as (select p.* from public.hotel_grupo_tarifa_propuesta p join public.hotel_temporada_grupos g on g.id = p.grupo_id
       where g.temporada_id = p_temporada_id),
r as (select t.* from public.tarifa_hotel t, v
       where t.hotel_id = v.hotel_id and btrim(coalesce(t.temporada, '')) = v.nombre and t.grupo_id is not null)
select (select count(*) from b full join r
          on r.grupo_id = b.grupo_id and btrim(r.tipo_habitacion) = b.tipo_habitacion and btrim(r.alimentacion) = b.alimentacion
         where b.id is null or r.id is null
            or row(b.neto_sencilla, b.neto_doble, b.neto_triple, b.neto_multiple, b.neto_nino, b.neto_nino2, b.neto_infante,
                   b.nota_infante, b.notas, b.edad_infante_min, b.edad_infante_max, b.edad_nino_min, b.edad_nino_max)
               is distinct from
               row(r.neto_sencilla, r.neto_doble, r.neto_triple, r.neto_multiple, r.neto_nino, r.neto_nino2, r.neto_infante,
                   r.nota_infante, r.notas, r.edad_infante_min, r.edad_infante_max, r.edad_nino_min, r.edad_nino_max))::int
     + (select count(*) from public.hotel_temporada_grupos g where g.temporada_id = p_temporada_id and not g.activo
          and exists (select 1 from public.hotel_temporada_grupos a where a.temporada_id = p_temporada_id and a.activo))::int
$$;

-- Días de la semana que ningún grupo cubre (salen de la cobertura de esta vigencia, D13).
create or replace function public._grupos_43_dias_sin_grupo(p_temporada_id bigint)
returns smallint[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(d order by d), '{}')::smallint[] from generate_series(1, 7) d
   where not exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = p_temporada_id and d = any (g.dias))
$$;

revoke all on function public._grupos_43_en_rpc() from public, anon, authenticated;
revoke all on function public.tg_hotel_temporada_grupos_activo_43() from public, anon, authenticated;
revoke all on function public.tg_tarifa_hotel_grupo_rpc_43() from public, anon, authenticated;
revoke all on function public._fecha_43(text) from public, anon, authenticated;
revoke all on function public._grupos_43_empates(bigint, bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_texto_empates(jsonb) from public, anon, authenticated;
revoke all on function public.tg_empates_43() from public, anon, authenticated;
revoke all on function public.tg_empates_43_marca() from public, anon, authenticated;
revoke all on function public._grupos_43_hotel_de(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_config(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_bloquear(bigint, text, boolean) from public, anon, authenticated;
revoke all on function public._grupos_43_bloquear_y_comparar(bigint, text) from public, anon, authenticated;
revoke all on function public._grupos_43_vende(text, numeric) from public, anon, authenticated;
revoke all on function public._grupos_43_habilitaciones(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_edades_conflicto(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_obsoletas(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_pendientes(bigint) from public, anon, authenticated;
revoke all on function public._grupos_43_dias_sin_grupo(bigint) from public, anon, authenticated;

-- 5) RPC ---------------------------------------------------------------------------------
-- Alcance para revisar antes de aplicar a la venta (una lectura). Todo lo que la aplicación exige o
-- rechaza viene de aquí, calculado en la base: habilitaciones, empates (simulando la propuesta aplicada),
-- reglas de edad, sugerencias obsoletas, días sin grupo y si hay cambios pendientes.
create or replace function public.grupos_dias_alcance(p_temporada_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cfg jsonb; v_hotel bigint;
begin
  perform public._grupos_43_autorizar(false);
  cfg := public._grupos_43_config(p_temporada_id);
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  return cfg || jsonb_build_object(
    'bases', public._calc_grupos_43_bases_de(p_temporada_id),
    'habilitaciones', public._grupos_43_habilitaciones(p_temporada_id),
    'empates', case when exists (select 1 from public.hotel_grupo_tarifa_propuesta p join public.hotel_temporada_grupos g on g.id = p.grupo_id
                                  where g.temporada_id = p_temporada_id)
                    then public._grupos_43_empates(v_hotel, p_temporada_id) else '[]'::jsonb end,
    'edades_conflicto', public._grupos_43_edades_conflicto(p_temporada_id),
    'obsoletas', public._grupos_43_obsoletas(p_temporada_id),
    'dias_sin_grupo', public._grupos_43_dias_sin_grupo(p_temporada_id),
    'pendientes', public._grupos_43_pendientes(p_temporada_id),
    -- Paquetes de porción terrestre activos con este hotel: mientras se venda por grupos no se pueden regenerar (el motor
    -- no publica un «desde» aproximado hasta la entrega 6) y conservan publicado su tarifario anterior.
    'paquetes_porcion', (select count(distinct ah.paquete_id) from public.armado_hoteles ah
                            join public.armado_paquetes ap on ap.id = ah.paquete_id and ap.activo and ap.tipo::text = 'porcion_terrestre'
                           where ah.hotel_id = v_hotel),
    'otras_con_grupos', (select count(*) from public.hotel_temporadas t
                          where t.hotel_id = v_hotel and t.id <> p_temporada_id
                            and exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = t.id and g.activo)));
end $$;

-- Aplicar a la venta: lo que se vende de esta vigencia pasa a ser EXACTAMENTE la propuesta de sus grupos,
-- en una transacción. p_habilitaciones: las acomodaciones que el usuario confirmó una por una
-- ([{grupo_id, tipo_habitacion, alimentacion, acomodacion}]); deben ser exactamente las que calcula la base.
create or replace function public.grupos_dias_activar(p_temporada_id bigint, p_huella text, p_habilitaciones jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb; v_hotel bigint; v_nombre text; x jsonb;
  n_quitadas int := 0; n_borradas int := 0; n_cambiadas int := 0; n_nuevas int := 0; n_activados int := 0;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_habilitaciones) is distinct from 'array' then
    raise exception 'p_habilitaciones debe ser una lista.' using errcode = '22023';
  end if;
  cfg := public._grupos_43_bloquear(p_temporada_id, p_huella, true);
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  v_nombre := btrim(cfg->'vigencia'->>'nombre');
  if (cfg->>'compra_cerrada')::boolean then
    raise exception 'La vigencia "%" tiene la compra cerrada: sus tarifas se conservan y no se cambian.', v_nombre using errcode = '23514';
  end if;
  if jsonb_array_length(cfg->'grupos') = 0 then
    raise exception 'La vigencia no tiene grupos de días.' using errcode = '23514';
  end if;
  if jsonb_array_length(cfg->'propuestas') = 0 then
    raise exception 'Ningún grupo tiene tarifas en la propuesta: no hay nada que aplicar (sin tarifa no se vende).' using errcode = '23514';
  end if;
  if public._grupos_43_pendientes(p_temporada_id) = 0 and cfg->>'estado' = 'activo' then
    raise exception 'No hay cambios pendientes: lo que se vende ya es igual a la propuesta.' using errcode = '23514';
  end if;
  x := public._grupos_43_obsoletas(p_temporada_id);
  if jsonb_array_length(x) > 0 then
    raise exception 'Hay sugerencias aceptadas cuya tarifa actual cambió después (%). Vuelve a revisarlas en la propuesta.',
      (select string_agg(format('%s · %s / %s', e->>'grupo', e->>'tipo_habitacion', e->>'alimentacion'), '; ') from jsonb_array_elements(x) e)
      using errcode = '23514';
  end if;
  x := public._grupos_43_edades_conflicto(p_temporada_id);
  if jsonb_array_length(x) > 0 then
    raise exception 'La regla de edad no coincide entre grupos en %. Usa la misma regla de edad en todos los grupos de cada combinación.',
      (select string_agg(format('%s / %s', e->>'tipo_habitacion', e->>'alimentacion'), '; ') from jsonb_array_elements(x) e)
      using errcode = '23514';
  end if;
  -- Habilitaciones: exactamente las calculadas (ni de menos ni de más; nada se habilita sin confirmar).
  if (select coalesce(jsonb_agg(k order by k), '[]') from (
        select format('%s|%s|%s|%s', e->>'grupo_id', e->>'tipo_habitacion', e->>'alimentacion', e->>'acomodacion') as k
          from jsonb_array_elements(public._grupos_43_habilitaciones(p_temporada_id)) e) a)
     is distinct from
     (select coalesce(jsonb_agg(k order by k), '[]') from (
        select distinct format('%s|%s|%s|%s', e->>'grupo_id', e->>'tipo_habitacion', e->>'alimentacion', e->>'acomodacion') as k
          from jsonb_array_elements(p_habilitaciones) e) b) then
    raise exception 'HABILITACIONES_SIN_CONFIRMAR: confirma una por una las acomodaciones que hoy no se venden y pasarían a venderse.'
      using errcode = 'PT409';
  end if;
  x := public._grupos_43_empates(v_hotel, p_temporada_id);
  if jsonb_array_length(x) > 0 then
    raise exception 'EMPATE_PRIORIDAD: %. Resuélvelo antes de aplicar.', public._grupos_43_texto_empates(x) using errcode = '23514';
  end if;

  perform set_config('app.grupos_43_rpc', 'on', true);
  perform set_config('app.tarifa_motivo', 'grupos_aplicar', true);
  update public.hotel_temporada_grupos set activo = true where temporada_id = p_temporada_id and not activo;
  get diagnostics n_activados = row_count;
  delete from public.tarifa_hotel t
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre and t.grupo_id is null;
  get diagnostics n_quitadas = row_count;
  -- Tarifas por grupo que ya no están en la propuesta (incluye duplicados: queda una por clave).
  delete from public.tarifa_hotel t
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre and t.grupo_id is not null
     and (not exists (select 1 from public.hotel_grupo_tarifa_propuesta p
                       where p.grupo_id = t.grupo_id and p.tipo_habitacion = btrim(t.tipo_habitacion) and p.alimentacion = btrim(t.alimentacion))
          or exists (select 1 from public.tarifa_hotel o
                      where o.hotel_id = t.hotel_id and o.grupo_id = t.grupo_id and btrim(coalesce(o.temporada, '')) = v_nombre
                        and btrim(o.tipo_habitacion) = btrim(t.tipo_habitacion) and btrim(o.alimentacion) = btrim(t.alimentacion)
                        and o.id > t.id));
  get diagnostics n_borradas = row_count;
  update public.tarifa_hotel t set
      neto_sencilla = p.neto_sencilla, neto_doble = p.neto_doble, neto_triple = p.neto_triple, neto_multiple = p.neto_multiple,
      neto_nino = p.neto_nino, neto_nino2 = p.neto_nino2, neto_infante = p.neto_infante, nota_infante = p.nota_infante,
      notas = p.notas, edad_infante_min = p.edad_infante_min, edad_infante_max = p.edad_infante_max,
      edad_nino_min = p.edad_nino_min, edad_nino_max = p.edad_nino_max
    from public.hotel_grupo_tarifa_propuesta p
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre and t.grupo_id = p.grupo_id
     and btrim(t.tipo_habitacion) = p.tipo_habitacion and btrim(t.alimentacion) = p.alimentacion
     and row(t.neto_sencilla, t.neto_doble, t.neto_triple, t.neto_multiple, t.neto_nino, t.neto_nino2, t.neto_infante, t.nota_infante,
             t.notas, t.edad_infante_min, t.edad_infante_max, t.edad_nino_min, t.edad_nino_max)
         is distinct from
         row(p.neto_sencilla, p.neto_doble, p.neto_triple, p.neto_multiple, p.neto_nino, p.neto_nino2, p.neto_infante, p.nota_infante,
             p.notas, p.edad_infante_min, p.edad_infante_max, p.edad_nino_min, p.edad_nino_max);
  get diagnostics n_cambiadas = row_count;
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, grupo_id,
      neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
  select v_hotel, p.tipo_habitacion, p.alimentacion, v_nombre, p.grupo_id,
         p.neto_sencilla, p.neto_doble, p.neto_triple, p.neto_multiple, p.neto_nino, p.neto_nino2, p.neto_infante, p.nota_infante, p.notas,
         p.edad_infante_min, p.edad_infante_max, p.edad_nino_min, p.edad_nino_max
    from public.hotel_grupo_tarifa_propuesta p join public.hotel_temporada_grupos g on g.id = p.grupo_id
   where g.temporada_id = p_temporada_id
     and not exists (select 1 from public.tarifa_hotel t
                      where t.hotel_id = v_hotel and t.grupo_id = p.grupo_id and btrim(coalesce(t.temporada, '')) = v_nombre
                        and btrim(t.tipo_habitacion) = p.tipo_habitacion and btrim(t.alimentacion) = p.alimentacion)
   order by p.id;
  get diagnostics n_nuevas = row_count;
  -- Las sugerencias quedaron consumidas: la tarifa «todos los días» de la que venían ya no se vende.
  update public.hotel_grupo_tarifa_propuesta p set origen_tarifa_id = null, origen_huella = null
    from public.hotel_temporada_grupos g where g.id = p.grupo_id and g.temporada_id = p_temporada_id and p.origen_tarifa_id is not null;
  set constraints public.trg_empates_43 immediate;   -- el empate se informa aquí, no al confirmar
  return jsonb_build_object('grupos_activados', n_activados, 'todos_los_dias_quitadas', n_quitadas, 'por_grupo_quitadas', n_borradas,
                            'por_grupo_cambiadas', n_cambiadas, 'por_grupo_nuevas', n_nuevas,
                            'config', public._grupos_43_config(p_temporada_id));
end $$;

-- Descartar el borrador de los grupos que se venden: su propuesta vuelve a ser exactamente lo vigente.
-- Los grupos todavía no aplicados (nuevos) conservan su propuesta.
create or replace function public.grupos_dias_descartar(p_temporada_id bigint, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; v_hotel bigint; v_nombre text; n_del int; n_ins int;
begin
  perform public._grupos_43_autorizar(true);
  cfg := public._grupos_43_bloquear(p_temporada_id, p_huella, false);
  if cfg->>'estado' <> 'activo' then
    raise exception 'La vigencia todavía no se vende por grupos: no hay borrador que descartar.' using errcode = '23514';
  end if;
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  v_nombre := btrim(cfg->'vigencia'->>'nombre');
  delete from public.hotel_grupo_tarifa_propuesta p using public.hotel_temporada_grupos g
   where g.id = p.grupo_id and g.temporada_id = p_temporada_id and g.activo;
  get diagnostics n_del = row_count;
  insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_sencilla, neto_doble, neto_triple,
      neto_multiple, neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, confirmado_por, confirmado_en)
  select distinct on (t.grupo_id, btrim(t.tipo_habitacion), btrim(t.alimentacion))
         t.grupo_id, btrim(t.tipo_habitacion), btrim(t.alimentacion), t.neto_sencilla, t.neto_doble, t.neto_triple,
         t.neto_multiple, t.neto_nino, t.neto_nino2, t.neto_infante, t.nota_infante, t.notas,
         t.edad_infante_min, t.edad_infante_max, t.edad_nino_min, t.edad_nino_max, auth.uid(), now()
    from public.tarifa_hotel t join public.hotel_temporada_grupos g on g.id = t.grupo_id and g.activo
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre
     and num_nonnulls(t.neto_sencilla, t.neto_doble, t.neto_triple, t.neto_multiple, t.neto_nino, t.neto_nino2, t.neto_infante) > 0
   order by t.grupo_id, btrim(t.tipo_habitacion), btrim(t.alimentacion), t.id desc;
  get diagnostics n_ins = row_count;
  return jsonb_build_object('borrador_quitadas', n_del, 'borrador_restauradas', n_ins, 'config', public._grupos_43_config(p_temporada_id));
end $$;

-- Volver a «todos los días»: por CADA combinación que hoy se vende por grupos hay que elegir de qué grupo se
-- toma la tarifa (o null = no se conserva). Sin elegir todas, no se ejecuta. Los grupos quedan preparados
-- (inactivos) con su propuesta, para poder volver a aplicarlos.
create or replace function public.grupos_dias_volver_todos(p_temporada_id bigint, p_huella text, p_elecciones jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; v_hotel bigint; v_nombre text; n_quitadas int; n_nuevas int := 0; e jsonb; v_g uuid;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_elecciones) is distinct from 'array' then
    raise exception 'p_elecciones debe ser una lista.' using errcode = '22023';
  end if;
  cfg := public._grupos_43_bloquear(p_temporada_id, p_huella, true);
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  v_nombre := btrim(cfg->'vigencia'->>'nombre');
  if cfg->>'estado' <> 'activo' then
    raise exception 'La vigencia ya se vende con tarifas de todos los días.' using errcode = '23514';
  end if;
  if (cfg->>'compra_cerrada')::boolean then
    raise exception 'La vigencia "%" tiene la compra cerrada: sus tarifas se conservan y no se cambian.', v_nombre using errcode = '23514';
  end if;
  -- Exactamente una elección por combinación vendida por grupos (ni de más, ni repetida, ni de menos).
  if (select coalesce(jsonb_agg(k order by k), '[]') from (
        select distinct btrim(t.tipo_habitacion) || chr(31) || btrim(t.alimentacion) as k
          from public.tarifa_hotel t where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre and t.grupo_id is not null) a)
     is distinct from
     (select coalesce(jsonb_agg(k order by k), '[]') from (
        select btrim(x->>'tipo_habitacion') || chr(31) || btrim(x->>'alimentacion') as k from jsonb_array_elements(p_elecciones) x) b) then
    raise exception 'Elige, para cada combinación que hoy se vende por grupos, de qué grupo se conserva la tarifa (o ninguno).'
      using errcode = '23514';
  end if;
  for e in select x from jsonb_array_elements(p_elecciones) x loop
    if e ? 'grupo_id' and jsonb_typeof(e->'grupo_id') = 'string' then
      v_g := (e->>'grupo_id')::uuid;
      if not exists (select 1 from public.tarifa_hotel t where t.hotel_id = v_hotel and t.grupo_id = v_g
                       and btrim(coalesce(t.temporada, '')) = v_nombre
                       and btrim(t.tipo_habitacion) = btrim(e->>'tipo_habitacion') and btrim(t.alimentacion) = btrim(e->>'alimentacion')) then
        raise exception 'El grupo elegido para % / % no tiene esa tarifa.', e->>'tipo_habitacion', e->>'alimentacion' using errcode = '23514';
      end if;
    elsif not (e ? 'grupo_id' and jsonb_typeof(e->'grupo_id') = 'null') then
      raise exception 'Cada elección indica un grupo o null (no se conserva).' using errcode = '22023';
    end if;
  end loop;

  perform set_config('app.grupos_43_rpc', 'on', true);
  perform set_config('app.tarifa_motivo', 'grupos_volver_todos', true);
  create temporary table _t43_volver on commit drop as
    select distinct on (btrim(t.tipo_habitacion), btrim(t.alimentacion))
           btrim(t.tipo_habitacion) as tipo_habitacion, btrim(t.alimentacion) as alimentacion,
           t.neto_sencilla, t.neto_doble, t.neto_triple, t.neto_multiple, t.neto_nino, t.neto_nino2, t.neto_infante,
           t.nota_infante, t.notas, t.edad_infante_min, t.edad_infante_max, t.edad_nino_min, t.edad_nino_max
      from public.tarifa_hotel t join jsonb_array_elements(p_elecciones) x
        on jsonb_typeof(x->'grupo_id') = 'string' and t.grupo_id = (x->>'grupo_id')::uuid
       and btrim(t.tipo_habitacion) = btrim(x->>'tipo_habitacion') and btrim(t.alimentacion) = btrim(x->>'alimentacion')
     where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre
     order by btrim(t.tipo_habitacion), btrim(t.alimentacion), t.id desc;
  delete from public.tarifa_hotel t
   where t.hotel_id = v_hotel and btrim(coalesce(t.temporada, '')) = v_nombre and t.grupo_id is not null;
  get diagnostics n_quitadas = row_count;
  update public.hotel_temporada_grupos set activo = false where temporada_id = p_temporada_id and activo;
  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
  select v_hotel, s.tipo_habitacion, s.alimentacion, v_nombre,
         s.neto_sencilla, s.neto_doble, s.neto_triple, s.neto_multiple, s.neto_nino, s.neto_nino2, s.neto_infante, s.nota_infante, s.notas,
         s.edad_infante_min, s.edad_infante_max, s.edad_nino_min, s.edad_nino_max
    from _t43_volver s order by s.tipo_habitacion, s.alimentacion;
  get diagnostics n_nuevas = row_count;
  drop table _t43_volver;
  set constraints public.trg_empates_43 immediate;
  return jsonb_build_object('por_grupo_quitadas', n_quitadas, 'todos_los_dias_nuevas', n_nuevas,
                            'config', public._grupos_43_config(p_temporada_id));
end $$;

-- 295 redefinida: guardar grupos. Igual que antes, salvo que los DÍAS de un grupo que ya se vende no cambian
-- aquí (cambiarían la venta sin revisión). El nombre sí.
create or replace function public.grupos_dias_guardar(p_temporada_id bigint, p_huella text, p_grupos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb; v_id uuid; v_dias smallint[]; v_viejos smallint[]; v_activo boolean;
  n_alta int := 0; n_cambio int := 0; pasada int;
begin
  perform public._grupos_43_autorizar(true);
  if jsonb_typeof(p_grupos) is distinct from 'array' then
    raise exception 'p_grupos debe ser un arreglo.' using errcode = '22023';
  end if;
  perform public._grupos_43_bloquear(p_temporada_id, p_huella, false);
  for pasada in 1..3 loop
    for e in select x from jsonb_array_elements(p_grupos) x loop
      select coalesce(array_agg(d::smallint), '{}') into v_dias from jsonb_array_elements_text(e->'dias') d;
      if e->>'id' is not null then
        v_id := (e->>'id')::uuid;
        select dias, activo into v_viejos, v_activo from public.hotel_temporada_grupos where id = v_id and temporada_id = p_temporada_id;
        if not found then
          raise exception 'El grupo % no pertenece a esta vigencia.', v_id using errcode = '23514';
        end if;
        if v_activo and (select array_agg(d order by d) from unnest(v_dias) d) is distinct from v_viejos then
          raise exception 'Los días del grupo "%" no se cambian mientras se vende. Para cambiarlos, vuelve a «todos los días» o borra el grupo y crea otro.',
            e->>'nombre' using errcode = '23514';
        end if;
        if (pasada = 1 and v_dias <@ v_viejos) or (pasada = 2 and not v_dias <@ v_viejos) then
          update public.hotel_temporada_grupos set nombre = e->>'nombre', dias = v_dias where id = v_id;
          n_cambio := n_cambio + 1;
        end if;
      elsif pasada = 3 then
        insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (p_temporada_id, e->>'nombre', v_dias);
        n_alta := n_alta + 1;
      end if;
    end loop;
  end loop;
  set constraints public.trg_empates_43 immediate;
  return jsonb_build_object('altas', n_alta, 'cambios', n_cambio, 'config', public._grupos_43_config(p_temporada_id));
end $$;

-- 295 redefinida: borrar un grupo. Preparado: el grupo y sus propuestas (como antes). Activo: además sus
-- tarifas a la venta (historial con motivo); no se borra el ÚLTIMO grupo activo (eso es «Volver a todos los
-- días», que exige elegir qué se conserva); con la compra cerrada no se toca.
create or replace function public.grupos_dias_borrar(p_grupo_id uuid, p_huella text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_temporada bigint; v_activo boolean; v_props int; v_tarifas int := 0; cfg jsonb;
begin
  perform public._grupos_43_autorizar(true);
  select temporada_id, activo into v_temporada, v_activo from public.hotel_temporada_grupos where id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  cfg := public._grupos_43_bloquear(v_temporada, p_huella, v_activo);
  if v_activo then
    if (cfg->>'compra_cerrada')::boolean then
      raise exception 'La vigencia tiene la compra cerrada: sus grupos y tarifas se conservan.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.hotel_temporada_grupos g where g.temporada_id = v_temporada and g.activo and g.id <> p_grupo_id) then
      raise exception 'Es el último grupo que se vende en esta vigencia: usa «Volver a todos los días» (eliges qué tarifas se conservan).'
        using errcode = '23514';
    end if;
    perform set_config('app.grupos_43_rpc', 'on', true);
    perform set_config('app.tarifa_motivo', 'grupos_borrar', true);
    delete from public.tarifa_hotel where grupo_id = p_grupo_id;
    get diagnostics v_tarifas = row_count;
  end if;
  delete from public.hotel_grupo_tarifa_propuesta where grupo_id = p_grupo_id;
  get diagnostics v_props = row_count;
  delete from public.hotel_temporada_grupos where id = p_grupo_id;
  set constraints public.trg_empates_43 immediate;
  return jsonb_build_object('propuestas_eliminadas', v_props, 'tarifas_eliminadas', v_tarifas, 'config', public._grupos_43_config(v_temporada));
end $$;

-- 297 redefinida: la calculadora por grupo escribe el BORRADOR también para grupos que ya se venden (antes
-- lo rechazaba); lo vigente no cambia hasta «Aplicar a la venta». Resto idéntico a la 297.
create or replace function public.grupos_dias_guardar_calculadora(
  p_temporada_id bigint, p_huella text, p_grupo_id uuid, p_tipo text,
  p_calc_version bigint, p_bases_version bigint, p_bases jsonb, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r jsonb; cfg jsonb; f jsonb; k text;
  v_hotel bigint; v_temporada bigint;
  v_calc public.hotel_calculadora;
  v_bases public.hotel_calculadora_grupo_bases;
  v_nueva bigint;
  v_campos constant text[] := array['grupo_id','tipo_habitacion','alimentacion',
    'neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante',
    'origen_tarifa_id','nota_infante','notas','edad_infante_min','edad_infante_max','edad_nino_min','edad_nino_max'];
  v_netos constant text[] := array['neto_sencilla','neto_doble','neto_triple','neto_multiple','neto_nino','neto_nino2','neto_infante'];
begin
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
  select g.temporada_id into v_temporada from public.hotel_temporada_grupos g where g.id = p_grupo_id;
  if not found then
    raise exception 'CONFIG_DESACTUALIZADA: el grupo ya no existe. Recarga y revisa de nuevo.' using errcode = 'PT409';
  end if;
  if v_temporada <> p_temporada_id then
    raise exception 'El grupo no pertenece a esta vigencia.' using errcode = '23514';
  end if;

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

  r := public.grupos_dias_guardar_propuesta(p_temporada_id, p_huella, 'actualizar', p_grupo_id, p_filas);
  cfg := r->'config';
  v_hotel := (cfg->'vigencia'->>'hotel_id')::bigint;
  perform public._calc_grupos_43_validar_bases(p_tipo, p_bases, cfg->'categorias', cfg->'regimenes');

  if exists (select 1 from public.hotel_temporadas t
              where t.hotel_id = v_hotel and btrim(t.nombre) = btrim(cfg->'vigencia'->>'nombre')
              group by btrim(t.nombre)
              having bool_and(t.compra_fin is not null and t.compra_fin < public.fecha_negocio())) then
    raise exception 'La vigencia "%" tiene la compra cerrada: no se calcula ni se guarda por grupo.', cfg->'vigencia'->>'nombre' using errcode = '23514';
  end if;

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

-- 237 redefinida: generación de la calculadora GENERAL. Idéntica, más: las vigencias con grupos activos
-- (y las promociones calculadas desde ellas, por `temporada_base`) se conservan como las de compra cerrada:
-- una fila del lote para ellas se rechaza, y «Reemplazar todo» no las borra.
CREATE OR REPLACE FUNCTION public.generar_tarifas_hotel_calculadora(p_hotel_id bigint, p_filas jsonb, p_previas jsonb, p_reemplazar_todo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hoy         date := public.fecha_negocio();
  v_protegidas  text[];
  v_con_grupos  text[];
  v_promos_pct  text[];
  v_tipo_calc   text;
  v_claves      text[];
  v_fila        jsonb;
  v_hotel_fila  bigint;
  v_choque      text;
  v_borradas    integer;
  v_insertadas  integer := 0;
  v_motivo      text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''),
                                 case when p_reemplazar_todo then 'calculadora_reemplazar_todo' else 'calculadora_generar' end);
  v_recargar    constant text := 'Recarga la página y vuelve a revisar la vista previa antes de generar.';
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'generar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
  if p_hotel_id is null then
    raise exception 'generar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;
  if v_motivo not in ('calculadora_generar', 'calculadora_reemplazar_todo', 'calculadora_sustituir_manual') then
    raise exception 'generar_tarifas_hotel_calculadora: motivo no permitido: %', v_motivo;
  end if;
  if p_reemplazar_todo and v_motivo <> 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: reemplazar todo solo admite el motivo calculadora_reemplazar_todo';
  end if;
  if not p_reemplazar_todo and v_motivo = 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: el motivo calculadora_reemplazar_todo exige p_reemplazar_todo';
  end if;
  if p_previas is null or jsonb_typeof(p_previas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: falta la foto de las tarifas cargadas (p_previas). %', v_recargar;
  end if;
  if not exists (select 1 from public.hoteles where id = p_hotel_id) then
    raise exception 'generar_tarifas_hotel_calculadora: el hotel % no existe', p_hotel_id;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'generar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'hotel_id' and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception when others then
        raise exception 'generar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %', v_fila->>'hotel_id';
      end;
      if v_hotel_fila <> p_hotel_id then
        raise exception 'generar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)', v_hotel_fila, p_hotel_id;
      end if;
    end if;
    if coalesce(btrim(v_fila->>'tipo_habitacion'), '') = ''
       or coalesce(btrim(v_fila->>'alimentacion'), '') = ''
       or coalesce(btrim(v_fila->>'temporada'), '') = '' then
      raise exception 'generar_tarifas_hotel_calculadora: cada fila necesita categoría, régimen y temporada';
    end if;
  end loop;

  select k into v_choque
  from (
    select btrim(f->>'tipo_habitacion') || ' / ' || btrim(f->>'alimentacion') || ' / ' || btrim(f->>'temporada') as k
    from jsonb_array_elements(p_filas) f
  ) x
  group by k having count(*) > 1
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la combinación % viene repetida en el lote', v_choque;
  end if;

  perform 1 from public.hoteles where id = p_hotel_id for update;
  perform 1 from public.hotel_temporadas where hotel_id = p_hotel_id for share;
  perform 1 from public.tarifa_hotel where hotel_id = p_hotel_id for update;

  select coalesce(array_agg(nombre), '{}') into v_protegidas
  from (
    select btrim(nombre) as nombre
    from public.hotel_temporadas
    where hotel_id = p_hotel_id and nombre is not null
    group by btrim(nombre)
    having bool_and(compra_fin is not null and compra_fin < v_hoy)
  ) p;

  -- #43/#60 (299): vigencias que se venden por grupos de días.
  select coalesce(array_agg(distinct btrim(t.nombre)), '{}') into v_con_grupos
    from public.hotel_temporadas t join public.hotel_temporada_grupos g on g.temporada_id = t.id and g.activo
   where t.hotel_id = p_hotel_id;

  select btrim(f->>'temporada') into v_choque
  from jsonb_array_elements(p_filas) f
  where btrim(f->>'temporada') = any(v_protegidas)
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la vigencia "%" tiene la compra cerrada; sus tarifas se conservan y no se regeneran', v_choque;
  end if;

  select btrim(f->>'temporada') into v_choque
  from jsonb_array_elements(p_filas) f
  where btrim(f->>'temporada') = any(v_con_grupos) or btrim(coalesce(f->>'temporada_base', '')) = any(v_con_grupos)
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la vigencia "%" se vende por grupos de días (o se calcula desde una que se vende así); sus tarifas se cambian desde «Calcular para» el grupo y se aplican desde «Grupos de días». %', v_choque, v_recargar;
  end if;

  select array_agg(distinct public._tarifa_clave(f)) into v_claves from jsonb_array_elements(p_filas) f;
  if p_reemplazar_todo then
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t where t.hotel_id = p_hotel_id))
       <> public._tarifa_huella(p_previas) then
      raise exception 'generar_tarifas_hotel_calculadora: las tarifas del hotel cambiaron después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  else
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t
                              where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)))
       <> public._tarifa_huella((select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(p_previas) f
                                 where public._tarifa_clave(f) = any(v_claves))) then
      raise exception 'generar_tarifas_hotel_calculadora: alguna de las tarifas que se iban a escribir cambió después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  end if;

  select tipo into v_tipo_calc from public.hotel_calculadora where hotel_id = p_hotel_id;
  select coalesce(array_agg(distinct btrim(nombre)), '{}') into v_promos_pct
  from public.hotel_temporadas where hotel_id = p_hotel_id and tipo = 'descuento_pct' and nombre is not null;

  if v_motivo = 'calculadora_sustituir_manual' then
    v_fila := p_filas -> 0;
    if jsonb_array_length(p_filas) <> 1 then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir reemplaza UNA sola fila por llamada';
    end if;
    if coalesce(v_tipo_calc, '') <> 'mixta' or not (btrim(v_fila->>'temporada') = any(v_promos_pct)) then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir solo aplica a una promoción %% de un hotel con calculadora Mixta';
    end if;
    if not coalesce((v_fila->>'precio_final_autoritativo')::boolean, false)
       or not exists (select 1 from public.hotel_temporadas t
                      where t.hotel_id = p_hotel_id and btrim(t.nombre) = btrim(coalesce(v_fila->>'temporada_base', ''))
                        and coalesce(t.tipo, 'tarifa') = 'tarifa') then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir exige una fila marcada como precio final y con temporada_base en una vigencia ''tarifa'' del hotel';
    end if;
    if not exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves))
       or exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)
                  and coalesce(t.precio_final_autoritativo, false)) then
      raise exception 'generar_tarifas_hotel_calculadora: no hay una promoción escrita a mano que sustituir en esa celda; usa "Generar"';
    end if;
  else
    select btrim(t.temporada) || ' · ' || btrim(t.tipo_habitacion) || ' · ' || btrim(t.alimentacion) into v_choque
    from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and coalesce(v_tipo_calc, '') = 'mixta'
      and not coalesce(t.precio_final_autoritativo, false)
      and btrim(t.temporada) = any(v_promos_pct)
      and case when p_reemplazar_todo
               then not (btrim(t.temporada) = any(v_protegidas))
                    and not (btrim(coalesce(t.temporada_base, '')) = any(v_con_grupos))
               else public._tarifa_clave(to_jsonb(t)) = any(v_claves) end
    limit 1;
    if v_choque is not null then
      raise exception 'generar_tarifas_hotel_calculadora: % es una promoción escrita a mano; no se sobrescribe al generar. Sustitúyela celda por celda o déjala como está. %', v_choque, v_recargar;
    end if;
  end if;

  perform set_config('app.tarifa_motivo', v_motivo, true);

  if p_reemplazar_todo then
    delete from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and (t.temporada is null or not (btrim(t.temporada) = any(v_protegidas)))
      and t.grupo_id is null
      and not (btrim(coalesce(t.temporada, '')) = any(v_con_grupos))
      and not (btrim(coalesce(t.temporada_base, '')) = any(v_con_grupos));
  else
    delete from public.tarifa_hotel t
    using (
      select distinct btrim(f->>'tipo_habitacion') as tipo, btrim(f->>'alimentacion') as alim, btrim(f->>'temporada') as temp
      from jsonb_array_elements(p_filas) f
    ) k
    where t.hotel_id = p_hotel_id
      and t.grupo_id is null
      and btrim(t.tipo_habitacion) = k.tipo
      and btrim(t.alimentacion) = k.alim
      and btrim(t.temporada) = k.temp;
  end if;
  get diagnostics v_borradas = row_count;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    insert into public.tarifa_hotel (
      hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple,
      neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
      precio_final_autoritativo, temporada_base
    ) values (
      p_hotel_id,
      btrim(v_fila->>'tipo_habitacion'),
      btrim(v_fila->>'alimentacion'),
      btrim(v_fila->>'temporada'),
      (v_fila->>'neto_sencilla')::numeric,
      (v_fila->>'neto_doble')::numeric,
      (v_fila->>'neto_triple')::numeric,
      (v_fila->>'neto_multiple')::numeric,
      (v_fila->>'neto_nino')::numeric,
      (v_fila->>'neto_nino2')::numeric,
      (v_fila->>'neto_infante')::numeric,
      v_fila->>'nota_infante',
      v_fila->>'notas',
      (v_fila->>'edad_infante_min')::integer,
      (v_fila->>'edad_infante_max')::integer,
      (v_fila->>'edad_nino_min')::integer,
      (v_fila->>'edad_nino_max')::integer,
      coalesce((v_fila->>'precio_final_autoritativo')::boolean, false),
      v_fila->>'temporada_base'
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  return jsonb_build_object(
    'borradas', v_borradas,
    'insertadas', v_insertadas,
    'protegidas', to_jsonb(v_protegidas),
    'con_grupos', to_jsonb(v_con_grupos)
  );
end;
$function$;

-- 6) Permisos de las RPC ------------------------------------------------------------------
revoke all on function public.grupos_dias_alcance(bigint) from public, anon;
revoke all on function public.grupos_dias_activar(bigint, text, jsonb) from public, anon;
revoke all on function public.grupos_dias_descartar(bigint, text) from public, anon;
revoke all on function public.grupos_dias_volver_todos(bigint, text, jsonb) from public, anon;
revoke all on function public.grupos_dias_guardar(bigint, text, jsonb) from public, anon;
revoke all on function public.grupos_dias_borrar(uuid, text) from public, anon;
revoke all on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.grupos_dias_alcance(bigint) to authenticated;
grant execute on function public.grupos_dias_activar(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_descartar(bigint, text) to authenticated;
grant execute on function public.grupos_dias_volver_todos(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_guardar(bigint, text, jsonb) to authenticated;
grant execute on function public.grupos_dias_borrar(uuid, text) to authenticated;
grant execute on function public.grupos_dias_guardar_calculadora(bigint, text, uuid, text, bigint, bigint, jsonb, jsonb) to authenticated;

commit;
