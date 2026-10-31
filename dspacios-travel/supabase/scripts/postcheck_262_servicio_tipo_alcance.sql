-- POSTCHECK 262 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto. Pegar COMPLETA tras correr la 262. Última fila (99) = VEREDICTO.
with
obs as (
    select 'fn:' || p.proname as etiqueta,
           md5(replace(p.prosrc, E'\r', '') || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || l.lanname || '|' || pg_get_function_result(p.oid) || '|' || pg_get_function_arguments(p.oid)) as huella
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('fn_franja_minutos', 'fn_franja_contiene', 'tg_servicio_suplementos_franja_solape', 'tg_servicio_precio_alcance_solape')
    union all
    select 'trg:' || t.tgname, md5(regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g') || '|' || t.tgenabled::text)
      from pg_trigger t
     where not t.tgisinternal and t.tgname in ('servicio_suplementos_franja_solape', 'servicio_precio_alcance_solape')
    union all
    select 'chk:' || c.conname, md5(pg_get_constraintdef(c.oid) || '|' || c.convalidated::text)
      from pg_constraint c
     where c.conname in ('servicios_adicionales_tipo_receptivo_chk', 'servicios_adicionales_combo_chk', 'servicio_suplementos_franja_pax_chk', 'contrato_servicios_alcance_traslado_chk',
                         'servicio_precio_alcance_alcance_chk', 'servicio_precio_alcance_precio_chk', 'servicio_precio_alcance_pax_chk')
    union all
    select 'idx:' || i.indexname, md5(i.indexdef)
      from pg_indexes i
     where i.schemaname = 'public' and i.indexname in ('idx_servicio_precio_alcance_vigencia', 'uq_servicio_precio_alcance_persona')
    union all
    select 'pol:' || p.policyname, md5(p.cmd || '|' || p.roles::text || '|' || regexp_replace(coalesce(p.qual, ''), '::[a-zA-Z_]+', '', 'g') || '|' || regexp_replace(coalesce(p.with_check, ''), '::[a-zA-Z_]+', '', 'g'))
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'servicio_precio_alcance'
    union all
    select 'tabla:servicio_precio_alcance', md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable, ',' order by c.ordinal_position) || '|rls=' || (select relrowsecurity::text from pg_class where oid = to_regclass('public.servicio_precio_alcance')))
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'servicio_precio_alcance'
     having count(*) > 0
    union all
    select 'col:' || c.table_name || '.' || c.column_name, md5(c.data_type || ':' || c.is_nullable)
      from information_schema.columns c
     where c.table_schema = 'public'
       and (c.table_name, c.column_name) in (('servicios_adicionales', 'tipo_receptivo'), ('servicios_adicionales', 'combo_incluye_traslado'), ('servicios_adicionales', 'combo_traslado_alcance'),
                                             ('servicio_suplementos_franja', 'pax_desde'), ('servicio_suplementos_franja', 'pax_hasta'), ('contrato_servicios', 'alcance_traslado'))
    union all
    select 'priv:' || r.rolname,
           md5(coalesce((select string_agg(pr, ',' order by pr) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
                          where has_table_privilege(r.rolname, 'public.servicio_precio_alcance', pr)), ''))
      from pg_roles r
     where r.rolname in ('anon', 'authenticated')
       and to_regclass('public.servicio_precio_alcance') is not null
),
esp(etiqueta, h255, h262) as (values
    ('chk:contrato_servicios_alcance_traslado_chk', null::text, 'b83b2fa4d0bb4a0f4c49c3a961ab0ed6'),
    ('chk:servicio_precio_alcance_alcance_chk', null::text, 'fd712e764143ba224b13530561813eb1'),
    ('chk:servicio_precio_alcance_pax_chk', null::text, 'e7643bce326e9bedde63da7bbdd8ddef'),
    ('chk:servicio_precio_alcance_precio_chk', null::text, '21fc79794e92c24f7cac451af1f358ac'),
    ('chk:servicio_suplementos_franja_pax_chk', null::text, 'e7643bce326e9bedde63da7bbdd8ddef'),
    ('chk:servicios_adicionales_combo_chk', null::text, '0910ccdcf4b86532f41a4170f19f4cad'),
    ('chk:servicios_adicionales_tipo_receptivo_chk', null::text, '287963a61189e468050a21ea57f3784f'),
    ('col:contrato_servicios.alcance_traslado', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('col:servicio_suplementos_franja.pax_desde', null::text, 'ca679b4f8cf32993811c8aed0edab813'),
    ('col:servicio_suplementos_franja.pax_hasta', null::text, 'ca679b4f8cf32993811c8aed0edab813'),
    ('col:servicios_adicionales.combo_incluye_traslado', null::text, '68e8c734465ffd79278adaf1664e7f12'),
    ('col:servicios_adicionales.combo_traslado_alcance', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('col:servicios_adicionales.tipo_receptivo', null::text, '83dc4f9f128b7d0c9a2d4e5706190e59'),
    ('fn:fn_franja_contiene', '24c0e8eda66132a040a426b9e03cb8cd', '24c0e8eda66132a040a426b9e03cb8cd'),
    ('fn:fn_franja_minutos', 'f0fc00b74485bf4524e3632ee6175b2b', 'f0fc00b74485bf4524e3632ee6175b2b'),
    ('fn:tg_servicio_precio_alcance_solape', null::text, '2b642c886a9ec8146f5c86266e8df7c6'),
    ('fn:tg_servicio_suplementos_franja_solape', '407aa56cef19b73b87f6896372e99529', '1f9536dad969c3f11dec4856d9f990a5'),
    ('idx:idx_servicio_precio_alcance_vigencia', null::text, '1518ba12483f8876742509e019e5b4ca'),
    ('idx:uq_servicio_precio_alcance_persona', null::text, '339020471b3e6b4c5e99ce5e47b341c0'),
    ('pol:servicio_precio_alcance: interno', null::text, '0cfc67ef775caedf4d5f3fabbcb7d7ca'),
    ('priv:anon', null::text, 'd41d8cd98f00b204e9800998ecf8427e'),
    ('priv:authenticated', null::text, '7aff36d98ea5480f97820ca45d87a51c'),
    ('tabla:servicio_precio_alcance', null::text, '110cec16ebae5246e84f7974cc9ab251'),
    ('trg:servicio_precio_alcance_solape', null::text, 'd5186437ebdf388df2d0bbd8b5e51f01'),
    ('trg:servicio_suplementos_franja_solape', '21a801aab4b043fa809dcdb7b8e90517', '21a801aab4b043fa809dcdb7b8e90517')
),
mal as (
  select e.etiqueta, o.huella from esp e left join obs o on o.etiqueta = e.etiqueta where o.huella is distinct from e.h262
),
cols as (select table_name || '.' || column_name || ':' || data_type as k from information_schema.columns where table_schema = 'public'),
cons as (select conrelid::regclass::text || '.' || conname as k from pg_constraint where convalidated),
n_cols as (select count(*) as n from cols where k in ('servicios_adicionales.tipo_receptivo:text','servicios_adicionales.combo_incluye_traslado:boolean','servicios_adicionales.combo_traslado_alcance:text',
            'servicio_suplementos_franja.pax_desde:integer','servicio_suplementos_franja.pax_hasta:integer','contrato_servicios.alcance_traslado:text','servicio_precio_alcance.precio:numeric')),
n_cons as (select count(*) as n from cons where k in ('servicios_adicionales.servicios_adicionales_tipo_receptivo_chk','servicios_adicionales.servicios_adicionales_combo_chk','servicio_suplementos_franja.servicio_suplementos_franja_pax_chk',
            'contrato_servicios.contrato_servicios_alcance_traslado_chk','servicio_precio_alcance.servicio_precio_alcance_alcance_chk','servicio_precio_alcance.servicio_precio_alcance_precio_chk','servicio_precio_alcance.servicio_precio_alcance_pax_chk')),
rel as (select to_regclass('public.servicio_precio_alcance') as r),
t3 as (
  select coalesce((select relrowsecurity from pg_class where oid = (select r from rel)), false) as rls,
         (select count(*) from pg_constraint where conrelid = (select r from rel) and contype = 'f' and confdeltype = 'c') as fk,
         (select count(*) from pg_indexes where indexname = 'uq_servicio_precio_alcance_persona') as uq,
         (select count(*) from pg_trigger where tgrelid = (select r from rel) and tgname = 'servicio_precio_alcance_solape' and not tgisinternal) as trg,
         (select count(*) from pg_policies where tablename = 'servicio_precio_alcance' and policyname = 'servicio_precio_alcance: interno') as pol
),
c as (
  select 1 as n, 'columnas nuevas (7)' as control, (select n from n_cols)::text as observado, '7' as esperado, case when (select n from n_cols) = 7 then 'OK' else 'FALLA' end as veredicto
  union all select 2, 'CHECK validados (tipo_receptivo, combo, pax de franja, alcance_traslado y 3 de servicio_precio_alcance)', (select n from n_cons)::text, '7', case when (select n from n_cons) = 7 then 'OK' else 'FALLA' end
  union all select 3, 'servicio_precio_alcance: RLS, FK en cascada, índice único por persona, trigger de rangos, policy',
         'rls=' || (select rls from t3)::text || ' fk=' || (select fk from t3)::text || ' uq=' || (select uq from t3)::text || ' trg=' || (select trg from t3)::text || ' pol=' || (select pol from t3)::text,
         'rls=true fk=1 uq=1 trg=1 pol=1',
         case when (select rls from t3) and (select fk from t3) = 1 and (select uq from t3) = 1 and (select trg from t3) = 1 and (select pol from t3) = 1 then 'OK' else 'FALLA' end
  union all select 4, 'anon sin acceso a servicio_precio_alcance',
         coalesce((select has_table_privilege('anon', (select r from rel), 'select')::text), 'no existe'), 'false',
         case when (select r from rel) is not null and not has_table_privilege('anon', (select r from rel), 'select') then 'OK' else 'FALLA' end
  union all select 5, 'trigger de solape de franjas considera pasajeros (la función menciona pax_desde)',
         (position('pax_desde' in coalesce(pg_get_functiondef(to_regprocedure('public.tg_servicio_suplementos_franja_solape()')), '')) > 0)::text, 'true',
         case when position('pax_desde' in coalesce(pg_get_functiondef(to_regprocedure('public.tg_servicio_suplementos_franja_solape()')), '')) > 0 then 'OK' else 'FALLA' end
  union all select 6, 'ningún servicio antiguo se clasificó solo: con tipo_receptivo / sin tipo',
         (select count(*) filter (where tipo_receptivo is not null) from public.servicios_adicionales)::text || ' / ' || (select count(*) filter (where tipo_receptivo is null) from public.servicios_adicionales)::text,
         '0 / todos (justo tras aplicar)', 'INFO'
  union all select 7, 'franjas existentes conservan pax NULL/NULL (todos los pasajeros)',
         (select count(*) from public.servicio_suplementos_franja where pax_desde is not null or pax_hasta is not null)::text, '0 (justo tras aplicar)', 'INFO'
  union all select 8, 'línea base: servicios / vigencias / franjas / contrato_servicios (comparar con el preflight)',
         (select count(*) from public.servicios_adicionales)::text || ' / ' || (select count(*) from public.servicio_temporadas)::text || ' / ' || (select count(*) from public.servicio_suplementos_franja)::text || ' / ' || (select count(*) from public.contrato_servicios)::text,
         'igual al preflight', 'INFO'
  union all select 9, 'huellas exactas: TODOS los objetos de la 262 y los de la 255 que reemplaza coinciden con la definición auditada de la 262',
         (select count(*) from esp)::text || ' auditados; con diferencia o ausentes: ' || (select count(*) from mal)::text || coalesce(' → ' || (select string_agg(etiqueta, ', ' order by etiqueta) from mal), ''),
         '0 con diferencia', case when (select count(*) from mal) = 0 then 'OK' else 'FALLA' end
  union all select 10, 'permisos efectivos de authenticated sobre servicio_precio_alcance: solo SELECT, INSERT, UPDATE, DELETE (sin TRUNCATE/REFERENCES/TRIGGER); anon sin nada',
         (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr where to_regclass('public.servicio_precio_alcance') is not null and has_table_privilege('authenticated', 'public.servicio_precio_alcance', pr)) || ' / anon: ' || coalesce((select string_agg(pr, ',') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr where to_regclass('public.servicio_precio_alcance') is not null and has_table_privilege('anon', 'public.servicio_precio_alcance', pr)), 'nada'),
         'DELETE,INSERT,SELECT,UPDATE / anon: nada',
         case when to_regclass('public.servicio_precio_alcance') is not null and not has_table_privilege('authenticated', 'public.servicio_precio_alcance', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.servicio_precio_alcance', 'REFERENCES') and not has_table_privilege('authenticated', 'public.servicio_precio_alcance', 'TRIGGER') and has_table_privilege('authenticated', 'public.servicio_precio_alcance', 'SELECT') and not has_table_privilege('anon', 'public.servicio_precio_alcance', 'SELECT') then 'OK' else 'FALLA' end
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con FALLA: ' || (select count(*) from c where veredicto = 'FALLA')::text, '0',
       case when (select count(*) from c where veredicto = 'FALLA') = 0 then 'OK' else 'FALLA' end
order by n;
