-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 216 · #39 edición de cotizaciones dinámicas (A). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 216 (vale también con la 217 aplicada). UNA sola fila, incluso si
-- la 216 no está (entonces FALLA): las piezas de la 216 se consultan con SQL dinámico protegido.
--   veredicto   OK si los 22 controles dan verdadero; si no, FALLA.
--   ok / fallos / chequeos (= 22) / fallidos ("ninguno" o C3,C7,…)
--   resumen     C1=t;C2=f;…;C22=t (todos, en orden).
-- C21/C22 miran la configuración GUARDADA EN LA BASE (pg_db_role_setting: ALTER ROLE/DATABASE …
-- SET). El panel de Supabase (Data API > Exposed schemas) vive fuera de la base: revisarlo a mano
-- y confirmar que p39_priv NO esté entre los esquemas expuestos.
--   filas       "Filas: …" conteos informativos (sin datos personales).
--   detalle     jsonb con cada control: codigo, ok y su explicación.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
hay as (
  select to_regnamespace('p39_priv') is not null
         and to_regprocedure('p39_priv.frontera_activa()') is not null
         and to_regprocedure('public.edicion_cotizaciones_habilitada()') is not null
         and to_regprocedure('p39_priv.componentes_manual(bigint)') is not null
         and to_regprocedure('p39_priv.composicion_coincide(bigint,jsonb)') is not null
         and to_regclass('p39_priv.suspension_edicion') is not null
         and to_regclass('p39_priv.autorizacion_emitida') is not null
         and to_regclass('p39_priv.autorizacion_cerrada') is not null
         and to_regclass('public.cotizacion_ediciones') is not null as si
),
dyn(k, q) as (
  values ('susp_filas', 'select count(*)::text as v from p39_priv.suspension_edicion'),
         ('suspendida', 'select coalesce(bool_and(suspendida), true)::text as v from p39_priv.suspension_edicion'),
         ('frontera', 'select p39_priv.frontera_activa()::text as v'),
         ('habilitada', 'select public.edicion_cotizaciones_habilitada()::text as v'),
         ('comp', 'select ((select count(*) from p39_priv.componentes_manual(-1)) = 0 and p39_priv.composicion_coincide(-1, ''[]''::jsonb)
                           and not p39_priv.composicion_coincide(-1, ''{}''::jsonb))::text as v'),
         ('ediciones', 'select count(*)::text as v from public.cotizacion_ediciones'),
         ('emitidas', 'select count(*)::text as v from p39_priv.autorizacion_emitida'),
         ('cerradas', 'select count(*)::text as v from p39_priv.autorizacion_cerrada')
),
ev as (
  select d.k, case when (select si from hay) then (xpath('/row/v/text()', query_to_xml(d.q, false, true, '')))[1]::text end as v
    from dyn d
),
fn(sig) as (
  values ('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)'),
         ('public.editar_servicios_cotizacion_manual(uuid,bigint,integer,text,jsonb,jsonb)'),
         ('public.actualizar_recobro_ninos_manual(uuid,bigint,integer,text,jsonb)'),
         ('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)'),
         ('public.anular_pago_previo_controlado(bigint,uuid,text)'),
         ('public.convertir_cotizacion_manual_controlada(bigint,uuid)'),
         ('public.edicion_cotizaciones_habilitada()')
),
md5_198 as (
  select string_agg(coalesce(md5(replace(p.prosrc, chr(13), '')), 'falta'), ',' order by f.n) as h
    from (values (1, 'public.anular_pago_previo(bigint,uuid,text)'), (2, 'public.convertir_cotizacion_a_contrato(bigint,uuid)'),
                 (3, 'public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)'),
                 (4, 'public.transferir_pagos_previos_a_abonos(bigint,text,uuid)')) f(n, sig)
    left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
frontera as (
  select count(*) filter (where t.tgenabled = 'D') as deshabilitados,
         count(*) filter (where t.tgenabled in ('O', 'A')) as activos,
         count(*) as total
    from pg_trigger t
   where not t.tgisinternal and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39')
),
c0(n, comprobacion, ok) as (
  select 1, 'cotizaciones.economico_rev: integer NOT NULL',
         exists (select 1 from pg_attribute a where a.attrelid = 'public.cotizaciones'::regclass and a.attname = 'economico_rev'
                  and a.atttypid = 'integer'::regtype and a.attnotnull and not a.attisdropped)
  union all select 2, 'cotizacion_ediciones existe con RLS activo',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.cotizacion_ediciones')), false)
  union all select 3, 'policy de lectura del historial presente',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cotizacion_ediciones' and policyname = 'cotizacion_ediciones: lectura')
  union all select 4, 'p39_priv: USAGE solo para service_role (ni anon ni authenticated)',
         case when to_regnamespace('p39_priv') is null then false
              else has_schema_privilege('service_role', 'p39_priv', 'USAGE')
                   and not has_schema_privilege('anon', 'p39_priv', 'USAGE') and not has_schema_privilege('authenticated', 'p39_priv', 'USAGE') end
  union all select 5, 'tablas de p39_priv (3) con RLS y sin privilegios para la API',
         (select count(*) from pg_class c where c.relnamespace = to_regnamespace('p39_priv') and c.relkind = 'r' and c.relrowsecurity) = 3
         and not exists (select 1 from pg_class c, (values ('anon'), ('authenticated'), ('service_role')) r(rol)
                          where c.relnamespace = to_regnamespace('p39_priv') and c.relkind = 'r'
                            and has_table_privilege(r.rol, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  union all select 6, 'interruptor de suspensión: una fila',
         (select v from ev where k = 'susp_filas') = '1'
  union all select 7, 'las 7 funciones públicas nuevas existen con su firma',
         (select count(*) from fn where to_regprocedure(fn.sig) is not null) = 7
  union all select 8, 'wrappers INVOKER; RPC de edición y habilitación DEFINER con search_path fijo',
         coalesce((select bool_and(not p.prosecdef) and count(*) = 3 from pg_proc p where p.oid in (
            to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)'),
            to_regprocedure('public.anular_pago_previo_controlado(bigint,uuid,text)'), to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)'))), false)
         and coalesce((select bool_and(p.prosecdef and p.proconfig is not null) and count(*) = 4 from pg_proc p where p.oid in (
            to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)'),
            to_regprocedure('public.editar_servicios_cotizacion_manual(uuid,bigint,integer,text,jsonb,jsonb)'),
            to_regprocedure('public.actualizar_recobro_ninos_manual(uuid,bigint,integer,text,jsonb)'), to_regprocedure('public.edicion_cotizaciones_habilitada()'))), false)
  union all select 9, 'p39_priv.autorizada VOLATILE y DEFINER; emitir/cerrar DEFINER',
         coalesce((select provolatile = 'v' and prosecdef from pg_proc where oid = to_regprocedure('p39_priv.autorizada(bigint,text)')), false)
         and coalesce((select bool_and(prosecdef) and count(*) = 2 from pg_proc where oid in (to_regprocedure('p39_priv.emitir(bigint,text,uuid)'), to_regprocedure('p39_priv.cerrar(bigint)'))), false)
  union all select 10, 'EXECUTE de las funciones públicas: solo service_role (habilitación: solo authenticated)',
         (select count(*) from fn where to_regprocedure(fn.sig) is not null) = 7
         and not exists (select 1 from fn, (values ('anon'), ('authenticated'), ('service_role')) r(rol)
                          where to_regprocedure(fn.sig) is not null
                            and has_function_privilege(r.rol, to_regprocedure(fn.sig), 'EXECUTE')
                                <> case when fn.sig = 'public.edicion_cotizaciones_habilitada()' then r.rol = 'authenticated' else r.rol = 'service_role' end)
  union all select 11, 'EXECUTE en p39_priv: emitir/cerrar/autorizada/composicion_coincide solo service_role; el resto nadie de la API',
         to_regnamespace('p39_priv') is not null
         and not exists (select 1 from pg_proc p, (values ('anon'), ('authenticated'), ('service_role')) r(rol)
                          where p.pronamespace = to_regnamespace('p39_priv')
                            and has_function_privilege(r.rol, p.oid, 'EXECUTE')
                                <> (r.rol = 'service_role' and p.proname in ('emitir', 'cerrar', 'autorizada', 'composicion_coincide')))
  union all select 12, 'revisión económica activa (1 en cotizaciones + 3 en servicios)',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled in ('O', 'A')
           and t.tgname in ('trg_cot_economico_rev_39', 'trg_cot_servicios_rev_39_ins', 'trg_cot_servicios_rev_39_upd', 'trg_cot_servicios_rev_39_del')) = 4
  union all select 13, 'frontera presente y NO a medias: 3 deshabilitados (solo 216) o 3 activos con la 217',
         (select total = 3 and (deshabilitados = 3 or (activos = 3 and (select v from ev where k = 'frontera') = 'true')) from frontera)
  union all select 14, 'historial y autorizaciones de solo inserción (6 disparadores)',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('trg_cotizacion_ediciones_inmutable', 'trg_cotizacion_ediciones_truncate',
            'trg_p39_emitida_inmutable', 'trg_p39_emitida_truncate', 'trg_p39_cerrada_inmutable', 'trg_p39_cerrada_truncate')) = 6
  union all select 15, 'las 4 RPC de dinero de la 198 sin cambios (md5 de main)',
         (select h from md5_198) = '49bb1f21f071141d30926ad426f87369,edc9975010746e53e4af6a75ad9763dc,146d0275f5a97b9ecd6a52e11161b248,4814691695eb7587c18628ede17f266f'
  union all select 16, 'los 10 disparadores de la 211 siguen presentes',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
            ('trg_cotizaciones_comparativa_guarda', 'trg_cotizaciones_hija_descartada', 'trg_cot_servicios_comparativa_guarda', 'trg_madre_sin_pagos',
             'trg_madre_sin_condiciones', 'trg_madre_sin_venta', 'trg_opciones_inmutables', 'trg_eventos_inmutables', 'trg_solicitudes_guarda', 'trg_validaciones_guarda')) = 10
  union all select 17, 'habilitación coherente: = frontera activa y sin suspensión',
         (select v from ev where k = 'habilitada')
           = (((select v from ev where k = 'frontera') = 'true') and ((select v from ev where k = 'suspendida') = 'false'))::text
  union all select 18, 'ninguna función de #39 lee variables de sesión salvo frontera_activa (session_replication_role)',
         to_regnamespace('p39_priv') is not null
         and not exists (select 1 from pg_proc p where (p.pronamespace = to_regnamespace('p39_priv') or p.oid in (select to_regprocedure(sig) from fn))
                          and p.proname <> 'frontera_activa' and p.prosrc ilike '%current_setting%')
  union all select 19, 'cotizacion_ediciones: authenticated solo SELECT; nadie de la API escribe',
         case when to_regclass('public.cotizacion_ediciones') is null then false
              else has_table_privilege('authenticated', 'public.cotizacion_ediciones', 'SELECT')
                   and not has_table_privilege('anon', 'public.cotizacion_ediciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
                   and not has_table_privilege('authenticated', 'public.cotizacion_ediciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
                   and not has_table_privilege('service_role', 'public.cotizacion_ediciones', 'INSERT,UPDATE,DELETE,TRUNCATE') end
  union all select 20, 'composición en SQL operativa (id inexistente: sin componentes; snapshot vacío coincide, objeto no)',
         (select v from ev where k = 'comp') = 'true'
  -- service_role tiene USAGE y EXECUTE en p39_priv (los wrappers INVOKER los necesitan): si el
  -- esquema llegara a exponerse, una sola mutation GraphQL podría encadenar `emitir` con escrituras
  -- directas. Se revisa CADA valor guardado (rol, base o rol+base), no la cadena unida por comas:
  -- un search_path "public, p39_priv" lleva comas dentro.
  union all select 21, 'p39_priv fuera de pgrst.db_schemas y pgrst.db_extra_search_path en la configuración guardada (revisar además el panel)',
         not exists (select 1 from pg_db_role_setting s, unnest(s.setconfig) e(v)
                      where e.v ~* '^pgrst\.db_(schemas|extra_search_path)=' and e.v ~* 'p39_priv')
  union all select 22, 'p39_priv fuera de todo search_path guardado (roles y bases): pg_graphql no lo refleja',
         not exists (select 1 from pg_db_role_setting s, unnest(s.setconfig) e(v)
                      where e.v ~* '^search_path=' and e.v ~* 'p39_priv')
),
c as (
  select n, comprobacion, coalesce(ok, false) as ok from c0
)
select case when count(*) filter (where not ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok)::int as ok,
       count(*) filter (where not ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg('C' || n, ',' order by n) filter (where not ok), 'ninguno') as fallidos,
       string_agg('C' || n || '=' || case when ok then 't' else 'f' end, ';' order by n) as resumen,
       'Filas: ediciones=' || coalesce((select v from ev where k = 'ediciones'), 'n/a')
         || ' · autorizaciones=' || coalesce((select v from ev where k = 'emitidas'), 'n/a')
         || ' · cerradas=' || coalesce((select v from ev where k = 'cerradas'), 'n/a')
         || ' · manuales_con_autor=' || (select count(*) from public.cotizaciones where tipo = 'manual' and creado_por_id is not null)
         || ' · suspendida=' || coalesce((select v from ev where k = 'suspendida'), 'n/a') as filas,
       jsonb_agg(jsonb_build_object('codigo', 'C' || n, 'ok', ok, 'comprobacion', comprobacion) order by n) as detalle
  from c;

rollback;
