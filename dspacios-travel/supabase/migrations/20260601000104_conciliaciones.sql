-- ───────────────────────────────────────────────────────────────────────────
-- 104 · CONTABILIDAD — conciliaciones bancarias
--
--  Extracto importado (pegado del Excel del banco) y los cruces MANUALES contra
--  los movimientos del sistema (abonos de cartera, pagos a proveedores y
--  movimientos de pagos). Un cruce agrupa N líneas de extracto con M ítems del
--  sistema cuyas sumas deben coincidir.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.conciliacion_extracto (
  id              bigserial primary key,
  fecha           date not null,
  descripcion     text,
  valor           numeric(15,2) not null,    -- con signo: + abono / − cargo
  saldo           numeric(15,2),
  periodo         text not null,             -- YYYY-MM
  cuenta          text,
  conciliacion_id bigint,                     -- null = sin conciliar
  created_at      timestamptz not null default now()
);
create index if not exists idx_conc_extracto_periodo on public.conciliacion_extracto(periodo);

create table if not exists public.conciliacion (
  id          bigserial primary key,
  nota        text,
  total       numeric(15,2) not null default 0,
  created_at  timestamptz not null default now()
);

-- Lado "sistema" de un cruce (snapshot del ítem real, ref identifica su origen).
create table if not exists public.conciliacion_sistema (
  id              bigserial primary key,
  conciliacion_id bigint not null references public.conciliacion(id) on delete cascade,
  ref             text not null,             -- 'abono:45' | 'pago:123:2' | 'movimiento:9'
  descripcion     text,
  fecha           date,
  valor           numeric(15,2) not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_conc_sistema_ref on public.conciliacion_sistema(ref);

alter table public.conciliacion_extracto enable row level security;
alter table public.conciliacion          enable row level security;
alter table public.conciliacion_sistema  enable row level security;

drop policy if exists "conc_extracto: contable" on public.conciliacion_extracto;
create policy "conc_extracto: contable" on public.conciliacion_extracto for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
drop policy if exists "conc: contable" on public.conciliacion;
create policy "conc: contable" on public.conciliacion for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
drop policy if exists "conc_sistema: contable" on public.conciliacion_sistema;
create policy "conc_sistema: contable" on public.conciliacion_sistema for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'));
