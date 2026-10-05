begin;
set transaction read only;

select
  to_regclass('public.crm_leads') as crm_leads,
  to_regclass('public.crm_lead_actividades') as crm_lead_actividades;

select relname
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('crm_leads', 'crm_lead_actividades');

rollback;
