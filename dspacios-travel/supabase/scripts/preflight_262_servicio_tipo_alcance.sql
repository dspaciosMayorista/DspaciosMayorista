-- PREFLIGHT 262 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto. Pegar COMPLETA en el editor SQL de Supabase (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL. La 262 es ADITIVA (columnas nuevas + 1 tabla + reemplazo del trigger de solape de la 255); no modifica filas existentes.
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
desv as (
  select o.etiqueta, o.huella from obs o join esp e on e.etiqueta = o.etiqueta
   where o.huella is distinct from e.h255 and o.huella is distinct from e.h262
),
art as (
  select (exists (select 1 from information_schema.columns where table_schema='public' and table_name='servicios_adicionales' and column_name='tipo_receptivo'))::int
       + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='servicios_adicionales' and column_name='combo_incluye_traslado'))::int
       + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='servicios_adicionales' and column_name='combo_traslado_alcance'))::int
       + (to_regclass('public.servicio_precio_alcance') is not null)::int
       + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='servicio_suplementos_franja' and column_name='pax_desde'))::int
       + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='servicio_suplementos_franja' and column_name='pax_hasta'))::int
       + (exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_servicios' and column_name='alcance_traslado'))::int as n
),
c as (
  select 1 as n, 'servicios_adicionales existe' as control, (to_regclass('public.servicios_adicionales') is not null)::text as observado, 'true' as esperado,
         case when to_regclass('public.servicios_adicionales') is not null then 'OK' else 'BLOQUEA' end as veredicto
  union all select 2, 'servicio_temporadas existe (089)', (to_regclass('public.servicio_temporadas') is not null)::text, 'true',
         case when to_regclass('public.servicio_temporadas') is not null then 'OK' else 'BLOQUEA' end
  union all select 3, '255 aplicada: servicio_suplementos_franja y funciones de franja',
         (to_regclass('public.servicio_suplementos_franja') is not null and to_regprocedure('public.fn_franja_minutos(text)') is not null and to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null)::text, 'true',
         case when to_regclass('public.servicio_suplementos_franja') is not null and to_regprocedure('public.fn_franja_minutos(text)') is not null and to_regprocedure('public.fn_franja_contiene(integer,integer,integer)') is not null then 'OK' else 'BLOQUEA' end
  union all select 4, 'trigger de solape de la 255 presente (la 262 reemplaza su función)',
         (exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal))::text, 'true',
         case when exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.servicio_suplementos_franja') and t.tgname = 'servicio_suplementos_franja_solape' and not t.tgisinternal) then 'OK' else 'BLOQUEA' end
  union all select 5, 'contrato_servicios existe (115)', (to_regclass('public.contrato_servicios') is not null)::text, 'true',
         case when to_regclass('public.contrato_servicios') is not null then 'OK' else 'BLOQUEA' end
  union all select 6, 'mi_rol() existe', (to_regprocedure('public.mi_rol()') is not null)::text, 'true',
         case when to_regprocedure('public.mi_rol()') is not null then 'OK' else 'BLOQUEA' end
  union all select 7, 'estado de la 262: 0 = limpio · 7 = ya aplicada · otro = parcial', (select n from art)::text || ' de 7', '0 o 7',
         case when (select n from art) = 0 then 'OK' when (select n from art) = 7 then 'YA APLICADA' else 'BLOQUEA' end
  union all select 8, 'transacciones abiertas sin actividad > 1 min (pueden retener candados del ALTER)',
         (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute')::text, '0',
         case when (select count(*) from pg_stat_activity a where a.pid <> pg_backend_pid() and a.state = 'idle in transaction' and a.xact_start < now() - interval '1 minute') = 0 then 'OK' else 'REVISAR' end
  union all select 9, 'línea base (la 262 NO debe cambiarlas): servicios / vigencias / franjas / contrato_servicios',
         (select count(*) from public.servicios_adicionales)::text || ' / ' || (select count(*) from public.servicio_temporadas)::text || ' / '
         || (select count(*) from public.servicio_suplementos_franja)::text || ' / ' || (select count(*) from public.contrato_servicios)::text, 'anotar para el postcheck', 'INFO'
  union all select 10, 'huellas exactas: objetos de la 255 que la 262 usa o reemplaza (funciones de franja y trigger de solape) = definición auditada',
         coalesce((select string_agg(etiqueta, ', ' order by etiqueta) from desv where etiqueta in (select etiqueta from esp where h255 is not null)), 'todas coinciden'), 'todas coinciden',
         case when exists (select 1 from desv where etiqueta in (select etiqueta from esp where h255 is not null)) then 'BLOQUEA' else 'OK' end
  union all select 11, 'huellas exactas: objetos de la 262 que ya existan (columnas, restricciones, índices, policy, permisos, funciones) = definición auditada',
         coalesce((select string_agg(etiqueta, ', ' order by etiqueta) from desv where etiqueta in (select etiqueta from esp where h255 is null)), 'todas coinciden o aún no existen'), 'todas coinciden o aún no existen',
         case when exists (select 1 from desv where etiqueta in (select etiqueta from esp where h255 is null)) then 'BLOQUEA' else 'OK' end
  union all select 12, 'permisos efectivos sobre servicio_precio_alcance (si ya existe): anon / authenticated',
         coalesce((select string_agg(etiqueta || '=' || (case when etiqueta in (select etiqueta from desv) then 'DISTINTO' else 'auditado' end), ' ' order by etiqueta) from obs where etiqueta like 'priv:%'), 'tabla aún no existe'), 'auditado', 'INFO'
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con problema: ' || (select count(*) from c where veredicto in ('BLOQUEA','REVISAR'))::text, '0',
       case when (select count(*) from c where veredicto in ('BLOQUEA','REVISAR')) > 0 then 'NO APLICAR'
            when exists (select 1 from c where veredicto = 'YA APLICADA') then 'YA APLICADA (reaplicar es idempotente)' else 'APTO PARA APLICAR' end
order by n;
