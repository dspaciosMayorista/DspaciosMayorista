-- Migración 054: Cotizaciones (presupuesto SIN número de contrato)
--
-- Antes, "cotizar" creaba de una un contrato pendiente: consumía un número
-- (00-NNNN), bloqueaba sillas y generaba CxP. Ahora una COTIZACIÓN es un
-- presupuesto liviano, sin número ni inventario: guarda el payload de la reserva
-- + un snapshot para el PDF + el precio. Al CONFIRMAR/convertir se llama al motor
-- de reserva normal (que genera el numero_contrato, sillas y CxP) y la cotización
-- queda marcada como 'convertida' con el enlace al contrato.

create sequence if not exists public.cotizacion_seq start 1;

create or replace function public.siguiente_codigo_cotizacion()
returns text language sql security definer set search_path = public as $$
  select 'C-' || lpad(nextval('public.cotizacion_seq')::text, 4, '0');
$$;

create table if not exists public.cotizaciones (
  id                bigserial primary key,
  codigo            text not null unique default public.siguiente_codigo_cotizacion(),
  created_at        timestamptz not null default now(),
  estado            text not null default 'abierta',  -- abierta / convertida / descartada
  -- payload completo de la reserva (ReservaInput) para poder convertir luego
  payload           jsonb not null,
  -- snapshot listo para el documento/PDF (venta-like + pasajeros/hoteles/vuelos/items)
  detalle           jsonb,
  -- campos denormalizados para el listado
  cliente           text,
  cliente_documento text,
  destino           text,
  hotel             text,
  modulo            text,
  plan_nombre       text,
  pax               integer default 0,
  precio_venta      numeric(15,2) default 0,
  moneda            text default 'COP',
  fecha_salida      date,
  fecha_regreso     date,
  vigencia_hasta    date,
  paquete_armado_id bigint,
  asesor            text,
  creado_por        text,
  -- enlace cuando se convierte en contrato
  numero_contrato   text references public.ventas(numero_contrato)
);

create index if not exists idx_cotizaciones_estado  on public.cotizaciones(estado);
create index if not exists idx_cotizaciones_created  on public.cotizaciones(created_at desc);

-- ── RLS: interno (mismo alcance que ventas/contratos) ──────────────────────
alter table public.cotizaciones enable row level security;

drop policy if exists "cotizaciones: interno" on public.cotizaciones;
create policy "cotizaciones: interno" on public.cotizaciones for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
