-- Migración 046: ADJUNTOS por contrato (cédulas, soportes de pago/abono)
--
-- Archivos SENSIBLES → bucket PRIVADO 'contratos' (no público; se descargan con
-- URL firmada temporal). Una fila por archivo enlazada al número de contrato.

insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do nothing;

drop policy if exists "contratos files: acceso" on storage.objects;
create policy "contratos files: acceso" on storage.objects
  for all
  using (bucket_id = 'contratos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (bucket_id = 'contratos' and public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));

create table if not exists public.contrato_adjuntos (
  id              bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  tipo            text not null default 'otro',   -- cedula | pago | abono | otro
  nombre          text,
  path            text not null,                  -- ruta dentro del bucket
  size_bytes      bigint,
  subido_por      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_contrato_adjuntos_contrato on public.contrato_adjuntos(numero_contrato);

alter table public.contrato_adjuntos enable row level security;
drop policy if exists "contrato_adjuntos: interno" on public.contrato_adjuntos;
create policy "contrato_adjuntos: interno" on public.contrato_adjuntos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
