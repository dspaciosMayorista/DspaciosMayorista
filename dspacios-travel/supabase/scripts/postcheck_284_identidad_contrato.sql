-- POSTCHECK de la migración 284 (identidad del contrato y guardas, #75 entrega 1). SOLO LECTURA. UNA consulta integral.
-- Pegar completa DESPUÉS de aplicar la 284 y ANTES de desplegar el código. Vuelve a correrse tras CUALQUIER migración que cree tablas de contrato.
-- Columnas: control · valor · esperado · estado (OK / REVISAR / INFO). Complementa la suite de integración (test_284_identidad_contrato.sh):
-- NO demuestra por sí solo que las acciones propaguen la identidad.
with
esc as (
  select distinct c.relname::text as tabla
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r','p') and (c.relname = 'ventas'
         or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
         or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass))),
fn as (select p.proname, p.prosecdef, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in ('contrato_guarda_identidad','contrato_verificar_identidad','contrato_ident_cabecera','contrato_ident_interna','contrato_declarar_identidad',
                            'contrato_instalar_guardas','contratos_identidades','sillas_identidades','fn_ventas_identidad_inmutable','fn_ventas_autodeclara_creacion'))
select * from (
  select 1 as o, 'ventas.contrato_uid (uuid, NOT NULL) y nacio_de_reuso (boolean, NOT NULL)' as control,
         coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ' / ' order by column_name) from information_schema.columns
                    where table_schema='public' and table_name='ventas' and column_name in ('contrato_uid','nacio_de_reuso')), 'NO EXISTEN') as valor,
         'contrato_uid:uuid:NO / nacio_de_reuso:boolean:NO' as esperado,
         case when (select count(*) from information_schema.columns where table_schema='public' and table_name='ventas'
                      and ((column_name='contrato_uid' and data_type='uuid' and is_nullable='NO') or (column_name='nacio_de_reuso' and data_type='boolean' and is_nullable='NO'))) = 2 then 'OK' else 'REVISAR' end as estado
  union all select 2, 'UNIQUE(contrato_uid) DEFERRABLE INITIALLY DEFERRED',
         coalesce((select condeferrable::text || '/' || condeferred::text from pg_constraint where conname='ventas_contrato_uid_uq'), 'NO EXISTE'), 'true/true',
         case when exists (select 1 from pg_constraint where conname='ventas_contrato_uid_uq' and condeferrable and condeferred) then 'OK' else 'REVISAR' end
  union all select 3, 'Todas las ventas tienen uid distinto (filas = uids distintos)',
         (select count(*)::text || ' = ' || count(distinct contrato_uid)::text from public.ventas), 'iguales',
         case when (select count(*) = count(distinct contrato_uid) from public.ventas) then 'OK' else 'REVISAR' end
  union all select 4, 'Ningún contrato ha nacido de reuso por la 284 (lo activa la entrega 3, con el reuso apagado hasta decisión del dueño)',
         (select count(*)::text from public.ventas where nacio_de_reuso), '0', case when (select count(*) from public.ventas where nacio_de_reuso) = 0 then 'OK' else 'INFO' end
  union all select 5, 'Tablas de contrato SIN clasificar en contrato_guardas_config',
         coalesce((select string_agg(tabla, ', ' order by tabla) from esc where tabla not in (select tabla from public.contrato_guardas_config)), '(ninguna)'), '(ninguna)',
         case when not exists (select 1 from esc where tabla not in (select tabla from public.contrato_guardas_config)) then 'OK' else 'REVISAR' end
  union all select 6, 'Tablas clasificadas (no excluidas) SIN trigger trg_contrato_guarda',
         coalesce((select string_agg(g.tabla, ', ' order by g.tabla) from public.contrato_guardas_config g
                    where g.modo <> 'excluida' and to_regclass('public.' || quote_ident(g.tabla)) is not null
                      and not exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || quote_ident(g.tabla)) and t.tgname = 'trg_contrato_guarda' and not t.tgisinternal)), '(ninguna)'), '(ninguna)',
         case when not exists (select 1 from public.contrato_guardas_config g
                    where g.modo <> 'excluida' and to_regclass('public.' || quote_ident(g.tabla)) is not null
                      and not exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || quote_ident(g.tabla)) and t.tgname = 'trg_contrato_guarda' and not t.tgisinternal)) then 'OK' else 'REVISAR' end
  union all select 7, 'Triggers trg_contrato_guarda: total y deshabilitados',
         (select count(*)::text || ' (deshabilitados: ' || count(*) filter (where tgenabled <> 'O')::text || ')' from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal), '(0 deshabilitados)',
         case when (select count(*) from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal) > 0
               and not exists (select 1 from pg_trigger where tgname='trg_contrato_guarda' and not tgisinternal and tgenabled <> 'O') then 'OK' else 'REVISAR' end
  union all select 8, 'Trigger de inmutabilidad de la identidad en ventas',
         (exists (select 1 from pg_trigger where tgname='trg_ventas_identidad_inmutable' and tgrelid='public.ventas'::regclass and tgenabled='O'))::text, 'true',
         case when exists (select 1 from pg_trigger where tgname='trg_ventas_identidad_inmutable' and tgrelid='public.ventas'::regclass and tgenabled='O') then 'OK' else 'REVISAR' end
  union all select 9, 'Funciones nuevas: 10 existen; guarda, verificación, contratos_identidades y sillas_identidades son SECURITY DEFINER',
         (select count(*)::text || ' / definer críticas: ' || count(*) filter (where prosecdef and proname in ('contrato_guarda_identidad','contrato_verificar_identidad','contratos_identidades','sillas_identidades'))::text from fn), '10 / 4',
         case when (select count(*) from fn) = 10 and (select count(*) filter (where prosecdef) from fn where proname in ('contrato_guarda_identidad','contrato_verificar_identidad','contratos_identidades','sillas_identidades')) = 4 then 'OK' else 'REVISAR' end
  union all select 10, 'declarar/instalar: sin EXECUTE para anon, authenticated ni service_role',
         (select bool_and(not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute'))::text
            from fn where proname in ('contrato_declarar_identidad','contrato_instalar_guardas')), 'true',
         case when (select bool_and(not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute'))
                      from fn where proname in ('contrato_declarar_identidad','contrato_instalar_guardas')) then 'OK' else 'REVISAR' end
  union all select 11, 'contratos_identidades: solo authenticated (no anon)',
         (select (has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))::text from fn where proname='contratos_identidades'), 'true',
         case when (select has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') from fn where proname='contratos_identidades') then 'OK' else 'REVISAR' end
  union all select 12, 'contrato_guardas_config: RLS activa y sin privilegios para anon/authenticated',
         (select (c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select'))::text from pg_class c where c.oid = to_regclass('public.contrato_guardas_config')), 'true',
         case when (select c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select') from pg_class c where c.oid = to_regclass('public.contrato_guardas_config')) then 'OK' else 'REVISAR' end
  union all select 13, 'Modos distintos de estricto (deben coincidir con el diseño aprobado)',
         coalesce((select string_agg(tabla || '=' || modo, ', ' order by tabla) from public.contrato_guardas_config where modo <> 'estricto'), '(ninguno)'),
         'avisos=estado_personal, cotizaciones=vinculo, movimientos_silla=desajuste',
         case when coalesce((select string_agg(tabla || '=' || modo, ', ' order by tabla) from public.contrato_guardas_config where modo <> 'estricto'), '') = 'avisos=estado_personal, cotizaciones=vinculo, movimientos_silla=desajuste' then 'OK' else 'REVISAR' end
) q order by o;
