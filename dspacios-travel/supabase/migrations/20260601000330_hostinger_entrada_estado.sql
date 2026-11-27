-- 330 · #103 — Hostinger inbound adapter: DURABLE CONTINUATION of the mailbox sweep and DURABLE backlog of replies whose download failed. Additive, idempotent. References no other 328/329 table.
--
-- Why (Codex HIN-2): the adapter scans the INBOX newest-first inside a bounded budget. Without memory, every run restarts at the newest message, so a reply buried under more newer unrelated mail than one run can read is never reached,
-- and a failed download that is not retried before the sweep moves on is forgotten. This migration stores exactly what a later run needs, and nothing else:
--   · hostinger_estado_buzon             one row per mailbox: uid_cubierto = every message with a uid up to it has been handled (recorded, irrelevant, or parked below); barrido_tope / barrido_siguiente = a sweep in
--                                        progress (scan uids <= siguiente and > cubierto; tope = the newest uid when it started; siguiente also moves down INSIDE a page, so a partially handled page keeps its progress);
--                                        barrido_desde = the eligibility threshold FIXED when the sweep started (only the first sweep of a mailbox has one): a later run resumes with the SAME threshold, so a reply that was eligible
--                                        when the sweep began is never dropped because the next run happens another day; version = optimistic-concurrency counter.
--   · hostinger_respuestas_pendientes    replies that were found but could not be downloaded/recorded yet. They stay until recorded or until the message no longer exists: they never age out silently.
--   · hostinger_estado_leer(buzon)       creates the row if absent and returns it; hostinger_estado_avanzar(...) moves the cursor only if version is still the one the caller read (compare-and-swap): of several
--                                        concurrent runs exactly one advances, the others keep their (idempotent) work and stop.
-- The mailbox id is a Hostinger resource id, not tenant data: no tenant column. No reply content is stored here (the events keep it, as before). Only the service role touches these tables (RLS on, no policy, no grants to anon/authenticated).
-- Rollback: supabase/scripts/rollback_330_hostinger_entrada_estado.sql · Preflight/postcheck: supabase/scripts/preflight_330_hostinger_entrada_estado.sql / postcheck_330_hostinger_entrada_estado.sql

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then raise exception '330 ABORTADA: falta el rol service_role.'; end if;
end $$;

create table if not exists public.hostinger_estado_buzon (
  buzon_id          text primary key check (buzon_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  version           integer not null default 0 check (version >= 0),
  uid_cubierto      bigint not null default 0 check (uid_cubierto >= 0),
  barrido_tope      bigint check (barrido_tope is null or barrido_tope > 0),
  barrido_siguiente bigint check (barrido_siguiente is null or barrido_siguiente >= 0),
  barrido_desde     timestamptz,
  actualizado_en    timestamptz not null default now(),
  check ((barrido_tope is null) = (barrido_siguiente is null)),
  check (barrido_tope is null or barrido_siguiente <= barrido_tope),
  check (barrido_tope is null or barrido_tope > uid_cubierto),
  check (barrido_tope is not null or barrido_desde is null)
);

create table if not exists public.hostinger_respuestas_pendientes (
  buzon_id       text not null references public.hostinger_estado_buzon(buzon_id) on delete cascade,
  uid            bigint not null check (uid > 0),
  dedupe         text not null check (length(dedupe) between 1 and 400),
  message_id     text check (message_id is null or length(message_id) <= 400),
  intentos       integer not null default 1 check (intentos >= 1),
  ultimo_error   text check (ultimo_error is null or length(ultimo_error) <= 300),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (buzon_id, uid)
);
create index if not exists hostinger_respuestas_pendientes_antiguas_idx on public.hostinger_respuestas_pendientes (buzon_id, creado_en);

alter table public.hostinger_estado_buzon enable row level security;
alter table public.hostinger_respuestas_pendientes enable row level security;
revoke all on public.hostinger_estado_buzon, public.hostinger_respuestas_pendientes from public, anon, authenticated;
grant select, insert, update, delete on public.hostinger_estado_buzon, public.hostinger_respuestas_pendientes to service_role;

create or replace function public.hostinger_estado_leer(p_buzon text)
returns table (version integer, uid_cubierto bigint, barrido_tope bigint, barrido_siguiente bigint, barrido_desde timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  insert into public.hostinger_estado_buzon (buzon_id) values (p_buzon) on conflict (buzon_id) do nothing;
  return query select e.version, e.uid_cubierto, e.barrido_tope, e.barrido_siguiente, e.barrido_desde from public.hostinger_estado_buzon e where e.buzon_id = p_buzon;
end
$f$;

-- Compare-and-swap: the new position (and eligibility threshold) is written only if nobody advanced since the caller read p_version. Returns true for the one winner, false otherwise (the caller must stop advancing; its processed work is idempotent).
create or replace function public.hostinger_estado_avanzar(p_buzon text, p_version integer, p_cubierto bigint, p_tope bigint, p_siguiente bigint, p_desde timestamptz)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $f$
declare n integer;
begin
  update public.hostinger_estado_buzon
     set version = version + 1, uid_cubierto = p_cubierto, barrido_tope = p_tope, barrido_siguiente = p_siguiente, barrido_desde = p_desde, actualizado_en = now()
   where buzon_id = p_buzon and version = p_version;
  get diagnostics n = row_count;
  return n = 1;
end
$f$;
revoke all on function public.hostinger_estado_leer(text), public.hostinger_estado_avanzar(text, integer, bigint, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.hostinger_estado_leer(text), public.hostinger_estado_avanzar(text, integer, bigint, bigint, bigint, timestamptz) to service_role;

comment on table public.hostinger_estado_buzon is '#103: posición durable del barrido del buzón de Hostinger (uid_cubierto + barrido en curso). Solo service_role. Sin contenido de correos.';
comment on table public.hostinger_respuestas_pendientes is '#103: respuestas halladas cuya descarga/registro falló; se reintentan en cada pasada hasta registrarse o hasta que el mensaje deje de existir. Solo service_role.';
