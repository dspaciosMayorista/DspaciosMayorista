-- Migración 047: contactos del CRM ÚNICOS por documento, teléfono y correo.
--
-- Índices únicos PARCIALES (ignoran NULL → puede haber varios sin teléfono/doc).
-- El teléfono compara solo dígitos: "300 123 4567" == "3001234567".
-- ⚠️ Si ya hay duplicados cargados, primero hay que limpiarlos o esta migración falla.

create unique index if not exists uq_crm_documento
  on public.crm_contactos (documento)
  where documento is not null;

create unique index if not exists uq_crm_email
  on public.crm_contactos (lower(email))
  where email is not null;

create unique index if not exists uq_crm_telefono
  on public.crm_contactos (regexp_replace(telefono, '[^0-9]', '', 'g'))
  where telefono is not null;
