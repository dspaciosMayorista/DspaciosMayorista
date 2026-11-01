-- HUELLAS 262 · SOLO LECTURA · una consulta: etiqueta · observada · auditada 255 · auditada 262 · estado. Pegar COMPLETA en el editor SQL de Supabase.
-- Sirve para ver qué objeto fue modificado por otra vía ANTES de aplicar la 262 (estado «DISTINTA») o DESPUÉS (postcheck/rollback la usan igual).
-- Estados: OK 255 (definición auditada de la 255) · OK 262 (definición auditada de la 262) · AUSENTE (objeto de la 262 aún no creado) · FALTA (objeto de la 255 ausente) · DISTINTA (modificado por otra vía).
with obs as (
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
), esp(etiqueta, h255, h262) as (values
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
)
select coalesce(e.etiqueta, o.etiqueta) as etiqueta, o.huella as observada, e.h255 as auditada_255, e.h262 as auditada_262,
       case when e.etiqueta is null then 'SIN AUDITAR'
            when o.huella is null and e.h255 is null then 'AUSENTE (se crea en la 262)'
            when o.huella is null then 'FALTA'
            when o.huella = e.h255 and e.h255 is distinct from e.h262 then 'OK 255'
            when o.huella = e.h262 then 'OK 262'
            when o.huella = e.h255 then 'OK 255'
            else 'DISTINTA' end as estado
  from esp e full join obs o on o.etiqueta = e.etiqueta
 order by 1;
