begin;

drop table if exists public.crm_lead_actividades cascade;
drop table if exists public.crm_leads cascade;

drop function if exists public.crm_lead_puede_actualizar(text, uuid, uuid);
drop function if exists public.crm_lead_puede_insertar(text, uuid);
drop function if exists public.crm_lead_puede_ver(text, uuid);
drop function if exists public.crm_lead_responsable_valido(uuid);
drop function if exists public.crm_lead_actividades_append_only();
drop function if exists public.crm_leads_bloquear_delete();
drop function if exists public.crm_leads_bloquear_cambio_tenant();
drop function if exists public.crm_leads_touch_updated_at();
drop function if exists public.crm_lead_normalizar_documento(text);
drop function if exists public.crm_lead_normalizar_email(text);
drop function if exists public.crm_lead_normalizar_telefono(text);

notify pgrst, 'reload schema';

commit;
