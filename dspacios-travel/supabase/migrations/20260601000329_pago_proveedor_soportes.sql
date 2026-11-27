-- 329 · #103 — Supplier PAYMENT notices: supporting evidence (files) linked to recorded supplier payments, and the relation «notice ↔ payments». Additive, idempotent. Requires 328 and 130.
--
-- What already exists and is NOT changed: `cxp_pagos` (one row per payment applied to ONE supplier obligation = ONE reservation/service line; migration 130). That row IS the allocation: a payment that covers several
--   reservations is several rows; a partial payment is a row smaller than the obligation. There is no payment reference, no evidence and no shared payment id on it — this migration does not add them to the payment.
-- What it adds (facts kept apart): recording a payment, uploading evidence, sending a notice, delivery, reply and supplier confirmation are DIFFERENT facts.
--   · `cxp_pago_soportes`           evidence files (PDF/JPG/PNG) the staff uploaded for a payment. A file that supports several payments is uploaded once and linked to each of them (several rows, same `path`).
--   · `solicitud_proveedor_pagos`   which payments a notice (solicitudes_proveedor.tipo = 'pago', migration 328) reported. The exact relation and attachments AS SENT live in `solicitudes_proveedor.snapshot`.
--   · private Storage bucket `soportes-pago-proveedor`, NO policy on storage.objects: only the server (service_role) touches it, after authorising in code (same model as 281 `soportes-pago`).
-- Sending or retrying a notice never writes `cxp_pagos`, accounting entries or reconciliation: those tables are not touched by any code of this feature (proved in pruebas/avisoPagoProveedor103.pg.ts).
-- Rollback: supabase/scripts/rollback_329_pago_proveedor_soportes.sql · Preflight/postcheck: supabase/scripts/preflight_329_pago_proveedor_soportes.sql / postcheck_329_pago_proveedor_soportes.sql

do $$
begin
  if to_regclass('public.cxp_pagos') is null then raise exception '329 ABORTADA: falta cxp_pagos (migración 130).'; end if;
  if to_regclass('public.solicitudes_proveedor') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitudes_proveedor' and column_name = 'tipo') then
    raise exception '329 ABORTADA: falta la 328 (solicitudes_proveedor con tipo).';
  end if;
  if to_regprocedure('public.mi_rol()') is null or to_regprocedure('public.puede_ver_tenant(text)') is null then raise exception '329 ABORTADA: faltan mi_rol() / puede_ver_tenant(text).'; end if;
end $$;

create table if not exists public.cxp_pago_soportes (
  id           bigint generated always as identity primary key,
  cxp_pago_id  bigint not null references public.cxp_pagos(id) on delete cascade,
  tenant       text not null,
  nombre       text not null check (length(btrim(nombre)) between 1 and 200),
  path         text not null check (length(path) between 1 and 400),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  subido_por   uuid,
  created_at   timestamptz not null default now(),
  unique (cxp_pago_id, path)
);
create index if not exists cxp_pago_soportes_pago_idx on public.cxp_pago_soportes (cxp_pago_id);

create table if not exists public.solicitud_proveedor_pagos (
  solicitud_id bigint not null references public.solicitudes_proveedor(id) on delete cascade,
  cxp_pago_id  bigint not null references public.cxp_pagos(id) on delete cascade,
  primary key (solicitud_id, cxp_pago_id)
);
create index if not exists solicitud_proveedor_pagos_pago_idx on public.solicitud_proveedor_pagos (cxp_pago_id);

alter table public.cxp_pago_soportes enable row level security;
alter table public.solicitud_proveedor_pagos enable row level security;
drop policy if exists "cxp_pago_soportes: lectura" on public.cxp_pago_soportes;
create policy "cxp_pago_soportes: lectura" on public.cxp_pago_soportes for select to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_tenant(tenant));
drop policy if exists "solicitud_proveedor_pagos: lectura" on public.solicitud_proveedor_pagos;
create policy "solicitud_proveedor_pagos: lectura" on public.solicitud_proveedor_pagos for select to authenticated
  using (exists (select 1 from public.solicitudes_proveedor s where s.id = solicitud_id and public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_tenant(s.tenant)));
revoke all on public.cxp_pago_soportes, public.solicitud_proveedor_pagos from anon, authenticated;
grant select on public.cxp_pago_soportes, public.solicitud_proveedor_pagos to authenticated;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('soportes-pago-proveedor', 'soportes-pago-proveedor', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
    on conflict (id) do nothing;
  end if;
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.cxp_pago_soportes';
    execute 'create trigger trg_auditoria after insert or update or delete on public.cxp_pago_soportes for each row execute function public.fn_auditoria()';
  end if;
end $$;

comment on table public.cxp_pago_soportes is '#103: evidencia (PDF/JPG/PNG, máx. 5 MB) de un pago a proveedor. No es el pago ni lo concilia. Un mismo archivo puede respaldar varios pagos (varias filas, mismo path). Escribe solo service_role.';
comment on table public.solicitud_proveedor_pagos is '#103: pagos que reportó un aviso de pago (solicitudes_proveedor.tipo = pago). La relación exacta enviada queda en solicitudes_proveedor.snapshot.';
