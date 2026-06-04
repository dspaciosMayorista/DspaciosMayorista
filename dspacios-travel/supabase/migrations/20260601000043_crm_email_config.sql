-- Migración 043: configuración de envío de EMAIL del CRM (fila única)
--
-- Datos del remitente + proveedor de envío (Brevo / Resend / SMTP) para las
-- campañas. La API key es sensible: RLS solo administración/gerencia.
-- (Recomendado: la API key también puede vivir en variable de entorno; este
--  campo permite configurarla desde la app si se prefiere.)

create table if not exists public.crm_email_config (
  id                integer primary key default 1 check (id = 1),
  proveedor         text not null default 'brevo',   -- brevo | resend | smtp
  remitente_email   text,
  remitente_nombre  text,
  responder_a       text,
  api_key           text,
  firma_html        text,
  activo            boolean not null default false,
  updated_at        timestamptz not null default now()
);

insert into public.crm_email_config (id) values (1) on conflict (id) do nothing;

alter table public.crm_email_config enable row level security;

drop policy if exists "crm_email_config: interno" on public.crm_email_config;
create policy "crm_email_config: interno" on public.crm_email_config
  for all
  using (public.mi_rol() in ('superadmin','gerencia','administracion'))
  with check (public.mi_rol() in ('superadmin','gerencia','administracion'));
