-- 262 · Servicios/traslados: tipo de receptivo, precio propio por trayecto (un trayecto / ida y regreso) y suplementos por rango de pasajeros.
-- NÚMERO PROVISIONAL: 257 está reservada para B2B y no hay rama visible con 260/261 al momento de escribirla; confirmar antes de aplicar (ver docs/tecnico/traslados-tipo-alcance-262.md).
--
-- ADITIVA: no modifica ni borra ninguna tarifa, vigencia, franja, servicio ni contrato existente, y NO clasifica automáticamente ningún servicio antiguo.
--
-- 1) servicios_adicionales.tipo_receptivo ('tour' | 'traslado' | 'asistencia_medica' | 'combo'). NULL = sin clasificar (todo servicio existente queda así: el dato
--    legado no acredita el tipo; `categoria` mezcla «tour_traslado»). Un combo DEBE declarar si contiene traslado (`combo_incluye_traslado`) y, si lo contiene,
--    cómo se cobra ese componente (`combo_traslado_alcance`: trayecto_llegada | trayecto_salida | ida_regreso).
-- 2) servicio_precio_alcance: precio PROPIO por (vigencia, alcance, rango de pasajeros). alcance = 'trayecto' (un solo sentido) o 'ida_regreso'. Cada uno es una fila
--    independiente que se carga a mano: ninguno se deriva del otro (ni mitad ni doble). Sin pax_desde/pax_hasta = precio por persona; con ellos = rango de grupo.
--    Los rangos de un mismo (vigencia, alcance) no pueden cruzarse (trigger, serializado por vigencia).
-- 3) servicio_suplementos_franja.pax_desde/pax_hasta: la franja puede tener un importe por rango de pasajeros (45.000 para 1–4, 80.000 para 5–12…). NULL/NULL = todos.
--    Se reemplaza el trigger de solape de la 255: dos franjas chocan solo si comparten tramo, hora Y algún número de pasajeros.
-- 4) contrato_servicios.alcance_traslado: lo que se VENDIÓ (llegada | salida | ida_regreso), para que el contrato/CxP lo conserve.
--
-- Preflight: supabase/scripts/preflight_262_*.sql · Postcheck: postcheck_262_*.sql · Rollback: rollback_262_*.sql · Inventario: inventario_262_*.sql (solo lectura).
begin;

do $$
begin
  if to_regclass('public.servicios_adicionales') is null then raise exception '262 ABORTADA: falta public.servicios_adicionales.'; end if;
  if to_regclass('public.servicio_temporadas') is null then raise exception '262 ABORTADA: falta public.servicio_temporadas (089).'; end if;
  if to_regclass('public.servicio_suplementos_franja') is null then raise exception '262 ABORTADA: falta public.servicio_suplementos_franja (255 sin aplicar).'; end if;
  if to_regclass('public.contrato_servicios') is null then raise exception '262 ABORTADA: falta public.contrato_servicios (115).'; end if;
  if to_regprocedure('public.fn_franja_minutos(text)') is null or to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is null then
    raise exception '262 ABORTADA: faltan las funciones de franja de la 255.';
  end if;
  if to_regprocedure('public.mi_rol()') is null then raise exception '262 ABORTADA: falta public.mi_rol().'; end if;
end $$;

-- ── 0. Guardia de huellas exactas ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ANTES de tocar nada se compara la huella exacta de cada objeto que esta migración usa o reemplaza con la definición auditada (255 o 262). Si CUALQUIER objeto fue
-- modificado por otra vía (cuerpo de una función de franja, trigger, columna, restricción, índice, policy o permisos), la migración ABORTA sin cambiar nada: no pisa
-- trabajo ajeno. La huella de una función normaliza solo los \r (fin de línea de Windows) y cubre cuerpo, search_path, SECURITY, volatilidad, lenguaje y firma.
-- Los objetos de la 262 que aún no existen no se comparan (los crea esta migración). Huellas observadas: supabase/scripts/huellas_262_lectura.sql.
do $guardia$
declare
  v_desviaciones text;
begin
  with obs as (
    select 'fn:' || p.proname as etiqueta,
           md5(replace(p.prosrc, E'\r', '') || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || l.lanname || '|' || pg_get_function_result(p.oid) || '|' || pg_get_function_arguments(p.oid)) as huella
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('fn_franja_minutos', 'fn_franja_contiene', 'tg_servicio_suplementos_franja_solape', 'tg_servicio_precio_alcance_solape')
    union all
    select 'trg:' || t.tgname, md5(regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g') || '|' || t.tgenabled::text)
      from pg_trigger t
     where not t.tgisinternal and t.tgname in ('servicio_suplementos_franja_solape', 'servicio_precio_alcance_solape')
    union all
    select 'chk:' || c.conname, md5(pg_get_constraintdef(c.oid) || '|' || c.convalidated::text)
      from pg_constraint c
     where c.conname in ('servicios_adicionales_tipo_receptivo_chk', 'servicios_adicionales_combo_chk', 'servicio_suplementos_franja_pax_chk', 'contrato_servicios_alcance_traslado_chk',
                         'servicio_precio_alcance_alcance_chk', 'servicio_precio_alcance_precio_chk', 'servicio_precio_alcance_pax_chk')
    union all
    select 'idx:' || i.indexname, md5(i.indexdef)
      from pg_indexes i
     where i.schemaname = 'public' and i.indexname in ('idx_servicio_precio_alcance_vigencia', 'uq_servicio_precio_alcance_persona')
    union all
    select 'pol:' || p.policyname, md5(p.cmd || '|' || p.roles::text || '|' || regexp_replace(coalesce(p.qual, ''), '::[a-zA-Z_]+', '', 'g') || '|' || regexp_replace(coalesce(p.with_check, ''), '::[a-zA-Z_]+', '', 'g'))
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'servicio_precio_alcance'
    union all
    select 'tabla:servicio_precio_alcance', md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable, ',' order by c.ordinal_position) || '|rls=' || (select relrowsecurity::text from pg_class where oid = to_regclass('public.servicio_precio_alcance')))
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'servicio_precio_alcance'
     having count(*) > 0
    union all
    select 'col:' || c.table_name || '.' || c.column_name, md5(c.data_type || ':' || c.is_nullable)
      from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (('servicios_adicionales', 'tipo_receptivo'), ('servicios_adicionales', 'combo_incluye_traslado'), ('servicios_adicionales', 'combo_traslado_alcance'),
                                             ('servicio_suplementos_franja', 'pax_desde'), ('servicio_suplementos_franja', 'pax_hasta'), ('contrato_servicios', 'alcance_traslado'))
    union all
    select 'priv:' || r.rolname,
           md5(coalesce((select string_agg(pr, ',' order by pr) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
                          where has_table_privilege(r.rolname, 'public.servicio_precio_alcance', pr)), ''))
      from pg_roles r
     where r.rolname in ('anon', 'authenticated')
       and to_regclass('public.servicio_precio_alcance') is not null
  ), esp(etiqueta, h255, h262) as (values
    ('chk:contrato_servicios_alcance_traslado_chk', null::text, 'b83b2fa4d0bb4a0f4c49c3a961ab0ed6'),
    ('chk:servicio_precio_alcance_alcance_chk', null::text, 'fd712e764143ba224b13530561813eb1'),
    ('chk:servicio_precio_alcance_pax_chk', null::text, 'e7643bce326e9bedde63da7bbdd8ddef'),
    ('chk:servicio_precio_alcance_precio_chk', null::text, '21fc79794e92c24f7cac451af1f358ac'),
    ('chk:servicio_suplementos_franja_pax_chk', null::text, 'e7643bce326e9bedde63da7bbdd8ddef'),
    ('chk:servicios_adicionales_combo_chk', null::text, '0910ccdcf4b86532f41a4170f19f4cad'),
    ('chk:servicios_adicionales_tipo_receptivo_chk', null::text, '287963a61189e468050a21ea57f3784f'),
    ('col:contrato_servicios.alcance_traslado', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('col:servicio_suplementos_franja.pax_desde', null::text, 'ca679b4f8cf32993811c8aed0edab813'),
    ('col:servicio_suplementos_franja.pax_hasta', null::text, 'ca679b4f8cf32993811c8aed0edab813'),
    ('col:servicios_adicionales.combo_incluye_traslado', null::text, '68e8c734465ffd79278adaf1664e7f12'),
    ('col:servicios_adicionales.combo_traslado_alcance', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('col:servicios_adicionales.tipo_receptivo', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('fn:fn_franja_contiene', '24c0e8eda66132a040a426b9e03cb8cd', '24c0e8eda66132a040a426b9e03cb8cd'),
    ('fn:fn_franja_minutos', 'f0fc00b74485bf4524e3632ee6175b2b', 'f0fc00b74485bf4524e3632ee6175b2b'),
    ('fn:tg_servicio_precio_alcance_solape', null::text, '2b642c886a9ec8146f5c86266e8df7c6'),
    ('fn:tg_servicio_suplementos_franja_solape', '407aa56cef19b73b87f6896372e99529', '1f9536dad969c3f11dec4856d9f990a5'),
    ('idx:idx_servicio_precio_alcance_vigencia', null::text, '1518ba12483f8876742509e019e5b4ca'),
    ('idx:uq_servicio_precio_alcance_persona', null::text, '339020471b3e6b4c5e99ce5e47b341c0'),
    ('pol:servicio_precio_alcance: interno', null::text, '0cfc67ef775caedf4d5f3fabbcb7d7ca'),
    ('priv:anon', null::text, 'd41d8cd98f00b204e9800998ecf8427e'),
    ('priv:authenticated', null::text, '7aff36d98ea5480f97820ca45d87a51c'),
    ('tabla:servicio_precio_alcance', null::text, '110cec16ebae5246e84f7974cc9ab251'),
    ('trg:servicio_precio_alcance_solape', null::text, 'd5186437ebdf388df2d0bbd8b5e51f01'),
    ('trg:servicio_suplementos_franja_solape', '21a801aab4b043fa809dcdb7b8e90517', '21a801aab4b043fa809dcdb7b8e90517')
  )
  select string_agg(format('%s [observada %s; auditadas %s]', o.etiqueta, o.huella, concat_ws(' o ', e.h255, e.h262)), E'\n  ' order by o.etiqueta)
    into v_desviaciones
    from obs o join esp e on e.etiqueta = o.etiqueta
   where o.huella is distinct from e.h255 and o.huella is distinct from e.h262;
  if v_desviaciones is not null then
    raise exception E'262 ABORTADA SIN MODIFICAR NADA: hay objetos con una definición distinta de la auditada (255/262):\n  %\nRevisa quién los cambió; no se pisan.', v_desviaciones;
  end if;
end
$guardia$;

-- ── 1. Tipo de receptivo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.servicios_adicionales
  add column if not exists tipo_receptivo text,
  add column if not exists combo_incluye_traslado boolean,
  add column if not exists combo_traslado_alcance text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.servicios_adicionales'::regclass and conname = 'servicios_adicionales_tipo_receptivo_chk') then
    alter table public.servicios_adicionales add constraint servicios_adicionales_tipo_receptivo_chk
      check (tipo_receptivo is null or tipo_receptivo in ('tour', 'traslado', 'asistencia_medica', 'combo'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.servicios_adicionales'::regclass and conname = 'servicios_adicionales_combo_chk') then
    alter table public.servicios_adicionales add constraint servicios_adicionales_combo_chk check (
      -- solo un combo declara si lleva traslado
      (tipo_receptivo = 'combo' or (combo_incluye_traslado is null and combo_traslado_alcance is null))
      -- un combo DEBE declararlo (sí o no)
      and (tipo_receptivo is distinct from 'combo' or combo_incluye_traslado is not null)
      -- con traslado: cómo se cobra ese componente; sin traslado: nada que declarar
      and (combo_incluye_traslado is not true or coalesce(combo_traslado_alcance in ('trayecto_llegada', 'trayecto_salida', 'ida_regreso'), false))
      and (combo_incluye_traslado is true or combo_traslado_alcance is null)
    );
  end if;
end $$;

comment on column public.servicios_adicionales.tipo_receptivo is
  'tour | traslado | asistencia_medica | combo (262). NULL = sin clasificar: el dato anterior no acredita el tipo y NO se asigna automáticamente.';
comment on column public.servicios_adicionales.combo_incluye_traslado is 'Solo combos (262): ¿contiene un traslado? Obligatorio declararlo.';
comment on column public.servicios_adicionales.combo_traslado_alcance is 'Solo combos con traslado (262): trayecto_llegada | trayecto_salida | ida_regreso — cómo se cobra ese componente.';

-- ── 2. Precio propio por trayecto y rango de pasajeros ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.servicio_precio_alcance (
  id                    bigserial primary key,
  servicio_temporada_id bigint not null references public.servicio_temporadas(id) on delete cascade,
  alcance               text   not null,
  pax_desde             integer,
  pax_hasta             integer,
  precio                numeric(15,2) not null,
  created_at            timestamptz not null default now(),
  constraint servicio_precio_alcance_alcance_chk check (alcance in ('trayecto', 'ida_regreso')),
  constraint servicio_precio_alcance_precio_chk check (precio >= 0),
  constraint servicio_precio_alcance_pax_chk check (
    (pax_desde is null) = (pax_hasta is null)
    and (pax_desde is null or (pax_desde >= 1 and pax_hasta >= pax_desde))
  )
);
create index if not exists idx_servicio_precio_alcance_vigencia on public.servicio_precio_alcance(servicio_temporada_id, alcance);
-- Un solo precio POR PERSONA por (vigencia, alcance).
create unique index if not exists uq_servicio_precio_alcance_persona
  on public.servicio_precio_alcance(servicio_temporada_id, alcance) where pax_desde is null;

create or replace function public.tg_servicio_precio_alcance_solape()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_otro record;
begin
  if new.pax_desde is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('servicio_precio_alcance:' || new.servicio_temporada_id::text, 0));
  for v_otro in
    select pax_desde, pax_hasta from public.servicio_precio_alcance
     where servicio_temporada_id = new.servicio_temporada_id and alcance = new.alcance
       and pax_desde is not null and id is distinct from new.id
  loop
    if new.pax_desde <= v_otro.pax_hasta and v_otro.pax_desde <= new.pax_hasta then
      raise exception 'El rango % a % pax (%) se cruza con el rango % a % de la misma vigencia.', new.pax_desde, new.pax_hasta, new.alcance, v_otro.pax_desde, v_otro.pax_hasta
        using errcode = '23P01';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists servicio_precio_alcance_solape on public.servicio_precio_alcance;
create trigger servicio_precio_alcance_solape
  before insert or update on public.servicio_precio_alcance
  for each row execute function public.tg_servicio_precio_alcance_solape();

alter table public.servicio_precio_alcance enable row level security;
drop policy if exists "servicio_precio_alcance: interno" on public.servicio_precio_alcance;
create policy "servicio_precio_alcance: interno" on public.servicio_precio_alcance for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
-- Permisos EFECTIVOS: Supabase concede por defecto todo (incluidos TRUNCATE, REFERENCES y TRIGGER, que saltan la RLS) a anon y authenticated en tablas nuevas.
-- Se retira todo y a authenticated solo se le dan las 4 operaciones que gobierna la policy (RLS); anon queda sin nada; service_role conserva lo suyo.
revoke all on public.servicio_precio_alcance from public, anon, authenticated;
grant select, insert, update, delete on public.servicio_precio_alcance to authenticated;
revoke all on sequence public.servicio_precio_alcance_id_seq from public, anon, authenticated;
grant usage, select on sequence public.servicio_precio_alcance_id_seq to authenticated;
revoke all on function public.tg_servicio_precio_alcance_solape() from public, anon, authenticated;

comment on table public.servicio_precio_alcance is
  'Precio neto PROPIO de un traslado por (vigencia, alcance, rango de pasajeros) (262). alcance trayecto = un sentido; ida_regreso = ambos. Se cargan por separado: nunca se deriva uno del otro. Sin pax = por persona.';

-- ── 3. Suplementos por rango de pasajeros ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.servicio_suplementos_franja
  add column if not exists pax_desde integer,
  add column if not exists pax_hasta integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.servicio_suplementos_franja'::regclass and conname = 'servicio_suplementos_franja_pax_chk') then
    alter table public.servicio_suplementos_franja add constraint servicio_suplementos_franja_pax_chk
      check ((pax_desde is null) = (pax_hasta is null) and (pax_desde is null or (pax_desde >= 1 and pax_hasta >= pax_desde)));
  end if;
end $$;

-- Reemplaza el trigger de la 255: ahora también exige que compartan algún número de pasajeros (NULL = todos).
create or replace function public.tg_servicio_suplementos_franja_solape()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_d1 integer := public.fn_franja_minutos(new.hora_desde);
  v_h1 integer := public.fn_franja_minutos(new.hora_hasta);
  v_p1d integer := coalesce(new.pax_desde, 1);
  v_p1h integer := coalesce(new.pax_hasta, 2147483647);
  v_otra record;
begin
  perform pg_advisory_xact_lock(hashtextextended('servicio_suplementos_franja:' || new.servicio_temporada_id::text, 0));
  for v_otra in
    select id, hora_desde, hora_hasta, tramo, pax_desde, pax_hasta
      from public.servicio_suplementos_franja
     where servicio_temporada_id = new.servicio_temporada_id
       and id is distinct from new.id
       and (tramo = 'ambos' or new.tramo = 'ambos' or tramo = new.tramo)
       and v_p1d <= coalesce(pax_hasta, 2147483647) and coalesce(pax_desde, 1) <= v_p1h
  loop
    if public.fn_franja_contiene(public.fn_franja_minutos(v_otra.hora_desde), v_d1, v_h1)
       or public.fn_franja_contiene(v_d1, public.fn_franja_minutos(v_otra.hora_desde), public.fn_franja_minutos(v_otra.hora_hasta)) then
      raise exception 'La franja % a % (%) se solapa con la franja % a % (%) de la misma vigencia para algún número de pasajeros.',
        new.hora_desde, new.hora_hasta, new.tramo, v_otra.hora_desde, v_otra.hora_hasta, v_otra.tramo
        using errcode = '23P01';
    end if;
  end loop;
  return new;
end;
$$;

comment on column public.servicio_suplementos_franja.pax_desde is 'Rango de pasajeros al que aplica el importe (262). NULL/NULL = todos.';

-- ── 4. Lo vendido ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.contrato_servicios add column if not exists alcance_traslado text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.contrato_servicios'::regclass and conname = 'contrato_servicios_alcance_traslado_chk') then
    alter table public.contrato_servicios add constraint contrato_servicios_alcance_traslado_chk
      check (alcance_traslado is null or alcance_traslado in ('llegada', 'salida', 'ida_regreso'));
  end if;
end $$;
comment on column public.contrato_servicios.alcance_traslado is 'Trayecto vendido de un traslado (262): llegada | salida | ida_regreso. NULL = no aplica o contrato anterior.';

commit;
