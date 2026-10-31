-- POSTCHECK 265 · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · veredicto. Pegar COMPLETA en el editor SQL de Supabase (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL. Verifica el ESTADO FINAL de la 265.
-- Fila 9: para comparar las RPC financieras con su estado ANTERIOR (antes de la 262) reemplaza los dos textos de abajo por las huellas completas que dio la consulta de la fila 9 EN LA BASE
-- ANTES DE APLICAR NADA (formato '<md5 registrar>/<md5 p63>'). Sin reemplazarlos la fila 9 queda INFO (muestra las huellas actuales).
with
ref(h_antes) as (select 'PEGAR_HUELLAS_ANTES'::text),
fn(proname, tipo) as (values ('tg_cxp_enlace_por_clave', 'trigger'), ('tg_cxp_enlace_inmutable', 'trigger'), ('tg_linea_enlazada_protegida', 'trigger'), ('tg_ventas_completo_exige_enlaces', 'trigger'), ('corregir_enlace_cxp_alcance', 'rpc')),
fninfo as (
    select f.proname, f.tipo, p.oid, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
           has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
           (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_x
      from fn f left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = f.proname
),
trg as (
    select t.tgname, t.tgenabled, c.relname, p.proname as fn from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal and t.tgname in ('cxp_enlace_por_clave', 'cxp_enlace_inmutable', 'linea_enlazada_protegida', 'ventas_completo_exige_enlaces', 'cxp_enlazar_servicio_alcance')
),
h as (
    select left(md5(replace(pg_get_functiondef('public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure), chr(13), '')), 32) || '/' || left(md5(replace(pg_get_functiondef('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)'::regprocedure), chr(13), '')), 32) as actual
),
c(n, control, observado, esperado, veredicto) as (
    select 1, 'contrato_servicios.clave_enlace (uuid) + índice único parcial válido',
           coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'clave_enlace'), 'AUSENTE') || ' / '
             || coalesce((select (i.indisunique and i.indisvalid and i.indpred is not null)::text from pg_index i join pg_class k on k.oid = i.indexrelid where k.relname = 'uq_contrato_servicios_clave_enlace' and k.relnamespace = 'public'::regnamespace), 'AUSENTE'),
           'uuid / true',
           case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'clave_enlace' and data_type = 'uuid')
                 and exists (select 1 from pg_index i join pg_class k on k.oid = i.indexrelid where k.relname = 'uq_contrato_servicios_clave_enlace' and k.relnamespace = 'public'::regnamespace and i.indisunique and i.indisvalid and i.indpred is not null) then 'OK' else 'FALLA' end
    union all select 2, '4 triggers de la 265 HABILITADOS en su tabla y apuntando a su función',
           coalesce((select string_agg(tgname || '@' || relname || '=' || tgenabled::text, ', ' order by tgname) from trg where tgname <> 'cxp_enlazar_servicio_alcance'), 'ninguno'),
           'cxp_enlace_inmutable@cuentas_por_pagar=O, cxp_enlace_por_clave@cuentas_por_pagar=O, linea_enlazada_protegida@contrato_servicios=O, ventas_completo_exige_enlaces@ventas=O',
           case when (select count(*) from trg where tgenabled = 'O' and tgname <> 'cxp_enlazar_servicio_alcance'
                       and (tgname, relname, fn) in (('cxp_enlace_por_clave', 'cuentas_por_pagar', 'tg_cxp_enlace_por_clave'), ('cxp_enlace_inmutable', 'cuentas_por_pagar', 'tg_cxp_enlace_inmutable'),
                                                      ('linea_enlazada_protegida', 'contrato_servicios', 'tg_linea_enlazada_protegida'), ('ventas_completo_exige_enlaces', 'ventas', 'tg_ventas_completo_exige_enlaces'))) = 4 then 'OK' else 'FALLA' end
    union all select 3, 'las 5 funciones existen, son SECURITY DEFINER y con search_path fijo (public, pg_temp)',
           (select count(*) from fninfo where oid is not null and prosecdef and cfg = 'search_path=public, pg_temp')::text || ' de 5', '5 de 5',
           case when (select count(*) from fninfo where oid is not null and prosecdef and cfg = 'search_path=public, pg_temp') = 5 then 'OK' else 'FALLA' end
    union all select 4, 'trigger y función de la 264 (cxp_enlazar_servicio_alcance / tg_cxp_enlazar_servicio_alcance) AUSENTES',
           (select count(*) from trg where tgname = 'cxp_enlazar_servicio_alcance')::text || ' / ' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_cxp_enlazar_servicio_alcance')::text, '0 / 0',
           case when not exists (select 1 from trg where tgname = 'cxp_enlazar_servicio_alcance') and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tg_cxp_enlazar_servicio_alcance') then 'OK' else 'FALLA' end
    union all select 5, 'permisos: corregir_enlace_cxp_alcance solo authenticated; las 4 funciones de trigger sin EXECUTE para anon, authenticated ni PUBLIC',
           'corregir: anon=' || coalesce((select anon_x::text from fninfo where proname = 'corregir_enlace_cxp_alcance'), '?') || ' public=' || coalesce((select public_x::text from fninfo where proname = 'corregir_enlace_cxp_alcance'), '?') || ' authenticated=' || coalesce((select auth_x::text from fninfo where proname = 'corregir_enlace_cxp_alcance'), '?')
             || ' · triggers con acceso: ' || (select count(*) from fninfo where tipo = 'trigger' and (anon_x or auth_x or public_x))::text,
           'corregir: anon=false public=false authenticated=true · triggers con acceso: 0',
           case when (select count(*) from fninfo where proname = 'corregir_enlace_cxp_alcance' and oid is not null and not anon_x and not public_x and auth_x) = 1
                 and (select count(*) from fninfo where tipo = 'trigger' and oid is not null and not (anon_x or auth_x or public_x)) = 4 then 'OK' else 'FALLA' end
    union all select 6, 'CHECK de alcance en cuentas_por_pagar validado (llegada | salida | ida_regreso)',
           coalesce((select convalidated::text || ' · ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'cuentas_por_pagar_alcance_traslado_chk' and conrelid = 'public.cuentas_por_pagar'::regclass), 'AUSENTE'), 'true',
           case when exists (select 1 from pg_constraint where conname = 'cuentas_por_pagar_alcance_traslado_chk' and conrelid = 'public.cuentas_por_pagar'::regclass and convalidated and pg_get_constraintdef(oid) like '%llegada%salida%ida_regreso%') then 'OK' else 'FALLA' end
    union all select 7, 'FKs validadas con ON DELETE SET NULL: contrato_servicios.servicio_id -> servicios_adicionales y cuentas_por_pagar.contrato_servicio_id -> contrato_servicios',
           coalesce((select string_agg(conrelid::regclass::text || '->' || confrelid::regclass::text || ':' || confdeltype::text || ':' || convalidated::text, ', ' order by conrelid::regclass::text)
                       from pg_constraint where contype = 'f' and ((conrelid = 'public.contrato_servicios'::regclass and confrelid = 'public.servicios_adicionales'::regclass and conkey = array[(select attnum from pg_attribute where attrelid = 'public.contrato_servicios'::regclass and attname = 'servicio_id')])
                                                                or (conrelid = 'public.cuentas_por_pagar'::regclass and confrelid = 'public.contrato_servicios'::regclass and conkey = array[(select attnum from pg_attribute where attrelid = 'public.cuentas_por_pagar'::regclass and attname = 'contrato_servicio_id')]))), 'AUSENTES'),
           'contrato_servicios->servicios_adicionales:n:true, cuentas_por_pagar->contrato_servicios:n:true',
           case when (select count(*) from pg_constraint where contype = 'f' and confdeltype = 'n' and convalidated and ((conrelid = 'public.contrato_servicios'::regclass and confrelid = 'public.servicios_adicionales'::regclass and conkey = array[(select attnum from pg_attribute where attrelid = 'public.contrato_servicios'::regclass and attname = 'servicio_id')])
                                                                                                                       or (conrelid = 'public.cuentas_por_pagar'::regclass and confrelid = 'public.contrato_servicios'::regclass and conkey = array[(select attnum from pg_attribute where attrelid = 'public.cuentas_por_pagar'::regclass and attname = 'contrato_servicio_id')]))) = 2 then 'OK' else 'FALLA' end
    union all select 8, 'índice único uq_cxp_contrato_servicio (una línea, a lo sumo una CxP) válido',
           coalesce((select (i.indisunique and i.indisvalid)::text from pg_index i join pg_class k on k.oid = i.indexrelid where k.relname = 'uq_cxp_contrato_servicio' and k.relnamespace = 'public'::regnamespace), 'AUSENTE'), 'true',
           case when exists (select 1 from pg_index i join pg_class k on k.oid = i.indexrelid where k.relname = 'uq_cxp_contrato_servicio' and k.relnamespace = 'public'::regnamespace and i.indisunique and i.indisvalid) then 'OK' else 'FALLA' end
    union all select 9, 'registrar_financiero_contrato y p63_registrar_financiero NO fueron reemplazadas: huellas md5 completas = las de ANTES de aplicar la 262',
           (select actual from h), (select case when h_antes !~ '^[0-9a-f]{32}/[0-9a-f]{32}$' then '(sin huellas de referencia: pega las de la base antes de aplicar nada)' else h_antes end from ref),
           case when (select h_antes from ref) !~ '^[0-9a-f]{32}/[0-9a-f]{32}$' then 'INFO' when (select actual from h) = (select h_antes from ref) then 'OK' else 'FALLA' end
)
select n, control, observado, esperado, veredicto from c
union all
select 99, 'VEREDICTO GLOBAL', 'controles con FALLA: ' || (select count(*) from c where veredicto = 'FALLA')::text, '0', case when (select count(*) from c where veredicto = 'FALLA') > 0 then 'FALLA' else 'OK' end
order by n;
