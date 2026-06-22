-- Migración 082: subcategoría libre en contactos del CRM.
-- Permite dividir cada categoría (p. ej. cliente_final) en grupos para segmentar
-- campañas: VIP, Luna de miel, Corporativo, por ciudad, etc. Texto libre.

alter table public.crm_contactos add column if not exists subcategoria text;
create index if not exists idx_crm_contactos_subcategoria on public.crm_contactos(subcategoria);
