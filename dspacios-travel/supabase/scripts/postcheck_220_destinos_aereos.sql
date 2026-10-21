-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 220 · #67 destinos aéreos alternativos. SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 220. UNA fila: veredicto OK si todos los controles dan verdadero.
--   C1  columna destinos_aereos_alternativos (boolean not null default false)
--   C2  tabla armado_paquete_destinos_aereos con PK (paquete_id, destino_id), FK a armado_paquetes y SIN FK a destinos
--   C3  RLS activa en la tabla y policy interna presente
--   C4  anon sin ningún privilegio sobre la tabla; authenticated con CRUD (gobernado por la policy)
--   C5  funciones de regla: pais_comparable_67, destinos_aereos_efectivos_67 (no ejecutables por anon/authenticated)
--   C6  validadores SECURITY DEFINER con search_path fijo y sin ejecución para anon/authenticated
--   C7  guardar_destinos_aereos_67 SECURITY INVOKER: authenticated y service_role la ejecutan, anon no
--   C8  triggers de restricción DIFERIDOS (vínculo en armado_vuelos/armado_empaquetados; configuración
--       en armado_paquetes y en la tabla de alternativas) y habilitados
--   C9  triggers de invalidación (181) presentes y habilitados
--   C10 paridad de pais_comparable_67 con la regla (vectores fijos)
--   C11 ningún paquete tiene check encendido sin alternativas ni alternativas inválidas (estado final coherente)
--   C12 trigger de auditoría en la tabla nueva (si fn_auditoria existe)
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
c as (
  select 'C1' as codigo,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'destinos_aereos_alternativos'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') as ok,
         'Columna armado_paquetes.destinos_aereos_alternativos boolean not null default false' as detalle
  union all
  select 'C2',
         to_regclass('public.armado_paquete_destinos_aereos') is not null
         and exists (select 1 from pg_constraint where conrelid = 'public.armado_paquete_destinos_aereos'::regclass and contype = 'p')
         and (select count(*) from pg_constraint where conrelid = 'public.armado_paquete_destinos_aereos'::regclass and contype = 'f') = 1
         and not exists (select 1 from pg_constraint where conrelid = 'public.armado_paquete_destinos_aereos'::regclass and contype = 'f' and confrelid = 'public.destinos'::regclass),
         'Tabla con PK y UNA sola FK (armado_paquetes); a propósito sin FK a destinos'
  union all
  select 'C3',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.armado_paquete_destinos_aereos')), false)
         and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'armado_paquete_destinos_aereos'),
         'RLS activa y policy interna presente'
  union all
  select 'C4',
         to_regclass('public.armado_paquete_destinos_aereos') is not null
         and not has_table_privilege('anon', 'public.armado_paquete_destinos_aereos', 'SELECT')
         and not has_table_privilege('anon', 'public.armado_paquete_destinos_aereos', 'INSERT')
         and has_table_privilege('authenticated', 'public.armado_paquete_destinos_aereos', 'SELECT')
         and has_table_privilege('authenticated', 'public.armado_paquete_destinos_aereos', 'INSERT'),
         'anon sin privilegios; authenticated con CRUD (la policy decide)'
  union all
  select 'C5',
         to_regprocedure('public.pais_comparable_67(text)') is not null
         and to_regprocedure('public.destinos_aereos_efectivos_67(bigint,boolean,bigint[])') is not null
         and not has_function_privilege('anon', 'public.pais_comparable_67(text)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.pais_comparable_67(text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.destinos_aereos_efectivos_67(bigint,boolean,bigint[])', 'EXECUTE')
         and not has_function_privilege('authenticated', 'public.destinos_aereos_efectivos_67(bigint,boolean,bigint[])', 'EXECUTE'),
         'Funciones puras presentes y sin ejecución para anon/authenticated'
  union all
  select 'C6',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('validar_vinculo_aereo_67', 'validar_config_destinos_aereos_67', 'trg_vinculo_aereo_67',
                 'trg_config_paquete_aereo_67', 'trg_config_alternativa_aerea_67', 'trg_invalidar_config_aerea_67', 'trg_invalidar_origen_aereo_67')
             and p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
             and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 7,
         'Los 7 validadores/triggers son SECURITY DEFINER con search_path fijo y sin ejecución para anon/authenticated'
  union all
  select 'C7',
         to_regprocedure('public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])') is not null
         and not (select prosecdef from pg_proc where oid = to_regprocedure('public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])'))
         and has_function_privilege('authenticated', 'public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])', 'EXECUTE')
         and has_function_privilege('service_role', 'public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])', 'EXECUTE')
         and not has_function_privilege('anon', 'public.guardar_destinos_aereos_67(bigint,bigint,boolean,bigint[])', 'EXECUTE'),
         'guardar_destinos_aereos_67 SECURITY INVOKER; anon sin ejecución'
  union all
  select 'C8',
         (select count(*) from pg_trigger t
               where not t.tgisinternal and t.tgenabled <> 'D' and t.tgdeferrable and t.tginitdeferred and t.tgconstraint <> 0
                 and t.tgname in ('tr_vinculo_aereo_67', 'tr_config_paquete_aereo_67_ins', 'tr_config_paquete_aereo_67_upd', 'tr_config_alternativa_aerea_67')) = 5,
         'Triggers de restricción diferidos y habilitados (2 de vínculo + 3 de configuración)'
  union all
  select 'C9',
         (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D'
            and t.tgname in ('tr_inv_check_aereo_67', 'tr_inv_alternativas_aereas_67', 'tr_inv_destino_bloqueo_67',
                             'tr_inv_destino_empaquetado_67', 'tr_inv_destino_pais_67')) = 5,
         'Triggers de invalidación del tarifario presentes y habilitados'
  union all
  select 'C10',
         public.pais_comparable_67('  República   DOMINICANA ') = 'republica dominicana'
         and public.pais_comparable_67('Curaçao') = 'curacao'
         and public.pais_comparable_67('MÉXICO') = 'mexico'
         and public.pais_comparable_67('RD') = 'rd'
         and public.pais_comparable_67('   ') is null and public.pais_comparable_67(null) is null,
         'Paridad de país comparable con la regla de la aplicación'
  union all
  select 'C11',
         not exists (
           select 1 from public.armado_paquetes p
            where p.destinos_aereos_alternativos
              and (p.destino_id is null
                   or not exists (select 1 from public.armado_paquete_destinos_aereos a where a.paquete_id = p.id)
                   or exists (select 1 from public.armado_paquete_destinos_aereos a join public.destinos d on d.id = a.destino_id
                               join public.destinos dc on dc.id = p.destino_id
                              where a.paquete_id = p.id
                                and (not coalesce(d.activo, false) or public.pais_comparable_67(d.pais) is distinct from public.pais_comparable_67(dc.pais)
                                     or public.pais_comparable_67(dc.pais) is null))))
         and not exists (select 1 from public.armado_paquete_destinos_aereos a join public.armado_paquetes p on p.id = a.paquete_id where a.destino_id = p.destino_id),
         'Ningún paquete con el check encendido sin alternativas válidas, y el comercial nunca figura como alternativa'
  union all
  select 'C12',
         to_regprocedure('public.fn_auditoria()') is null
         or exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.armado_paquete_destinos_aereos') and t.tgname = 'trg_auditoria' and not t.tgisinternal),
         'Auditoría (087) adjunta a la tabla nueva'
)
select case when bool_and(ok) then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok) as ok,
       count(*) filter (where not ok) as fallos,
       count(*) as chequeos,
       coalesce(string_agg(codigo, ',' order by codigo) filter (where not ok), 'ninguno') as fallidos,
       string_agg(codigo || '=' || case when ok then 't' else 'f' end, ';' order by codigo) as resumen,
       jsonb_agg(jsonb_build_object('codigo', codigo, 'ok', ok, 'detalle', detalle) order by codigo) as detalle
  from c;

rollback;
