-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 222 · hija manual con precio NETO (#50). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 222. Devuelve UNA sola fila consolidada (formato de la 214/219):
--   veredicto   OK solo si las 16 verificaciones (C1-C16) dan true; si no, FALLA.
--   ok / fallos / chequeos   conteos (esperado: 16 / 0 / 16). Un resultado nulo cuenta como falla.
--   fallidos    códigos que fallaron, o 'ninguno'.
--   resumen     C1=t;C2=t;...;C16=t  (todas, en orden; t = pasa, f = falla).
--   filas       C16 (informativa): hijas selladas hoy (PVP / NETO) — 0 / 0 recién aplicada.
--   detalle     jsonb con cada verificación: codigo, ok y su explicación.
-- No lee datos personales: solo catálogo y conteos.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
tablas(nombre) as (values ('cotizacion_neto'), ('cotizacion_neto_componentes')),
privadas(firma, para_service) as (
  values ('p50_priv.exigir_modalidad()', false), ('p50_priv.repartir(bigint,bigint[])', false), ('p50_priv.rol_fija_neto(text)', false),
         ('p50_priv.rol_autoriza_margen(text,boolean)', false), ('p50_priv.evaluar_margen(bigint,bigint,boolean)', false),
         ('p50_priv.calcular(bigint,boolean,numeric,numeric)', false), ('p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', false),
         ('p50_priv.modalidad_coincide(bigint,text,boolean)', false), ('p50_priv.requiere_modalidad(bigint)', false),
         ('p50_priv.resolver_impl(bigint,text,text,text,text,boolean,boolean)', false),
         ('p50_priv.composicion_neto_coincide(bigint,jsonb)', true), ('p50_priv.validar_conversion(bigint,uuid)', true),
         ('p50_priv.completar_conversion(bigint,text)', true)
),
definer(oid) as (
  select p.oid from pg_proc p
   where p.prosecdef and (p.pronamespace = to_regnamespace('p50_priv')
         or p.oid in (to_regprocedure('public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)'),
                      to_regprocedure('public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)')))
),
reemplazadas(firma, marca) as (
  values ('public.elegir_opcion_comparativa_sesion(uuid,text)', 'p50_priv.sellar_hija'),
         ('public.resolver_solicitud_comparativa(bigint,text,text,text)', 'p50_priv.resolver_impl'),
         ('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', 'p50_priv.composicion_neto_coincide'),
         ('public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'p50_priv.completar_conversion')
),
chequeos as (
  select 'C1' as codigo,
         (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select nombre from tablas) and c.relrowsecurity) = 2
         and not exists (select 1 from pg_policies pp where pp.tablename in (select nombre from tablas)) as ok,
         'cotizacion_neto y cotizacion_neto_componentes: RLS activo y SIN policies' as detalle
  union all
  select 'C2',
         not has_table_privilege('anon', 'public.cotizacion_neto', 'select,insert,update,delete,truncate')
         and not has_table_privilege('authenticated', 'public.cotizacion_neto', 'select,insert,update,delete,truncate')
         and not has_table_privilege('authenticated', 'public.cotizacion_neto_componentes', 'select,insert,update,delete,truncate')
         and not has_table_privilege('anon', 'public.cotizacion_neto_componentes', 'select,insert,update,delete,truncate')
         and has_table_privilege('service_role', 'public.cotizacion_neto', 'select')
         and has_table_privilege('service_role', 'public.cotizacion_neto_componentes', 'select')
         and not has_table_privilege('service_role', 'public.cotizacion_neto', 'insert,update,delete,truncate')
         and not has_table_privilege('service_role', 'public.cotizacion_neto_componentes', 'insert,update,delete,truncate'),
         'Permisos de las tablas: nada para anon/authenticated; service_role solo SELECT'
  union all
  select 'C3',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D'
            and t.tgrelid in (to_regclass('public.cotizacion_neto'), to_regclass('public.cotizacion_neto_componentes'))
            and t.tgname in ('trg_cotizacion_neto_inmutable', 'trg_cotizacion_neto_truncate',
                             'trg_cotizacion_neto_comp_inmutable', 'trg_cotizacion_neto_comp_truncate')) = 4,
         'Los 4 disparadores de solo inserción (update/delete/truncate) están habilitados'
  union all
  select 'C4',
         (select count(*) from pg_constraint c where c.conrelid = to_regclass('public.cotizacion_neto')
            and c.conname in ('cotizacion_neto_cot_fk', 'cotizacion_neto_aliado', 'cotizacion_neto_pvp', 'cotizacion_neto_neto')) = 4
         and (select count(*) from pg_constraint c where c.conrelid = to_regclass('public.cotizacion_neto_componentes')
                and c.conname = 'cotizacion_neto_componentes_neto') = 1,
         'Restricciones del sello (FK compuesta, aliado, PVP, NETO) y del reparto presentes'
  union all
  select 'C5',
         (select count(*) from pg_attribute a where a.attrelid = to_regclass('public.cotizacion_comparativa_validaciones')
            and a.attname in ('modalidad', 'reconoce_recobro', 'autorizar_margen') and a.attnum > 0 and not a.attisdropped) = 3,
         'cotizacion_comparativa_validaciones: columnas modalidad, reconoce_recobro y autorizar_margen'
  union all
  select 'C6',
         has_schema_privilege('service_role', 'p50_priv', 'USAGE') and not has_schema_privilege('anon', 'p50_priv', 'USAGE')
         and not has_schema_privilege('authenticated', 'p50_priv', 'USAGE'),
         'p50_priv: USAGE solo para service_role'
  union all
  select 'C7',
         (select bool_and(to_regprocedure(f.firma) is not null
                          and has_function_privilege('service_role', to_regprocedure(f.firma), 'EXECUTE') = f.para_service
                          and not has_function_privilege('authenticated', to_regprocedure(f.firma), 'EXECUTE')
                          and not has_function_privilege('anon', to_regprocedure(f.firma), 'EXECUTE')) from privadas f),
         'Las 13 funciones de p50_priv existen; solo las 3 que llama el wrapper son ejecutables por service_role'
  union all
  select 'C8',
         has_function_privilege('service_role', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE'),
         'RPC nuevas: la del recibo solo service_role; la de resolver solo authenticated (identidad = auth.uid())'
  union all
  select 'C9',
         has_function_privilege('authenticated', 'public.elegir_opcion_comparativa_sesion(uuid,text)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.elegir_opcion_comparativa_sesion(uuid,text)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.resolver_solicitud_comparativa(bigint,text,text,text)', 'EXECUTE')
         and not has_function_privilege('service_role', 'public.resolver_solicitud_comparativa(bigint,text,text,text)', 'EXECUTE')
         and has_function_privilege('service_role', 'public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)', 'EXECUTE')
         and has_function_privilege('service_role', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE'),
         'Las 4 funciones reemplazadas conservan su ACL de la 211/216'
  union all
  select 'C10',
         (select bool_and(coalesce(p.prosrc like '%' || r.marca || '%', false)) from reemplazadas r join pg_proc p on p.oid = to_regprocedure(r.firma)),
         'Las 4 funciones reemplazadas ya llevan la lógica de #50 (marca en el cuerpo)'
  union all
  select 'C11',
         (select not prosecdef from pg_proc where oid = to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)'))
         and (select not prosecdef from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')),
         'Los wrappers de pago y conversión siguen siendo SECURITY INVOKER'
  union all
  select 'C12',
         not exists (select 1 from definer d join pg_proc p on p.oid = d.oid
                      where not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%' and c like '%pg_temp')),
         'Toda función SECURITY DEFINER de #50 fija search_path con pg_temp al final'
  union all
  select 'C13',
         not exists (select 1 from pg_proc p where p.pronamespace = to_regnamespace('p50_priv') and p.prosrc ilike '%current_setting%')
         and (select provolatile = 's' from pg_proc where oid = to_regprocedure('p50_priv.calcular(bigint,boolean,numeric,numeric)'))
         and (select provolatile = 'i' from pg_proc where oid = to_regprocedure('p50_priv.repartir(bigint,bigint[])')),
         'Sin current_setting; calcular es STABLE (consulta tablas) y repartir IMMUTABLE (pura)'
  union all
  select 'C14',
         md5(replace(coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), ''), chr(13), ''))
           = 'edc9975010746e53e4af6a75ad9763dc',
         'La RPC 198 de conversión conserva el cuerpo de main (md5)'
  union all
  select 'C15',
         (select count(*) from pg_catalog.pg_trigger t
           where not t.tgisinternal and t.tgenabled in ('O', 'A')
             and t.tgname in ('trg_cot_frontera_39', 'trg_cot_economico_rev_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39',
                              'trg_cot_servicios_rev_39_ins', 'trg_cot_servicios_rev_39_upd', 'trg_cot_servicios_rev_39_del')) = 7
         and not has_table_privilege('service_role', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('authenticated', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('service_role', 'public.cotizacion_condiciones', 'TRUNCATE')
         and (select count(*) from pg_class c where c.oid = to_regclass('p50_priv.config')) = 1,
         'La frontera de #39 sigue íntegra (7 disparadores, permisos) y existe el interruptor p50_priv.config'
  union all
  select 'C16', true,
         'Sellos hoy: PVP=' || (select count(*) from public.cotizacion_neto where modalidad = 'pvp')
           || ' / NETO=' || (select count(*) from public.cotizacion_neto where modalidad = 'neto')
           || '; modalidad obligatoria=' || (select exigir_modalidad::text from p50_priv.config where id)
),
orden as (
  select c.codigo, coalesce(c.ok, false) as ok, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) filter (where not o.ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where o.ok)::int as ok,
       count(*) filter (where not o.ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg(o.codigo, ', ' order by o.n) filter (where not o.ok), 'ninguno') as fallidos,
       string_agg(o.codigo || '=' || case when o.ok then 't' else 'f' end, ';' order by o.n) as resumen,
       (select o2.detalle from orden o2 where o2.codigo = 'C16') as filas,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'ok', o.ok, 'detalle', o.detalle) order by o.n) as detalle
  from orden o;

rollback;
