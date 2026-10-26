-- ═════════════════════════════════════════════════════════════════════════
-- Migración 244 (#88): programas terrestres por HOTEL y VIGENCIA, con NOCHES
-- ADICIONALES.
--
-- ADITIVA e IDEMPOTENTE. No toca ninguna tabla ni función existente: los modos
-- de precio de siempre (`categoria`, `salida`) quedan EXACTAMENTE igual. Un
-- programa solo entra en la modalidad nueva cuando se le asigna
-- `programas.modo_precio = 'hotel'` (la columna ya existe desde la 068 y no
-- tiene CHECK, así que no se modifica).
--
-- Catálogo (por programa):
--   · programa_hoteles          hotel + zona, tipo de habitación y ocupación permitida
--                               (+ proveedor propio opcional; null = el del programa).
--   · programa_hotel_precios    PRECIO BASE: neto POR PERSONA para TODA la estancia
--                               incluida, por hotel × vigencia (se decide por la fecha
--                               de ENTRADA) × modalidad de servicios (privado | regular).
--   · programa_hotel_noches     TARIFA DE NOCHE ADICIONAL: neta, por hotel × vigencia (la
--                               de la fecha de CADA noche) × acomodación, con su UNIDAD de
--                               cobro (persona | habitación) declarada expresamente, sin
--                               valor por defecto. Es la misma para privados y regulares.
--   · guardar_programa_hoteles  reemplazo ATÓMICO del catálogo (conserva los ids de los
--                               hoteles) y rechaza vigencias solapadas.
--
-- Contrato (la reserva congela lo usado; NUNCA se recalcula un contrato histórico):
--   · contrato_programa_estancia        selección, fechas, vigencias, PVP por noche e
--                                       itinerario desplazado. SIN netos: lo lee quien ve el contrato.
--   · contrato_programa_estancia_costo  netos y CxP de la estancia. Solo roles contables.
--   Ninguna de las dos admite escritura desde el navegador: la hace únicamente la Server
--   Action de reserva con la clave de servicio, tras autorizar.
--
-- Seguridad: los netos del proveedor NO se publican. Las tablas del catálogo solo las lee
-- y escribe personal interno de producto/contabilidad; la ficha pública y el formulario
-- reciben PVP calculado en el servidor (nunca un neto).
-- No toca programas ya reservados ni ventas existentes.
-- ═════════════════════════════════════════════════════════════════════════
begin;

-- ── Hoteles del programa ───────────────────────────────────────────────────
create table if not exists public.programa_hoteles (
  id                     bigserial primary key,
  programa_id            bigint not null references public.programas(id) on delete cascade,
  orden                  integer not null default 0,
  nombre                 text not null,
  zona                   text,
  tipo_habitacion        text,
  max_pax_habitacion     integer,
  max_menores_habitacion integer,
  proveedor_id           bigint references public.proveedores(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint programa_hoteles_nombre_check check (char_length(btrim(nombre)) between 1 and 200),
  constraint programa_hoteles_max_pax_check check (max_pax_habitacion is null or max_pax_habitacion >= 1),
  constraint programa_hoteles_max_menores_check check (max_menores_habitacion is null or max_menores_habitacion >= 0)
);
create unique index if not exists uq_programa_hoteles_nombre
  on public.programa_hoteles (programa_id, lower(btrim(nombre)));
create index if not exists idx_programa_hoteles_programa on public.programa_hoteles (programa_id, orden);

-- ── Precio base (estancia incluida) ────────────────────────────────────────
create table if not exists public.programa_hotel_precios (
  id                 bigserial primary key,
  hotel_id           bigint not null references public.programa_hoteles(id) on delete cascade,
  desde              date not null,
  hasta              date not null,
  modalidad_servicios text not null,
  bajo_solicitud     boolean not null default false,
  neto_sencilla      numeric(15,2),
  neto_doble         numeric(15,2),
  neto_triple        numeric(15,2),
  neto_multiple      numeric(15,2),
  neto_nino          numeric(15,2),
  constraint programa_hotel_precios_vigencia_check check (desde <= hasta),
  constraint programa_hotel_precios_modalidad_check check (modalidad_servicios in ('privado', 'regular')),
  constraint programa_hotel_precios_netos_check check (
    (neto_sencilla is null or (neto_sencilla >= 0 and neto_sencilla < 1e13))
    and (neto_doble is null or (neto_doble >= 0 and neto_doble < 1e13))
    and (neto_triple is null or (neto_triple >= 0 and neto_triple < 1e13))
    and (neto_multiple is null or (neto_multiple >= 0 and neto_multiple < 1e13))
    and (neto_nino is null or (neto_nino >= 0 and neto_nino < 1e13))
  )
);
create index if not exists idx_programa_hotel_precios_hotel on public.programa_hotel_precios (hotel_id, modalidad_servicios, desde);

-- ── Tarifa de noche adicional ──────────────────────────────────────────────
-- `unidad_cobro` NOT NULL y sin DEFAULT: cada tarifa declara si el proveedor la
-- cobra por persona o por habitación. `neto_nino` solo se exige y se usa cuando la
-- unidad es «persona» (null = el menor no tiene tarifa adicional y la selección no
-- se cotiza; 0 = gratis declarado). Con unidad «habitación» el menor va INCLUIDO en
-- la habitación: no suma suplemento hotelero, solo paga la asistencia médica, y un
-- `neto_nino` cargado se ignora.
create table if not exists public.programa_hotel_noches (
  id             bigserial primary key,
  hotel_id       bigint not null references public.programa_hoteles(id) on delete cascade,
  desde          date not null,
  hasta          date not null,
  unidad_cobro   text not null,
  neto_sencilla  numeric(15,2),
  neto_doble     numeric(15,2),
  neto_triple    numeric(15,2),
  neto_multiple  numeric(15,2),
  neto_nino      numeric(15,2),
  constraint programa_hotel_noches_vigencia_check check (desde <= hasta),
  constraint programa_hotel_noches_unidad_check check (unidad_cobro in ('persona', 'habitacion')),
  constraint programa_hotel_noches_netos_check check (
    (neto_sencilla is null or (neto_sencilla >= 0 and neto_sencilla < 1e13))
    and (neto_doble is null or (neto_doble >= 0 and neto_doble < 1e13))
    and (neto_triple is null or (neto_triple >= 0 and neto_triple < 1e13))
    and (neto_multiple is null or (neto_multiple >= 0 and neto_multiple < 1e13))
    and (neto_nino is null or (neto_nino >= 0 and neto_nino < 1e13))
  ),
  constraint programa_hotel_noches_alguno_check check (
    neto_sencilla is not null or neto_doble is not null or neto_triple is not null
    or neto_multiple is not null or neto_nino is not null
  )
);
create index if not exists idx_programa_hotel_noches_hotel on public.programa_hotel_noches (hotel_id, desde);

comment on table public.programa_hoteles is
  '#88: hoteles de un programa con modo_precio = hotel. Zona, tipo de habitación y ocupación permitida; proveedor_id null = el del programa.';
comment on table public.programa_hotel_precios is
  '#88: precio BASE neto por persona para toda la estancia incluida, por hotel × vigencia de la fecha de ENTRADA × modalidad de servicios. Nunca se publica un neto.';
comment on table public.programa_hotel_noches is
  '#88: tarifa NETA de noche adicional por hotel × vigencia de la fecha de cada noche × acomodación, con la unidad de cobro del proveedor (persona | habitación). neto_nino solo aplica con unidad persona (tarifa explícita del menor; null = no se cotiza con menores); con unidad habitación el menor va incluido y solo paga la asistencia.';

-- ── RLS: solo personal interno de producto/contabilidad ─────────────────────
alter table public.programa_hoteles       enable row level security;
alter table public.programa_hotel_precios enable row level security;
alter table public.programa_hotel_noches  enable row level security;

drop policy if exists "programa_hoteles: interno" on public.programa_hoteles;
create policy "programa_hoteles: interno" on public.programa_hoteles for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

drop policy if exists "programa_hotel_precios: interno" on public.programa_hotel_precios;
create policy "programa_hotel_precios: interno" on public.programa_hotel_precios for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

drop policy if exists "programa_hotel_noches: interno" on public.programa_hotel_noches;
create policy "programa_hotel_noches: interno" on public.programa_hotel_noches for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

revoke all on table public.programa_hoteles, public.programa_hotel_precios, public.programa_hotel_noches from anon;

-- ── Guardado atómico del catálogo ──────────────────────────────────────────
-- p_hoteles: arreglo de { id?, nombre, zona, tipo_habitacion, max_pax_habitacion,
--   max_menores_habitacion, proveedor_id, base: [{desde,hasta,modalidad_servicios,
--   bajo_solicitud,neto_*}], noches: [{desde,hasta,unidad_cobro,neto_*}] }.
-- Conserva el id de los hoteles que ya existen (el formulario de reserva puede tener
-- uno elegido), reemplaza sus tarifas y borra los hoteles que ya no vienen. SECURITY
-- INVOKER: manda la RLS de siempre. Serializa por programa con un lock de fila.
create or replace function public.guardar_programa_hoteles(p_programa_id bigint, p_hoteles jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  h        jsonb;
  x        jsonb;
  v_id     bigint;
  v_ids    bigint[] := '{}';
  v_orden  integer := 0;
begin
  perform 1 from public.programas where id = p_programa_id for update;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;
  if p_hoteles is null or jsonb_typeof(p_hoteles) <> 'array' then
    raise exception 'La lista de hoteles debe ser un arreglo.';
  end if;

  for h in select value from jsonb_array_elements(p_hoteles) loop
    v_id := nullif(h->>'id', '')::bigint;
    if v_id is not null then
      if not exists (select 1 from public.programa_hoteles where id = v_id and programa_id = p_programa_id) then
        raise exception 'El hotel % no pertenece al programa % (o no tienes acceso).', v_id, p_programa_id;
      end if;
      update public.programa_hoteles
         set orden = v_orden,
             nombre = h->>'nombre',
             zona = nullif(btrim(coalesce(h->>'zona', '')), ''),
             tipo_habitacion = nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
             max_pax_habitacion = nullif(h->>'max_pax_habitacion', '')::integer,
             max_menores_habitacion = nullif(h->>'max_menores_habitacion', '')::integer,
             proveedor_id = nullif(h->>'proveedor_id', '')::bigint
       where id = v_id;
    else
      insert into public.programa_hoteles (programa_id, orden, nombre, zona, tipo_habitacion, max_pax_habitacion, max_menores_habitacion, proveedor_id)
      values (
        p_programa_id, v_orden, h->>'nombre',
        nullif(btrim(coalesce(h->>'zona', '')), ''),
        nullif(btrim(coalesce(h->>'tipo_habitacion', '')), ''),
        nullif(h->>'max_pax_habitacion', '')::integer,
        nullif(h->>'max_menores_habitacion', '')::integer,
        nullif(h->>'proveedor_id', '')::bigint
      ) returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
    v_orden := v_orden + 1;

    delete from public.programa_hotel_precios where hotel_id = v_id;
    delete from public.programa_hotel_noches where hotel_id = v_id;

    for x in select value from jsonb_array_elements(coalesce(h->'base', '[]'::jsonb)) loop
      insert into public.programa_hotel_precios (hotel_id, desde, hasta, modalidad_servicios, bajo_solicitud,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'modalidad_servicios',
        coalesce((x->>'bajo_solicitud')::boolean, false),
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;

    for x in select value from jsonb_array_elements(coalesce(h->'noches', '[]'::jsonb)) loop
      insert into public.programa_hotel_noches (hotel_id, desde, hasta, unidad_cobro,
        neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino)
      values (v_id, (x->>'desde')::date, (x->>'hasta')::date, x->>'unidad_cobro',
        nullif(x->>'neto_sencilla', '')::numeric, nullif(x->>'neto_doble', '')::numeric,
        nullif(x->>'neto_triple', '')::numeric, nullif(x->>'neto_multiple', '')::numeric,
        nullif(x->>'neto_nino', '')::numeric);
    end loop;
  end loop;

  delete from public.programa_hoteles where programa_id = p_programa_id and not (id = any (v_ids));

  -- Vigencias solapadas: se rechazan AL GUARDAR (el motor de reserva las bloquea igual
  -- si llegaran por otra vía, pero lo correcto es no dejarlas entrar).
  if exists (
    select 1
      from public.programa_hotel_precios a
      join public.programa_hotel_precios b
        on b.hotel_id = a.hotel_id and b.modalidad_servicios = a.modalidad_servicios and b.id > a.id
       and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios.';
  end if;
  if exists (
    select 1
      from public.programa_hotel_noches a
      join public.programa_hotel_noches b
        on b.hotel_id = a.hotel_id and b.id > a.id and a.desde <= b.hasta and b.desde <= a.hasta
      join public.programa_hoteles ph on ph.id = a.hotel_id
     where ph.programa_id = p_programa_id
  ) then
    raise exception 'Hay vigencias de noche adicional solapadas para un mismo hotel.';
  end if;
end;
$$;

revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from public;
revoke all on function public.guardar_programa_hoteles(bigint, jsonb) from anon;
grant execute on function public.guardar_programa_hoteles(bigint, jsonb) to authenticated;

-- ── Contrato: selección congelada (sin netos) ──────────────────────────────
create table if not exists public.contrato_programa_estancia (
  numero_contrato      text primary key references public.ventas(numero_contrato) on delete cascade,
  programa_id          bigint,
  hotel_id             bigint,
  hotel_nombre         text not null,
  zona                 text,
  tipo_habitacion      text,
  modalidad_servicios  text not null,
  moneda               text not null,
  fecha_entrada        date not null,
  noches_incluidas     integer not null,
  noches_adicionales   integer not null default 0,
  fecha_regreso        date not null,
  base_vigencia_desde  date not null,
  base_vigencia_hasta  date not null,
  habitaciones         jsonb not null default '{}'::jsonb,
  ninos                integer not null default 0,
  infantes             integer not null default 0,
  precio_base          numeric(15,2) not null,
  precio_noches        numeric(15,2) not null default 0,
  noches               jsonb not null default '[]'::jsonb,
  itinerario           jsonb not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  constraint contrato_programa_estancia_modalidad_check check (modalidad_servicios in ('privado', 'regular')),
  constraint contrato_programa_estancia_noches_check check (noches_incluidas >= 0 and noches_adicionales >= 0),
  constraint contrato_programa_estancia_fechas_check check (fecha_regreso >= fecha_entrada and base_vigencia_desde <= base_vigencia_hasta),
  constraint contrato_programa_estancia_precios_check check (precio_base >= 0 and precio_noches >= 0)
);
-- Sin referencia a programa_hoteles/programas a propósito: es una FOTO del momento de la
-- reserva y debe sobrevivir a que el catálogo se edite o se borre.

-- ── Contrato: costo congelado (solo roles contables) ───────────────────────
create table if not exists public.contrato_programa_estancia_costo (
  numero_contrato        text primary key references public.ventas(numero_contrato) on delete cascade,
  moneda                 text not null,
  neto_base              numeric(15,2) not null,
  neto_noches            numeric(15,2) not null default 0,
  asistencia_noches      numeric(15,2) not null default 0,
  detalle_noches         jsonb not null default '[]'::jsonb,
  proveedor_noches_id    bigint,
  cxp_programa_id        bigint references public.cuentas_por_pagar(id) on delete set null,
  cxp_noches_id          bigint references public.cuentas_por_pagar(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint contrato_programa_estancia_costo_check check (neto_base >= 0 and neto_noches >= 0 and asistencia_noches >= 0)
);

comment on table public.contrato_programa_estancia is
  '#88: foto de la estancia reservada (hotel, modalidad, fechas exactas, vigencias, PVP por noche, itinerario desplazado). Sin netos. Solo la escribe la Server Action de reserva.';
comment on table public.contrato_programa_estancia_costo is
  '#88: netos de la estancia congelados al reservar. Solo roles contables. La asistencia no se paga con el hotel: se registra en su propia CxP de asistencia (la migración 245 agrega asistencia_total y su proveedor, y retira los enlaces cxp_*: las CxP se vinculan por numero_contrato).';

alter table public.contrato_programa_estancia       enable row level security;
alter table public.contrato_programa_estancia_costo enable row level security;

drop policy if exists "contrato_programa_estancia: lectura" on public.contrato_programa_estancia;
create policy "contrato_programa_estancia: lectura" on public.contrato_programa_estancia for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
    and public.puede_ver_contrato(numero_contrato)
  );

drop policy if exists "contrato_programa_estancia_costo: lectura contable" on public.contrato_programa_estancia_costo;
create policy "contrato_programa_estancia_costo: lectura contable" on public.contrato_programa_estancia_costo for select
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and exists (
      select 1 from public.ventas v
       where v.numero_contrato = contrato_programa_estancia_costo.numero_contrato
         and public.puede_ver_tenant(v.tenant)
    )
  );

-- Sin policies de escritura y sin privilegios de escritura: solo service_role.
revoke all on table public.contrato_programa_estancia, public.contrato_programa_estancia_costo from anon;
revoke insert, update, delete, truncate on table public.contrato_programa_estancia, public.contrato_programa_estancia_costo from authenticated;

-- Auditoría genérica (087/108) en las tablas nuevas.
drop trigger if exists trg_auditoria on public.programa_hoteles;
create trigger trg_auditoria after insert or update or delete on public.programa_hoteles
  for each row execute function public.fn_auditoria();
drop trigger if exists trg_auditoria on public.programa_hotel_precios;
create trigger trg_auditoria after insert or update or delete on public.programa_hotel_precios
  for each row execute function public.fn_auditoria();
drop trigger if exists trg_auditoria on public.programa_hotel_noches;
create trigger trg_auditoria after insert or update or delete on public.programa_hotel_noches
  for each row execute function public.fn_auditoria();
drop trigger if exists trg_auditoria on public.contrato_programa_estancia;
create trigger trg_auditoria after insert or update or delete on public.contrato_programa_estancia
  for each row execute function public.fn_auditoria();
drop trigger if exists trg_auditoria on public.contrato_programa_estancia_costo;
create trigger trg_auditoria after insert or update or delete on public.contrato_programa_estancia_costo
  for each row execute function public.fn_auditoria();

notify pgrst, 'reload schema';

commit;
