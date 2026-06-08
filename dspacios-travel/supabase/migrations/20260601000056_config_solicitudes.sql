-- 056 · Configuración de SOLICITUDES de reserva (tarifario dinámico)
--
-- A dónde llegan las solicitudes que arma el carrito público: número de WhatsApp
-- y correos del equipo (los que el dueño elija). El checkout las usa para armar
-- los enlaces wa.me y mailto. Una sola fila editable en Configuración.

create table if not exists public.config_solicitudes (
  id           integer primary key default 1,
  whatsapp     text,           -- número con indicativo, solo dígitos (ej. 573001234567)
  emails       text,           -- uno o varios correos separados por coma
  mensaje_extra text,          -- nota opcional al pie del mensaje
  updated_at   timestamptz not null default now(),
  constraint config_solicitudes_una_fila check (id = 1)
);

insert into public.config_solicitudes (id) values (1) on conflict (id) do nothing;

alter table public.config_solicitudes enable row level security;
drop policy if exists "config_solicitudes: interno" on public.config_solicitudes;
create policy "config_solicitudes: interno" on public.config_solicitudes
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));
