-- Migración 011: Link público para compartir contratos
--
-- Cada contrato tiene un token aleatorio (uuid) que permite verlo sin login
-- mediante /c/<token>. El token es imposible de adivinar, así que solo quien
-- tenga el enlace puede abrir ese contrato.

alter table public.ventas
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists ventas_share_token_key
  on public.ventas (share_token);
