-- 062 · Notificaciones por correo (alertas operativas)
--
-- Un correo diario (Resend, remitente info@dspaciostravel.com) avisa a los
-- destinatarios configurados sobre fechas límite próximas: pago a proveedores
-- (CxP), cobro a clientes (cuotas) y devolución/emisión de bloqueos.
-- La API key de Resend va en variable de entorno (RESEND_API_KEY), no en la BD.

create table if not exists public.config_notificaciones (
  id                integer primary key default 1,
  remitente         text not null default 'D''spacios Travel <info@dspaciostravel.com>',
  destinatarios     text,                       -- correos separados por coma
  dias_anticipacion integer not null default 5,
  alerta_cxp        boolean not null default true,
  alerta_cuotas     boolean not null default true,
  alerta_bloqueos   boolean not null default true,
  activo            boolean not null default true,
  updated_at        timestamptz not null default now(),
  constraint config_notificaciones_una_fila check (id = 1)
);
insert into public.config_notificaciones (id) values (1) on conflict (id) do nothing;

alter table public.config_notificaciones enable row level security;
drop policy if exists "config_notificaciones: interno" on public.config_notificaciones;
create policy "config_notificaciones: interno" on public.config_notificaciones
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
