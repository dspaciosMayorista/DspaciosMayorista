-- ───────────────────────────────────────────────────────────────────────────
-- 076 · MULTI-USUARIO POR AGENCIA (agentes)
--
-- Una agencia (usuario rol 'agencia' con agencia_id NULL = titular) puede tener
-- varios AGENTES (usuarios rol 'agencia' con agencia_id = id del titular).
-- La facturación en contrato NETO siempre es de la AGENCIA (el titular), sin
-- importar qué agente reserve.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.usuarios
  add column if not exists agencia_id uuid references public.usuarios(id);

create index if not exists idx_usuarios_agencia on public.usuarios(agencia_id);
