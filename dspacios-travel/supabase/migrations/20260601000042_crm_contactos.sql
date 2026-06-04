-- Migración 042: CRM — base de datos de contactos (compartida con el portal)
--
-- Categorías con tratamiento distinto: cliente_final, agencia, freelance,
-- empresa, pasajero (este último informativo: cumpleaños, día de la mujer, etc.).
-- Pensado para envío de email/publicidad → incluye CONSENTIMIENTO (Habeas Data,
-- Ley 1581/2012): `acepta_publicidad` arranca en false (opt-in) y `no_contactar`.

create table if not exists public.crm_contactos (
  id                bigserial primary key,
  categoria         text not null default 'cliente_final',  -- cliente_final|agencia|freelance|empresa|pasajero
  nombre            text not null,
  tipo_doc          text,
  documento         text,
  email             text,
  telefono          text,
  ciudad            text,
  pais              text,
  fecha_nacimiento  date,           -- para felicitaciones de cumpleaños
  genero            text,           -- F | M | otro (para campañas tipo día de la mujer)
  origen            text,           -- de qué agencia/freelance/canal proviene
  etiquetas         text[],
  acepta_publicidad boolean not null default false,  -- consentimiento (Habeas Data)
  no_contactar      boolean not null default false,
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_crm_contactos_categoria on public.crm_contactos(categoria);
create index if not exists idx_crm_contactos_email on public.crm_contactos(email);

alter table public.crm_contactos enable row level security;

drop policy if exists "crm_contactos: lectura"   on public.crm_contactos;
drop policy if exists "crm_contactos: escritura" on public.crm_contactos;

create policy "crm_contactos: lectura" on public.crm_contactos
  for select using (auth.uid() is not null);

create policy "crm_contactos: escritura" on public.crm_contactos
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
