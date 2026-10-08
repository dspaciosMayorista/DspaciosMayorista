begin;

-- Ensayo estructural autocontenido: no depende de datos reales y revierte todo.
create extension if not exists pgtap;

select plan(10);

select has_table('public', 'crm_leads', 'crm_leads existe');
select has_table('public', 'crm_lead_actividades', 'crm_lead_actividades existe');
select has_function('public', 'crm_lead_puede_ver', array['text', 'uuid'], 'funcion de lectura existe');
select has_index('public', 'crm_leads', 'uq_crm_leads_tenant_tipo_documento', 'unicidad documental por tenant + tipo + numero existe');
select hasnt_index('public', 'crm_leads', 'uq_crm_leads_tenant_telefono', 'telefono NO es unico: solo sugiere coincidencias');
select hasnt_index('public', 'crm_leads', 'uq_crm_leads_tenant_email', 'correo NO es unico: solo sugiere coincidencias');

select results_eq(
  $$ select public.crm_lead_normalizar_telefono('+57 300 123 4567') $$,
  $$ values ('573001234567'::text) $$,
  'normaliza telefono con prefijo 57'
);

select isnt_empty(
  $$ select 1 from pg_trigger where tgrelid = 'public.crm_leads'::regclass and tgname = 'trg_crm_leads_bloquear_delete' $$,
  'lead tiene trigger anti-delete'
);

select isnt_empty(
  $$ select 1 from pg_trigger where tgrelid = 'public.crm_lead_actividades'::regclass and tgname = 'trg_crm_lead_actividades_append_only_update' $$,
  'actividad tiene trigger append-only'
);

select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename in ('crm_leads', 'crm_lead_actividades') and roles::text = '{public}' $$,
  'no hay policies abiertas a public'
);

select * from finish();

rollback;
