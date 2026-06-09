-- 061 · Plan de cobro al cliente (fechas de cobro / cuotas)
--
-- % mínimo de abono para confirmar (por tipo de contrato, editable solo por
-- superadmin) + el plan de cuotas guardado por contrato (para mostrarlo y para
-- los recordatorios). Reglas: 30% confirma, saldo en cuotas mensuales hasta 1 mes
-- antes del check-in; si el viaje está a <1 mes, 100%.

create table if not exists public.config_cobros (
  tipo_paquete text primary key,           -- bloqueo | porcion_terrestre | servicios
  pct_abono    numeric(5,4) not null default 0.30,
  updated_at   timestamptz not null default now()
);
insert into public.config_cobros (tipo_paquete, pct_abono) values
  ('bloqueo', 0.30), ('porcion_terrestre', 0.30), ('servicios', 0.30)
on conflict (tipo_paquete) do nothing;

alter table public.config_cobros enable row level security;
drop policy if exists "config_cobros: lectura" on public.config_cobros;
create policy "config_cobros: lectura" on public.config_cobros
  for select using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
drop policy if exists "config_cobros: superadmin" on public.config_cobros;
create policy "config_cobros: superadmin" on public.config_cobros
  for all using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');

create table if not exists public.cuotas (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  orden           integer not null,
  tipo            text not null,            -- abono | cuota | total
  fecha_limite    date not null,
  monto           numeric(15,2) not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cuotas_contrato on public.cuotas(numero_contrato);

alter table public.cuotas enable row level security;
drop policy if exists "cuotas: interno" on public.cuotas;
create policy "cuotas: interno" on public.cuotas for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
