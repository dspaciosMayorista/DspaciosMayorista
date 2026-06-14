-- ───────────────────────────────────────────────────────────────────────────
-- 074 · SOLICITUDES DE REGISTRO B2B (agencias / freelance)
--
-- El portal B2B tiene Login y Registrarse. El registro crea una SOLICITUD
-- pendiente con los datos del aliado; se aprueba SOLO desde el portal admin.
-- (Quién puede aprobar: superadmin/admin por defecto; otros si se personaliza
--  el permiso del módulo "b2b" — se valida en el server action.)
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_solicitudes (
  id                      bigserial primary key,
  tipo                    text not null default 'agencia',   -- 'agencia' | 'freelance'
  nombre                  text not null,                     -- razón social / nombre
  nit                     text,
  contacto                text,
  email                   text not null,
  telefono                text,
  ciudad                  text,
  notas                   text,
  acepta_notificaciones   boolean not null default true,
  estado                  text not null default 'pendiente', -- pendiente | aprobada | rechazada
  usuario_id              uuid references public.usuarios(id),
  revisado_por            text,
  revisado_at             timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists idx_b2b_solicitudes_estado on public.b2b_solicitudes(estado);

alter table public.b2b_solicitudes enable row level security;

-- Registro público: cualquiera puede enviar una solicitud.
drop policy if exists "b2b_solicitudes: registro público" on public.b2b_solicitudes;
create policy "b2b_solicitudes: registro público" on public.b2b_solicitudes for insert with check (true);

-- Lectura/gestión: roles administrativos (el resto se valida en el server action).
drop policy if exists "b2b_solicitudes: gestión admin" on public.b2b_solicitudes;
create policy "b2b_solicitudes: gestión admin" on public.b2b_solicitudes for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));
