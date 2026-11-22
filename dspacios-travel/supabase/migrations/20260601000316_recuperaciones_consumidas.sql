-- 316 · #62 (B4): consumo de la recuperación de contraseña en estado CONTROLADO POR EL SERVIDOR (no en user_metadata, que el usuario puede editar).
-- Una fila = un evento de recuperación (usuario + sesión de recuperación + instante) reclamado por la app. La PRIMARY KEY hace el reclamo ATÓMICO:
-- de dos restablecimientos concurrentes con el mismo evento, solo uno inserta (el otro recibe 23505 y se niega).
-- Aditiva y sin datos previos. Solo service_role (código de servidor): anon/authenticated no la leen ni la escriben, y no hay políticas RLS.
-- Sin FK a auth.users a propósito: no depende del esquema auth del proveedor y la fila es solo un registro de «ya se usó».
create table if not exists public.recuperaciones_consumidas (
  user_id uuid not null,
  evento text not null,
  estado text not null default 'reclamada' check (estado in ('reclamada', 'aplicada')),
  reclamada_en timestamptz not null default now(),
  aplicada_en timestamptz,
  constraint recuperaciones_consumidas_pk primary key (user_id, evento)
);
comment on table public.recuperaciones_consumidas is '#62 B4: eventos de recuperación de contraseña ya reclamados (reclamada = en curso o resultado incierto; aplicada = Auth confirmó el cambio). Solo service_role.';

alter table public.recuperaciones_consumidas enable row level security;
revoke all on table public.recuperaciones_consumidas from public, anon, authenticated;
grant select, insert, update, delete on table public.recuperaciones_consumidas to service_role;
