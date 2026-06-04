-- Migración 044: campañas de email del CRM (registro de envíos)

create table if not exists public.crm_campanas (
  id            bigserial primary key,
  asunto        text not null,
  cuerpo_html   text,
  categoria     text,                 -- categoría destino o 'todos'
  tipo          text not null default 'campana',  -- campana | cumpleanos | fecha_especial
  total         integer not null default 0,
  enviados      integer not null default 0,
  fallidos      integer not null default 0,
  estado        text not null default 'enviada',
  created_at    timestamptz not null default now()
);

alter table public.crm_campanas enable row level security;
drop policy if exists "crm_campanas: interno" on public.crm_campanas;
create policy "crm_campanas: interno" on public.crm_campanas
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
