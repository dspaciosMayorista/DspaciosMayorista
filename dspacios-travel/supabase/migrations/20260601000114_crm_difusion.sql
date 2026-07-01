-- ───────────────────────────────────────────────────────────────────────────
-- 114 · CRM · DIFUSIÓN — control de material promocional (cronograma)
--
--  Controla qué material (flyer/video/reel…) de qué hotel/destino se envía por
--  lista de difusión, evitando repetir demasiado seguido. El "estado de rotación",
--  "última vez enviado", "días desde", etc. NO se guardan: se calculan en vivo
--  desde el histórico (lib/crm/difusion.ts). Reglas: no repetir hotel < 21 días,
--  no repetir el mismo material < 30 días, en pausa si 2+ envíos en 30 días.
--
--  El material puede venir del catálogo (hotel_id → hoteles) o ser MANUAL (solo
--  texto), para productos que no están en el tarifario.
-- ───────────────────────────────────────────────────────────────────────────

-- Inventario de materiales
create table if not exists public.crm_material (
  id             bigserial primary key,
  destino        text,
  hotel_producto text not null,
  hotel_id       bigint references public.hoteles(id) on delete set null, -- opcional: link al catálogo
  tipo_material  text,                         -- flyer / video / reel / carrusel / estado / oferta…
  fuente         text,                         -- material del hotel / propio…
  estado         text not null default 'disponible',
  prioridad      text not null default 'media',
  link_archivo   text,
  fecha_material date,
  observaciones  text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_crm_material_hotel on public.crm_material(hotel_id);

-- Histórico de envíos (alimenta el motor de rotación)
create table if not exists public.crm_envio (
  id             bigserial primary key,
  material_id    bigint references public.crm_material(id) on delete set null,
  destino        text,
  hotel_producto text not null,
  tipo_material  text,
  fecha_envio    date not null,
  lista_enviada  text,
  canal          text,
  objetivo       text,
  enfoque        text,
  resultado      text not null default 'sin_medir',
  responsable    text,
  observaciones  text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_crm_envio_material on public.crm_envio(material_id);
create index if not exists idx_crm_envio_fecha on public.crm_envio(fecha_envio);

-- Calendario de difusión (planeado)
create table if not exists public.crm_difusion_plan (
  id               bigserial primary key,
  material_id      bigint references public.crm_material(id) on delete set null,
  fecha_programada date not null,
  destino          text,
  hotel_producto   text,
  tipo_material    text,
  canal            text,
  lista_objetivo   text,
  enfoque          text,
  estado           text not null default 'pendiente', -- pendiente/programado/enviado/reprogramar/cancelado
  observaciones    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_crm_plan_fecha on public.crm_difusion_plan(fecha_programada);

-- RLS: mismos roles internos que el resto del CRM.
do $$
declare t text;
begin
  foreach t in array array['crm_material','crm_envio','crm_difusion_plan'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: lectura" on public.%I', t, t);
    execute format($p$create policy "%s: lectura" on public.%I for select using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))$p$, t, t);
    execute format('drop policy if exists "%s: escritura" on public.%I', t, t);
    execute format($p$create policy "%s: escritura" on public.%I for all using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')) with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))$p$, t, t);
  end loop;
end $$;
