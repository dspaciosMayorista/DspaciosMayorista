-- ───────────────────────────────────────────────────────────────────────────
-- 072 · PERMISOS por rol y por usuario (matriz de módulos)
--
-- Control de acceso por MÓDULO con tres acciones: consultar / modificar /
-- eliminar. Se define por ROL y, opcionalmente, se sobre-escribe por USUARIO
-- (acceso especial a alguien aunque tenga un rol).
--
-- Nota: esto gobierna la VISIBILIDAD/UX (qué módulos ve y qué botones).
-- La seguridad de datos sigue en las políticas RLS de cada tabla. Superadmin
-- nunca se bloquea (se resuelve en código).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.permisos_rol (
  rol        text not null,
  modulo     text not null,
  consultar  boolean not null default false,
  modificar  boolean not null default false,
  eliminar   boolean not null default false,
  primary key (rol, modulo)
);

create table if not exists public.permisos_usuario (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  modulo     text not null,
  consultar  boolean not null default false,
  modificar  boolean not null default false,
  eliminar   boolean not null default false,
  primary key (usuario_id, modulo)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.permisos_rol     enable row level security;
alter table public.permisos_usuario enable row level security;

-- Lectura: cualquier usuario autenticado (el dashboard la usa para gating).
drop policy if exists "permisos_rol: lectura" on public.permisos_rol;
create policy "permisos_rol: lectura" on public.permisos_rol for select using (auth.uid() is not null);
drop policy if exists "permisos_usuario: lectura" on public.permisos_usuario;
create policy "permisos_usuario: lectura" on public.permisos_usuario for select using (auth.uid() is not null);

-- Escritura: solo superadmin / administración / gerencia.
drop policy if exists "permisos_rol: escritura" on public.permisos_rol;
create policy "permisos_rol: escritura" on public.permisos_rol for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));
drop policy if exists "permisos_usuario: escritura" on public.permisos_usuario;
create policy "permisos_usuario: escritura" on public.permisos_usuario for all
  using (public.mi_rol() in ('superadmin','administracion','gerencia'))
  with check (public.mi_rol() in ('superadmin','administracion','gerencia'));
