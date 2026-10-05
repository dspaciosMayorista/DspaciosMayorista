begin;
set transaction read only;

select
  c.relname,
  c.relrowsecurity as rls_habilitado,
  c.relforcerowsecurity as rls_forzado
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('crm_leads', 'crm_lead_actividades')
order by c.relname;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('crm_leads', 'crm_lead_actividades')
order by tablename, policyname;

select t.tgrelid::regclass as tabla, t.tgname
from pg_trigger t
where t.tgrelid in ('public.crm_leads'::regclass, 'public.crm_lead_actividades'::regclass)
  and not t.tgisinternal
order by 1, 2;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('crm_leads', 'crm_lead_actividades')
order by tablename, indexname;

rollback;
